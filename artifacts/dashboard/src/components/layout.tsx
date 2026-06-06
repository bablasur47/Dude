import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useLogout } from "@workspace/api-client-react";
import { Activity, Server, Users, Key, BrainCircuit, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

// Paths relative to the wouter base (/dashboard) — no nest, flat routes
const navItems = [
  { href: "/overview", label: "Overview", icon: Activity },
  { href: "/servers", label: "Servers", icon: Server },
  { href: "/users", label: "Users", icon: Users },
  { href: "/apis", label: "API Keys", icon: Key },
  { href: "/personality", label: "Personality", icon: BrainCircuit },
];

export function DashboardLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const logoutMutation = useLogout({
    mutation: {
      onSuccess: () => {
        localStorage.removeItem("dashboard_token");
        setLocation("/login");
      },
    },
  });

  function isActive(href: string) {
    return location === href || location.startsWith(href + "/");
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground selection:bg-primary/30">
      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex w-64 border-r border-border/50 bg-card/30 backdrop-blur flex-col shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-border/50 bg-background/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center border border-primary/30 text-primary font-bold">
              P
            </div>
            <div className="flex flex-col">
              <span className="font-semibold leading-tight tracking-tight text-sm">Priya System</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest">Mission Control</span>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <span className={`flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-all duration-200 cursor-pointer ${
                isActive(item.href)
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}>
                <item.icon className={`w-4 h-4 ${isActive(item.href) ? "text-primary" : ""}`} />
                {item.label}
              </span>
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-border/50 bg-background/50">
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={() => logoutMutation.mutate()}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden h-14 border-b border-border/50 flex items-center justify-between px-4 bg-background/80 backdrop-blur sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-primary/20 flex items-center justify-center border border-primary/30 text-primary font-bold text-sm">
              P
            </div>
            <span className="font-semibold text-sm">Priya Control</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => logoutMutation.mutate()}
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-auto p-4 pb-24 md:pb-8 md:p-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>
      </main>

      {/* ── Mobile bottom navigation bar ── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-background/95 backdrop-blur border-t border-border/50 z-20 flex">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href} className="flex-1">
            <span className={`flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
              isActive(item.href) ? "text-primary" : "text-muted-foreground"
            }`}>
              <item.icon className="w-5 h-5" />
              {item.label}
            </span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
