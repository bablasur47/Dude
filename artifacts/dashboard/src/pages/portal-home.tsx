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
        <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Loading your profile...</div>
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

  // Get last user message for "last thing you said"
  const lastUserMsg = stats?.recentMessages.find((m) => m.role === "user");
  const lastBotMsg = stats?.recentMessages.find((m) => m.role === "assistant");

  return (
    <PortalLayout>
      <div className="space-y-5">

        {/* Profile card */}
        <Card className="bg-gradient-to-br from-indigo-500/5 to-background border-indigo-500/20">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center gap-4">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="avatar" className="w-14 h-14 rounded-full border-2 border-indigo-500/30" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-indigo-500/20 border-2 border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-xl">
                  {user?.username?.[0]?.toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-bold text-lg truncate">
                  {user?.nickname ? (
                    <span>{user.nickname} <span className="text-sm text-muted-foreground font-normal">({user?.username})</span></span>
                  ) : (
                    user?.username
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {user?.relationshipVibe && (
                    <Badge variant="outline" className="text-xs bg-indigo-500/10 text-indigo-400 border-indigo-500/20">
                      {vibeLabels[user.relationshipVibe] ?? user.relationshipVibe}
                    </Badge>
                  )}
                  {user?.pronouns && (
                    <Badge variant="outline" className="text-xs">{user.pronouns}</Badge>
                  )}
                  {user?.languageStyle === "english" && (
                    <Badge variant="outline" className="text-xs">English mode</Badge>
                  )}
                </div>
              </div>
              <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground" onClick={load}>
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>

            {!user?.nickname && !user?.relationshipVibe && (
              <div className="mt-4 flex items-start gap-3 bg-indigo-500/5 rounded-lg p-3 border border-indigo-500/10">
                <Sparkles className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Set your nickname and vibe so Priya knows exactly how to talk to you —{" "}
                  <button className="text-indigo-400 hover:underline" onClick={() => setLocation("/portal/settings")}>
                    go to Settings
                  </button>.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Activity stats row */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="bg-card/30">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-indigo-400">{totalMessages}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Total Messages</div>
            </CardContent>
          </Card>
          <Card className="bg-card/30">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-indigo-400">{serverCount}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Servers</div>
            </CardContent>
          </Card>
          <Card className="bg-card/30">
            <CardContent className="p-4 text-center">
              <div className="text-sm font-semibold text-indigo-400 leading-tight">{timeAgo(lastActive)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Last Active</div>
            </CardContent>
          </Card>
        </div>

        {/* Per-server activity */}
        {stats && stats.servers.length > 0 && (
          <Card>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Server className="w-4 h-4 text-indigo-400" />
                Activity by Server
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="space-y-2">
                {stats.servers.slice(0, 5).map((srv) => {
                  const pct = totalMessages > 0 ? (srv.messageCount / totalMessages) * 100 : 0;
                  return (
                    <div key={srv.guildId}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-foreground font-medium truncate max-w-[60%]">{srv.guildName}</span>
                        <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                          <Clock className="w-3 h-3" />
                          {timeAgo(srv.lastMessage)}
                          <span className="font-medium text-foreground">{srv.messageCount}</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500/60 rounded-full transition-all"
                          style={{ width: `${Math.max(pct, 2)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                {stats.servers.length > 5 && (
                  <p className="text-xs text-muted-foreground text-center pt-1">
                    +{stats.servers.length - 5} more servers
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent conversation */}
        {lastUserMsg && lastBotMsg && (
          <Card>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-indigo-400" />
                Last Conversation
                <span className="text-xs text-muted-foreground font-normal ml-auto">{lastUserMsg.guildName}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4 space-y-2">
              <div className="flex justify-end">
                <div className="max-w-[80%] bg-indigo-600/20 rounded-xl rounded-br-sm px-3 py-2 text-sm">
                  <p className="text-[10px] text-muted-foreground mb-1">You</p>
                  <p className="line-clamp-2">{lastUserMsg.content}</p>
                </div>
              </div>
              <div className="flex justify-start">
                <div className="max-w-[80%] bg-muted rounded-xl rounded-bl-sm px-3 py-2 text-sm">
                  <p className="text-[10px] text-muted-foreground mb-1">Priya</p>
                  <p className="line-clamp-2">{lastBotMsg.content}</p>
                </div>
              </div>
              <div className="flex justify-end pt-1">
                <button
                  className="text-xs text-indigo-400 hover:underline flex items-center gap-1"
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
          <Card
            className="cursor-pointer hover:border-indigo-500/40 transition-colors group"
            onClick={() => setLocation("/portal/history")}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-indigo-400" />
                Chat History
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground">View or reset your conversations with Priya across all servers.</p>
              <div className="mt-3 flex items-center gap-1 text-xs text-indigo-400 group-hover:gap-2 transition-all">
                View history <ArrowRight className="w-3 h-3" />
              </div>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer hover:border-indigo-500/40 transition-colors group"
            onClick={() => setLocation("/portal/settings")}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Settings className="w-4 h-4 text-indigo-400" />
                Preferences
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground">Set your nickname, pronouns, vibe and language style.</p>
              <div className="mt-3 flex items-center gap-1 text-xs text-indigo-400 group-hover:gap-2 transition-all">
                Edit settings <ArrowRight className="w-3 h-3" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Danger zone */}
        {totalMessages > 0 && (
          <Card className="border-destructive/20">
            <CardContent className="p-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Reset All History</p>
                <p className="text-xs text-muted-foreground">Delete all your conversations with Priya across every server.</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20"
                onClick={handleResetAll}
                disabled={resetting}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                {resetting ? "Clearing..." : "Reset All"}
              </Button>
            </CardContent>
          </Card>
        )}

      </div>
    </PortalLayout>
  );
}
