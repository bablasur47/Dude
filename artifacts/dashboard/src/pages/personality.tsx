import { useEffect } from "react";
import { useGetPersonality, useUpdatePersonality, getGetPersonalityQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Save, BrainCircuit } from "lucide-react";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel } from "@/components/ui/form";

type PersonalityFormData = {
  name: string;
  systemPrompt: string;
  nsfwEnabled: boolean;
  randomPingEnabled: boolean;
  greetNewMembers: boolean;
  randomPingIntervalMinutes: number;
  maxHistoryDays: number;
  activeProvider: string;
};

export function Personality() {
  const { data, isLoading } = useGetPersonality();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<PersonalityFormData>({
    defaultValues: {
      name: "Priya",
      systemPrompt: "",
      nsfwEnabled: false,
      randomPingEnabled: true,
      greetNewMembers: true,
      randomPingIntervalMinutes: 120,
      maxHistoryDays: 7,
      activeProvider: "groq",
    },
  });

  useEffect(() => {
    if (data) {
      form.reset({
        name: data.name,
        systemPrompt: data.systemPrompt,
        nsfwEnabled: data.nsfwEnabled,
        randomPingEnabled: data.randomPingEnabled,
        greetNewMembers: data.greetNewMembers,
        randomPingIntervalMinutes: data.randomPingIntervalMinutes ?? 120,
        maxHistoryDays: data.maxHistoryDays ?? 7,
        activeProvider: data.activeProvider ?? "groq",
      });
    }
  }, [data, form]);

  const updateMutation = useUpdatePersonality({
    mutation: {
      onSuccess: () => {
        toast({ title: "Saved", description: "Personality settings updated." });
        queryClient.invalidateQueries({ queryKey: getGetPersonalityQueryKey() });
      },
      onError: () => toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" }),
    },
  });

  const onSubmit = (values: PersonalityFormData) => {
    updateMutation.mutate({ data: values });
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Personality</h1>
          <p className="text-muted-foreground mt-1">Configure Priya's behavior and character.</p>
        </div>
        <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
          <BrainCircuit className="w-5 h-5 text-primary" />
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          <Card className="bg-card/30 border-border/50">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Identity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bot Name</FormLabel>
                    <FormControl>
                      <Input {...field} className="bg-background/50 border-border/50 max-w-xs" data-testid="input-bot-name" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="systemPrompt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>System Prompt</FormLabel>
                    <FormDescription className="text-xs">
                      This is the core instruction set for Priya's personality.
                    </FormDescription>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={10}
                        className="bg-background/50 border-border/50 font-mono text-xs resize-y"
                        data-testid="textarea-system-prompt"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="activeProvider"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Active AI Provider</FormLabel>
                    <FormDescription className="text-xs">
                      Primary provider. Falls back to others if rate limited.
                    </FormDescription>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="bg-background/50 border-border/50 max-w-xs" data-testid="select-provider">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="groq">Groq</SelectItem>
                        <SelectItem value="gemini">Gemini</SelectItem>
                        <SelectItem value="nvidia">Nvidia</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card className="bg-card/30 border-border/50">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Behavior Toggles</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <FormField
                control={form.control}
                name="nsfwEnabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <div>
                      <FormLabel>NSFW Mode (Global)</FormLabel>
                      <FormDescription className="text-xs">
                        Master switch. Per-channel control via /nsfw command.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="toggle-nsfw"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="randomPingEnabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <div>
                      <FormLabel>Random Pings</FormLabel>
                      <FormDescription className="text-xs">
                        Priya randomly messages members to start conversations.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="toggle-random-ping" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="greetNewMembers"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <div>
                      <FormLabel>Greet New Members</FormLabel>
                      <FormDescription className="text-xs">
                        Send a welcome message when someone joins.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="toggle-greet" />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card className="bg-card/30 border-border/50">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Limits</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="randomPingIntervalMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Random Ping Interval (minutes)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={30}
                        {...field}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        className="bg-background/50 border-border/50"
                        data-testid="input-ping-interval"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="maxHistoryDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Memory Duration (days)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={30}
                        {...field}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        className="bg-background/50 border-border/50"
                        data-testid="input-history-days"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={updateMutation.isPending} data-testid="button-save-personality">
              <Save className="w-4 h-4 mr-2" />
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
