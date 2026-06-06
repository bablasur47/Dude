import mongoose, { Schema, Document } from "mongoose";

// ─── Chat History ─────────────────────────────────────────────────────────────

export interface IChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export interface IChatHistory extends Document {
  userId: string;
  guildId: string; // "dm" for direct messages
  messages: IChatMessage[];
  updatedAt: Date;
}

const ChatMessageSchema = new Schema<IChatMessage>({
  role: { type: String, enum: ["user", "assistant"], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: () => new Date() },
});

const ChatHistorySchema = new Schema<IChatHistory>(
  {
    userId: { type: String, required: true, index: true },
    guildId: { type: String, required: true, index: true },
    messages: [ChatMessageSchema],
  },
  { timestamps: true }
);

ChatHistorySchema.index({ userId: 1, guildId: 1 }, { unique: true });

export const ChatHistory =
  mongoose.models.ChatHistory ||
  mongoose.model<IChatHistory>("ChatHistory", ChatHistorySchema);

// ─── User Registry ────────────────────────────────────────────────────────────

export interface IBotUser extends Document {
  userId: string;
  username: string;
  discriminator?: string;
  avatarUrl?: string;
  messageCount: number;
  lastSeen: Date;
  servers: string[];
  banned: boolean;
  // Personal portal settings
  nickname?: string;           // What Priya calls this user
  pronouns?: string;           // he/him | she/her | they/them | custom
  relationshipVibe?: string;   // friend | bestie | crush | formal
  languageStyle?: string;      // hinglish | english
}

const BotUserSchema = new Schema<IBotUser>(
  {
    userId: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    discriminator: String,
    avatarUrl: String,
    messageCount: { type: Number, default: 0 },
    lastSeen: { type: Date, default: () => new Date() },
    servers: [String],
    banned: { type: Boolean, default: false },
    nickname: { type: String, default: null },
    pronouns: { type: String, default: null },
    relationshipVibe: { type: String, default: null },
    languageStyle: { type: String, default: "hinglish" },
  },
  { timestamps: true }
);

export const BotUser =
  mongoose.models.BotUser ||
  mongoose.model<IBotUser>("BotUser", BotUserSchema);

// ─── Server Registry ──────────────────────────────────────────────────────────

export interface IServerConfig extends Document {
  guildId: string;
  name: string;
  iconUrl?: string;
  memberCount: number;
  joinedAt: Date;
  nsfwChannels: string[];
  totalMessages: number;
  welcomeEnabled: boolean;
  welcomeChannelId?: string;
  pingChannelId?: string;
  prefix: string;               // per-server command prefix (default "!")
}

const ServerConfigSchema = new Schema<IServerConfig>(
  {
    guildId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    iconUrl: String,
    memberCount: { type: Number, default: 0 },
    joinedAt: { type: Date, default: () => new Date() },
    nsfwChannels: [String],
    totalMessages: { type: Number, default: 0 },
    welcomeEnabled: { type: Boolean, default: false },
    welcomeChannelId: { type: String, default: null },
    pingChannelId: { type: String, default: null },
    prefix: { type: String, default: "!" },
  },
  { timestamps: true }
);

export const ServerConfig =
  mongoose.models.ServerConfig ||
  mongoose.model<IServerConfig>("ServerConfig", ServerConfigSchema);

// ─── API Keys ─────────────────────────────────────────────────────────────────

export interface IApiKey extends Document {
  provider: "groq" | "gemini" | "nvidia";
  label: string;
  key: string;
  enabled: boolean;
  errorCount: number;
  lastUsed?: Date;
}

const ApiKeySchema = new Schema<IApiKey>(
  {
    provider: {
      type: String,
      enum: ["groq", "gemini", "nvidia"],
      required: true,
    },
    label: { type: String, required: true },
    key: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    errorCount: { type: Number, default: 0 },
    lastUsed: Date,
  },
  { timestamps: true }
);

export const ApiKey =
  mongoose.models.ApiKey || mongoose.model<IApiKey>("ApiKey", ApiKeySchema);

// ─── Bot Personality ──────────────────────────────────────────────────────────

export interface IPersonality extends Document {
  name: string;
  systemPrompt: string;
  nsfwEnabled: boolean;
  randomPingEnabled: boolean;
  greetNewMembers: boolean;
  randomPingIntervalMinutes: number;
  maxHistoryDays: number;
  activeProvider: string;
}

const PersonalitySchema = new Schema<IPersonality>({
  name: { type: String, default: "Priya" },
  systemPrompt: { type: String, required: true },
  nsfwEnabled: { type: Boolean, default: false },
  randomPingEnabled: { type: Boolean, default: false },
  greetNewMembers: { type: Boolean, default: true },
  randomPingIntervalMinutes: { type: Number, default: 120 },
  maxHistoryDays: { type: Number, default: 7 },
  activeProvider: { type: String, default: "groq" },
});

export const Personality =
  mongoose.models.Personality ||
  mongoose.model<IPersonality>("Personality", PersonalitySchema);

// ─── User Relationships (marry / adopt / family) ──────────────────────────────

export interface IUserRelationship extends Document {
  userId: string;
  guildId: string;
  marriedTo?: string;
  marriedAt?: Date;
  parents: string[];
  children: string[];
}

const UserRelationshipSchema = new Schema<IUserRelationship>(
  {
    userId: { type: String, required: true },
    guildId: { type: String, required: true },
    marriedTo: { type: String, default: null },
    marriedAt: { type: Date, default: null },
    parents: [String],
    children: [String],
  },
  { timestamps: true }
);

UserRelationshipSchema.index({ userId: 1, guildId: 1 }, { unique: true });

export const UserRelationship =
  mongoose.models.UserRelationship ||
  mongoose.model<IUserRelationship>("UserRelationship", UserRelationshipSchema);
