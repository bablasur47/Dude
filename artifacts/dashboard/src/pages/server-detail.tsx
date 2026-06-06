import { useGetServer, useGetNsfwChannels } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Server, Users, MessageSquare, Clock, Hash, ShieldAlert } from "lucide-react";
import { format } from "date-fns";

export function ServerDetail() {
  const params = useParams();
  const guildId = params.guildId as string;
  const { data: server, isLoading: serverLoading } = useGetServer(guildId);
  const { data: nsfwChannels, isLoading: nsfwLoading } = useGetNsfwChannels(guildId);

  if (serverLoading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-32"/><Skeleton className="h-48 w-full"/></div>;
  }

  if (!server) {
    return <div>Server not found</div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <Link href="/servers">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
            <ChevronLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-3">
          {server.iconUrl ? (
            <img src={server.iconUrl} alt={server.name} className="w-10 h-10 rounded-md" />
          ) : (
            <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center">
              <Server className="w-5 h-5 text-muted-foreground" />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{server.name}</h1>
            <p className="text-sm text-muted-foreground font-mono">{server.guildId}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card/30 border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded bg-primary/10 text-primary"><Users className="w-5 h-5"/></div>
            <div>
              <p className="text-xs text-muted-foreground">Members</p>
              <p className="text-lg font-bold">{server.memberCount.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/30 border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded bg-primary/10 text-primary"><MessageSquare className="w-5 h-5"/></div>
            <div>
              <p className="text-xs text-muted-foreground">Total Messages</p>
              <p className="text-lg font-bold">{server.totalMessages.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/30 border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded bg-primary/10 text-primary"><Clock className="w-5 h-5"/></div>
            <div>
              <p className="text-xs text-muted-foreground">Joined At</p>
              <p className="text-sm font-medium">{format(new Date(server.joinedAt), "MMM d, yyyy")}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 mt-8">
        <Card className="bg-card/30 border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldAlert className="w-5 h-5 text-destructive" />
              NSFW Channels
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nsfwLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : nsfwChannels && nsfwChannels.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {nsfwChannels.map(channel => (
                  <div key={channel.channelId} className="flex items-center justify-between p-3 rounded-md bg-background border border-border">
                    <div className="flex items-center gap-2 truncate">
                      <Hash className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium truncate">{channel.channelName}</span>
                    </div>
                    {channel.enabled ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-destructive/20 text-destructive border border-destructive/30 uppercase">NSFW ON</span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border uppercase">OFF</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded-md bg-background/50">
                No NSFW channels configured for this server.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
