import { useGetBotStats, useGetBotStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Server, Users, MessageSquare, Activity, Cpu } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function Overview() {
  const { data: stats, isLoading: statsLoading } = useGetBotStats();
  const { data: status, isLoading: statusLoading } = useGetBotStatus();

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">System Overview</h1>
          <p className="text-muted-foreground mt-1">Real-time metrics for Priya's core operations.</p>
        </div>
        <div className="flex items-center gap-2">
          {statusLoading ? (
            <Skeleton className="w-24 h-8 rounded-full" />
          ) : (
            <div className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-2 border ${
              status?.online 
                ? "bg-green-500/10 text-green-500 border-green-500/20 shadow-[0_0_10px_rgba(34,197,94,0.2)]" 
                : "bg-red-500/10 text-red-500 border-red-500/20"
            }`}>
              <div className={`w-2 h-2 rounded-full ${status?.online ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
              {status?.online ? "SYSTEM ONLINE" : "SYSTEM OFFLINE"}
            </div>
          )}
        </div>
      </div>

      {!statusLoading && status && (
        <Card className="bg-card/50 border-primary/20 overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent pointer-events-none" />
          <CardContent className="p-6 flex items-center gap-6 relative z-10">
            {status.avatarUrl ? (
              <img src={status.avatarUrl} alt="Bot Avatar" className="w-16 h-16 rounded-lg ring-1 ring-primary/30" />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30 text-2xl font-bold text-primary">
                P
              </div>
            )}
            <div>
              <h2 className="text-2xl font-bold text-foreground">{status.username}<span className="text-muted-foreground text-lg">#{status.discriminator}</span></h2>
              <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><Cpu className="w-4 h-4 text-primary" /> Core Active</span>
                <span className="flex items-center gap-1"><Activity className="w-4 h-4 text-primary" /> Ping: {status.ping ?? 0}ms</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Servers" icon={Server} value={stats?.totalServers} loading={statsLoading} />
        <StatCard title="Total Users" icon={Users} value={stats?.totalUsers} loading={statsLoading} />
        <StatCard title="Messages Processed" icon={MessageSquare} value={stats?.totalMessages} loading={statsLoading} />
        <StatCard title="Active Today" icon={Activity} value={stats?.activeToday} loading={statsLoading} />
      </div>
    </div>
  );
}

function StatCard({ title, icon: Icon, value, loading }: { title: string, icon: any, value?: number, loading: boolean }) {
  return (
    <Card className="bg-card/30 backdrop-blur border-border/50 transition-all hover:bg-card/50 hover:border-primary/30">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-primary opacity-70" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className="text-3xl font-bold tracking-tighter text-foreground">{value?.toLocaleString()}</div>
        )}
      </CardContent>
    </Card>
  );
}
