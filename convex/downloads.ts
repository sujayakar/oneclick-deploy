import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const createDownload = internalMutation({
    args: {
        id: v.string(),
        repoUrl: v.string(),
        path: v.string(),        
        teamSlug: v.string(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db.query("downloads").withIndex("by_download_id", (q) => q.eq("id", args.id)).first();
        if (existing) {
            throw new Error("Download already exists");
        }
        await ctx.db.insert("downloads", {
            id: args.id,
            repoUrl: args.repoUrl,
            path: args.path,
            teamSlug: args.teamSlug,
            status: { type: "pending" },
        });
    }
})

export const failDownload = internalMutation({
    args: {
        id: v.string(),
        error: v.string(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db.query("downloads").withIndex("by_download_id", (q) => q.eq("id", args.id)).first();
        if (!existing) {
            throw new Error("Download not found");
        }
        return await ctx.db.patch(existing._id, { status: { type: "error", error: args.error, duration: Date.now() - existing._creationTime } });
    }
})

export const succeedDownload = internalMutation({
    args: {
        id: v.string(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db.query("downloads").withIndex("by_download_id", (q) => q.eq("id", args.id)).first();
        if (!existing) {
            throw new Error("Download not found");
        }
        await ctx.db.patch(existing._id, { status: { type: "success", duration: Date.now() - existing._creationTime } });
    }
})

export const createDownloadStep = internalMutation({
    args: {
        downloadId: v.string(),
        step: v.string(),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("downloadSteps", {
            downloadId: args.downloadId,
            step: args.step,
            status: { type: "pending" },
        });
    }
})

export const updateDownloadStep = internalMutation({
    args: {
        id: v.id("downloadSteps"),
        step: v.string(),
    },
    handler: async (ctx, args) => {
        return await ctx.db.patch(args.id, { step: args.step });
    }
})

export const failDownloadStep = internalMutation({
    args: {
        id: v.id("downloadSteps"),
        error: v.string(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db.get(args.id);
        if (!existing) {
            throw new Error("Download step not found");
        }
        return await ctx.db.patch(args.id, { status: { type: "error", error: args.error, duration: Date.now() - existing._creationTime } });
    }
})

export const logStep = internalMutation({
    args: {
        step: v.id("downloadSteps"),
        ts: v.number(),
        message: v.string(),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("logs", { step: args.step, ts: args.ts, message: args.message });
    }
})

export const succeedDownloadStep = internalMutation({
    args: {
        id: v.id("downloadSteps"),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db.get(args.id);
        if (!existing) {
            throw new Error("Download step not found");
        }
        return await ctx.db.patch(args.id, { status: { type: "success", duration: Date.now() - existing._creationTime } });
    }
})