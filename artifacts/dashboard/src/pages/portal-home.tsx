import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { fetchPortalMe, fetchPortalStats, deleteAllPortalHistory, type PortalUser, type PortalStats } from "@/lib/portal";
import { PortalLayout } from "@/components/portal-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquare, Settings, ArrowRight, Sparkles, Clock, Server, Trash2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function PortalHome() {
  const [user, setUser] = useState<PortalUser | null>(null);
  const [stats, setStats] = useState<PortalStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  async function load() {
    setLoading(true);
    try {
      const [u, s] = await Promise.all([fetchPortalMe(), fetchPortalStats()]);
      setUser(u);
      setStats(s);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleResetAll() {
    if (!confirm("Reset ALL your chat history with Priya across every server? This cannot be undone.")) return;
    setResetting(true);
    try {
      await deleteAllPortalHistory();
      toast({ title: "All cleared!", description: "Your entire chat history has been reset." });
      await load();
    } catch {
      toast({ title: "Error", description: "Could not clear history.", variant: "destructive" });
    } finally {
      setResetting(false);
    }
  }

  if (loading) {
    return (
      <PortalLayout>
        <div className="flex items-center justify-center h-64 text-zinc-600 text-sm">Loading your profile...</div>
      </PortalLayout>
    );
  }

  if (error) {
    return (
      <PortalLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <p className="text-destructive text-sm">{error}</p>
          <Button variant="outline" onClick={() => setLocation("/portal")}>Go back</Button>
        </div>
      </PortalLayout>
    );
  }

  const vibeLabels: Record<string, string> = {
    friend: "Friends",
    bestie: "Besties",
    crush: "Crush",
    formal: "Formal",
  };

  const totalMessages = stats?.servers.reduce((s, srv) => s + srv.messageCount, 0) ?? 0;
  const serverCount = stats?.servers.length ?? 0;
  const lastActive = stats?.servers[0]?.lastMessage ?? null;

  const lastUserMsg = stats?.recentMessages.find((m) => m.role === "user");
  const lastBotMsg = stats?.recentMessages.find((m) => m.role === "assistant");

  return (
    <PortalLayout>
      <div className="space-y-4">

        {/* Profile card */}
        <div className="bg-[#0a0a0a] border border-white/8 rounded-xl p-5">
          <div className="flex items-center gap-4">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="avatar" className="w-13 h-13 rounded-full border border-white/10" />
            ) : (
              <div className="w-13 h-13 rounded-full bg-white/6 border border-white/10 flex items-center justify-center text-zinc-300 font-bold text-xl">
                {user?.username?.[0]?.toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="font-bold text-lg text-zinc-100 truncate">
                {user?.nickname ? (
                  <span>{user.nickname} <span className="text-sm text-zinc-600 font-normal">({user?.username})</span></span>
                ) : (
                  user?.username
                )}
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {user?.relationshipVibe && (
                  <Badge variant="outline" className="text-xs bg-white/4 text-zinc-400 border-white/10">
                    {vibeLabels[user.relationshipVibe] ?? user.relationshipVibe}
                  </Badge>
                )}
                {user?.pronouns && (
                  <Badge variant="outline" className="text-xs border-white/10 text-zinc-500">{user.pronouns}</Badge>
                )}
                {user?.languageStyle === "english" && (
                  <Badge variant="outline" className="text-xs border-white/10 text-zinc-500">English mode</Badge>
                )}
              </div>
            </div>
            <Button variant="ghost" size="icon" className="shrink-0 text-zinc-600 hover:text-zinc-300" onClick={load}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>

          {!user?.nickname && !user?.relationshipVibe && (
            <div className="mt-4 flex items-start gap-3 bg-white/3 rounded-lg p-3 border border-white/6">
              <Sparkles className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
              <p className="text-xs text-zinc-600">
                Set your nickname and vibe so Priya knows exactly how to talk to you —{" "}
                <button className="text-zinc-400 hover:text-zinc-200 hover:underline" onClick={() => setLocation("/portal/settings")}>
                  go to Settings
                </button>.
              </p>
            </div>
          )}
        </div>

        {/* Activity stats row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total Messages", value: totalMessages.toString() },
            { label: "Servers", value: serverCount.toString() },
            { label: "Last Active", value: timeAgo(lastActive), small: true },
          ].map((s) => (
            <div key={s.label} className="bg-[#0a0a0a] border border-white/8 rounded-xl p-4 text-center">
              <div className={`font-bold text-zinc-100 ${s.small ? "text-sm leading-tight" : "text-2xl"}`}>{s.value}</div>
              <div className="text-xs text-zinc-600 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Per-server activity */}
        {stats && stats.servers.length > 0 && (
          <Card className="bg-[#0a0a0a] border-white/8">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm flex items-center gap-2 text-zinc-300">
                <Server className="w-4 h-4 text-zinc-500" />
                Activity by Server
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="space-y-3">
                {stats.servers.slice(0, 5).map((srv) => {
                  const pct = totalMessages > 0 ? (srv.messageCount / totalMessages) * 100 : 0;
                  return (
                    <div key={srv.guildId}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-zinc-300 font-medium truncate max-w-[60%]">{srv.guildName}</span>
                        <div className="flex items-center gap-2 text-zinc-600 shrink-0">
                          <Clock className="w-3 h-3" />
                          {timeAgo(srv.lastMessage)}
                          <span className="font-medium text-zinc-400">{srv.messageCount}</span>
                        </div>
                      </div>
                      <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-zinc-400/50 rounded-full transition-all"
                          style={{ width: `${Math.max(pct, 2)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                {stats.servers.length > 5 && (
                  <p className="text-xs text-zinc-600 text-center pt-1">+{stats.servers.length - 5} more servers</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Last conversation */}
        {lastUserMsg && lastBotMsg && (
          <Card className="bg-[#0a0a0a] border-white/8">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm flex items-center gap-2 text-zinc-300">
                <MessageSquare className="w-4 h-4 text-zinc-500" />
                Last Conversation
                <span className="text-xs text-zinc-600 font-normal ml-auto">{lastUserMsg.guildName}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4 space-y-2">
              <div className="flex justify-end">
                <div className="max-w-[80%] bg-white/6 border border-white/8 rounded-xl rounded-br-sm px-3 py-2 text-sm">
                  <p className="text-[10px] text-zinc-600 mb-1">You</p>
                  <p className="text-zinc-200 line-clamp-2">{lastUserMsg.content}</p>
                </div>
              </div>
              <div className="flex justify-start">
                <div className="max-w-[80%] bg-[#111] border border-white/6 rounded-xl rounded-bl-sm px-3 py-2 text-sm">
                  <p className="text-[10px] text-zinc-600 mb-1">Priya</p>
                  <p className="text-zinc-300 line-clamp-2">{lastBotMsg.content}</p>
                </div>
              </div>
              <div className="flex justify-end pt-1">
                <button
                  className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors"
                  onClick={() => setLocation("/portal/history")}
                >
                  See full history <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick actions */}
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            {
              icon: MessageSquare,
              title: "Chat History",
              desc: "View or reset your conversations with Priya across all servers.",
              cta: "View history",
              href: "/portal/history",
            },
            {
              icon: Settings,
              title: "Preferences",
              desc: "Set your nickname, pronouns, vibe and language style.",
              cta: "Edit settings",
              href: "/portal/settings",
            },
          ].map((item) => (
            <div
              key={item.href}
              className="bg-[#0a0a0a] border border-white/8 hover:border-white/16 rounded-xl p-4 cursor-pointer transition-colors group"
              onClick={() => setLocation(item.href)}
            >
              <div className="flex items-center gap-2 mb-2">
                <item.icon className="w-4 h-4 text-zinc-500" />
                <span className="text-sm font-medium text-zinc-200">{item.title}</span>
              </div>
              <p className="text-xs text-zinc-600">{item.desc}</p>
              <div className="mt-3 flex items-center gap-1 text-xs text-zinc-500 group-hover:text-zinc-300 group-hover:gap-2 transition-all">
                {item.cta} <ArrowRight className="w-3 h-3" />
              </div>
            </div>
          ))}
        </div>

        {/* Danger zone */}
        {totalMessages > 0 && (
          <div className="border border-red-500/15 rounded-xl p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-300">Reset All History</p>
              <p className="text-xs text-zinc-600 mt-0.5">Delete all your conversations with Priya across every server.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 text-red-400 hover:text-red-300 hover:bg-red-500/8 border-red-500/20"
              onClick={handleResetAll}
              disabled={resetting}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              {resetting ? "Clearing..." : "Reset All"}
            </Button>
          </div>
        )}

      </div>
    </PortalLayout>
  );
}
