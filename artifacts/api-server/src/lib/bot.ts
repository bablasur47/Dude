import {
  Client,
  type Message,
  type GuildMember,
  type TextChannel,
  ChannelType,
} from "discord.js-selfbot-v13";
import { logger } from "./logger";
import { ChatHistory, BotUser, ServerConfig, Personality } from "./models";
import { getAiResponse } from "./ai-router";
import { getPersonality } from "./personality";
import { handlePrefixCommand, getServerPrefix } from "./prefix-commands";
import { generateCounterCard } from "./cards";
import type { CounterMember } from "./cards";

export let discordClient: Client | null = null;
export let botStartTime = Date.now();

// ─── Snipe store (deleted messages, keyed by channelId) ───────────────────────

export interface DeletedMessage {
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  content: string;
  deletedAt: number;
}
const SNIPE_MAX = 5;
export const snipeStore = new Map<string, DeletedMessage[]>();

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ─── History helpers ──────────────────────────────────────────────────────────

async function getHistory(userId: string, guildId: string) {
  const cutoff = new Date(Date.now() - ONE_WEEK_MS);
  let history = await ChatHistory.findOne({ userId, guildId });
  if (!history) {
    history = new ChatHistory({ userId, guildId, messages: [] });
  }
  history.messages = history.messages.filter(
    (m: { timestamp: Date }) => m.timestamp >= cutoff
  );
  return history;
}

async function saveHistory(userId: string, guildId: string, role: "user" | "assistant", content: string) {
  const cutoff = new Date(Date.now() - ONE_WEEK_MS);
  await ChatHistory.findOneAndUpdate(
    { userId, guildId },
    { $push: { messages: { role, content, timestamp: new Date() } } },
    { upsert: true }
  );
  await ChatHistory.updateOne(
    { userId, guildId },
    { $pull: { messages: { timestamp: { $lt: cutoff } } } }
  );
}

async function upsertUser(member: { id: string; username: string; discriminator?: string; avatarUrl?: string }, guildId: string) {
  const setFields: Record<string, unknown> = {
    username: member.username,
    discriminator: member.discriminator,
    lastSeen: new Date(),
  };
  if (member.avatarUrl) setFields.avatarUrl = member.avatarUrl;
  await BotUser.findOneAndUpdate(
    { userId: member.id },
    {
      $set: setFields,
      $addToSet: { servers: guildId },
    },
    { upsert: true }
  );
}

// ─── Access check ─────────────────────────────────────────────────────────────

async function isAllowed(userId: string): Promise<{ allowed: boolean; banned: boolean }> {
  const ownerId = process.env.OWNER_DISCORD_ID;
  if (userId === ownerId) return { allowed: true, banned: false };
  const user = await BotUser.findOne({ userId });
  if (user?.banned) return { allowed: false, banned: true };
  if (user?.whitelisted) return { allowed: true, banned: false };
  return { allowed: false, banned: false };
}

// ─── Core reply logic ─────────────────────────────────────────────────────────

async function generateReply(
  userId: string,
  guildId: string,
  userMessage: string,
  isNsfw: boolean
): Promise<string> {
  const personality = await getPersonality();
  const history = await getHistory(userId, guildId);

  let systemPrompt = personality.systemPrompt;

  const userProfile = await BotUser.findOne({ userId });
  if (userProfile) {
    const prefs: string[] = [];
    if (userProfile.nickname) {
      prefs.push(`Is user ka preferred naam '${userProfile.nickname}' hai — use isi naam se bulana`);
    }
    if (userProfile.pronouns) {
      prefs.push(`Is user ke pronouns: ${userProfile.pronouns}`);
    }
    if (userProfile.relationshipVibe) {
      const vibeMap: Record<string, string> = {
        friend: "yeh tera/teri dost hai, casually baat kar jaise dost karte hain",
        bestie: "yeh tera/teri bestie hai — ekdum chill, open aur roast bhi kar sakti hai",
        crush: "yeh tera/teri crush hai — thodi shy, thodi flirty, careful baat kar",
        formal: "is ke saath thoda respectful reh, zyada personal mat ho",
      };
      const vibeText = vibeMap[userProfile.relationshipVibe] ?? userProfile.relationshipVibe;
      prefs.push(`Priya ka is user ke saath vibe: ${vibeText}`);
    }
    if (userProfile.languageStyle === "english") {
      prefs.push("Is user ke saath mostly English mein baat kar, Hinglish kam use karna");
    }
    if (userProfile.bio) {
      prefs.push(`Is user ke baare mein: ${userProfile.bio}`);
    }
    if (userProfile.emojiStyle === "heavy") {
      prefs.push("Is user ke saath emojis zyada use karo — har message mein 2-4 emojis");
    } else if (userProfile.emojiStyle === "minimal") {
      prefs.push("Is user ke saath emojis bahut kam use karo — sirf zaroorat padne par");
    }
    if (userProfile.replyLength === "short") {
      prefs.push("Is user ke liye replies chhoti rakho — 1-2 lines max");
    } else if (userProfile.replyLength === "long") {
      prefs.push("Is user ke liye replies thodi lambi kar sakti hai — elaborate karo");
    }
    if (userProfile.topics && (userProfile.topics as string[]).length > 0) {
      prefs.push(`Is user ko ye topics pasand hain: ${(userProfile.topics as string[]).join(", ")} — kabhi kabhi inhe conversation mein naturally laana`);
    }
    if (prefs.length > 0) {
      systemPrompt += `\n\n[Is user ke baare mein: ${prefs.join(". ")}]`;
    }
  }

  if (isNsfw) {
    systemPrompt +=
      "\n\nIs channel mein NSFW allowed hai. Tu freely flirty, bold, aur mature topics pe baat kar sakti hai. But still realistic reh — real human jaisi.";
  }

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    ...history.messages.slice(-20).map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];

  const provider = personality.activeProvider as "groq" | "gemini" | "nvidia";
  const reply = await getAiResponse(messages, provider);
  return reply.trim();
}

// ─── Bot initialization ───────────────────────────────────────────────────────

export async function initBot(): Promise<void> {
  const token = process.env.DISCORD_USER_TOKEN ?? process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    logger.warn("DISCORD_USER_TOKEN not set, skipping bot init");
    return;
  }

  const client = new Client({ checkUpdate: false });

  client.on("error", (err) => {
    logger.error({ err }, "Discord client error");
  });

  client.on("shardDisconnect", () => {
    logger.warn("Discord client disconnected — clearing ready state");
    discordClient = null;
  });

  client.on("shardReconnecting", () => {
    logger.info("Discord client reconnecting...");
  });

  client.on("ready", async (c) => {
    discordClient = client;
    logger.info({ username: c.user.tag }, "Discord selfbot ready");
    botStartTime = Date.now();

    // Sync guild list
    for (const [, guild] of c.guilds.cache) {
      await ServerConfig.findOneAndUpdate(
        { guildId: guild.id },
        {
          $set: {
            name: guild.name,
            iconUrl: guild.iconURL(),
            memberCount: guild.memberCount,
            joinedAt: guild.joinedAt,
          },
          $setOnInsert: { nsfwChannels: [], totalMessages: 0 },
        },
        { upsert: true }
      );
    }

    // Start schedulers
    startRandomPingScheduler(c);
    startCounterUpdater(c);
  });

  // ─── Guild Join ──────────────────────────────────────────────────────────────

  client.on("guildCreate", async (guild) => {
    await ServerConfig.findOneAndUpdate(
      { guildId: guild.id },
      {
        $set: {
          name: guild.name,
          iconUrl: guild.iconURL(),
          memberCount: guild.memberCount,
          joinedAt: guild.joinedAt,
        },
        $setOnInsert: { nsfwChannels: [], totalMessages: 0 },
      },
      { upsert: true }
    );
  });

  // ─── New Member Greeting ─────────────────────────────────────────────────────

  client.on("guildMemberAdd", async (member: GuildMember) => {
    const personality = await getPersonality();
    if (!personality.greetNewMembers) return;

    const guild = member.guild;
    const serverConf = await ServerConfig.findOne({ guildId: guild.id });

    if (!serverConf?.welcomeEnabled) return;

    let channel: TextChannel | undefined;
    if (serverConf.welcomeChannelId) {
      const ch = guild.channels.cache.get(serverConf.welcomeChannelId);
      if (ch && ch.type === ChannelType.GuildText && "send" in ch) {
        channel = ch as TextChannel;
      }
    }
    if (!channel) {
      channel = (guild.systemChannel || guild.channels.cache
        .filter((c) => c.type === ChannelType.GuildText)
        .first()) as TextChannel | undefined;
    }

    if (!channel || !("send" in channel)) return;

    const ping = `<@${member.id}>`;
    const greetings = [
      `Arrey ${ping}! Aa gaye! Welcome to the server yaar! 🎉`,
      `Oho, ${ping} aa gaya! Finally! Welcome haan!`,
      `${ping}! Welcome yaar! Server mein khush raho!`,
      `Aye ${ping}! Server mein swagat hai tumhara! 👋`,
      `${ping} aaya! Yay! Welcome welcome! Enjoy karo!`,
    ];

    const greeting = greetings[Math.floor(Math.random() * greetings.length)];
    await (channel as TextChannel).send(greeting);
  });

  // ─── Message Delete (snipe) ──────────────────────────────────────────────────

  client.on("messageDelete", (message) => {
    if (message.partial) return;
    if (!message.author) return;
    if (message.author.id === client.user?.id) return;
    if (!message.content) return;
    const displayName =
      (message.member as GuildMember | null)?.displayName ??
      message.author?.username ??
      "Unknown";
    const avatarUrl = message.author?.avatarURL({ size: 256 }) ?? null;
    const entry: DeletedMessage = {
      authorId: message.author!.id,
      authorName: displayName,
      authorAvatar: avatarUrl,
      content: message.content,
      deletedAt: Date.now(),
    };
    const prev = snipeStore.get(message.channelId) ?? [];
    snipeStore.set(message.channelId, [entry, ...prev].slice(0, SNIPE_MAX));
  });

  // ─── Message handler ─────────────────────────────────────────────────────────

  client.on("messageCreate", async (message: Message) => {
    // Skip own messages
    if (message.author.id === client.user?.id) return;

    const isDm = !message.guild;
    const guildId = isDm ? "dm" : message.guild!.id;

    // Count every guild message — server total + per-user leaderboard count
    if (!isDm) {
      ServerConfig.findOneAndUpdate(
        { guildId },
        { $inc: { totalMessages: 1 } }
      ).catch(() => {});
      BotUser.findOneAndUpdate(
        { userId: message.author.id },
        {
          $inc: { messageCount: 1 },
          $setOnInsert: {
            username: message.author.username,
            discriminator: message.author.discriminator ?? "0",
            avatarUrl: message.author.avatarURL({ size: 64 }) ?? "",
          },
          $addToSet: { servers: guildId },
        },
        { upsert: true }
      ).catch(() => {});
    }

    const isMentioned = message.mentions.has(client.user!);
    const isReply =
      message.reference?.messageId &&
      (await message.channel.messages
        .fetch(message.reference.messageId)
        .then((m) => m.author.id === client.user!.id)
        .catch(() => false));

    // ── Prefix commands ────────────────────────────────────────────────────────
    const serverPrefix = await getServerPrefix(isDm ? null : message.guild?.id ?? null);
    if (message.content.startsWith(serverPrefix)) {
      const withoutPrefix = message.content.slice(serverPrefix.length).trim();
      const parts = withoutPrefix.split(/\s+/);
      const command = parts[0]?.toLowerCase() ?? "";
      const args = parts.slice(1);

      // ── Whitelist management (owner only) ─────────────────────────────────
      if (command === "whitelist") {
        if (message.author.id !== process.env.OWNER_DISCORD_ID) {
          await message.reply("Yaar ye command sirf bot owner ke liye hai! 😤");
          return;
        }
        await handleWhitelistCommand(message, args);
        return;
      }

      // ── All other prefix commands — check whitelist first ─────────────────
      const access = await isAllowed(message.author.id);
      if (!access.allowed) return;

      if (command === "image" || command === "imagine") {
        const rawPrompt = args.join(" ").trim();
        if (!rawPrompt) {
          await message.reply(`Kya banana hai? Kuch prompt do! Example: \`${serverPrefix}image cute cat on a mountain\``);
          return;
        }
        let statusMsg: Message | null = null;
        try {
          statusMsg = await message.reply("Soch rahi hun... image bana rahi hun! Thodi wait karo 🎨");
          const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(rawPrompt)}?width=1024&height=1024&model=flux&nologo=true&enhance=true`;
          const imgRes = await fetch(url);
          if (!imgRes.ok) throw new Error(`Pollinations returned ${imgRes.status}`);
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          await statusMsg.delete().catch(() => {});
          await message.reply({
            content: `**Yeh lo!** \`${rawPrompt}\``,
            files: [{ attachment: buffer, name: "priya-art.png" }],
          });
        } catch (err) {
          logger.error({ err }, "Image generation failed");
          if (statusMsg) {
            await statusMsg.edit("Yaar kuch gadbad ho gayi image generate karte waqt. Thodi der baad try karo!").catch(() => {});
          }
        }
        return;
      }

      const prefixCommandNames = [
        "help", "commands",
        "profile", "p",
        "ship",
        "marry", "marriage",
        "divorce",
        "adopt",
        "unadopt",
        "family",
        "runaway", "escape", "leavefamily", "leave",
        "parents", "parent",
        "marriagecard", "mcard", "weddingcard",
        "roast",
        "hug",
        "slap",
        "8ball", "eightball",
        "rate",
        "coinflip", "flip",
        "rank", "m",
        "lb",
        "resetcount",
        "snipe",
        "nsfw",
        "reset",
        "truth",
        "dare",
        "ping",
        "announce",
        "ban", "botban",
        "unban", "botunban",
        "serverlist",
        "clearhistory",
        "setpingchannel",
        "setwelcome",
        "welcome",
        "resetserver",
        "say",
        "forceadopt",
        "setupcounter",
        "setprefix",
        "setprovider",
        "aioff",
        "aion",
        "aioffchannel",
        "aionchannel",
      ];
      if (prefixCommandNames.includes(command)) {
        await handlePrefixCommand(message, client, command, args);
        return;
      }
    }

    if (!isDm && !isMentioned && !isReply) return;

    // ── Access check for AI replies ────────────────────────────────────────
    const access = await isAllowed(message.author.id);
    if (!access.allowed) return;

    // Check server/channel AI toggle + NSFW setting
    let isNsfw = false;
    if (!isDm && message.channelId) {
      const serverConf = await ServerConfig.findOne({ guildId });
      isNsfw = serverConf?.nsfwChannels.includes(message.channelId) ?? false;

      const aiOff = serverConf?.aiEnabled === false ||
        (serverConf?.aiDisabledChannels ?? []).includes(message.channelId);
      if (aiOff) return;
    }

    const userText = message.content
      .replace(/<@!?\d+>/g, "")
      .trim();

    if (!userText) return;

    if ("sendTyping" in message.channel) {
      await (message.channel as { sendTyping: () => Promise<void> }).sendTyping();
    }

    try {
      await upsertUser(
        {
          id: message.author.id,
          username: message.author.username,
          discriminator: message.author.discriminator,
          avatarUrl: message.author.avatarURL({ size: 256 }) ?? undefined,
        },
        guildId
      );

      await saveHistory(message.author.id, guildId, "user", userText);

      const reply = await generateReply(
        message.author.id,
        guildId,
        userText,
        isNsfw
      );

      await saveHistory(message.author.id, guildId, "assistant", reply);

      if (Math.random() < 0.05) {
        const emojis = ["😏", "💅", "🙄", "😌", "👀"];
        const emoji = emojis[Math.floor(Math.random() * emojis.length)];
        await message.react(emoji).catch(() => {});
      }

      await message.reply({ content: reply, allowedMentions: { repliedUser: false } });
    } catch (err) {
      logger.error({ err }, "Error generating bot reply");
      await message.reply("Yaar kuch technical issue ho gaya. Thodi der baad try karo!").catch(() => {});
    }
  });

  await client.login(token);
}

// ─── Whitelist management ─────────────────────────────────────────────────────

async function handleWhitelistCommand(message: Message, args: string[]): Promise<void> {
  const sub = args[0]?.toLowerCase();

  if (sub === "add") {
    const targetId = args[1]?.replace(/[<@!>]/g, "").trim();
    if (!targetId || !/^\d+$/.test(targetId)) {
      await message.reply("Usage: `!whitelist add <userid>` — valid Discord user ID do!");
      return;
    }
    await BotUser.findOneAndUpdate(
      { userId: targetId },
      { $set: { whitelisted: true } },
      { upsert: true }
    );
    await message.reply(`✅ User \`${targetId}\` ko whitelist kar diya! Ab ye Priya se baat kar sakta hai.`);
    return;
  }

  if (sub === "remove" || sub === "rem") {
    const targetId = args[1]?.replace(/[<@!>]/g, "").trim();
    if (!targetId || !/^\d+$/.test(targetId)) {
      await message.reply("Usage: `!whitelist remove <userid>` — valid Discord user ID do!");
      return;
    }
    await BotUser.findOneAndUpdate(
      { userId: targetId },
      { $set: { whitelisted: false } }
    );
    await message.reply(`✅ User \`${targetId}\` ko whitelist se hata diya.`);
    return;
  }

  if (sub === "list") {
    const users = await BotUser.find({ whitelisted: true }).lean();
    if (users.length === 0) {
      await message.reply("Abhi koi whitelist mein nahi hai. `!whitelist add <userid>` se add karo!");
      return;
    }
    const lines = users.map((u, i) => `${i + 1}. **${u.username}** (\`${u.userId}\`)`);
    const chunks: string[] = [];
    let current = `**Whitelisted Users (${users.length}):**\n`;
    for (const line of lines) {
      if ((current + line + "\n").length > 1900) {
        chunks.push(current);
        current = "";
      }
      current += line + "\n";
    }
    if (current) chunks.push(current);
    for (const chunk of chunks) {
      await message.reply(chunk).catch(() => {});
    }
    return;
  }

  await message.reply(
    "**Whitelist Commands:**\n" +
    "`!whitelist add <userid>` — kisi ko whitelist karo\n" +
    "`!whitelist remove <userid>` — whitelist se hatao\n" +
    "`!whitelist list` — saare whitelisted users dekho"
  );
}

// ─── Top members helper ───────────────────────────────────────────────────────

async function getTopMembers(
  guildId: string,
  guildMembers: Map<string, import("discord.js-selfbot-v13").GuildMember>
): Promise<CounterMember[]> {
  const top = await BotUser.find({ servers: guildId, banned: { $ne: true } })
    .sort({ messageCount: -1 })
    .limit(10)
    .lean()
    .catch(() => []);

  return top.map((u) => {
    const member = guildMembers.get(u.userId);
    const avatarUrl =
      member?.user.avatarURL({ size: 64 }) ??
      u.avatarUrl ??
      undefined;
    return {
      userId: u.userId,
      username: member?.displayName ?? member?.user.username ?? u.username,
      avatarUrl,
      messageCount: u.messageCount ?? 0,
    };
  });
}

// ─── Random ping scheduler ────────────────────────────────────────────────────

function startRandomPingScheduler(client: Client) {
  const schedule = async () => {
    const personality = await getPersonality();
    if (!personality.randomPingEnabled) return;

    for (const [, guild] of client.guilds.cache) {
      try {
        const serverConf = await ServerConfig.findOne({ guildId: guild.id });

        let channel: TextChannel | undefined;

        if (serverConf?.pingChannelId) {
          const ch = guild.channels.cache.get(serverConf.pingChannelId);
          if (ch && ch.type === ChannelType.GuildText && "send" in ch) {
            channel = ch as TextChannel;
          }
        }

        if (!channel) {
          const textChannels = guild.channels.cache.filter(
            (c) => c.type === ChannelType.GuildText
          );
          if (textChannels.size === 0) continue;
          channel = textChannels.random() as TextChannel;
        }

        if (!channel) continue;

        const members = (await guild.members.fetch()).filter((m) => !m.user.bot && m.user.id !== client.user?.id);
        if (members.size === 0) continue;

        const member = members.random();
        if (!member) continue;

        const prompts = [
          `Aur batao kya chal raha hai?`,
          `Aye yaar, boring ho raha hai! Baat karo mujhse!`,
          `Koi hai? Main akeli hu yahan 🥺`,
          `Aye, tum log itne quiet kyun ho aaj?`,
          `Kuch interesting batao yaar!`,
          `Oi ${member.displayName}, kaisa chal raha hai tera din?`,
          `Suno suno, koi interesting cheez batao mujhe!`,
        ];

        const prompt = prompts[Math.floor(Math.random() * prompts.length)];
        await channel.send(`<@${member.id}> ${prompt}`);
      } catch (err) {
        logger.warn({ err, guildId: guild.id }, "Random ping failed");
      }
    }
  };

  const intervalMs = 2 * 60 * 60 * 1000;
  setInterval(schedule, intervalMs);
}

// ─── Live counter updater (every 30 s) ───────────────────────────────────────

function startCounterUpdater(client: Client) {
  const tick = async () => {
    const configs = await ServerConfig.find({
      counterChannelId: { $ne: null },
      counterMessageId: { $ne: null },
    }).catch(() => []);

    for (const conf of configs) {
      try {
        const guild = client.guilds.cache.get(conf.guildId);
        if (!guild) continue;

        const channel = guild.channels.cache.get(conf.counterChannelId!) as TextChannel | undefined;
        if (!channel || !("messages" in channel)) continue;

        const msg = await channel.messages.fetch(conf.counterMessageId!).catch(() => null);
        if (!msg) {
          await ServerConfig.findOneAndUpdate(
            { guildId: conf.guildId },
            { $set: { counterChannelId: null, counterMessageId: null } }
          );
          continue;
        }

        const members = await guild.members.fetch().catch(() => guild.members.cache);
        const memberCount = members.size;
        const botCount = members.filter((m) => m.user.bot).size;
        const memberMap = new Map(members.map((m) => [m.user.id, m]));
        const topMembers = await getTopMembers(conf.guildId, memberMap);

        const buf = await generateCounterCard({
          guildName: guild.name,
          guildIconUrl: guild.iconURL({ size: 256 }) ?? undefined,
          totalMessages: conf.totalMessages ?? 0,
          memberCount,
          botCount,
          updatedAt: new Date(),
          topMembers,
        });

        await msg.edit({
          content: "",
          files: [{ attachment: buf, name: "counter.png" }],
        });
      } catch (err) {
        logger.warn({ err, guildId: conf.guildId }, "Counter update failed");
      }
    }
  };

  tick().catch(() => {});
  setInterval(() => tick().catch(() => {}), 30_000);
}
