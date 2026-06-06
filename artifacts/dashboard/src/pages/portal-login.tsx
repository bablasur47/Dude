import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { setPortalToken, hasPortalToken, fetchPortalMe } from "@/lib/portal";
import { Button } from "@/components/ui/button";
import { MessageCircle, Zap, History, SlidersHorizontal, AlertTriangle } from "lucide-react";

type ErrorKind = "no_code" | "token_failed" | "auth_failed" | "user_fetch_failed" | string;

function ErrorBox({ kind }: { kind: ErrorKind }) {
  if (kind === "token_failed") {
    return (
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-4 space-y-3">
        <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Discord login failed — setup required
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          The bot owner needs to fix two things in the{" "}
          <a
            href="https://discord.com/developers/applications"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-400 underline underline-offset-2"
          >
            Discord Developer Portal
          </a>
          :
        </p>
        <ol className="text-xs text-muted-foreground space-y-2 list-decimal list-inside">
          <li>
            <span className="text-foreground font-medium">Add DISCORD_CLIENT_SECRET</span> to your server's{" "}
            <span className="font-mono bg-muted px-1 rounded">.env</span> file.
            <br />
            <span className="text-muted-foreground/70">
              Found at: Your App → OAuth2 → Client Secret
            </span>
          </li>
          <li>
            <span className="text-foreground font-medium">Add the redirect URI</span> in your Discord app.
            <br />
            <span className="text-muted-foreground/70">
              Your App → OAuth2 → Redirects → Add:{" "}
            </span>
            <span className="font-mono text-amber-400 break-all">
              {window.location.origin}/api/auth/discord/callback
            </span>
          </li>
        </ol>
        <p className="text-xs text-muted-foreground/60">
          Then set{" "}
          <span className="font-mono bg-muted px-1 rounded">
            DISCORD_REDIRECT_URI={window.location.origin}/api/auth/discord/callback
          </span>{" "}
          in your .env and restart.
        </p>
      </div>
    );
  }

  const messages: Record<string, string> = {
    no_code: "Discord auth was cancelled.",
    auth_failed: "Authentication failed. Please try again.",
    user_fetch_failed: "Couldn't fetch your Discord profile. Please try again.",
  };

  return (
    <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3 text-sm text-destructive">
      {messages[kind] ?? "Something went wrong. Please try again."}
    </div>
  );
}

export function PortalLogin() {
  const [, setLocation] = useLocation();
  const [error, setError] = useState<ErrorKind | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const err = params.get("error");

    if (token) {
      setPortalToken(token);
      window.history.replaceState({}, "", window.location.pathname);
      setLocation("/portal/home");
      return;
    }

    if (err) setError(err);

    if (hasPortalToken()) {
      fetchPortalMe()
        .then(() => setLocation("/portal/home"))
        .catch(() => setChecking(false));
    } else {
      setChecking(false);
    }
  }, [setLocation]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Checking session...</div>
      </div>
    );
  }

  const features = [
    { icon: History, label: "View your chat history with Priya" },
    { icon: SlidersHorizontal, label: "Set your nickname, pronouns & vibe" },
    { icon: MessageCircle, label: "Reset history anytime" },
    { icon: Zap, label: "Priya remembers your preferences" },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-500/5 via-background to-background pointer-events-none" />

      <div className="relative w-full max-w-sm space-y-8">
        <div className="text-center space-y-3">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 text-3xl font-bold shadow-lg shadow-indigo-500/5">
            P
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Priya Portal</h1>
            <p className="text-muted-foreground text-sm mt-1">Your personal space with Priya</p>
          </div>
        </div>

        <div className="space-y-2">
          {features.map((f) => (
            <div key={f.label} className="flex items-center gap-3 text-sm text-muted-foreground">
              <f.icon className="w-4 h-4 text-indigo-400 shrink-0" />
              {f.label}
            </div>
          ))}
        </div>

        {error && <ErrorBox kind={error} />}

        <a href="/api/auth/discord">
          <Button className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold h-11 gap-2">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.001.022.015.043.03.056a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.030z" />
            </svg>
            Continue with Discord
          </Button>
        </a>

        <p className="text-center text-xs text-muted-foreground">
          You need to have chatted with Priya at least once on Discord to access the portal.
        </p>
      </div>
    </div>
  );
}
