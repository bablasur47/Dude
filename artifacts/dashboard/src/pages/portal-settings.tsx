import { useEffect, useState } from "react";
import { fetchPortalMe, updatePortalSettings, type PortalUser } from "@/lib/portal";
import { PortalLayout } from "@/components/portal-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

function SettingCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="bg-[#0a0a0a] border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-zinc-200">{title}</CardTitle>
        {description && <CardDescription className="text-xs text-zinc-600">{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function PillButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
        active
          ? "bg-white/10 border-white/25 text-zinc-100"
          : "border-white/10 text-zinc-600 hover:border-white/20 hover:text-zinc-400"
      }`}
    >
      {children}
    </button>
  );
}

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
        <div className="flex items-center justify-center h-64 text-zinc-600 text-sm">Loading settings...</div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Preferences</h1>
          <p className="text-sm text-zinc-600 mt-0.5">
            These settings change how Priya talks to you personally — across every server you share with her.
          </p>
        </div>

        <SettingCard title="Nickname" description="What should Priya call you? Leave blank to use your Discord username.">
          <Input
            placeholder={`e.g. ${user?.username ?? "Rahul"}`}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={32}
            className="max-w-xs bg-black border-white/10 text-zinc-200"
          />
        </SettingCard>

        <SettingCard title="About You" description="A short bio Priya keeps in mind when chatting with you. She'll reference it naturally.">
          <Textarea
            placeholder="e.g. Main 18 saal ka hoon, Delhi se hoon, coding aur anime pasand hai mujhe"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={200}
            rows={3}
            className="resize-none text-sm bg-black border-white/10 text-zinc-200"
          />
          <p className="text-xs text-zinc-700 mt-1">{bio.length}/200</p>
        </SettingCard>

        <SettingCard title="Birthday 🎂" description="Priya will wish you on your birthday! (We only store month + day, not year.)">
          <div className="flex gap-3 items-center flex-wrap">
            <select
              value={birthdayMonth}
              onChange={(e) => setBirthdayMonth(e.target.value)}
              className="bg-black border border-white/10 rounded-md px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-500"
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
              className="w-32 bg-black border-white/10 text-zinc-200"
            />
            {(birthdayMonth || birthdayDay) && (
              <button
                onClick={() => { setBirthdayMonth(""); setBirthdayDay(""); }}
                className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </SettingCard>

        <SettingCard title="Topics You Like 💬" description="Priya will bring up these topics naturally in conversation. Add up to 10.">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {topics.map((t) => (
                <span
                  key={t}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-full bg-white/10 border border-white/10 text-zinc-300"
                >
                  {t}
                  <button onClick={() => removeTopic(t)} className="hover:text-white ml-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {topics.length === 0 && (
                <span className="text-xs text-zinc-600">No topics added yet</span>
              )}
            </div>
            {topics.length < 10 && (
              <div className="flex gap-2">
                <Input
                  placeholder="Type a topic..."
                  value={topicInput}
                  onChange={(e) => setTopicInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTopic(topicInput); } }}
                  className="max-w-xs text-sm bg-black border-white/10 text-zinc-200"
                />
                <Button variant="outline" size="sm" onClick={() => addTopic(topicInput)} className="gap-1 border-white/10 text-zinc-400 hover:text-zinc-200">
                  <Plus className="w-3.5 h-3.5" /> Add
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <p className="w-full text-xs text-zinc-600 mb-1">Quick add:</p>
              {TOPIC_SUGGESTIONS.filter((s) => !topics.includes(s)).slice(0, 8).map((s) => (
                <button
                  key={s}
                  onClick={() => addTopic(s)}
                  className="px-2 py-0.5 text-xs rounded-full border border-white/10 text-zinc-600 hover:border-white/20 hover:text-zinc-300 transition-colors"
                >
                  + {s}
                </button>
              ))}
            </div>
          </div>
        </SettingCard>

        <SettingCard title="Pronouns" description="So Priya uses the right words when talking about you.">
          <div className="flex flex-wrap gap-2">
            {PRONOUNS_OPTIONS.map((o) => (
              <PillButton key={o.value} active={pronouns === o.value} onClick={() => setPronouns(o.value)}>
                {o.label}
              </PillButton>
            ))}
          </div>
        </SettingCard>

        <SettingCard title="Relationship Vibe" description="Sets the tone of how Priya interacts with you.">
          <div className="space-y-2">
            {VIBE_OPTIONS.map((o) => (
              <label
                key={o.value}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                  vibe === o.value
                    ? "bg-white/10 border-white/20 text-zinc-200"
                    : "border-white/10 hover:border-white/15 text-zinc-600"
                }`}
              >
                <input
                  type="radio"
                  name="vibe"
                  value={o.value}
                  checked={vibe === o.value}
                  onChange={() => setVibe(o.value)}
                  className="accent-zinc-400"
                />
                <span className="text-sm">{o.label}</span>
              </label>
            ))}
          </div>
        </SettingCard>

        <SettingCard title="Language Style" description="Priya naturally speaks Hinglish — you can ask her to use more English.">
          <div className="flex flex-wrap gap-2">
            {LANG_OPTIONS.map((o) => (
              <PillButton key={o.value} active={lang === o.value} onClick={() => setLang(o.value)}>
                {o.label}
              </PillButton>
            ))}
          </div>
        </SettingCard>

        <SettingCard title="Emoji Usage" description="How many emojis should Priya use in her messages?">
          <div className="flex flex-wrap gap-2">
            {EMOJI_OPTIONS.map((o) => (
              <PillButton key={o.value} active={emojiStyle === o.value} onClick={() => setEmojiStyle(o.value)}>
                {o.label}
              </PillButton>
            ))}
          </div>
        </SettingCard>

        <SettingCard title="Reply Length" description="How long should Priya's replies typically be?">
          <div className="flex flex-wrap gap-2">
            {REPLY_LENGTH_OPTIONS.map((o) => (
              <PillButton key={o.value} active={replyLength === o.value} onClick={() => setReplyLength(o.value)}>
                {o.label}
              </PillButton>
            ))}
          </div>
        </SettingCard>

        <div className="flex justify-end pb-2">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="gap-2 bg-zinc-200 text-black hover:bg-white font-semibold"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving..." : "Save Preferences"}
          </Button>
        </div>
      </div>
    </PortalLayout>
  );
}
