import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { Toaster } from "@/components/ui/toaster";

const deployUrl = "https://sujayakar--oneclick-deploy-handler.modal.run";

type Step =
  | { type: "start" }
  | { type: "deploying"; repoUrl: string; teamSlug: string; authToken: string }
  | { type: "done"; deploymentName: string; logEvents: LogEvent[] };

const DEFAULT_GIT_URL = "https://github.com/sujayakar/oneclick-demo.git";
const DEFAULT_TEAM_SLUG = "sujayakar-team";

export default function App() {
  const [step, setStep] = useState<Step>({ type: "start" });
  return (
    <>
      <main className="container max-w-4xl flex flex-col gap-8">
        <h1 className="text-4xl font-extrabold my-8 text-center">
          Deploy to Convex
        </h1>
        {step.type === "start" && <StartForm setStep={setStep} />}
        {step.type === "deploying" && (
          <DeployStatus {...step} setStep={setStep} />
        )}
        {step.type === "done" && <Done {...step} />}
      </main>
      <Toaster />
    </>
  );
}

function StartForm(props: { setStep: (step: Step) => void }) {
  const { toast } = useToast();
  const [repoUrl, setRepoUrl] = useState<string | null>(DEFAULT_GIT_URL);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [teamSlug, setTeamSlug] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!repoUrl) {
      toast({
        variant: "destructive",
        title: "Missing repo URL",
        description: "Repo URL is required",
      });
      return;
    }

    // Do some normalization of the URL to be helpful.
    let normalized = repoUrl.trim();
    if (!normalized.startsWith("https://github.com/")) {
      toast({
        variant: "destructive",
        title: "Invalid repo URL",
        description: "Repo URL must start with https://github.com/.",
      });
      return;
    }
    if (normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }
    if (!normalized.endsWith(".git")) {
      normalized = `${normalized}.git`;
    }
    if (!normalized.endsWith(".git")) {
      normalized = `${normalized}.git`;
    }
    if (
      !normalized.startsWith("https://github.com/") ||
      !normalized.endsWith(".git")
    ) {
      toast({
        variant: "destructive",
        title: "Invalid repo URL",
        description:
          "Repo URL must start with https://github.com/ and end with .git.",
      });
      return;
    }
    if (!teamSlug) {
      toast({
        variant: "destructive",
        title: "Missing team slug",
        description: "Team slug is required",
      });
      return;
    }
    if (!authToken) {
      toast({
        variant: "destructive",
        title: "Missing auth token",
        description: "Auth token is required",
      });
      return;
    }
    props.setStep({
      type: "deploying",
      repoUrl: normalized.trim(),
      teamSlug: teamSlug.trim(),
      authToken: authToken.trim(),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <label
          htmlFor="repo-url"
          className="block text-sm font-medium text-foreground"
        >
          GitHub (Git) repo URL
        </label>
        <input
          id="repo-url"
          type="text"
          placeholder={DEFAULT_GIT_URL}
          value={repoUrl ?? ""}
          onChange={(e) => setRepoUrl(e.target.value)}
          className="w-full px-3 py-2 border rounded-md border-input bg-background placeholder:text-muted-foreground placeholder:italic"
        />
      </div>

      <div className="space-y-2">
        <label
          htmlFor="team-slug"
          className="block text-sm font-medium text-foreground"
        >
          Convex team slug
        </label>
        <input
          id="team-slug"
          type="text"
          placeholder={DEFAULT_TEAM_SLUG}
          value={teamSlug ?? ""}
          onChange={(e) => setTeamSlug(e.target.value)}
          className="w-full px-3 py-2 border rounded-md border-input bg-background placeholder:text-muted-foreground placeholder:italic"
        />
      </div>

      <div className="space-y-2">
        <label
          htmlFor="auth-token"
          className="block text-sm font-medium text-foreground"
        >
          Auth token (from{" "}
          <a
            href="https://dashboard.convex.dev/auth"
            target="_blank"
            className="text-primary hover:text-primary/90 underline underline-offset-4"
          >
            Convex dashboard
          </a>
          )
        </label>
        <input
          id="auth-token"
          type="password"
          value={authToken ?? ""}
          onChange={(e) => setAuthToken(e.target.value)}
          className="w-full px-3 py-2 border rounded-md border-input bg-background"
        />
      </div>

      <Button type="submit" className="w-full">
        Deploy to Convex
      </Button>
    </form>
  );
}

type LogEvent = { status: string } | { error: string } | { done: string };

function DeployStatus(props: {
  repoUrl: string;
  teamSlug: string;
  authToken: string;
  setStep: (step: Step) => void;
}) {
  const [logEvents, setLogEvents] = useState<LogEvent[]>([]);
  useEffect(() => {
    let isFirstRun = true;
    const promise = async () => {
      if (!isFirstRun) return;
      isFirstRun = false;

      const body = {
        repo_url: props.repoUrl,
        team_slug: props.teamSlug,
        auth_token: props.authToken,
      };
      try {
        const response = await fetch(deployUrl, {
          method: "POST",
          body: JSON.stringify(body),
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
          },
        });
        if (!response.ok) {
          throw new Error("Failed to fetch status");
        }
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("Failed to get reader");
        }
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          const text = decoder.decode(value);
          const events: LogEvent[] = [];
          for (const line of text.split("\n")) {
            if (!line.startsWith("data: ")) {
              continue;
            }
            const trimmed = line.slice(6).trim();
            if (trimmed === "") {
              continue;
            }
            const event = JSON.parse(trimmed) as LogEvent;
            events.push(event);
            if ("done" in event) {
              setLogEvents((e) => {
                const newLogEvents = [...e, ...events];
                props.setStep({
                  type: "done",
                  deploymentName: event.done,
                  logEvents: newLogEvents,
                });
                return newLogEvents;
              });
              return;
            }
          }
          setLogEvents((e) => [...e, ...events]);
        }
      } catch (error: any) {
        console.error(error);
        setLogEvents((e) => [...e, { error: error.toString() }]);
      }
    };
    void promise();
    return () => {};
  }, [props.repoUrl, props.teamSlug, props.authToken]);

  return (
    <div className="space-y-4">
      <div className="p-4 bg-background border rounded-md">
        <h3 className="font-semibold mb-2 pb-2 border-b flex items-center gap-2">
          <span className="animate-spin inline-block w-4 h-4 border-2 border-foreground/20 border-t-foreground rounded-full" />
          Deploying...
        </h3>
        <DeploymentLogs logEvents={logEvents} />
      </div>
    </div>
  );
}

function DeploymentLogs(props: { logEvents: LogEvent[] }) {
  const errors = [];
  const statuses = [];
  let done: string | undefined = undefined;
  for (const event of props.logEvents) {
    if ("error" in event) {
      errors.push(event.error);
    }
    if ("status" in event) {
      statuses.push(event.status);
    }
    if ("done" in event) {
      done = event.done;
    }
  }
  return (
    <div
      className="font-mono space-y-1 h-[300px] overflow-y-auto flex flex-col"
      ref={(el) => {
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      }}
    >
      {errors.map((error, i) => (
        <div key={i} className="text-red-800 font-mono">
          {error}
        </div>
      ))}
      {statuses.map((status, i) => (
        <div key={i} className="text-foreground">
          {status}
        </div>
      ))}
      {done && <div className="text-green-600 font-semibold">✓ {done}</div>}
    </div>
  );
}

function Done(props: { deploymentName: string; logEvents: LogEvent[] }) {
  return (
    <div className="p-6 bg-background border rounded-md shadow-sm">
      <h3 className="font-semibold mb-4 pb-3 border-b text-green-600 text-center text-2xl">
        Deployment complete!
      </h3>
      <div className="space-y-3 mb-6 pb-6 border-b">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">
            Deployment name:
          </span>
          <code className="font-mono bg-muted px-2 py-1 rounded">
            {props.deploymentName}
          </code>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">Deployment URL:</span>
          <a
            href={`https://${props.deploymentName}.convex.site/`}
            target="_blank"
            className="font-mono text-primary hover:text-primary/90 hover:underline"
          >
            https://{props.deploymentName}.convex.site/
          </a>
        </div>
      </div>
      <DeploymentLogs logEvents={props.logEvents} />
    </div>
  );
}
