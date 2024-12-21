import modal
import subprocess
import tempfile
import os
import json
import requests
from os.path import expanduser
from fastapi.responses import StreamingResponse
from packaging import version

image = (
    modal.Image.debian_slim(python_version="3.10")
    .pip_install("requests", "fastapi[standard]", "boto3", "packaging")
    .apt_install(["git", "unzip", "curl"])
    .run_commands("curl -fsSL https://bun.sh/install | bash")
)

app = modal.App("oneclick-deploy")


def exchange_token(auth_token: str, provision_url: str) -> str:
    response = requests.post(
        f"{provision_url}/api/authorize",
        json={
            "authnToken": auth_token,
            "deviceName": "oneclick-deploy",
        },
    )
    response.raise_for_status()
    data = response.json()
    if not response.ok:
        raise ValueError(data.error)
    return data["accessToken"]


def stream_command(cmd: list[str], **kwargs):
    handle = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        bufsize=1024,
        text=True,
        **kwargs,
    )
    for line in handle.stdout:
        yield line.strip()
    handle.wait()
    if handle.returncode != 0:
        raise Exception(
            f"Command {' '.join(cmd)} failed with return code {handle.returncode}"
        )


def download_repo(body: dict):
    repo_url = body["repo_url"]
    auth_token = body["auth_token"]
    team_slug = body["team_slug"]
    env_vars = body.get("env_vars", {})
    provision_url = body.get("provision_url", "https://provision.convex.dev")

    repo_name = repo_url.split("/")[-1].replace(".git", "")
    if not repo_name:
        raise ValueError("Invalid repo URL")

    bun_path = expanduser("~/.bun/bin/bun")

    with tempfile.TemporaryDirectory() as temp_dir:
        yield {"status": "Authenticating..."}
        access_token = exchange_token(auth_token, provision_url)

        yield {"status": "Cloning repo..."}

        for line in stream_command(
            ["git", "clone", repo_url, os.path.join(temp_dir, repo_name)]
        ):
            yield {"status": line}

        yield {"status": "Installing dependencies..."}
        for line in stream_command(
            [bun_path, "install"], cwd=os.path.join(temp_dir, repo_name)
        ):
            yield {"status": line}                

        cmd = [
            bun_path,
            'x',
            'convex',
            '--version'
        ]
        convex_version = subprocess.check_output(cmd, cwd=os.path.join(temp_dir, repo_name)).decode().strip()
        if version.parse(convex_version) < version.parse("1.17.0"):
            raise ValueError("Convex version must be at least 1.17.0")
        yield {"status": f"Convex version {convex_version}"}

        yield {"status": "Deploying to convex..."}        
        cmd = [
            bun_path,
            "x",
            "convex",
            "dev",
            "--once",
            "--configure",
            "new",
            "--team",
            team_slug,
            "--project",
            repo_name,
        ]        
        
        env = os.environ.copy()
        env["CONVEX_OVERRIDE_ACCESS_TOKEN"] = access_token
        for line in stream_command(cmd, cwd=os.path.join(temp_dir, repo_name), env=env):
            yield {"status": line}

        if env_vars:
            yield {"status": "Setting environment variables..."}
            for key, value in env_vars.items():
                cmd =[
                    bun_path,
                    'x',
                    'convex',
                    'env',
                    'set',
                    key,
                    value,
                ]
                for line in stream_command(cmd, cwd=os.path.join(temp_dir, repo_name), env=env):
                    yield {"status": line}

        yield {"status": "Getting deployment info..."}        
        cmd = [
            bun_path,
            'x',
            'convex',
            'dashboard',
            '--no-open',
        ]
        dashboard_url = subprocess.check_output(cmd, cwd=os.path.join(temp_dir, repo_name), env=env).decode().strip()
        deployment_name = dashboard_url.split("/")[-1]

        yield {"done": deployment_name}
        return

# 256MB of memory => 20x disk space => 5GB locally
# Try using an ephemeral disk?
@app.function(image=image, cpu=1, memory=256)
@modal.web_endpoint(method="POST")
def handler(body: dict):
    def stream_response():
        try:
            for message in download_repo(body):
                yield "data: " + json.dumps(message) + "\n\n"
        except Exception as e:
            print("Request failed", e)
            yield "data: " + json.dumps({"error": str(e)}) + "\n\n"            
            return

    return StreamingResponse(stream_response(), media_type="text/event-stream")


@app.local_entrypoint()
def main():
    call = handler.remote(
        "https://github.com/get-convex/prosemirror-sync.git",
        "",
        "",
        "sujayakar-team",
    )
    print("the square is", call)


def run_deployment_build(temp_dir, repo_name, bun_path): 
    package_json = json.loads(
        open(os.path.join(temp_dir, repo_name, "package.json")).read()
    )
    if "oneclick-build" not in package_json["scripts"]:
        return


    yield {"status": "Building for hosting..."}
    cmd = [
        bun_path,
        "run",
        "oneclick-build",
    ]
    for line in stream_command(cmd, cwd=os.path.join(temp_dir, repo_name)):
        yield {"status": line}

    dist_dir = os.path.join(temp_dir, repo_name, "dist")
    for dirpath, dirnames, filenames in os.walk(dist_dir):
        for filename in filenames:
            yield {"status": f"Uploading {filename}..."}
            cmd = [
                bun_path,
                "x",
                "convex",
                "run",
                "assets:startUpload",
            ]
            url = json.loads(
                subprocess.check_output(
                    cmd, cwd=os.path.join(temp_dir, repo_name)
                ).decode()
            ).strip()
            contents = open(os.path.join(dirpath, filename)).read()
            content_types = {
                ".html": "text/html",
                ".css": "text/css",
                ".js": "text/javascript",
                ".svg": "image/svg+xml",
            }
            _, ext = os.path.splitext(filename)
            if ext not in content_types:
                yield {"status": f"Unknown file type {ext}"}
                continue
            content_type = content_types[ext]
            resp = requests.post(
                url, data=contents, headers={"Content-Type": content_type}
            )
            resp.raise_for_status()
            storage_id = resp.json()["storageId"]
            path = os.path.relpath(os.path.join(dirpath, filename), dist_dir)
            cmd = [
                bun_path,
                "x",
                "convex",
                "run",
                "assets:uploadAsset",
                json.dumps(
                    {
                        "path": path,
                        "id": storage_id,
                        "contentType": content_type,
                    }
                ),
            ]
            subprocess.check_output(cmd, cwd=os.path.join(temp_dir, repo_name))        