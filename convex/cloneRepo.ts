"use node";

import { v } from "convex/values";
import { action, ActionCtx, internalMutation } from "./_generated/server";
import path from "path";
import decompress from 'decompress';
import * as fs from "fs";
import { tmpdir } from "os";
import { chdir } from "process";
import * as childProcess from "node:child_process";
import { promisify } from "node:util";
import os from "os";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

const execAsync = promisify(childProcess.exec);


export const exchangeToken = action({
    args: {
        authToken: v.string(),
    },
    handler: async (ctx, args) => {
        const response = await fetch("https://provision.convex.dev/api/authorize", {
            method: "POST",
            headers: {                
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                "authnToken": args.authToken,
                "deviceName": "oneclick-deploy",
            }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error);
        }
        const { accessToken } = data;
        if (typeof accessToken !== "string") {
            throw new Error("Invalid access token");
        }
        return accessToken;
    }
})

class Step {
    private lastLogged: Map<string, number> = new Map();
    constructor(private ctx: ActionCtx, private stepId: Id<"downloadSteps">) {
    }

    async log(message: string) {
        await this.ctx.runMutation(internal.downloads.logStep, {
            step: this.stepId,
            ts: Date.now(),
            message,
        });
    }

    async logDebounced(key: string, duration: number, message: string) {
        if (this.lastLogged.get(key) && Date.now() - this.lastLogged.get(key)! < duration) {
            return;
        }
        this.lastLogged.set(key, Date.now());
        await this.log(message);
    }

    async fail(error: string) {
        await this.ctx.runMutation(internal.downloads.failDownloadStep, {
            id: this.stepId,
            error,
        });
    }

    async succeed() {
        await this.ctx.runMutation(internal.downloads.succeedDownloadStep, {
            id: this.stepId,
        });
    }
}


async function withStep<T>(ctx: ActionCtx, name: string, downloadId: string, f: (step: Step) => Promise<T>) {
    const stepId = await ctx.runMutation(internal.downloads.createDownloadStep, {
        downloadId: downloadId,
        step: name,
    });
    const step = new Step(ctx, stepId);
    let result: T;
    try {
        result = await f(step);        
    } catch (error: any) {
        await step.fail(error.message);
        throw error;
    }
    await step.succeed();
    return result;
}

export const downloadRepo = action({
    args: {
        downloadId: v.string(),
        repoUrl: v.string(),
        path: v.string(),
        deviceToken: v.string(),
        teamSlug: v.string(),
    },
    handler: async (ctx, args) => {
        const tempDir = fs.mkdtempSync(path.join(tmpdir(), 'repo-'));        
        await ctx.runMutation(internal.downloads.createDownload, {
            id: args.downloadId,
            repoUrl: args.repoUrl,
            path: args.path,
            teamSlug: args.teamSlug,
        });        
        try {
            const { repoName, zipPath } = await withStep(ctx, "Downloading repository...", args.downloadId, async (step) => {
                if (!args.repoUrl.startsWith("https://github.com/")) {
                    throw new Error("Invalid repo URL");
                }
                const repoName = args.repoUrl.split("/").pop();
                if (!repoName) {
                    throw new Error("Invalid repo URL");
                }
                const zipUrl = args.repoUrl + "/archive/refs/heads/main.zip";
                await step.log(`Downloading ${args.repoUrl}...`);                
                const response = await fetch(zipUrl);
                if (!response.ok) {
                    throw new Error("Failed to download repo");
                }
                if (!response.body) {
                    throw new Error("No response body");
                }    
                if (response.headers.get('content-type') !== 'application/zip') {
                    throw new Error(`Invalid content type: ${response.headers.get('content-type')}`);
                }        
                const zipPath = path.join(tempDir, 'repo.zip');
                const fileStream = fs.createWriteStream(zipPath);
                const resp = await response.body.getReader();            
                const start = Date.now();
                let totalBytes = 0;                
                while (true) {
                    const { done, value } = await resp.read();                
                    if (done) {
                        break;                
                    }
                    totalBytes += value.length;
                    const speed = ((totalBytes / 1024 / 1024) / ((Date.now() - start) / 1000)).toFixed(2);
                    await step.logDebounced('download', 1000, `Downloaded ${totalBytes} bytes (${speed} MB/s)`);
                    fileStream.write(value);                                    
                }
                fileStream.end();                
                await step.log('Done!');              
                return { repoName, zipPath };
            });
            await withStep(ctx, "Extracting repository...", args.downloadId, async (step) => {                
                const files = await decompress(zipPath, tempDir);            
                let numFiles = 0;
                for (const file of files) {                    
                    if (!fs.existsSync(path.join(tempDir, file.path))) {
                        throw new Error("Failed to decompress repo");
                    }                    
                    numFiles++;
                    await step.logDebounced('decompress', 1000, `Extracted ${numFiles} files`);
                }   
                await step.log('Done!');              
            });
            const workingDir = path.join(tempDir, repoName + '-main');
            chdir(workingDir);
            await withStep(ctx, "Installing dependencies...", args.downloadId, async (step) => {
                const { stdout: nodeVersion } = await execAsync('node -v');
                await step.log(`Node version: ${nodeVersion.trim()}`);
                const { stdout: npmVersion } = await execAsync('npm -v');
                await step.log(`NPM version: ${npmVersion.trim()}`);                                

                await new Promise<void>((resolve, reject) => {
                    const npm = childProcess.spawn('npm', ['install'], { 
                        env: { ...process.env, HOME: tempDir },
                        stdio: ['ignore', 'pipe', 'pipe']
                    });
    
                    npm.stdout.on('data', async (data) => {
                        const line = data.toString();                        
                        await step.log(line);
                    });
    
                    npm.stderr.on('data', async (data) => {
                        const line = data.toString();
                        await step.log(line);
                    });
    
                    npm.on('close', (code) => {                        
                        if (code === 0) {
                            resolve();
                        } else {
                            reject(new Error(`npm install failed with code ${code}`));
                        }
                    });
                    npm.on('error', (err) => {
                        reject(err);
                    });
                });
            });

            const env = await withStep(ctx, "Deploying...", args.downloadId, async (step) => {
                const convexConfigPath = path.join(tempDir, '.convex', 'config.json');
                fs.mkdirSync(path.dirname(convexConfigPath), { recursive: true });
                fs.writeFileSync(convexConfigPath, JSON.stringify({"accessToken": args.deviceToken}));
                await step.log(`Wrote config to ${convexConfigPath}`);

                await new Promise<void>((resolve, reject) => {
                    const cmdArgs = [
                        'convex',
                        'dev',
                        '--once',
                        '--configure',
                        'new',
                        '--team', args.teamSlug,    
                        '--project', `oneclick-${repoName}`,
                    ]
                    const env = {
                        ...process.env,
                        HOME: tempDir,                
                    }
                    const convex = childProcess.spawn('npx', cmdArgs, { 
                        env,
                        stdio: ['ignore', 'pipe', 'pipe']
                    });
    
                    convex.stdout.on('data', async (data) => {
                        const line = data.toString();
                        await step.log(line);
                    });
    
                    convex.stderr.on('data', async (data) => {
                        const line = data.toString();
                        await step.log(line);
                    });
    
                    convex.on('close', (code) => {
                        const deployEnd = Date.now();                        
                        if (code === 0) {
                            resolve();
                        } else {
                            reject(new Error(`deploy failed with code ${code}`));
                        }
                    });
                    convex.on('error', (err) => {
                        reject(err);
                    });
                }); 
    
                const env = fs.readFileSync(path.join(workingDir, '.env.local'), 'utf8');
                return env;
            });
            await ctx.runMutation(internal.downloads.succeedDownload, {
                id: args.downloadId,
            });
            return env;
        } catch (error: any) {
            await ctx.runMutation(internal.downloads.failDownload, {
                id: args.downloadId,
                error: error.message,
            });
            throw error;
        } finally {
            fs.rmdirSync(tempDir, { recursive: true });
        }
    }
})

        
        

//         const start = Date.now();
        
//         console.log('Fetching', zipUrl);
//         const response = await fetch(zipUrl);
        
        
//         try {            
            
//             console.log('Done! Decompressing...');
//             const files = await decompress(zipPath, tempDir);            
//             for (const file of files) {
//                 // console.log('file', file.path);
//                 if (!fs.existsSync(path.join(tempDir, file.path))) {
//                     throw new Error("Failed to decompress repo");
//                 }
//             }    
//             console.log('Decompressed!');

//             const workingDir = path.join(tempDir, repoName + '-main');
//             chdir(workingDir);

            

//             const convexConfigPath = path.join(tempDir, '.convex', 'config.json');
//             fs.mkdirSync(path.dirname(convexConfigPath), { recursive: true });
//             fs.writeFileSync(convexConfigPath, JSON.stringify({"accessToken": args.deviceToken}));
//             console.log('Wrote config to', convexConfigPath);            

//             const npmStart = Date.now();
            
//             const npmEnd = Date.now();
//             console.log('npm install time:', npmEnd - npmStart);            

//             const deployStart = Date.now();
            
//         } finally {
//             fs.rmdirSync(tempDir, { recursive: true });
//         }                
//     }
// });

export const findEnv = action({
    args: {
        path: v.string(),
    },
    handler: async (ctx, args) => {
        try {
            const { stdout: nodeVersion } = await execAsync('node -v');
            console.log('node version:', nodeVersion.trim());
            
            const { stdout: npmVersion } = await execAsync('npm -v');
            console.log('npm version:', npmVersion.trim());
        } catch (error) {
            console.error('Error executing commands:', error);
        }

        // console.log(dummyNpm);
        // const decompress = require.resolve('decompress');
        // const npm = require.resolve('npm');
        // const convex = require.resolve('convex');
    }
})