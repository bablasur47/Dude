import { useState } from "react";
import { useLogin } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <div className="min-h-screen w-full flex items-center justify-center bg-black p-4">
      <div className="w-full max-w-sm">
        {/* Logo mark */}
        <div className="flex flex-col items-center mb-8 gap-4">
          <div className="w-14 h-14 rounded-xl bg-white/5 flex items-center justify-center border border-white/10">
            <Terminal className="w-7 h-7 text-zinc-300" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Mission Control</h1>
            <p className="text-sm text-zinc-600 mt-1">Authenticate to access Priya's systems.</p>
          </div>
        </div>

        {/* Form card */}
        <div className="bg-[#0a0a0a] border border-white/10 rounded-xl p-6 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Access Code</label>
              <Input
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-black border-white/10 focus-visible:ring-zinc-500 text-zinc-100 placeholder:text-zinc-700"
                autoFocus
              />
            </div>
            <Button
              type="submit"
              className="w-full font-semibold bg-zinc-200 text-black hover:bg-white transition-colors"
              disabled={loginMutation.isPending || !password}
            >
              {loginMutation.isPending ? "Authenticating..." : "Enter Dashboard"}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-zinc-800 mt-6">Priya System v2</p>
      </div>
    </div>
  );
}
