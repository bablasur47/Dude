import { useGetServers } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Server, Users, MessageSquare, Link2, Copy, Check } from "lucide-react";
import { useState, useCallback } from "react";

function InviteButton({ guildId }: { guildId: string }) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInvite = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("dashboard_token");
      const res = await fetch(`/api/servers/${guildId}/invite`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Failed");
      }
      const { inviteUrl } = await res.json();
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error");
      setTimeout(() => setError(null), 3000);
    } finally {
      setLoading(false);
    }
  }, [guildId]);

  if (error) {
    return (
      <span className="text-xs text-red-400 truncate max-w-[120px]">{error}</span>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs gap-1 border-border/50 bg-transparent hover:bg-primary/10 hover:border-primary/50 hover:text-primary transition-all"
      onClick={handleInvite}
      disabled={loading}
    >
      {copied ? (
        <><Check className="w-3 h-3 text-green-400" /><span className="text-green-400">Copied!</span></>
      ) : loading ? (
        <><Link2 className="w-3 h-3 animate-pulse" />Getting...</>
      ) : (
        <><Copy className="w-3 h-3" />Invite Link</>
      )}
    </Button>
  );
}

export function Servers() {
  const { data: servers, isLoading } = useGetServers();
  const [search, setSearch] = useState("");

  const filteredServers = servers?.filter(s =>
    (s.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
    s.guildId.includes(search)
  ) ?? [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Active Guilds</h1>
          <p className="text-muted-foreground mt-1">Servers currently integrated with Priya's systems.</p>
        </div>
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search servers..." 
            className="pl-9 bg-card/30 border-border/50"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-xl bg-card/30" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredServers.map((server) => (
            <Link key={server.guildId} href={`/servers/${server.guildId}`}>
              <Card className="cursor-pointer bg-card/30 backdrop-blur border-border/50 transition-all hover:bg-card/50 hover:border-primary/50 group">
                <CardContent className="p-5 flex items-start gap-4">
                  {server.iconUrl ? (
                    <img src={server.iconUrl} alt={server.name} className="w-12 h-12 rounded-lg ring-1 ring-border group-hover:ring-primary/50 transition-all" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center ring-1 ring-border group-hover:ring-primary/50 transition-all">
                      <Server className="w-6 h-6 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-base truncate group-hover:text-primary transition-colors">{server.name}</h3>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">{server.guildId}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {server.memberCount.toLocaleString()}</span>
                      <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> {(server.messageCount ?? 0).toLocaleString()}</span>
                    </div>
                    <div className="mt-2" onClick={(e) => e.preventDefault()}>
                      <InviteButton guildId={server.guildId} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
          {filteredServers.length === 0 && (
            <div className="col-span-full py-12 text-center text-muted-foreground bg-card/20 rounded-xl border border-dashed border-border">
              No servers found matching "{search}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}
