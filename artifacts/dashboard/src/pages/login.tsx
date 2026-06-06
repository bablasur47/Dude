import { useState } from "react";
import { useLogin } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Terminal } from "lucide-react";

export function Login() {
  const [password, setPassword] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data) => {
        if (data.success) {
          localStorage.setItem("dashboard_token", data.token);
          setLocation("/overview");
        } else {
          toast({
            title: "Access Denied",
            description: "Invalid credentials.",
            variant: "destructive"
          });
        }
      },
      onError: () => {
        toast({
          title: "Error",
          description: "Could not connect to authentication server.",
          variant: "destructive"
        });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    loginMutation.mutate({ data: { password } });
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background" />
      <Card className="w-full max-w-sm relative bg-card/80 backdrop-blur border-primary/20 shadow-2xl shadow-primary/5">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
            <Terminal className="w-6 h-6 text-primary" />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-2xl font-bold tracking-tight">Mission Control</CardTitle>
            <CardDescription>Authenticate to access Priya's core systems.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="Access Code"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-background/50 border-white/10 focus-visible:ring-primary"
              />
            </div>
            <Button 
              type="submit" 
              className="w-full font-semibold"
              disabled={loginMutation.isPending || !password}
            >
              {loginMutation.isPending ? "Authenticating..." : "Enter Dashboard"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
