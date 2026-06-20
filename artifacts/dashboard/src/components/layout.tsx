import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useLogout } from "@workspace/api-client-react";
import { Activity, Server, Users, Key, BrainCircuit, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    <div className="flex min-h-screen bg-background text-foreground selection:bg-white/10">
      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex w-60 border-r border-white/8 bg-[#020202] flex-col shrink-0">
        <div className="h-16 flex items-center px-5 border-b border-white/8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-white/8 flex items-center justify-center border border-white/12 text-zinc-200 font-bold text-sm">
              P
            </div>
            <div className="flex flex-col">
              <span className="font-semibold leading-tight tracking-tight text-sm text-zinc-100">Priya System</span>
              <span className="text-[10px] text-zinc-600 uppercase tracking-widest">Mission Control</span>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <span className={`flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-all duration-150 cursor-pointer ${
                isActive(item.href)
                  ? "bg-white/8 text-zinc-100 font-medium border-l-2 border-zinc-300 pl-[10px]"
                  : "text-zinc-500 hover:bg-white/4 hover:text-zinc-300"
              }`}>
                <item.icon className={`w-4 h-4 shrink-0 ${isActive(item.href) ? "text-zinc-200" : "text-zinc-600"}`} />
                {item.label}
              </span>
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-white/8">
          <Button
            variant="ghost"
            className="w-full justify-start text-zinc-600 hover:text-red-400 hover:bg-red-500/8 text-sm"
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
        <div className="md:hidden h-14 border-b border-white/8 flex items-center justify-between px-4 bg-black/90 backdrop-blur sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-white/8 flex items-center justify-center border border-white/12 text-zinc-200 font-bold text-xs">
              P
            </div>
            <span className="font-semibold text-sm text-zinc-100">Priya Control</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-zinc-600 hover:text-red-400"
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
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-black/95 backdrop-blur border-t border-white/8 z-20 flex">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href} className="flex-1">
            <span className={`flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
              isActive(item.href) ? "text-zinc-200" : "text-zinc-600"
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
