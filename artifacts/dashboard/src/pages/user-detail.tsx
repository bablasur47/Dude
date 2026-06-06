import { useGetUser, useDeleteUser, getGetUsersQueryKey, getGetUserQueryKey } from "@workspace/api-client-react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Trash2, MessageSquare, Clock, Server } from "lucide-react";

export function UserDetail() {
  const { userId } = useParams<{ userId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useGetUser(userId, {
    query: { enabled: !!userId, queryKey: getGetUserQueryKey(userId) },
  });

  const deleteMutation = useDeleteUser({
    mutation: {
      onSuccess: () => {
        toast({ title: "History Cleared", description: "Chat history has been deleted." });
        queryClient.invalidateQueries({ queryKey: getGetUsersQueryKey() });
        setLocation("/users");
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to delete history.", variant: "destructive" });
      },
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">User not found.</p>
        <Button variant="ghost" className="mt-4" onClick={() => setLocation("/users")}>
          Back to Users
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation("/users")}
          data-testid="button-back"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{user.username}</h1>
          <p className="text-muted-foreground text-sm font-mono">{user.userId}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-card/30 border-border/50">
          <CardContent className="p-6 flex items-center gap-4">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.username} className="w-16 h-16 rounded-xl ring-1 ring-border/50" />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-2xl">
                {user.username.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-lg">{user.username}</span>
                {user.discriminator && user.discriminator !== "0" && (
                  <span className="text-muted-foreground">#{user.discriminator}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{user.messageCount.toLocaleString()} messages</span>
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Last seen {new Date(user.lastSeen).toLocaleString()}</span>
                <span className="flex items-center gap-1"><Server className="w-3 h-3" />{(user.servers ?? []).length} server{(user.servers ?? []).length !== 1 ? "s" : ""}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/30 border-destructive/20">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Danger Zone</p>
              <p className="text-xs text-muted-foreground mt-1">Permanently delete this user's chat history. This cannot be undone.</p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate({ userId })}
              data-testid="button-delete-history"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {deleteMutation.isPending ? "Deleting..." : "Clear History"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/30 border-border/50">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            Recent Chat History
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 max-h-[500px] overflow-y-auto">
          {user.recentMessages.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">No messages in history.</p>
          ) : (
            [...user.recentMessages].reverse().map((msg, i) => (
              <div
                key={i}
                className={`flex gap-3 ${msg.role === "user" ? "justify-start" : "justify-end"}`}
                data-testid={`msg-${msg.role}-${i}`}
              >
                <div className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${
                  msg.role === "user"
                    ? "bg-muted text-foreground"
                    : "bg-primary/10 border border-primary/20 text-foreground"
                }`}>
                  <p className="leading-relaxed">{msg.content}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {new Date(msg.timestamp).toLocaleString()}
                  </p>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
