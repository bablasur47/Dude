import { useState } from "react";
import {
  useGetApis,
  useAddApi,
  useDeleteApi,
  useUpdateApi,
  getGetApisQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Key, AlertCircle, CheckCircle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PROVIDER_COLORS: Record<string, string> = {
  groq: "text-orange-400 border-orange-400/30 bg-orange-400/10",
  gemini: "text-blue-400 border-blue-400/30 bg-blue-400/10",
  nvidia: "text-green-400 border-green-400/30 bg-green-400/10",
};

export function ApiKeys() {
  const { data: apis, isLoading } = useGetApis();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [provider, setProvider] = useState<"groq" | "gemini" | "nvidia">("groq");
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getGetApisQueryKey() });

  const addMutation = useAddApi({
    mutation: {
      onSuccess: () => {
        toast({ title: "API Key Added", description: `${provider} key added successfully.` });
        setLabel(""); setKey(""); setShowForm(false);
        invalidate();
      },
      onError: () => toast({ title: "Error", description: "Failed to add API key.", variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteApi({
    mutation: {
      onSuccess: () => { toast({ title: "Deleted" }); invalidate(); },
      onError: () => toast({ title: "Error", description: "Failed to delete key.", variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateApi({
    mutation: {
      onSuccess: () => invalidate(),
      onError: () => toast({ title: "Error", description: "Failed to update key.", variant: "destructive" }),
    },
  });

  const grouped = (apis ?? []).reduce<Record<string, typeof apis>>((acc, api) => {
    if (!acc[api!.provider]) acc[api!.provider] = [];
    acc[api!.provider]!.push(api);
    return acc;
  }, {});

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">API Keys</h1>
          <p className="text-muted-foreground mt-1">Manage AI provider keys with automatic failover.</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} size="sm" data-testid="button-add-key">
          <Plus className="w-4 h-4 mr-2" />
          Add Key
        </Button>
      </div>

      {showForm && (
        <Card className="bg-card/50 border-primary/20 animate-in fade-in slide-in-from-top-2 duration-300">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Add New API Key</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select value={provider} onValueChange={(v) => setProvider(v as "groq" | "gemini" | "nvidia")}>
                <SelectTrigger className="bg-background/50 border-border/50" data-testid="select-provider">
                  <SelectValue placeholder="Provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="groq">Groq</SelectItem>
                  <SelectItem value="gemini">Gemini</SelectItem>
                  <SelectItem value="nvidia">Nvidia</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="Label (e.g. Groq Key 2)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="bg-background/50 border-border/50"
                data-testid="input-key-label"
              />
              <Input
                placeholder="API Key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className="bg-background/50 border-border/50 font-mono text-sm"
                data-testid="input-key-value"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!label || !key || addMutation.isPending}
                onClick={() => addMutation.mutate({ data: { provider, label, key } })}
                data-testid="button-save-key"
              >
                {addMutation.isPending ? "Saving..." : "Save Key"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-4">
          {["groq", "gemini", "nvidia"].map((p) => (
            <div key={p}>
              <Skeleton className="h-5 w-20 mb-2" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          ))}
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <Card className="bg-card/30 border-border/50">
          <CardContent className="py-16 text-center">
            <Key className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No API keys configured. Add one above.</p>
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([prov, keys]) => (
          <div key={prov} className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <Badge className={`text-xs font-mono uppercase ${PROVIDER_COLORS[prov] ?? ""}`}>
                {prov}
              </Badge>
              <span className="text-xs text-muted-foreground">{keys!.length} key{keys!.length !== 1 ? "s" : ""}</span>
            </div>
            {keys!.map((api) => (
              <Card
                key={api!.id}
                className={`bg-card/30 border-border/50 transition-all ${!api!.enabled ? "opacity-50" : ""}`}
                data-testid={`card-api-${api!.id}`}
              >
                <CardContent className="p-4 flex items-center gap-4">
                  {(api!.errorCount ?? 0) > 3 ? (
                    <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                  ) : (
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{api!.label}</p>
                    <p className="font-mono text-xs text-muted-foreground">{api!.maskedKey}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground hidden sm:flex">
                    {api!.lastUsed && <span>Used {new Date(api!.lastUsed).toLocaleDateString()}</span>}
                    {(api!.errorCount ?? 0) > 0 && (
                      <span className="text-destructive">{api!.errorCount} errors</span>
                    )}
                  </div>
                  <Switch
                    checked={api!.enabled}
                    onCheckedChange={(enabled) =>
                      updateMutation.mutate({ apiId: api!.id, data: { enabled } })
                    }
                    data-testid={`toggle-api-${api!.id}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate({ apiId: api!.id })}
                    data-testid={`button-delete-api-${api!.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
