import { ClerkProvider, useAuth } from "@clerk/clerk-react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "./index.css";

const convex = new ConvexReactClient("https://accomplished-parrot-505.convex.cloud");

ReactDOM.createRoot(document.getElementById("root")!).render(
    <ErrorBoundary>
      <ClerkProvider
        publishableKey={"pk_test_Y3JlYXRpdmUtc2hyaW1wLTU3LmNsZXJrLmFjY291bnRzLmRldiQ"}
      >
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
          <App />
        </ConvexProviderWithClerk>
      </ClerkProvider>
    </ErrorBoundary>
);
