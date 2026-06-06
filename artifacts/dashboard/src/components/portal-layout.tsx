import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Home, MessageSquare, Settings, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearPortalToken } from "@/lib/portal";

const navItems = [
  { href: "/portal/home", label: "Home", icon: Home },
  { href: "/portal/history", label: "History", icon: MessageSquare },
  { href: "/portal/settings", label: "Settings", icon: Settings },
];

export function PortalLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();

  function handleLogout() {
    clearPortalToken();
    setLocation("/portal");
  }

  function isActive(href: string) {
    return location === href || location.startsWith(href + "/");
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 border-r border-border/50 bg-card/20 flex-col shrink-0">
        <div className="h-16 flex items-center px-5 border-b border-border/50 gap-3">
          <div className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-sm">
            P
          </div>
          <div>
            <div className="font-semibold text-sm leading-tight">Priya Portal</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Your space</div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <span className={`flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-all cursor-pointer ${
                isActive(item.href)
                  ? "bg-indigo-500/10 text-indigo-400 font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}>
                <item.icon className="w-4 h-4" />
                {item.label}
              </span>
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-border/50">
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10 text-sm"
            onClick={handleLogout}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <div className="md:hidden h-14 border-b border-border/50 flex items-center justify-between px-4 bg-background/80 backdrop-blur sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-xs">P</div>
            <span className="font-semibold text-sm">Priya Portal</span>
          </div>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={handleLogout}>
            <LogOut className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-4 pb-24 md:pb-8 md:p-8">
          <div className="max-w-3xl mx-auto">{children}</div>
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-background/95 backdrop-blur border-t border-border/50 z-20 flex">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href} className="flex-1">
            <span className={`flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
              isActive(item.href) ? "text-indigo-400" : "text-muted-foreground"
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
