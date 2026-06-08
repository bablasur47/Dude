import { useEffect, useState } from "react";
import { fetchPortalMe, updatePortalSettings, type PortalUser } from "@/lib/portal";
import { PortalLayout } from "@/components/portal-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Save, X, Plus } from "lucide-react";

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

const EMOJI_OPTIONS = [
  { value: "heavy", label: "Heavy 🎉 — lots of emojis" },
  { value: "normal", label: "Normal 😊 — balanced (default)" },
  { value: "minimal", label: "Minimal 🙂 — almost none" },
];

const REPLY_LENGTH_OPTIONS = [
  { value: "short", label: "Short — quick replies" },
  { value: "medium", label: "Medium — balanced (default)" },
  { value: "long", label: "Long — detailed, elaborate" },
];

const TOPIC_SUGGESTIONS = [
  "anime", "gaming", "music", "movies", "cricket",
  "coding", "food", "travel", "memes", "study",
  "fashion", "fitness", "bollywood", "k-pop", "art",
];

const MONTH_OPTIONS = [
  { value: "01", label: "January" }, { value: "02", label: "February" },
  { value: "03", label: "March" }, { value: "04", label: "April" },
  { value: "05", label: "May" }, { value: "06", label: "June" },
  { value: "07", label: "July" }, { value: "08", label: "August" },
  { value: "09", label: "September" }, { value: "10", label: "October" },
  { value: "11", label: "November" }, { value: "12", label: "December" },
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
  const [bio, setBio] = useState("");
  const [birthdayMonth, setBirthdayMonth] = useState("");
  const [birthdayDay, setBirthdayDay] = useState("");
  const [emojiStyle, setEmojiStyle] = useState("normal");
  const [replyLength, setReplyLength] = useState("medium");
  const [topics, setTopics] = useState<string[]>([]);
  const [topicInput, setTopicInput] = useState("");

  useEffect(() => {
    fetchPortalMe()
      .then((u) => {
        setUser(u);
        setNickname(u.nickname ?? "");
        setPronouns(u.pronouns ?? "");
        setVibe(u.relationshipVibe ?? "");
        setLang(u.languageStyle ?? "hinglish");
        setBio(u.bio ?? "");
        if (u.birthday) {
          const [m, d] = u.birthday.split("-");
          setBirthdayMonth(m ?? "");
          setBirthdayDay(d ?? "");
        }
        setEmojiStyle(u.emojiStyle ?? "normal");
        setReplyLength(u.replyLength ?? "medium");
        setTopics(u.topics ?? []);
      })
      .catch(() => toast({ title: "Error", description: "Could not load settings.", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, []);

  function addTopic(t: string) {
    const trimmed = t.trim().toLowerCase();
    if (!trimmed || topics.includes(trimmed) || topics.length >= 10) return;
    setTopics([...topics, trimmed]);
    setTopicInput("");
  }

  function removeTopic(t: string) {
    setTopics(topics.filter((x) => x !== t));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const birthday = birthdayMonth && birthdayDay
        ? `${birthdayMonth}-${birthdayDay.padStart(2, "0")}`
        : null;

      const updated = await updatePortalSettings({
        nickname: nickname.trim() || null,
        pronouns: pronouns || null,
        relationshipVibe: vibe || null,
        languageStyle: lang,
        bio: bio.trim() || null,
        birthday,
        emojiStyle,
        replyLength,
        topics,
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

        {/* Bio */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">About You</CardTitle>
            <CardDescription className="text-xs">A short bio Priya keeps in mind when chatting with you. She'll reference it naturally.</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="e.g. Main 18 saal ka hoon, Delhi se hoon, coding aur anime pasand hai mujhe"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={200}
              rows={3}
              className="resize-none text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">{bio.length}/200</p>
          </CardContent>
        </Card>

        {/* Birthday */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Birthday 🎂</CardTitle>
            <CardDescription className="text-xs">Priya will wish you on your birthday! (We only store month + day, not year.)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 items-center flex-wrap">
              <select
                value={birthdayMonth}
                onChange={(e) => setBirthdayMonth(e.target.value)}
                className="bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">Month</option>
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <Input
                type="number"
                placeholder="Day (1-31)"
                value={birthdayDay}
                onChange={(e) => setBirthdayDay(e.target.value)}
                min={1}
                max={31}
                className="w-32"
              />
              {(birthdayMonth || birthdayDay) && (
                <button
                  onClick={() => { setBirthdayMonth(""); setBirthdayDay(""); }}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  Clear
                </button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Topics */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Topics You Like 💬</CardTitle>
            <CardDescription className="text-xs">Priya will bring up these topics naturally in conversation. Add up to 10.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {topics.map((t) => (
                <span
                  key={t}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-full bg-indigo-600/20 border border-indigo-500/40 text-indigo-300"
                >
                  {t}
                  <button onClick={() => removeTopic(t)} className="hover:text-white ml-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {topics.length === 0 && (
                <span className="text-xs text-muted-foreground">No topics added yet</span>
              )}
            </div>
            {topics.length < 10 && (
              <div className="flex gap-2">
                <Input
                  placeholder="Type a topic..."
                  value={topicInput}
                  onChange={(e) => setTopicInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTopic(topicInput); } }}
                  className="max-w-xs text-sm"
                />
                <Button variant="outline" size="sm" onClick={() => addTopic(topicInput)} className="gap-1">
                  <Plus className="w-3.5 h-3.5" /> Add
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <p className="w-full text-xs text-muted-foreground mb-1">Quick add:</p>
              {TOPIC_SUGGESTIONS.filter((s) => !topics.includes(s)).slice(0, 8).map((s) => (
                <button
                  key={s}
                  onClick={() => addTopic(s)}
                  className="px-2 py-0.5 text-xs rounded-full border border-border/50 text-muted-foreground hover:border-indigo-500/40 hover:text-indigo-400 transition-colors"
                >
                  + {s}
                </button>
              ))}
            </div>
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

        {/* Emoji style */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Emoji Usage</CardTitle>
            <CardDescription className="text-xs">How many emojis should Priya use in her messages?</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {EMOJI_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setEmojiStyle(o.value)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                    emojiStyle === o.value
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

        {/* Reply length */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Reply Length</CardTitle>
            <CardDescription className="text-xs">How long should Priya's replies typically be?</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {REPLY_LENGTH_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setReplyLength(o.value)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                    replyLength === o.value
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
