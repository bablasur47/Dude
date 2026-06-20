import { useEffect, useState } from "react";
import { fetchPortalHistory, deletePortalHistoryGuild, deleteAllPortalHistory, type PortalHistoryEntry } from "@/lib/portal";
import { PortalLayout } from "@/components/portal-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronDown, ChevronRight, Trash2, MessageSquare, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function PortalHistory() {
  const [entries, setEntries] = useState<PortalHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { toast } = useToast();

  async function load() {
    setLoading(true);
    try {
      const data = await fetchPortalHistory();
      setEntries(data);
    } catch {
      toast({ title: "Error", description: "Could not load history.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDeleteGuild(guildId: string, guildName: string) {
    if (!confirm(`Reset your chat history with Priya in "${guildName}"? This cannot be undone.`)) return;
    setDeleting(guildId);
    try {
      await deletePortalHistoryGuild(guildId);
      toast({ title: "Cleared!", description: `Chat history in ${guildName} has been reset.` });
      await load();
    } catch {
      toast({ title: "Error", description: "Could not clear history.", variant: "destructive" });
    } finally {
      setDeleting(null);
    }
  }

  async function handleDeleteAll() {
    if (!confirm("Reset ALL your chat history with Priya across every server? This cannot be undone.")) return;
    setDeleting("all");
    try {
      await deleteAllPortalHistory();
      toast({ title: "All cleared!", description: "Your entire chat history has been reset." });
      await load();
    } catch {
      toast({ title: "Error", description: "Could not clear history.", variant: "destructive" });
    } finally {
      setDeleting(null);
    }
  }

  const totalMessages = entries.reduce((s, e) => s + e.messageCount, 0);

  return (
    <PortalLayout>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-zinc-100">Chat History</h1>
            <p className="text-sm text-zinc-600 mt-0.5">
              {totalMessages} messages across {entries.length} {entries.length === 1 ? "server" : "servers"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading} className="border-white/10 text-zinc-400 hover:text-zinc-200">
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {entries.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10 border-red-500/20"
                onClick={handleDeleteAll}
                disabled={deleting === "all"}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                Reset All
              </Button>
            )}
          </div>
        </div>

        {loading && (
          <div className="text-center text-zinc-600 text-sm py-16">Loading history...</div>
        )}

        {!loading && entries.length === 0 && (
          <div className="text-center text-zinc-600 py-16">
            <MessageSquare className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No chat history yet. Go talk to Priya!</p>
          </div>
        )}

        {entries.map((entry) => (
          <Card key={entry.guildId} className="bg-[#0a0a0a] border-white/10 overflow-hidden">
            <CardHeader className="py-3 px-4">
              <div className="flex items-center justify-between gap-3">
                <button
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  onClick={() => setExpanded(expanded === entry.guildId ? null : entry.guildId)}
                >
                  {expanded === entry.guildId ? (
                    <ChevronDown className="w-4 h-4 text-zinc-600 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-zinc-600 shrink-0" />
                  )}
                  <CardTitle className="text-sm font-medium truncate text-zinc-200">{entry.guildName}</CardTitle>
                  <Badge variant="secondary" className="text-xs shrink-0 bg-white/5 text-zinc-500 border-white/10">
                    {entry.messageCount} msgs
                  </Badge>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-zinc-600 hover:text-red-400 shrink-0"
                  onClick={() => handleDeleteGuild(entry.guildId, entry.guildName)}
                  disabled={deleting === entry.guildId}
                  title="Reset history in this server"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </CardHeader>

            {expanded === entry.guildId && (
              <CardContent className="px-0 pt-0 pb-0">
                <ScrollArea className="h-72 border-t border-white/10">
                  <div className="p-4 space-y-3">
                    {entry.messages.length === 0 ? (
                      <p className="text-xs text-zinc-600 text-center py-6">History cleared</p>
                    ) : (
                      entry.messages.map((msg, i) => (
                        <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                            msg.role === "user"
                              ? "bg-white/5 border border-white/10 text-zinc-200 rounded-br-sm"
                              : "bg-[#111] border border-white/5 text-zinc-300 rounded-bl-sm"
                          }`}>
                            <p className="text-[10px] font-medium mb-1 text-zinc-600">
                              {msg.role === "user" ? "You" : "Priya"}
                            </p>
                            {msg.content}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </PortalLayout>
  );
}
