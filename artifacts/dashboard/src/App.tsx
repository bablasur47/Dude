import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setupAuth } from "@/lib/api";
import { hasPortalToken } from "@/lib/portal";
import { useGetMe } from "@workspace/api-client-react";

import { Login } from "@/pages/login";
import { DashboardLayout } from "@/components/layout";
import { Overview } from "@/pages/dashboard";
import { Servers } from "@/pages/servers";
import { ServerDetail } from "@/pages/server-detail";
import { Users } from "@/pages/users";
import { UserDetail } from "@/pages/user-detail";
import { ApiKeys } from "@/pages/api-keys";
import { Personality } from "@/pages/personality";
import { PortalLogin } from "@/pages/portal-login";
import { PortalHome } from "@/pages/portal-home";
import { PortalHistory } from "@/pages/portal-history";
import { PortalSettings } from "@/pages/portal-settings";
import NotFound from "@/pages/not-found";

setupAuth();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

// Wrap owner dashboard pages in layout
function L({ children }: { children: React.ReactNode }) {
  return <DashboardLayout>{children}</DashboardLayout>;
}

// ─── Owner auth guard ─────────────────────────────────────────────────────────

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useGetMe();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading) {
      if (!data?.authenticated) {
        if (location !== "/login" && !location.startsWith("/portal")) {
          setLocation("/login");
        }
      } else {
        if (location === "/login" || location === "/") setLocation("/overview");
      }
    }
  }, [data, isLoading, location, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        Initializing...
      </div>
    );
  }

  // Let portal routes through without owner auth
  if (location.startsWith("/portal")) return <>{children}</>;

  if (!data?.authenticated && location !== "/login") return null;

  return <>{children}</>;
}

// ─── Portal auth guard ────────────────────────────────────────────────────────

function PortalGuard({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!hasPortalToken()) {
      setLocation("/portal");
    }
  }, [setLocation]);

  if (!hasPortalToken()) return null;
  return <>{children}</>;
}

// ─── Router ───────────────────────────────────────────────────────────────────

function Router() {
  return (
    <AuthGuard>
      <Switch>
        {/* Owner dashboard */}
        <Route path="/login" component={Login} />
        <Route path="/overview"><L><Overview /></L></Route>
        <Route path="/servers/:guildId"><L><ServerDetail /></L></Route>
        <Route path="/servers"><L><Servers /></L></Route>
        <Route path="/users/:userId"><L><UserDetail /></L></Route>
        <Route path="/users"><L><Users /></L></Route>
        <Route path="/apis"><L><ApiKeys /></L></Route>
        <Route path="/personality"><L><Personality /></L></Route>

        {/* User portal */}
        <Route path="/portal" component={PortalLogin} />
        <Route path="/portal/home">
          <PortalGuard><PortalHome /></PortalGuard>
        </Route>
        <Route path="/portal/history">
          <PortalGuard><PortalHistory /></PortalGuard>
        </Route>
        <Route path="/portal/settings">
          <PortalGuard><PortalSettings /></PortalGuard>
        </Route>

        <Route component={NotFound} />
      </Switch>
    </AuthGuard>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
