import { useEffect, useState } from "react";
import { fetchPortalMe, updatePortalSettings, type PortalUser } from "@/lib/portal";
import { PortalLayout } from "@/components/portal-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Save } from "lucide-react";

const PRONOUNS_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "he/him", label: "he/him" },
  { value: "she/her", label: "she/her" },
  { value: "they/them", label: "they/them" },
];

const VIBE_OPTIONS = [
  { value: "", label: "Not set (default)" },
  { value: "friend", label: "Friend — casual, like dost" },
  { value: "bestie", label: "Bestie — extra chill, roast mode on" },
  { value: "crush", label: "Crush — shy + flirty energy" },
  { value: "formal", label: "Formal — respectful, less personal" },
];

const LANG_OPTIONS = [
  { value: "hinglish", label: "Hinglish (default)" },
  { value: "english", label: "More English, less Hindi" },
];

export function PortalSettings() {
  const [user, setUser] = useState<PortalUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const [nickname, setNickname] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [vibe, setVibe] = useState("");
  const [lang, setLang] = useState("hinglish");

  useEffect(() => {
    fetchPortalMe()
      .then((u) => {
        setUser(u);
        setNickname(u.nickname ?? "");
        setPronouns(u.pronouns ?? "");
        setVibe(u.relationshipVibe ?? "");
        setLang(u.languageStyle ?? "hinglish");
      })
      .catch(() => toast({ title: "Error", description: "Could not load settings.", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await updatePortalSettings({
        nickname: nickname.trim() || null,
        pronouns: pronouns || null,
        relationshipVibe: vibe || null,
        languageStyle: lang,
      });
      setUser(updated);
      toast({ title: "Saved!", description: "Priya will remember your preferences now." });
    } catch {
      toast({ title: "Error", description: "Could not save settings.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <PortalLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Loading settings...</div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Preferences</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            These settings change how Priya talks to you personally — they affect every server you share with her.
          </p>
        </div>

        {/* Nickname */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Nickname</CardTitle>
            <CardDescription className="text-xs">What should Priya call you? Leave blank to use your Discord username.</CardDescription>
          </CardHeader>
          <CardContent>
            <Input
              placeholder={`e.g. ${user?.username ?? "Rahul"}`}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={32}
              className="max-w-xs"
            />
          </CardContent>
        </Card>

        {/* Pronouns */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Pronouns</CardTitle>
            <CardDescription className="text-xs">So Priya uses the right words when talking about you.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {PRONOUNS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setPronouns(o.value)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                    pronouns === o.value
                      ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-400"
                      : "border-border/50 text-muted-foreground hover:border-indigo-500/30"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Relationship vibe */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Relationship Vibe</CardTitle>
            <CardDescription className="text-xs">Sets the tone of how Priya interacts with you.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {VIBE_OPTIONS.map((o) => (
                <label
                  key={o.value}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                    vibe === o.value
                      ? "bg-indigo-600/10 border-indigo-500/40 text-indigo-300"
                      : "border-border/40 hover:border-indigo-500/20 text-muted-foreground"
                  }`}
                >
                  <input
                    type="radio"
                    name="vibe"
                    value={o.value}
                    checked={vibe === o.value}
                    onChange={() => setVibe(o.value)}
                    className="accent-indigo-500"
                  />
                  <span className="text-sm">{o.label}</span>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Language style */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Language Style</CardTitle>
            <CardDescription className="text-xs">Priya naturally speaks Hinglish — you can ask her to use more English.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {LANG_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setLang(o.value)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                    lang === o.value
                      ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-400"
                      : "border-border/50 text-muted-foreground hover:border-indigo-500/30"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Save */}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} className="gap-2 bg-indigo-600 hover:bg-indigo-700">
            <Save className="w-4 h-4" />
            {saving ? "Saving..." : "Save Preferences"}
          </Button>
        </div>
      </div>
    </PortalLayout>
  );
}
