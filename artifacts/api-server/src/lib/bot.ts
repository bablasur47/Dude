import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  Message,
  GuildMember,
  TextChannel,
  ChannelType,
} from "discord.js";
import { logger } from "./logger";
import { ChatHistory, BotUser, ServerConfig, Personality, UserRelationship } from "./models";
import { getAiResponse } from "./ai-router";
import { getPersonality } from "./personality";
import { handlePrefixCommand, getServerPrefix, invalidatePrefixCache } from "./prefix-commands";
import { generateCounterCard, generateAdoptCard } from "./cards";
import type { CardUser, CounterMember } from "./cards";

export let discordClient: Client | null = null;
export let botStartTime = Date.now();

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ─── History helpers ──────────────────────────────────────────────────────────

async function getHistory(userId: string, guildId: string) {
  const cutoff = new Date(Date.now() - ONE_WEEK_MS);
  let history = await ChatHistory.findOne({ userId, guildId });
  if (!history) {
    history = new ChatHistory({ userId, guildId, messages: [] });
  }
  // Prune old messages
  history.messages = history.messages.filter(
    (m: { timestamp: Date }) => m.timestamp >= cutoff
  );
  return history;
}

async function saveHistory(userId: string, guildId: string, role: "user" | "assistant", content: string) {
  const cutoff = new Date(Date.now() - ONE_WEEK_MS);
  // $push and $pull on the same field in one op cause a MongoDB conflict —
  // split into two sequential updates.
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
      $inc: { messageCount: 1 },
      $addToSet: { servers: guildId },
    },
    { upsert: true }
  );
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

  // ── Inject user personal preferences ──────────────────────────────────────
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
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    logger.warn("DISCORD_BOT_TOKEN not set, skipping bot init");
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  discordClient = client;

  // Prevent unhandled Discord errors from crashing the process
  client.on(Events.Error, (err) => {
    logger.error({ err }, "Discord client error");
  });

  client.on(Events.ClientReady, async (c) => {
    logger.info({ username: c.user.tag }, "Discord bot ready");
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

    // Register slash commands
    await c.application.commands.set([
      {
        name: "nsfw",
        description: "Enable or disable Priya NSFW mode in this channel",
        options: [
          {
            name: "enable",
            description: "true to enable, false to disable",
            type: 5, // BOOLEAN
            required: true,
          },
        ],
      },
      {
        name: "reset",
        description: "Reset your chat history with Priya",
      },
      {
        name: "truth",
        description: "Ask Priya for a truth question",
      },
      {
        name: "dare",
        description: "Ask Priya for a dare",
      },
      // ── Owner-only commands ──────────────────────────────────────────────────
      {
        name: "ping",
        description: "[Owner] Check bot latency and stats",
      },
      {
        name: "announce",
        description: "[Owner] Broadcast a message as Priya to all servers",
        options: [
          {
            name: "message",
            description: "Message to broadcast",
            type: 3, // STRING
            required: true,
          },
        ],
      },
      {
        name: "ban",
        description: "[Owner] Ban a user from using Priya",
        options: [
          {
            name: "user",
            description: "User to ban",
            type: 6, // USER
            required: true,
          },
          {
            name: "reason",
            description: "Reason for ban",
            type: 3, // STRING
            required: false,
          },
        ],
      },
      {
        name: "unban",
        description: "[Owner] Unban a user from using Priya",
        options: [
          {
            name: "userid",
            description: "Discord user ID to unban",
            type: 3, // STRING
            required: true,
          },
        ],
      },
      {
        name: "serverlist",
        description: "[Owner] List all servers Priya is in",
      },
      {
        name: "clearhistory",
        description: "[Owner] Clear chat history of any user",
        options: [
          {
            name: "userid",
            description: "Discord user ID",
            type: 3, // STRING
            required: true,
          },
        ],
      },
      {
        name: "setpingchannel",
        description: "Set the channel where Priya randomly pings members (server owner / Manage Server)",
        options: [
          {
            name: "channel",
            description: "Channel for random pings",
            type: 7, // CHANNEL
            required: true,
          },
        ],
      },
      {
        name: "setwelcome",
        description: "Set the welcome channel for new members (also enables welcome)",
        options: [
          {
            name: "channel",
            description: "Channel to send welcome messages in",
            type: 7, // CHANNEL
            required: true,
          },
        ],
      },
      {
        name: "welcome",
        description: "Enable or disable welcome messages for new members in this server",
        options: [
          {
            name: "enable",
            description: "true to enable, false to disable",
            type: 5, // BOOLEAN
            required: true,
          },
        ],
      },
      {
        name: "resetserver",
        description: "Reset ALL chat history in this server (server owner or admin only)",
      },
      {
        name: "say",
        description: "Make Priya say something in a channel (Administrators only)",
        options: [
          {
            name: "content",
            description: "What should Priya say?",
            type: 3, // STRING
            required: true,
          },
          {
            name: "channel",
            description: "Channel to send the message in (defaults to current channel)",
            type: 7, // CHANNEL
            required: false,
          },
        ],
      },
      {
        name: "setprefix",
        description: "Change Priya's command prefix for this server (Admin only)",
        options: [
          {
            name: "prefix",
            description: "New prefix, e.g. ! or $ or . (1-5 characters)",
            type: 3, // STRING
            required: true,
          },
        ],
      },
      {
        name: "forceadopt",
        description: "[Owner] Forcefully adopt any user as another's child (no consent needed)",
        options: [
          {
            name: "parent",
            description: "The parent user",
            type: 6, // USER
            required: true,
          },
          {
            name: "child",
            description: "The child user",
            type: 6, // USER
            required: true,
          },
        ],
      },
      {
        name: "setupcounter",
        description: "Post a live message-count image in this channel, updated every 30s (Admin only)",
      },
      {
        name: "setprovider",
        description: "[Owner] Switch Priya's active AI provider",
        options: [
          {
            name: "provider",
            description: "AI provider to use",
            type: 3, // STRING
            required: true,
            choices: [
              { name: "Groq", value: "groq" },
              { name: "Gemini", value: "gemini" },
              { name: "Nvidia", value: "nvidia" },
            ],
          },
        ],
      },
    ]);

    // Start random ping scheduler
    startRandomPingScheduler(c);
    // Start live counter updater
    startCounterUpdater(c);
  });

  // ─── Guild Join ──────────────────────────────────────────────────────────────

  client.on(Events.GuildCreate, async (guild) => {
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

  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    const personality = await getPersonality();
    if (!personality.greetNewMembers) return;

    const guild = member.guild;
    const serverConf = await ServerConfig.findOne({ guildId: guild.id });

    // Welcome is off by default per server — must be explicitly enabled
    if (!serverConf?.welcomeEnabled) return;

    let channel: TextChannel | undefined;
    if (serverConf.welcomeChannelId) {
      const ch = guild.channels.cache.get(serverConf.welcomeChannelId);
      if (ch && ch.type === ChannelType.GuildText && "send" in ch) {
        channel = ch as TextChannel;
      }
    }
    // Fall back to system channel or first text channel
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

  // ─── Message handler ─────────────────────────────────────────────────────────

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;

    const isDm = !message.guild;
    const guildId = isDm ? "dm" : message.guild!.id;
    const isMentioned = message.mentions.has(client.user!);
    const isReply =
      message.reference?.messageId &&
      (await message.channel.messages
        .fetch(message.reference.messageId)
        .then((m) => m.author.id === client.user!.id)
        .catch(() => false));

    // ── Dynamic prefix commands — image, ship, marry, divorce, adopt, unadopt, family ──
    const serverPrefix = await getServerPrefix(isDm ? null : message.guild?.id ?? null);
    if (message.content.startsWith(serverPrefix)) {
      const withoutPrefix = message.content.slice(serverPrefix.length).trim();
      const parts = withoutPrefix.split(/\s+/);
      const command = parts[0]?.toLowerCase() ?? "";
      const args = parts.slice(1);

      if (command === "image" || command === "imagine") {
        const rawPrompt = args.join(" ").trim();
        if (!rawPrompt) {
          await message.reply(`Kya banana hai? Kuch prompt do! Example: \`${serverPrefix}image cute cat on a mountain\``);
          return;
        }
        const bannedCheck = await BotUser.findOne({ userId: message.author.id, banned: true });
        if (bannedCheck) return;

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
      ];
      if (prefixCommandNames.includes(command)) {
        const bannedCheck = await BotUser.findOne({ userId: message.author.id, banned: true });
        if (bannedCheck) return;
        await handlePrefixCommand(message, client, command, args);
        return;
      }
    }

    if (!isDm && !isMentioned && !isReply) return;

    // Check if user is banned
    const bannedCheck = await BotUser.findOne({ userId: message.author.id, banned: true });
    if (bannedCheck) return;

    // Check NSFW setting for this channel
    let isNsfw = false;
    if (!isDm && message.channelId) {
      const serverConf = await ServerConfig.findOne({ guildId });
      isNsfw = serverConf?.nsfwChannels.includes(message.channelId) ?? false;
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
          avatarUrl: message.author.displayAvatarURL({ size: 256, extension: "png" } as Parameters<typeof message.author.displayAvatarURL>[0]),
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

      // Increment server message count
      if (!isDm) {
        await ServerConfig.findOneAndUpdate(
          { guildId },
          { $inc: { totalMessages: 1 } }
        );
      }

      // Very rarely react with an emoji (1 in 20 chance)
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

  // ─── Slash Commands ───────────────────────────────────────────────────────────

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, user, guildId, channelId } = interaction;

    try {
      if (commandName === "reset") {
        await ChatHistory.findOneAndUpdate(
          { userId: user.id, guildId: guildId ?? "dm" },
          { $set: { messages: [] } }
        );
        await interaction.reply({
          content: "Done yaar! Teri chat history delete kar di. Fresh start!",
          ephemeral: true,
        });
        return;
      }

      if (commandName === "nsfw") {
        const ownerId = process.env.OWNER_DISCORD_ID;
        if (user.id !== ownerId && !(interaction.memberPermissions?.has("ManageChannels") ?? false)) {
          await interaction.reply({
            content: "Yaar tujhe permission nahi hai ye karne ki!",
            ephemeral: true,
          });
          return;
        }

        const enable = interaction.options.getBoolean("enable", true);
        if (enable) {
          await ServerConfig.findOneAndUpdate(
            { guildId: guildId ?? "unknown" },
            { $addToSet: { nsfwChannels: channelId } },
            { upsert: true }
          );
          await interaction.reply({
            content: "NSFW mode on kar diya is channel mein! 😈",
            ephemeral: true,
          });
        } else {
          await ServerConfig.findOneAndUpdate(
            { guildId: guildId ?? "unknown" },
            { $pull: { nsfwChannels: channelId } }
          );
          await interaction.reply({
            content: "NSFW mode off kar diya is channel mein.",
            ephemeral: true,
          });
        }
        return;
      }

      if (commandName === "truth") {
        // Defer immediately so Discord doesn't time out while AI generates
        await interaction.deferReply();
        const reply = await generateReply(
          user.id,
          guildId ?? "dm",
          "Mujhe ek interesting truth question do",
          false
        );
        await interaction.editReply(reply);
        return;
      }

      if (commandName === "dare") {
        await interaction.deferReply();
        const reply = await generateReply(
          user.id,
          guildId ?? "dm",
          "Mujhe ek fun dare do",
          false
        );
        await interaction.editReply(reply);
        return;
      }

      // ── Owner-only commands ────────────────────────────────────────────────
      const ownerId = process.env.OWNER_DISCORD_ID;
      const ownerCommands = ["ping", "announce", "ban", "unban", "serverlist", "clearhistory"];
      if (ownerCommands.includes(commandName)) {
        if (user.id !== ownerId) {
          await interaction.reply({
            content: "Yaar ye command sirf owner ke liye hai! Tu owner nahi hai 😤",
            ephemeral: true,
          });
          return;
        }

        if (commandName === "ping") {
          const latency = client.ws.ping;
          const servers = client.guilds.cache.size;
          const uptime = Math.floor((Date.now() - botStartTime) / 1000 / 60);
          await interaction.reply({
            content: `**Priya Status**\n🏓 Latency: ${latency}ms\n🌐 Servers: ${servers}\n⏱️ Uptime: ${uptime} minutes`,
            ephemeral: true,
          });
          return;
        }

        if (commandName === "announce") {
          await interaction.deferReply({ ephemeral: true });
          const msg = interaction.options.getString("message", true);
          let sent = 0;
          let failed = 0;
          for (const [, guild] of client.guilds.cache) {
            try {
              const channel = guild.systemChannel ||
                guild.channels.cache
                  .filter((c) => c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me!)?.has("SendMessages"))
                  .first() as TextChannel | undefined;
              if (channel && "send" in channel) {
                await (channel as TextChannel).send(msg);
                sent++;
              }
            } catch {
              failed++;
            }
          }
          await interaction.editReply(
            `Broadcast complete! Sent to ${sent} server${sent !== 1 ? "s" : ""}${failed > 0 ? `, failed on ${failed}` : ""}.`
          );
          return;
        }

        if (commandName === "ban") {
          const target = interaction.options.getUser("user", true);
          const reason = interaction.options.getString("reason") ?? "No reason given";
          await BotUser.findOneAndUpdate(
            { userId: target.id },
            { $set: { banned: true } },
            { upsert: true }
          );
          await interaction.reply({
            content: `**${target.username}** ko ban kar diya! Reason: ${reason}`,
            ephemeral: true,
          });
          return;
        }

        if (commandName === "unban") {
          const targetId = interaction.options.getString("userid", true);
          const result = await BotUser.findOneAndUpdate(
            { userId: targetId },
            { $set: { banned: false } }
          );
          if (result) {
            await interaction.reply({ content: `User \`${targetId}\` ko unban kar diya!`, ephemeral: true });
          } else {
            await interaction.reply({ content: `User \`${targetId}\` mili nahi database mein.`, ephemeral: true });
          }
          return;
        }

        if (commandName === "serverlist") {
          const guilds = client.guilds.cache.map((g) => `• **${g.name}** (${g.memberCount} members)`);
          const list = guilds.length > 0 ? guilds.join("\n") : "Koi server nahi!";
          await interaction.reply({
            content: `**Servers where Priya is present (${guilds.length}):**\n${list}`,
            ephemeral: true,
          });
          return;
        }

        if (commandName === "clearhistory") {
          const targetId = interaction.options.getString("userid", true);
          await ChatHistory.updateMany({ userId: targetId }, { $set: { messages: [] } });
          await interaction.reply({
            content: `User \`${targetId}\` ki saari chat history clear kar di!`,
            ephemeral: true,
          });
          return;
        }

        if (commandName === "setprovider") {
          const provider = interaction.options.getString("provider", true) as "groq" | "gemini" | "nvidia";
          await Personality.findOneAndUpdate({}, { $set: { activeProvider: provider } }, { upsert: true });
          await interaction.reply({
            content: `Done! Ab Priya **${provider.toUpperCase()}** use karegi. Teri marzi!`,
            ephemeral: true,
          });
          return;
        }
      }

      // ── /setpingchannel — set channel for random pings ───────────────────────
      if (commandName === "setpingchannel") {
        const isOwner = user.id === process.env.OWNER_DISCORD_ID;
        const isServerOwner = interaction.guild?.ownerId === user.id;
        const hasManage = interaction.memberPermissions?.has("ManageGuild") ?? false;

        if (!isOwner && !isServerOwner && !hasManage) {
          await interaction.reply({
            content: "Yaar tujhe permission nahi hai ye karne ki! Manage Server chahiye.",
            ephemeral: true,
          });
          return;
        }

        if (!guildId) {
          await interaction.reply({ content: "Ye command sirf server mein use hoti hai.", ephemeral: true });
          return;
        }

        const ch = interaction.options.getChannel("channel", true);
        await ServerConfig.findOneAndUpdate(
          { guildId },
          { $set: { pingChannelId: ch.id } },
          { upsert: true }
        );
        await interaction.reply({
          content: `Done! Ab main <#${ch.id}> mein random members ko ping karungi. (Random ping globally on hona chahiye — dashboard se check karo!)`,
          ephemeral: true,
        });
        return;
      }

      // ── /setwelcome — set welcome channel for this server ───────────────────
      if (commandName === "setwelcome") {
        const isOwner = user.id === process.env.OWNER_DISCORD_ID;
        const isServerOwner = interaction.guild?.ownerId === user.id;
        const hasManage = interaction.memberPermissions?.has("ManageGuild") ?? false;

        if (!isOwner && !isServerOwner && !hasManage) {
          await interaction.reply({
            content: "Yaar tujhe permission nahi hai ye karne ki! Manage Server chahiye.",
            ephemeral: true,
          });
          return;
        }

        if (!guildId) {
          await interaction.reply({ content: "Ye command sirf server mein use hoti hai.", ephemeral: true });
          return;
        }

        const ch = interaction.options.getChannel("channel", true);
        await ServerConfig.findOneAndUpdate(
          { guildId },
          { $set: { welcomeChannelId: ch.id, welcomeEnabled: true } },
          { upsert: true }
        );
        await interaction.reply({
          content: `Done! Ab naye members ko <#${ch.id}> mein welcome karungi. Welcome bhi on kar di! 🎉`,
          ephemeral: true,
        });
        return;
      }

      // ── /welcome — toggle welcome on/off for this server ─────────────────────
      if (commandName === "welcome") {
        const isOwner = user.id === process.env.OWNER_DISCORD_ID;
        const isServerOwner = interaction.guild?.ownerId === user.id;
        const hasManage = interaction.memberPermissions?.has("ManageGuild") ?? false;

        if (!isOwner && !isServerOwner && !hasManage) {
          await interaction.reply({
            content: "Yaar tujhe permission nahi hai ye karne ki! Manage Server chahiye.",
            ephemeral: true,
          });
          return;
        }

        if (!guildId) {
          await interaction.reply({ content: "Ye command sirf server mein use hoti hai.", ephemeral: true });
          return;
        }

        const enable = interaction.options.getBoolean("enable", true);
        const serverConf = await ServerConfig.findOneAndUpdate(
          { guildId },
          { $set: { welcomeEnabled: enable } },
          { upsert: true, new: true }
        );

        if (enable && !serverConf?.welcomeChannelId) {
          await interaction.reply({
            content: "Welcome on kar di! Lekin welcome channel set nahi hai — `/setwelcome` se channel set karo warna main system channel use karungi.",
            ephemeral: true,
          });
        } else if (enable) {
          await interaction.reply({
            content: `Welcome on kar di! Naye members ko <#${serverConf!.welcomeChannelId}> mein greet karungi.`,
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content: "Welcome off kar di. Naye members ko greet nahi karungi ab.",
            ephemeral: true,
          });
        }
        return;
      }

      // ── /say — Administrator only: send a message as Priya ───────────────────
      if (commandName === "say") {
        const isAdmin = interaction.memberPermissions?.has("Administrator") ?? false;
        const isOwner = user.id === process.env.OWNER_DISCORD_ID;
        if (!isAdmin && !isOwner) {
          await interaction.reply({
            content: "Yaar sirf Administrators ye command use kar sakte hain!",
            ephemeral: true,
          });
          return;
        }
        if (!guildId) {
          await interaction.reply({ content: "Ye command sirf server mein use hoti hai.", ephemeral: true });
          return;
        }

        const content = interaction.options.getString("content", true);
        const targetChannel = interaction.options.getChannel("channel") ?? interaction.channel;

        if (!targetChannel || !("send" in targetChannel)) {
          await interaction.reply({ content: "Channel valid nahi hai!", ephemeral: true });
          return;
        }

        // Non-owners cannot ping @everyone/@here/roles — strip them silently
        const hasMassPing = /@everyone|@here|<@&\d+>/.test(content);
        if (hasMassPing && !isOwner) {
          await interaction.reply({
            content: "⚠️ Mass pings (@everyone, @here, role mentions) allowed nahi hain `/say` mein! Message nahi bheja gaya.",
            ephemeral: true,
          });
          return;
        }

        await (targetChannel as TextChannel).send({
          content,
          // Even for admins, suppress all mention pings unless owner explicitly used them
          allowedMentions: isOwner ? undefined : { parse: ["users"] },
        });
        await interaction.reply({ content: `Done! Message send kar diya <#${targetChannel.id}> mein.`, ephemeral: true });
        return;
      }

      // ── /forceadopt — Owner only: forcefully adopt any user ──────────────────
      if (commandName === "forceadopt") {
        const isOwner = user.id === process.env.OWNER_DISCORD_ID;
        if (!isOwner) {
          await interaction.reply({ content: "Yaar ye sirf bot owner kar sakta hai!", ephemeral: true });
          return;
        }
        if (!guildId) {
          await interaction.reply({ content: "Ye command sirf server mein use hoti hai.", ephemeral: true });
          return;
        }

        await interaction.deferReply();

        const parentUser = interaction.options.getUser("parent", true);
        const childUser = interaction.options.getUser("child", true);

        if (parentUser.id === childUser.id) {
          await interaction.editReply("Parent aur child same nahi ho sakte!");
          return;
        }

        await Promise.all([
          UserRelationship.findOneAndUpdate(
            { userId: parentUser.id, guildId },
            { $addToSet: { children: childUser.id } },
            { upsert: true }
          ),
          UserRelationship.findOneAndUpdate(
            { userId: childUser.id, guildId },
            { $addToSet: { parents: parentUser.id } },
            { upsert: true }
          ),
        ]);

        const snapSize = (n: number): number => {
          const sizes = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096];
          let best = sizes[0];
          for (const s of sizes) { if (s <= n) best = s; else break; }
          return best;
        };
        const toCard = (u: import("discord.js").User): CardUser => ({
          id: u.id,
          username: u.displayName ?? u.username,
          avatarUrl: u.avatarURL({ size: snapSize(256) as 256 }) ?? undefined,
        });

        try {
          const buf = await generateAdoptCard(toCard(parentUser), toCard(childUser));
          await interaction.editReply({
            content: `✅ Done! **${parentUser.displayName ?? parentUser.username}** ne **${childUser.displayName ?? childUser.username}** ko forcefully adopt kar liya! 🏠`,
            files: [{ attachment: buf, name: "force-adopt.png" }],
          });
        } catch (err) {
          logger.error({ err }, "forceadopt card failed");
          await interaction.editReply(`✅ Done! **${parentUser.username}** ne **${childUser.username}** ko adopt kar liya!`);
        }
        return;
      }

      // ── /setupcounter — Admin: post live message-count image in this channel ─
      if (commandName === "setupcounter") {
        const isAdmin = interaction.memberPermissions?.has("Administrator") ?? false;
        const isOwner = user.id === process.env.OWNER_DISCORD_ID;
        if (!isAdmin && !isOwner) {
          await interaction.reply({ content: "Yaar sirf Administrators ye set kar sakte hain!", ephemeral: true });
          return;
        }
        if (!guildId || !interaction.guild) {
          await interaction.reply({ content: "Ye command sirf server mein use hoti hai.", ephemeral: true });
          return;
        }

        await interaction.deferReply({ ephemeral: true });

        const guild = interaction.guild;
        const channel = interaction.channel as TextChannel;
        const serverConf = await ServerConfig.findOne({ guildId });

        const members = await guild.members.fetch().catch(() => guild.members.cache);
        const memberCount = members.size;
        const botCount = members.filter((m) => m.user.bot).size;
        const memberMap = new Map(members.map((m) => [m.user.id, m]));
        const topMembers = await getTopMembers(guildId, memberMap);

        const buf = await generateCounterCard({
          guildName: guild.name,
          guildIconUrl: guild.iconURL({ size: 256 }) ?? undefined,
          totalMessages: serverConf?.totalMessages ?? 0,
          memberCount,
          botCount,
          updatedAt: new Date(),
          topMembers,
        });

        const posted = await channel.send({
          content: "",
          files: [{ attachment: buf, name: "counter.png" }],
        });

        await ServerConfig.findOneAndUpdate(
          { guildId },
          { $set: { counterChannelId: channel.id, counterMessageId: posted.id } },
          { upsert: true }
        );

        await interaction.editReply(`✅ Live counter setup kar diya <#${channel.id}> mein! Ye image har 30 seconds mein update hogi. 📊`);
        return;
      }

      // ── /setprefix — Admin can change the command prefix ─────────────────────
      if (commandName === "setprefix") {
        const isAdmin = interaction.memberPermissions?.has("Administrator") ?? false;
        const isOwner = user.id === process.env.OWNER_DISCORD_ID;
        const hasManage = interaction.memberPermissions?.has("ManageGuild") ?? false;
        if (!isAdmin && !isOwner && !hasManage) {
          await interaction.reply({
            content: "Yaar tujhe permission nahi hai! Manage Server ya Administrator chahiye.",
            ephemeral: true,
          });
          return;
        }
        if (!guildId) {
          await interaction.reply({ content: "Ye command sirf server mein use hoti hai.", ephemeral: true });
          return;
        }

        const newPrefix = interaction.options.getString("prefix", true).trim();
        if (!newPrefix || newPrefix.length > 5 || newPrefix.includes(" ")) {
          await interaction.reply({
            content: "Prefix 1-5 characters ka hona chahiye aur usme space nahi hona chahiye!",
            ephemeral: true,
          });
          return;
        }

        await ServerConfig.findOneAndUpdate(
          { guildId },
          { $set: { prefix: newPrefix } },
          { upsert: true }
        );
        invalidatePrefixCache(guildId);
        await interaction.reply({
          content: `Done! Ab Priya ka prefix **\`${newPrefix}\`** ho gaya. Commands: \`${newPrefix}ship\`, \`${newPrefix}image\`, etc.`,
          ephemeral: false,
        });
        return;
      }

      // ── /resetserver — server owner or admin can reset entire server history ──
      if (commandName === "resetserver") {
        const isOwner = user.id === process.env.OWNER_DISCORD_ID;
        const isServerOwner = interaction.guild?.ownerId === user.id;
        const isAdmin = interaction.memberPermissions?.has("Administrator") ?? false;

        if (!isOwner && !isServerOwner && !isAdmin) {
          await interaction.reply({
            content: "Yaar sirf server owner ya admin ye kar sakte hain!",
            ephemeral: true,
          });
          return;
        }

        if (!guildId) {
          await interaction.reply({ content: "Ye command sirf server mein use hoti hai.", ephemeral: true });
          return;
        }

        const result = await ChatHistory.updateMany({ guildId }, { $set: { messages: [] } });
        await interaction.reply({
          content: `Done! Is server ke ${result.modifiedCount} users ki chat history clear kar di. Fresh start!`,
          ephemeral: true,
        });
        return;
      }
    } catch (err) {
      logger.error({ err, commandName }, "Slash command error");
      // Try to inform the user — ignore if interaction already expired
      try {
        const msg = "Yaar kuch gadbad ho gayi. Thodi der baad try karo!";
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(msg);
        } else {
          await interaction.reply({ content: msg, ephemeral: true });
        }
      } catch {
        // interaction expired — nothing we can do
      }
    }
  });

  await client.login(token);
}

// ─── Top members helper ───────────────────────────────────────────────────────

async function getTopMembers(
  guildId: string,
  guildMembers: Map<string, import("discord.js").GuildMember>
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

        // Use configured ping channel if set and valid
        if (serverConf?.pingChannelId) {
          const ch = guild.channels.cache.get(serverConf.pingChannelId);
          if (ch && ch.type === ChannelType.GuildText && "send" in ch) {
            channel = ch as TextChannel;
          }
        }

        // Fall back to a random text channel
        if (!channel) {
          const textChannels = guild.channels.cache.filter(
            (c) => c.type === ChannelType.GuildText
          );
          if (textChannels.size === 0) continue;
          channel = textChannels.random() as TextChannel;
        }

        if (!channel) continue;

        const members = (await guild.members.fetch()).filter((m) => !m.user.bot);
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

  const intervalMs = 2 * 60 * 60 * 1000; // 2 hours default
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
          // Message was deleted — clear the stored IDs
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
          attachments: [],
        });
      } catch (err) {
        logger.warn({ err, guildId: conf.guildId }, "Counter update failed");
      }
    }
  };

  // Run immediately on start, then every 30 seconds
  tick().catch(() => {});
  setInterval(() => tick().catch(() => {}), 30_000);
}
