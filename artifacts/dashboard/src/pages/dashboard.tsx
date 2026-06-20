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
          <h1 className="text-3xl font-bold tracking-tight text-zinc-100">System Overview</h1>
          <p className="text-zinc-600 mt-1">Real-time metrics for Priya's core operations.</p>
        </div>
        <div className="flex items-center gap-2">
          {statusLoading ? (
            <Skeleton className="w-28 h-8 rounded-full" />
          ) : (
            <div className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-2 border ${
              status?.online
                ? "bg-green-500/8 text-green-400 border-green-500/20"
                : "bg-red-500/10 text-red-400 border-red-500/20"
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${status?.online ? "bg-green-400 animate-pulse" : "bg-red-400"}`} />
              {status?.online ? "ONLINE" : "OFFLINE"}
            </div>
          )}
        </div>
      </div>

      {!statusLoading && status && (
        <div className="bg-[#0a0a0a] border border-white/10 rounded-xl p-5 flex items-center gap-5">
          {status.avatarUrl ? (
            <img src={status.avatarUrl} alt="Bot Avatar" className="w-14 h-14 rounded-lg ring-1 ring-white/10" />
          ) : (
            <div className="w-14 h-14 rounded-lg bg-white/5 flex items-center justify-center border border-white/10 text-2xl font-bold text-zinc-200">
              P
            </div>
          )}
          <div>
            <h2 className="text-xl font-bold text-zinc-100">
              {status.username}
              <span className="text-zinc-600 text-base font-normal">#{status.discriminator}</span>
            </h2>
            <div className="flex items-center gap-4 mt-1 text-sm text-zinc-600">
              <span className="flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5 text-zinc-400" /> Core Active</span>
              <span className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-zinc-400" /> {status.ping ?? 0}ms</span>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Total Servers" icon={Server} value={stats?.totalServers} loading={statsLoading} />
        <StatCard title="Total Users" icon={Users} value={stats?.totalUsers} loading={statsLoading} />
        <StatCard title="Messages" icon={MessageSquare} value={stats?.totalMessages} loading={statsLoading} />
        <StatCard title="Active Today" icon={Activity} value={stats?.activeToday} loading={statsLoading} />
      </div>
    </div>
  );
}

function StatCard({ title, icon: Icon, value, loading }: { title: string; icon: React.ElementType; value?: number; loading: boolean }) {
  return (
    <Card className="bg-[#0a0a0a] border-white/10 hover:border-white/20 transition-colors">
      <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-zinc-600 uppercase tracking-wider">{title}</CardTitle>
        <Icon className="h-3.5 w-3.5 text-zinc-600" />
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {loading ? (
          <Skeleton className="h-8 w-16 bg-white/5" />
        ) : (
          <div className="text-3xl font-bold tracking-tighter text-zinc-100">{value?.toLocaleString() ?? "—"}</div>
        )}
      </CardContent>
    </Card>
  );
}
