import {
  type Message,
  type Client,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
} from "discord.js";
import { logger } from "./logger";
import { BotUser, UserRelationship, ServerConfig } from "./models";
import {
  calculateLovePercentage,
  generateShipCard,
  generateMarriageCard,
  generateAdoptCard,
  generateFamilyCard,
  generateProfileCard,
  generateRoastCard,
  generateActionCard,
  generateCounterCard,
  type CardUser,
  type CounterMember,
} from "./cards";
import { getAiResponse } from "./ai-router";
import { getPersonality } from "./personality";

// ─── Prefix cache ─────────────────────────────────────────────────────────────

const prefixCache = new Map<string, { prefix: string; expiry: number }>();
const PREFIX_TTL = 5 * 60 * 1000;

export async function getServerPrefix(guildId: string | null): Promise<string> {
  if (!guildId) return "!";
  const cached = prefixCache.get(guildId);
  if (cached && cached.expiry > Date.now()) return cached.prefix;
  const conf = await ServerConfig.findOne({ guildId });
  const prefix = conf?.prefix ?? "!";
  prefixCache.set(guildId, { prefix, expiry: Date.now() + PREFIX_TTL });
  return prefix;
}

export function invalidatePrefixCache(guildId: string) {
  prefixCache.delete(guildId);
}

// ─── Pending requests (prevent spam) ─────────────────────────────────────────

// key = "marry:guildId:fromId:toId" or "adopt:guildId:fromId:toId"
const pendingRequests = new Set<string>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOrCreateRelationship(userId: string, guildId: string) {
  return UserRelationship.findOneAndUpdate(
    { userId, guildId },
    { $setOnInsert: { parents: [], children: [] } },
    { upsert: true, new: true }
  );
}

async function resolveCardUser(userId: string, client: Client, guildId?: string): Promise<CardUser> {
  // Try Discord first (most reliable, always up-to-date avatar)
  const discordUser = client.users.cache.get(userId) ?? await client.users.fetch(userId).catch(() => null);
  if (discordUser) {
    const avatarUrl = discordUser.displayAvatarURL({ size: 256, extension: "png" });
    // Cache in DB for any future use
    BotUser.updateOne({ userId }, { $set: { avatarUrl, username: discordUser.username } }).catch(() => {});
    return { id: userId, username: discordUser.username, avatarUrl };
  }
  // Fallback to DB record
  const dbUser = await BotUser.findOne({ userId });
  if (dbUser) {
    return { id: userId, username: dbUser.username, avatarUrl: dbUser.avatarUrl ?? null };
  }
  return { id: userId, username: `User#${userId.slice(-4)}`, avatarUrl: null };
}

function getMentionedUser(message: Message, args: string[]): string | null {
  const mention = message.mentions.users.first();
  if (mention) return mention.id;
  const raw = args[0]?.replace(/[<@!>]/g, "");
  if (raw && /^\d+$/.test(raw)) return raw;
  return null;
}

function makeConsentRow(acceptId: string, rejectId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(acceptId)
      .setLabel("Accept ✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(rejectId)
      .setLabel("Decline ❌")
      .setStyle(ButtonStyle.Danger)
  );
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleShip(message: Message, client: Client, args: string[]) {
  const guildId = message.guild?.id ?? "dm";
  const mentioned = [...message.mentions.users.values()];
  let user1Id: string, user2Id: string;

  if (mentioned.length >= 2) {
    user1Id = mentioned[0].id;
    user2Id = mentioned[1].id;
  } else if (mentioned.length === 1) {
    user1Id = message.author.id;
    user2Id = mentioned[0].id;
  } else {
    await message.reply("Kaun se do log? Tag karo yaar! Example: `!ship @user1 @user2`");
    return;
  }

  if (user1Id === user2Id) {
    await message.reply("Khud se ship nahi hota yaar 😅");
    return;
  }

  const pct = calculateLovePercentage(user1Id, user2Id);
  const [u1, u2] = await Promise.all([
    resolveCardUser(user1Id, client, guildId),
    resolveCardUser(user2Id, client, guildId),
  ]);

  let status;
  try {
    status = await message.reply({ content: "Calculating love... 💕" });
  } catch { return; }

  try {
    const buf = await generateShipCard(u1, u2, pct);
    await status.edit({
      content: `💕 **${u1.username}** + **${u2.username}** = **${pct}%** compatibility!`,
      files: [{ attachment: buf, name: "ship.png" }],
    });
  } catch (err) {
    logger.error({ err }, "Ship card generation failed");
    await status.edit(`💕 **${u1.username}** + **${u2.username}** = **${pct}%** compatibility!`).catch(() => {});
  }
}

async function handleMarry(message: Message, client: Client, args: string[]) {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai yaar!");
    return;
  }
  const guildId = message.guild.id;
  const targetId = getMentionedUser(message, args);

  if (!targetId) {
    await message.reply("Kisko propose kar raha/rahi hai? Tag karo! Example: `!marry @user`");
    return;
  }
  if (targetId === message.author.id) {
    await message.reply("Khud se shaadi nahi hoti yaar 😂");
    return;
  }
  if (targetId === client.user?.id) {
    await message.reply("Aww tujhse pyaar hai mujhe, par main bot hun 😔💔 Kisi insaan se kar shaadi!");
    return;
  }

  const pendingKey = `marry:${guildId}:${message.author.id}:${targetId}`;
  if (pendingRequests.has(pendingKey)) {
    await message.reply("Ek proposal pehle se pending hai! Pehle uska jawab aane do.");
    return;
  }

  const [myRel, theirRel] = await Promise.all([
    getOrCreateRelationship(message.author.id, guildId),
    getOrCreateRelationship(targetId, guildId),
  ]);

  if (myRel.marriedTo) {
    const spouse = await resolveCardUser(myRel.marriedTo, client, guildId);
    await message.reply(`Yaar tu pehle se **${spouse.username}** se married hai! Pehle divorce le.`).catch(() => {});
    return;
  }
  if (theirRel.marriedTo) {
    const target = await resolveCardUser(targetId, client, guildId);
    await message.reply(`**${target.username}** pehle se kisi aur se married hai!`).catch(() => {});
    return;
  }
  const isMyFamily = myRel.children.includes(targetId) || myRel.parents.includes(targetId);
  const isTheirFamily = theirRel.children.includes(message.author.id) || theirRel.parents.includes(message.author.id);
  if (isMyFamily || isTheirFamily) {
    await message.reply("Yaar apne hi family member se shaadi? That's weird 🤢").catch(() => {});
    return;
  }

  const [proposer, target] = await Promise.all([
    resolveCardUser(message.author.id, client, guildId),
    resolveCardUser(targetId, client, guildId),
  ]);

  // Send proposal with consent buttons
  const acceptId = `marry_yes_${message.author.id}_${targetId}`;
  const rejectId = `marry_no_${message.author.id}_${targetId}`;
  const row = makeConsentRow(acceptId, rejectId);

  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle("💍 Marriage Proposal!")
    .setDescription(
      `**${proposer.username}** is proposing to **${target.username}**!\n\n` +
      `<@${targetId}>, kya tum **${proposer.username}** se shaadi karna chahte/chahti ho?\n\n` +
      `*You have 60 seconds to respond!*`
    )
    .setFooter({ text: "Only the mentioned user can accept or decline." });

  let proposal: Message;
  try {
    proposal = await message.reply({ embeds: [embed], components: [row] });
  } catch { return; }

  pendingRequests.add(pendingKey);

  try {
    const interaction = await proposal.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => {
        if (i.user.id !== targetId) {
          i.reply({ content: "Ye proposal tumhare liye nahi hai! 😤", ephemeral: true }).catch(() => {});
          return false;
        }
        return i.customId === acceptId || i.customId === rejectId;
      },
      time: 60_000,
    });

    if (interaction.customId === acceptId) {
      await interaction.deferUpdate();

      const now = new Date();
      await Promise.all([
        UserRelationship.findOneAndUpdate(
          { userId: message.author.id, guildId },
          { $set: { marriedTo: targetId, marriedAt: now } }
        ),
        UserRelationship.findOneAndUpdate(
          { userId: targetId, guildId },
          { $set: { marriedTo: message.author.id, marriedAt: now } }
        ),
      ]);

      try {
        const buf = await generateMarriageCard(proposer, target, now);
        await proposal.edit({
          embeds: [],
          components: [],
          content: `🎉 **${proposer.username}** aur **${target.username}** ab officially married hain! Mubarak ho! 💍`,
          files: [{ attachment: buf, name: "marriage.png" }],
        });
      } catch (err) {
        logger.error({ err }, "Marriage card failed");
        await proposal.edit({
          embeds: [],
          components: [],
          content: `💍 **${proposer.username}** aur **${target.username}** ab officially married hain! Mubarak ho!`,
        }).catch(() => {});
      }
    } else {
      await interaction.update({
        embeds: [],
        components: [],
        content: `💔 **${target.username}** ne proposal decline kar diya. Better luck next time, **${proposer.username}**!`,
      });
    }
  } catch {
    // Timed out
    await proposal.edit({
      embeds: [],
      components: [],
      content: `⏰ **${target.username}** ne 60 seconds mein koi jawab nahi diya. Proposal expire ho gaya! 💨`,
    }).catch(() => {});
  } finally {
    pendingRequests.delete(pendingKey);
  }
}

async function handleDivorce(message: Message, client: Client) {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const guildId = message.guild.id;
  const myRel = await UserRelationship.findOne({ userId: message.author.id, guildId });

  if (!myRel?.marriedTo) {
    await message.reply("Tu married hi nahi hai toh divorce kaise lega 😅");
    return;
  }

  const spouseId = myRel.marriedTo;
  const spouse = await resolveCardUser(spouseId, client, guildId);

  await Promise.all([
    UserRelationship.findOneAndUpdate(
      { userId: message.author.id, guildId },
      { $set: { marriedTo: null, marriedAt: null } }
    ),
    UserRelationship.findOneAndUpdate(
      { userId: spouseId, guildId },
      { $set: { marriedTo: null, marriedAt: null } }
    ),
  ]);

  await message.reply(`Theek hai... **${message.author.username}** aur **${spouse.username}** ab divorced hain. 💔`);
}

async function handleAdopt(message: Message, client: Client, args: string[]) {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const guildId = message.guild.id;
  const targetId = getMentionedUser(message, args);

  if (!targetId) {
    await message.reply("Kisko adopt karna hai? Tag karo! Example: `!adopt @user`");
    return;
  }
  if (targetId === message.author.id) {
    await message.reply("Khud ko adopt nahi kar sakte yaar 😅");
    return;
  }
  if (targetId === client.user?.id) {
    await message.reply("Main kisi ki child nahi bunti! 😤");
    return;
  }

  const pendingKey = `adopt:${guildId}:${message.author.id}:${targetId}`;
  if (pendingRequests.has(pendingKey)) {
    await message.reply("Ek adoption request pehle se pending hai! Pehle uska jawab aane do.");
    return;
  }

  const [myRel, theirRel] = await Promise.all([
    getOrCreateRelationship(message.author.id, guildId),
    getOrCreateRelationship(targetId, guildId),
  ]);

  if (theirRel.parents.length >= 2) {
    const tgt = await resolveCardUser(targetId, client, guildId);
    await message.reply(`**${tgt.username}** ke pehle se 2 parents hain!`);
    return;
  }
  if (myRel.children.includes(targetId)) {
    await message.reply("Ye pehle se tera/teri child hai!");
    return;
  }
  if (theirRel.children.includes(message.author.id) || myRel.parents.includes(targetId)) {
    await message.reply("Yaar ye relationship allowed nahi — family loop ban jayega!");
    return;
  }

  const [parent, child] = await Promise.all([
    resolveCardUser(message.author.id, client, guildId),
    resolveCardUser(targetId, client, guildId),
  ]);

  // Send adoption request with consent buttons
  const acceptId = `adopt_yes_${message.author.id}_${targetId}`;
  const rejectId = `adopt_no_${message.author.id}_${targetId}`;
  const row = makeConsentRow(acceptId, rejectId);

  const embed = new EmbedBuilder()
    .setColor(0x43b581)
    .setTitle("🏠 Adoption Request!")
    .setDescription(
      `**${parent.username}** wants to adopt **${child.username}**!\n\n` +
      `<@${targetId}>, kya tum **${parent.username}** ki family join karna chahte/chahti ho?\n\n` +
      `*You have 60 seconds to respond!*`
    )
    .setFooter({ text: "Only the mentioned user can accept or decline." });

  let request: Message;
  try {
    request = await message.reply({ embeds: [embed], components: [row] });
  } catch { return; }

  pendingRequests.add(pendingKey);

  try {
    const interaction = await request.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => {
        if (i.user.id !== targetId) {
          i.reply({ content: "Ye request tumhare liye nahi hai! 😤", ephemeral: true }).catch(() => {});
          return false;
        }
        return i.customId === acceptId || i.customId === rejectId;
      },
      time: 60_000,
    });

    if (interaction.customId === acceptId) {
      await interaction.deferUpdate();

      await Promise.all([
        UserRelationship.findOneAndUpdate(
          { userId: message.author.id, guildId },
          { $addToSet: { children: targetId } }
        ),
        UserRelationship.findOneAndUpdate(
          { userId: targetId, guildId },
          { $addToSet: { parents: message.author.id } }
        ),
      ]);

      try {
        const buf = await generateAdoptCard(parent, child);
        await request.edit({
          embeds: [],
          components: [],
          content: `🎉 **${parent.username}** ne **${child.username}** ko adopt kar liya! Welcome to the family! 🏠`,
          files: [{ attachment: buf, name: "adopt.png" }],
        });
      } catch (err) {
        logger.error({ err }, "Adopt card failed");
        await request.edit({
          embeds: [],
          components: [],
          content: `🏠 **${parent.username}** ne **${child.username}** ko adopt kar liya! Welcome to the family!`,
        }).catch(() => {});
      }
    } else {
      await interaction.update({
        embeds: [],
        components: [],
        content: `❌ **${child.username}** ne adoption decline kar diya. Better luck next time, **${parent.username}**!`,
      });
    }
  } catch {
    // Timed out
    await request.edit({
      embeds: [],
      components: [],
      content: `⏰ **${child.username}** ne 60 seconds mein koi jawab nahi diya. Adoption request expire ho gaya! 💨`,
    }).catch(() => {});
  } finally {
    pendingRequests.delete(pendingKey);
  }
}

async function handleUnadopt(message: Message, client: Client, args: string[]) {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const guildId = message.guild.id;
  const targetId = getMentionedUser(message, args);

  if (!targetId) {
    await message.reply("Kisko unadopt karna hai? Tag karo! Example: `!unadopt @user`");
    return;
  }

  const myRel = await UserRelationship.findOne({ userId: message.author.id, guildId });
  if (!myRel?.children.includes(targetId)) {
    await message.reply("Ye tera/teri child hai hi nahi!");
    return;
  }

  await Promise.all([
    UserRelationship.findOneAndUpdate(
      { userId: message.author.id, guildId },
      { $pull: { children: targetId } }
    ),
    UserRelationship.findOneAndUpdate(
      { userId: targetId, guildId },
      { $pull: { parents: message.author.id } }
    ),
  ]);

  const target = await resolveCardUser(targetId, client, guildId);
  await message.reply(`**${target.username}** ko unadopt kar diya. Sad 💔`);
}

async function handleFamily(message: Message, client: Client, args: string[]) {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const guildId = message.guild.id;
  const targetId = getMentionedUser(message, args) ?? message.author.id;

  const rel = await UserRelationship.findOne({ userId: targetId, guildId });

  // If the user is married, also fetch the spouse's children and merge them
  // so both sides of a couple see all adopted children in the family tree.
  const spouseRel = rel?.marriedTo
    ? await UserRelationship.findOne({ userId: rel.marriedTo, guildId })
    : null;

  const ownChildIds: string[] = rel?.children ?? [];
  const spouseChildIds: string[] = spouseRel?.children ?? [];
  const mergedChildIds = [...new Set([...ownChildIds, ...spouseChildIds])];

  const [userCard, spouseCard, parentCards, childCards] = await Promise.all([
    resolveCardUser(targetId, client, guildId),
    rel?.marriedTo ? resolveCardUser(rel.marriedTo, client, guildId) : Promise.resolve(null),
    Promise.all((rel?.parents ?? []).map((id: string) => resolveCardUser(id, client, guildId))),
    Promise.all(mergedChildIds.map((id: string) => resolveCardUser(id, client, guildId))),
  ]);

  let status;
  try {
    status = await message.reply({ content: "Building family tree... 🌳" });
  } catch { return; }

  try {
    const buf = await generateFamilyCard(userCard, parentCards, spouseCard, childCards);
    await status.edit({
      content: `🌳 **${userCard.username}**'s Family Tree`,
      files: [{ attachment: buf, name: "family.png" }],
    });
  } catch (err) {
    logger.error({ err }, "Family card failed");
    const parts: string[] = [];
    parts.push(`🌳 **${userCard.username}'s Family Tree**`);
    parts.push(`👨‍👩‍👧 **Parents:** ${parentCards.length ? parentCards.map((p) => p.username).join(", ") : "None"}`);
    parts.push(`💍 **Spouse:** ${spouseCard ? spouseCard.username : "Single"}`);
    parts.push(`👶 **Children:** ${childCards.length ? childCards.map((c) => c.username).join(", ") : "None"}`);
    await status.edit(parts.join("\n")).catch(() => {});
  }
}

// ─── Marriage card command ────────────────────────────────────────────────────

async function handleMarriageCard(message: Message, client: Client, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const guildId = message.guild.id;
  const targetId = getMentionedUser(message, args) ?? message.author.id;

  const rel = await UserRelationship.findOne({ userId: targetId, guildId });

  if (!rel?.marriedTo) {
    const isSelf = targetId === message.author.id;
    await message.reply(
      isSelf
        ? "Tu abhi married nahi hai! Pehle `!marry @user` karo 💍"
        : "Ye user married nahi hai!"
    );
    return;
  }

  const status = await message.reply({ content: "Marriage card bana rahi hun... 💍" });

  try {
    const [user, spouse] = await Promise.all([
      resolveCardUser(targetId, client, guildId),
      resolveCardUser(rel.marriedTo, client, guildId),
    ]);
    const marriedAt = rel.marriedAt ?? new Date();
    const buf = await generateMarriageCard(user, spouse, marriedAt);
    await status.edit({
      content: `💍 **${user.username}** & **${spouse.username}** — Happily Married! 💕`,
      files: [{ attachment: buf, name: "marriage-card.png" }],
    });
  } catch (err) {
    logger.error({ err }, "Marriage card command failed");
    await status.edit("Marriage card nahi ban paaya abhi 😅").catch(() => {});
  }
}

// ─── Parents command ──────────────────────────────────────────────────────────

async function handleParents(message: Message, client: Client, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const guildId = message.guild.id;
  const targetId = getMentionedUser(message, args) ?? message.author.id;

  const rel = await UserRelationship.findOne({ userId: targetId, guildId });
  const targetUser = await resolveCardUser(targetId, client, guildId);

  if (!rel || rel.parents.length === 0) {
    const isSelf = targetId === message.author.id;
    await message.reply(
      isSelf
        ? "Tere koi parents nahi hain! Use `!adopt` karva ke kisi se adopt ho jao. 🏠"
        : `**${targetUser.username}** ke koi parents nahi hain!`
    );
    return;
  }

  const parentCards = await Promise.all(
    rel.parents.map((id: string) => resolveCardUser(id, client, guildId))
  );

  const embed = new EmbedBuilder()
    .setColor(0x43b581)
    .setTitle(`👨‍👩‍👧 ${targetUser.username}'s Parents`)
    .setDescription(parentCards.map((p, i) => `${i + 1}. **${p.username}** (<@${p.id}>)`).join("\n"))
    .setFooter({ text: "Use !leave to run away from your family" });

  await message.reply({ embeds: [embed] });
}

// ─── Profile command ──────────────────────────────────────────────────────────

async function handleProfile(message: Message, client: Client, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const guildId = message.guild.id;

  // Target: mentioned user or self
  const targetId = getMentionedUser(message, args) ?? message.author.id;

  const status = await message.reply({ content: "Tera profile bana rahi hoon... ✨" });

  const [cardUser, dbUser, rel] = await Promise.all([
    resolveCardUser(targetId, client, guildId),
    BotUser.findOne({ userId: targetId }),
    UserRelationship.findOne({ userId: targetId, guildId }),
  ]);

  // Resolve spouse name if married
  let spouseName: string | null = null;
  if (rel?.marriedTo) {
    const spouseUser = await resolveCardUser(rel.marriedTo, client, guildId);
    spouseName = spouseUser.username;
  }

  const profileData = {
    user: cardUser,
    messageCount: dbUser?.messageCount ?? 0,
    spouseName,
    parentsCount: rel?.parents?.length ?? 0,
    childrenCount: rel?.children?.length ?? 0,
  };

  try {
    const buf = await generateProfileCard(profileData);
    await status.edit({
      content: "",
      files: [{ attachment: buf, name: "profile.png" }],
    });
  } catch (err) {
    logger.error({ err }, "Profile card error");
    await status.edit({ content: "Card banane mein problem aayi. Sorry! 😅" });
  }
}

// ─── Runaway command ──────────────────────────────────────────────────────────

async function handleRunaway(message: Message): Promise<void> {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const guildId = message.guild.id;
  const userId = message.author.id;

  const rel = await UserRelationship.findOne({ userId, guildId });

  if (!rel || !rel.parents || rel.parents.length === 0) {
    await message.reply("Tu kahin bhaag nahi sakta — tere koi parents hi nahi hain! 😂");
    return;
  }

  const parentIds = [...rel.parents] as string[];

  // Remove self from each parent's children list
  for (const parentId of parentIds) {
    await UserRelationship.findOneAndUpdate(
      { userId: parentId, guildId },
      { $pull: { children: userId } }
    );
  }

  // Clear own parents
  rel.parents = [];
  await rel.save();

  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xff6eb4)
        .setDescription(
          `🏃💨 **${message.author.username}** ghar se bhaag gaya/gayi!\n` +
          `${parentIds.length} parent${parentIds.length > 1 ? "s" : ""} se rishta tod diya. Goodbye! 👋`
        )
        .setFooter({ text: "Use !adopt to be adopted again" }),
    ],
  });
}

// ─── Roast command ────────────────────────────────────────────────────────────

async function handleRoast(message: Message, client: Client, args: string[]): Promise<void> {
  const guildId = message.guild?.id ?? "dm";
  const targetId = getMentionedUser(message, args) ?? null;

  if (!targetId) {
    await message.reply("Kisko roast karun? Tag karo! Example: `!roast @user`");
    return;
  }
  if (targetId === message.author.id) {
    await message.reply("Khud ko roast? Itna self-aware hona bhi achi baat nahi yaar 😂");
    return;
  }
  if (targetId === client.user?.id) {
    await message.reply("Mujhe roast karega? Try karo — main ready hun 😤🔥");
    return;
  }

  const target = await resolveCardUser(targetId, client, guildId);
  const status = await message.reply({ content: `Priya roast ki taiyaari kar rahi hai... 🔥` });

  try {
    const personality = await getPersonality();
    const roastMessages = [
      { role: "system" as const, content: "Tu Priya hai — ek savage, funny Discord bot. Tu short aur punchy roasts likhti hai." },
      { role: "user" as const, content: `Write a short, funny savage roast for a Discord user named "${target.username}". 2-3 sentences max. Make it playful, clever, not genuinely mean. Hinglish ya English dono chalega.` },
    ];
    const roastText = (await getAiResponse(roastMessages, personality.activeProvider as "groq" | "gemini" | "nvidia")).trim();

    const buf = await generateRoastCard(target, roastText);
    await status.edit({
      content: `🔥 <@${targetId}> **got roasted** by <@${message.author.id}>!`,
      files: [{ attachment: buf, name: "roast.png" }],
    });
  } catch (err) {
    logger.error({ err }, "Roast command failed");
    await status.edit("Yaar roast generate karne mein problem aayi 😅").catch(() => {});
  }
}

// ─── Hug command ──────────────────────────────────────────────────────────────

async function handleHug(message: Message, client: Client, args: string[]): Promise<void> {
  const guildId = message.guild?.id ?? "dm";
  const targetId = getMentionedUser(message, args) ?? null;

  if (!targetId) {
    await message.reply("Kisko hug karna hai? Tag karo! Example: `!hug @user`");
    return;
  }
  if (targetId === message.author.id) {
    await message.reply("Khud ko hug karna chahta/chahti hai? Aww, le lo apna hug! 🤗");
    return;
  }

  const [from, to] = await Promise.all([
    resolveCardUser(message.author.id, client, guildId),
    resolveCardUser(targetId, client, guildId),
  ]);

  const status = await message.reply({ content: "Aww... 🤗" });
  try {
    const buf = await generateActionCard(from, to, `${from.username} hugged ${to.username}!`, "🤗", "#ff80ab", "#c084fc");
    await status.edit({
      content: `🤗 **${from.username}** ne **${to.username}** ko hug kiya! Cute! 💕`,
      files: [{ attachment: buf, name: "hug.png" }],
    });
  } catch (err) {
    logger.error({ err }, "Hug card failed");
    await status.edit(`🤗 **${from.username}** ne **${to.username}** ko hug kiya! Aww!`).catch(() => {});
  }
}

// ─── Slap command ─────────────────────────────────────────────────────────────

async function handleSlap(message: Message, client: Client, args: string[]): Promise<void> {
  const guildId = message.guild?.id ?? "dm";
  const targetId = getMentionedUser(message, args) ?? null;

  if (!targetId) {
    await message.reply("Kisko slap karun? Tag karo! Example: `!slap @user`");
    return;
  }
  if (targetId === message.author.id) {
    await message.reply("Khud ko slap? Theek hai, deserve karta/karti hai shayad 😂👋");
    return;
  }

  const [from, to] = await Promise.all([
    resolveCardUser(message.author.id, client, guildId),
    resolveCardUser(targetId, client, guildId),
  ]);

  const status = await message.reply({ content: "👋💥" });
  try {
    const buf = await generateActionCard(from, to, `${from.username} slapped ${to.username}!`, "👋", "#ff4444", "#ff8c00");
    await status.edit({
      content: `👋 **${from.username}** ne **${to.username}** ko slap maar diya! THAPPAD! 💥`,
      files: [{ attachment: buf, name: "slap.png" }],
    });
  } catch (err) {
    logger.error({ err }, "Slap card failed");
    await status.edit(`👋 **${from.username}** ne **${to.username}** ko slap maar diya! THAPPAD!`).catch(() => {});
  }
}

// ─── 8ball command ────────────────────────────────────────────────────────────

const EIGHTBALL_RESPONSES = [
  "Bilkul haan! ✨", "Definitely! 💯", "Haan, main sure hun!", "Lagta hai haan yaar!",
  "Sab signs haan ki taraf ja rahe hain 🌟", "Pakka! 🎯",
  "Nahi yaar... 💀", "Bilkul nahi!", "Iski koi chance nahi.", "Definitely nahi!",
  "Main tujhe doubt karta/karti hun 🤨", "Iske baare mein mat socho.",
  "Abhi nahi bolunga/bolungi 🙈", "Thodi der baad pooch.", "Picture abhi clear nahi hai 🌫️",
  "Better luck next time!", "Hmm... 50-50 yaar!", "Shayad? Main bhi nahi jaanti 🤷",
];

async function handleEightBall(message: Message, args: string[]): Promise<void> {
  const question = args.join(" ").trim();
  if (!question) {
    await message.reply("Kuch poochh toh yaar! Example: `!8ball Kya main pass hounga?`");
    return;
  }
  const answer = EIGHTBALL_RESPONSES[Math.floor(Math.random() * EIGHTBALL_RESPONSES.length)];
  const embed = new EmbedBuilder()
    .setColor(0x2e0052)
    .setTitle("🎱 Magic 8-Ball")
    .addFields(
      { name: "Sawaal", value: question.length > 200 ? question.slice(0, 197) + "..." : question },
      { name: "Jawab", value: answer }
    )
    .setFooter({ text: "Priya Bot" });
  await message.reply({ embeds: [embed] });
}

// ─── Rate command ─────────────────────────────────────────────────────────────

async function handleRate(message: Message, args: string[]): Promise<void> {
  const thing = args.join(" ").trim();
  if (!thing) {
    await message.reply("Kya rate karun? Example: `!rate pizza`");
    return;
  }

  const status = await message.reply({ content: "Soch rahi hun... 🤔" });
  try {
    const personality = await getPersonality();
    const rateMessages = [
      { role: "system" as const, content: "Tu Priya hai — ek opinionated, funny Indian girl. Tu cheezein rate karti hai apne hisaab se." },
      { role: "user" as const, content: `Rate "${thing}" out of 10 with a short funny explanation in Priya's style. Format: "[number]/10 — [short reason]". Keep it under 2 sentences.` },
    ];
    const rating = (await getAiResponse(rateMessages, personality.activeProvider as "groq" | "gemini" | "nvidia")).trim();

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle("⭐ Priya's Rating")
      .addFields(
        { name: "Cheez", value: thing.length > 200 ? thing.slice(0, 197) + "..." : thing },
        { name: "Rating", value: rating }
      )
      .setFooter({ text: "Priya's honest opinion 😌" });

    await status.edit({ content: "", embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "Rate command failed");
    await status.edit("Yaar rate nahi kar paai abhi 😅").catch(() => {});
  }
}

// ─── Coinflip command ─────────────────────────────────────────────────────────

async function handleCoinflip(message: Message): Promise<void> {
  const result = Math.random() < 0.5 ? "Heads 🪙" : "Tails 🔄";
  const comments = [
    "Fate ne decide kar diya!", "Lucky day!", "Tera number aa gaya!",
    "Theek hai, pagal!", "Agar tu khush nahi hai toh dobara karte hain lol",
  ];
  const comment = comments[Math.floor(Math.random() * comments.length)];
  await message.reply(`🪙 **${result}!** — ${comment}`);
}

// ─── Help command ─────────────────────────────────────────────────────────────

async function handleHelp(message: Message, prefix: string): Promise<void> {
  const siteUrl = process.env.SITE_URL?.replace(/\/$/, "");

  const commands = [
    { name: `${prefix}ship @user1 @user2`, value: "Dono ki compatibility check karo 💘" },
    { name: `${prefix}marry @user`, value: "Kisi ko propose karo 💍" },
    { name: `${prefix}divorce`, value: "Apne partner se alag ho jao 💔" },
    { name: `${prefix}adopt @user`, value: "Kisi ko apna bachcha banao 👶" },
    { name: `${prefix}unadopt @user`, value: "Bachche ko unadopt karo (parent side) 🚪" },
    { name: `${prefix}leave`, value: "Apne parents se bhaag jao (child side) 🏃" },
    { name: `${prefix}parents [@user]`, value: "Apne ya kisi ke parents dekho 👨‍👩‍👧" },
    { name: `${prefix}family [@user]`, value: "Apna pura parivaar dekho 🏠" },
    { name: `${prefix}profile [@user]`, value: "Apna ya kisi ka profile card dekho ✨" },
    { name: `${prefix}marriagecard [@user]`, value: "Apna ya kisi ka marriage card dekho 💍" },
    { name: `${prefix}roast @user`, value: "Kisi ko AI se roast karwao 🔥" },
    { name: `${prefix}hug @user`, value: "Kisi ko hug karo 🤗" },
    { name: `${prefix}slap @user`, value: "Kisi ko thappad maro 👋" },
    { name: `${prefix}8ball <sawaal>`, value: "Magic 8-ball se poochho 🎱" },
    { name: `${prefix}rate <kuch bhi>`, value: "Priya kisi bhi cheez ko rate karegi ⭐" },
    { name: `${prefix}coinflip`, value: "Heads ya tails? 🪙" },
    { name: `${prefix}help`, value: "Ye help message 😊" },
  ];

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle("✨ Priya — Commands")
    .setDescription(
      "Heyy! Main Priya hoon, tumhari AI dost 💕\nYe rahi meri saari commands:"
    )
    .addFields(
      commands.map((c) => ({ name: `\`${c.name}\``, value: c.value, inline: false }))
    )
    .setFooter({ text: `Prefix: ${prefix}  •  Priya Bot` });

  if (siteUrl) {
    embed.addFields({
      name: "🌐 Dashboard & User Portal",
      value: [
        `**[User Portal](${siteUrl}/portal)** — Apni chat history dekho, settings change karo`,
        `**[Owner Dashboard](${siteUrl}/login)** — Bot manage karo`,
      ].join("\n"),
      inline: false,
    });
  }

  await message.reply({ embeds: [embed] });
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

// ─── !rank / !m ───────────────────────────────────────────────────────────────

async function handleRank(message: Message, client: Client, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const guildId = message.guild.id;
  const targetId = getMentionedUser(message, args) ?? message.author.id;

  const dbUser = await BotUser.findOne({ userId: targetId });
  const count = dbUser?.messageCount ?? 0;

  // Find rank — count how many users in this server have MORE messages
  const rank = (await BotUser.countDocuments({ servers: guildId, messageCount: { $gt: count }, banned: { $ne: true } })) + 1;
  const total = await BotUser.countDocuments({ servers: guildId, banned: { $ne: true } });

  const member = message.guild.members.cache.get(targetId) ?? await message.guild.members.fetch(targetId).catch(() => null);
  const displayName = member?.displayName ?? dbUser?.username ?? "Unknown";
  const isSelf = targetId === message.author.id;

  const medals: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };
  const medal = medals[rank] ?? "💬";

  await message.reply(
    `${medal} **${displayName}** ka server rank: **#${rank}** out of **${total}** members\n` +
    `📨 Total messages: **${count.toLocaleString()}**${isSelf ? "" : ` (${displayName} ki ranking)`}`
  );
}

// ─── !lb ──────────────────────────────────────────────────────────────────────

async function handleLeaderboard(message: Message, client: Client): Promise<void> {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const guildId = message.guild.id;
  const guild = message.guild;

  const status = await message.reply("Leaderboard bana rahi hoon... ⏳");

  const [members, serverConf, topRaw] = await Promise.all([
    guild.members.fetch().catch(() => guild.members.cache),
    ServerConfig.findOne({ guildId }),
    BotUser.find({ servers: guildId, banned: { $ne: true } })
      .sort({ messageCount: -1 })
      .limit(10)
      .lean(),
  ]);

  const memberMap = new Map(members.map((m) => [m.user.id, m]));

  const topMembers: CounterMember[] = topRaw.map((u) => {
    const m = memberMap.get(u.userId);
    return {
      userId: u.userId,
      username: m?.displayName ?? m?.user.username ?? u.username,
      avatarUrl: m?.user.avatarURL({ size: 64 }) ?? u.avatarUrl ?? undefined,
      messageCount: u.messageCount ?? 0,
    };
  });

  const memberCount = members.size;
  const botCount = members.filter((m) => m.user.bot).size;

  const buf = await generateCounterCard({
    guildName: guild.name,
    guildIconUrl: guild.iconURL({ size: 256 }) ?? undefined,
    totalMessages: serverConf?.totalMessages ?? 0,
    memberCount,
    botCount,
    updatedAt: new Date(),
    topMembers,
  });

  await status.edit({
    content: "",
    files: [{ attachment: buf, name: "leaderboard.png" }],
  });
}

// ─── !resetcount ──────────────────────────────────────────────────────────────

async function handleResetCount(message: Message): Promise<void> {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai.");
    return;
  }

  const member = message.guild.members.cache.get(message.author.id);
  const isAdmin = member?.permissions.has("Administrator") ?? false;
  const isServerOwner = message.guild.ownerId === message.author.id;

  if (!isAdmin && !isServerOwner) {
    await message.reply("❌ Yaar sirf server admins ye kar sakte hain!");
    return;
  }

  const guildId = message.guild.id;

  // Reset all users' messageCount who are in this server to 0
  const result = await BotUser.updateMany(
    { servers: guildId },
    { $set: { messageCount: 0 } }
  );

  // Reset server total message counter
  await ServerConfig.findOneAndUpdate(
    { guildId },
    { $set: { totalMessages: 0 } }
  );

  await message.reply(
    `✅ Done! **${result.modifiedCount}** users ke message counts reset kar diye. Leaderboard ab zero se shuru hoga! 🔄`
  );
}

export async function handlePrefixCommand(
  message: Message,
  client: Client,
  command: string,
  args: string[]
): Promise<void> {
  try {
    const prefix = await getServerPrefix(message.guild?.id ?? null);
    switch (command.toLowerCase()) {
      case "help":
      case "commands":
        await handleHelp(message, prefix);
        break;
      case "profile":
      case "p":
        await handleProfile(message, client, args);
        break;
      case "runaway":
      case "escape":
      case "leavefamily":
      case "leave":
        await handleRunaway(message);
        break;
      case "parent":
      case "parents":
        await handleParents(message, client, args);
        break;
      case "roast":
        await handleRoast(message, client, args);
        break;
      case "hug":
        await handleHug(message, client, args);
        break;
      case "slap":
        await handleSlap(message, client, args);
        break;
      case "8ball":
      case "eightball":
        await handleEightBall(message, args);
        break;
      case "rate":
        await handleRate(message, args);
        break;
      case "coinflip":
      case "flip":
        await handleCoinflip(message);
        break;
      case "ship":
        await handleShip(message, client, args);
        break;
      case "marry":
      case "marriage":
        await handleMarry(message, client, args);
        break;
      case "divorce":
        await handleDivorce(message, client);
        break;
      case "adopt":
        await handleAdopt(message, client, args);
        break;
      case "unadopt":
        await handleUnadopt(message, client, args);
        break;
      case "family":
        await handleFamily(message, client, args);
        break;
      case "marriagecard":
      case "mcard":
      case "weddingcard":
        await handleMarriageCard(message, client, args);
        break;
      case "rank":
      case "m":
        await handleRank(message, client, args);
        break;
      case "lb":
        await handleLeaderboard(message, client);
        break;
      case "resetcount":
        await handleResetCount(message);
        break;
    }
  } catch (err) {
    logger.error({ err, command }, "Prefix command error");
    await message.reply("Yaar kuch gadbad ho gayi. Thodi der baad try karo!").catch(() => {});
  }
}
