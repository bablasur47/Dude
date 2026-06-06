import { useState } from "react";
import { useGetUsers } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Search, MessageSquare, Clock, ChevronRight } from "lucide-react";

export function Users() {
  const { data: users, isLoading } = useGetUsers();
  const [search, setSearch] = useState("");

  const filtered = users?.filter(
    (u) =>
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      u.userId.includes(search)
  ) ?? [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Users</h1>
        <p className="text-muted-foreground mt-1">All users Priya has interacted with.</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by username or ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 bg-card/30 border-border/50"
          data-testid="input-user-search"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <p>No users found.</p>
            </div>
          ) : (
            filtered.map((user) => (
              <Link key={user.userId} href={`/users/${user.userId}`}>
                <Card
                  className="bg-card/30 border-border/50 hover:bg-card/60 hover:border-primary/30 transition-all cursor-pointer"
                  data-testid={`card-user-${user.userId}`}
                >
                  <CardContent className="p-4 flex items-center gap-4">
                    {user.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt={user.username}
                        className="w-10 h-10 rounded-lg ring-1 ring-border/50"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-semibold text-sm">
                        {user.username.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground truncate">{user.username}</span>
                        {user.discriminator && user.discriminator !== "0" && (
                          <span className="text-muted-foreground text-xs">#{user.discriminator}</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono">{user.userId}</p>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <MessageSquare className="w-3.5 h-3.5" />
                        {user.messageCount.toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1 hidden sm:flex">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(user.lastSeen).toLocaleDateString()}
                      </span>
                      <Badge variant="outline" className="text-xs border-border/50 hidden md:flex">
                        {(user.servers ?? []).length} server{(user.servers ?? []).length !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground ml-2" />
                  </CardContent>
                </Card>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
