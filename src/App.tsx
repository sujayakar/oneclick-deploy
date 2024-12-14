import { Button } from "@/components/ui/button";
import { SignInButton, UserButton } from "@clerk/clerk-react";
import {
  Authenticated,
  Unauthenticated,
  useAction,
  useMutation,
  useQuery,
} from "convex/react";
import { api } from "../convex/_generated/api";
import { useState } from "react";

// TODO:
// - [ ] Should we be using Bun? Much faster?
// - [ ] Support paths within repos

type Repo = {
  githubUrl: string;
  teamSlug: string;
};

type Step =
  | { type: "start" }
  | { type: "picked repo"; repo: Repo }
  | { type: "opened dashboard"; repo: Repo }
  | { type: "submitted token"; repo: Repo }
  | { type: "ready to deploy"; repo: Repo; deviceToken: string }  

export default function App() {
  const [repo, setRepo] = useState<Repo>({ githubUrl: "https://github.com/get-convex/multiplayer-cursors", teamSlug: "sujayakar-team" });
  const [step, setStep] = useState<Step>({ type: "start" });
  const [authToken, setAuthToken] = useState<string | null>(null);

  const exchangeToken = useAction(api.cloneRepo.exchangeToken);

  const handlePickRepo = () => {
    if (!repo.githubUrl) {
      return;
    }
    setStep({ type: "picked repo", repo });
  };

  const handleExchangeToken = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!authToken || step.type !== "opened dashboard") {
      return;
    }
    setStep({ type: "submitted token", repo: step.repo });
    try {
      const deviceToken = await exchangeToken({ authToken });
      setStep({ type: "ready to deploy", repo: step.repo, deviceToken });
    } catch (error) {
      console.error("Error exchanging token:", error);
      setStep({ type: "start" });
    }
  };

  return (
    <main className="container max-w-4xl flex flex-col gap-8">
      <h1 className="text-4xl font-extrabold my-8 text-center">
        Deploy to Convex
      </h1>
      {!!(step as any).repo && (
        <div className="flex flex-col items-center gap-4">
          <p className="text-foreground">
            Repo: {(step as any).repo.githubUrl}
          </p>
        </div>
      )}
      <div className="flex justify-center">
        {step.type === "start" && (
          <form          
            onSubmit={(e) => {
              e.preventDefault();
              handlePickRepo();
            }}
            className="flex flex-col items-center gap-4 w-full"
          >
            <p className="text-foreground">Pick a GitHub repo to deploy:</p>
            <div className="flex flex-col gap-2 w-full max-w-2xl">
              <input
                type="text"
                value={repo?.githubUrl ?? ""}
                onChange={(e) =>
                  setRepo({ ...repo, githubUrl: e.target.value })
                }
                className="flex-1 px-3 py-2 rounded-md bg-background border border-input text-foreground"
                placeholder="GitHub repo URL"
              />
              <input
                type="text"
                value={repo?.teamSlug ?? ""}
                onChange={(e) => setRepo({ ...repo, teamSlug: e.target.value })}
                className="flex-1 px-3 py-2 rounded-md bg-background border border-input text-foreground"
                placeholder="Team slug"
              />
              <Button type="submit">Submit</Button>
            </div>
          </form>
        )}
        {step.type === "picked repo" && (
          <a
            target="_blank"
            href="https://dashboard.convex.dev/auth"
            onClick={() =>
              setStep({ type: "opened dashboard", repo: step.repo })
            }
            className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Get <code className="mx-1">convex dev</code> access token
          </a>
        )}
        {step.type === "opened dashboard" && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-foreground">
              Paste in the access token you got from the dashboard:
            </p>
            <form
              onSubmit={handleExchangeToken}
              className="flex gap-2 w-full max-w-2xl"
            >
              <input
                type="text"
                value={authToken ?? ""}
                onChange={(e) => setAuthToken(e.target.value)}
                className="flex-1 px-3 py-2 rounded-md bg-background border border-input text-foreground"
                placeholder="Access token"
              />
              <Button type="submit">Submit</Button>
            </form>
          </div>
        )}
        {step.type === "submitted token" && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-foreground">Waiting for device token...</p>
          </div>
        )}
        {step.type === "ready to deploy" && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-foreground">Ready to deploy!</p>
            <p className="text-foreground">
              <Button>Deploy</Button>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

// function Test() {
// <Authenticated>
//         <SignedIn />
//       </Authenticated>
//       <Unauthenticated>
//         <div className="flex justify-center">
//           <SignInButton mode="modal">
//             <Button>Sign in</Button>
//           </SignInButton>
//         </div>
//       </Unauthenticated>
// }

// function SignedIn() {
//   const { numbers, viewer } =
//     useQuery(api.myFunctions.listNumbers, {
//       count: 10,
//     }) ?? {};
//   const addNumber = useMutation(api.myFunctions.addNumber);

//   return (
//     <>
//       <p>Welcome {viewer}!</p>
//       <p className="flex gap-4 items-center">
//         This is you:
//         <UserButton afterSignOutUrl="#" />
//       </p>
//       <p>
//         Click the button below and open this page in another window - this data
//         is persisted in the Convex cloud database!
//       </p>
//       <p>
//         <Button
//           onClick={() => {
//             void addNumber({ value: Math.floor(Math.random() * 10) });
//           }}
//         >
//           Add a random number
//         </Button>
//       </p>
//       <p>
//         Numbers:{" "}
//         {numbers?.length === 0
//           ? "Click the button!"
//           : numbers?.join(", ") ?? "..."}
//       </p>
//       <p>
//         Edit{" "}
//         <code className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold">
//           convex/myFunctions.ts
//         </code>{" "}
//         to change your backend
//       </p>
//       <p>
//         Edit{" "}
//         <code className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold">
//           src/App.tsx
//         </code>{" "}
//         to change your frontend
//       </p>
//       <p>
//         Check out{" "}
//         <a
//           className="font-medium text-primary underline underline-offset-4"
//           target="_blank"
//           href="https://docs.convex.dev/home"
//         >
//           Convex docs
//         </a>
//       </p>
//     </>
//   );
// }
