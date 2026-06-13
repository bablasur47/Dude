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
import { BotUser, UserRelationship, ServerConfig, ChatHistory } from "./models";
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
  generateSnipeCard,
  type CardUser,
  type CounterMember,
  type FamilyChildNode,
} from "./cards";
import { snipeStore } from "./bot";
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

  let status;
  try {
    status = await message.reply({ content: "Building family tree... 🌳" });
  } catch { return; }

  try {
    const rel = await UserRelationship.findOne({ userId: targetId, guildId });
    const spouseRel = rel?.marriedTo
      ? await UserRelationship.findOne({ userId: rel.marriedTo, guildId })
      : null;

    // Direct parents (max 4)
    const parentIds = [...new Set<string>(rel?.parents ?? [])].slice(0, 4);

    // Grandparents: parents of each parent (max 6 total)
    const gpSets = await Promise.all(
      parentIds.map((pid) =>
        UserRelationship.findOne({ userId: pid, guildId }).then((r) => r?.parents ?? [])
      )
    );
    const grandparentIds = [...new Set<string>(gpSets.flat())].slice(0, 6);

    // Children: merge user + spouse children (cap at 12 for layout)
    const ownChildIds: string[] = rel?.children ?? [];
    const spouseChildIds: string[] = spouseRel?.children ?? [];
    const childIds = [...new Set<string>([...ownChildIds, ...spouseChildIds])].slice(0, 12);

    // Fetch per-child: their relationship (spouse + their own children)
    const childRels = await Promise.all(
      childIds.map((cid) => UserRelationship.findOne({ userId: cid, guildId }))
    );

    // For each child that has a spouse, fetch that spouse's rel too (to merge children)
    const childSpouseRels = await Promise.all(
      childRels.map((cr) =>
        cr?.marriedTo
          ? UserRelationship.findOne({ userId: cr.marriedTo, guildId })
          : Promise.resolve(null)
      )
    );

    // Resolve all card users in parallel
    const [userCard, spouseCard, grandparentCards, parentCards, ...childDataArrays] =
      await Promise.all([
        resolveCardUser(targetId, client, guildId),
        rel?.marriedTo ? resolveCardUser(rel.marriedTo, client, guildId) : Promise.resolve(null),
        Promise.all(grandparentIds.map((id) => resolveCardUser(id, client, guildId))),
        Promise.all(parentIds.map((id) => resolveCardUser(id, client, guildId))),
        // For each child: resolve [childUser, childSpouseUser | null, ...gcUsers]
        ...childIds.map(async (cid, i): Promise<FamilyChildNode> => {
          const cr  = childRels[i];
          const csr = childSpouseRels[i];
          const gcIds = [
            ...new Set<string>([
              ...(cr?.children  ?? []),
              ...(csr?.children ?? []),
            ]),
          ].slice(0, 6);

          const [childUser, childSpouseUser, ...gcUsers] = await Promise.all([
            resolveCardUser(cid, client, guildId),
            cr?.marriedTo ? resolveCardUser(cr.marriedTo, client, guildId) : Promise.resolve(null),
            ...gcIds.map((id) => resolveCardUser(id, client, guildId)),
          ]);

          return {
            user:     childUser,
            spouse:   childSpouseUser,
            children: gcUsers as CardUser[],
          };
        }),
      ]);

    const childNodes = childDataArrays as FamilyChildNode[];

    const buf = await generateFamilyCard({
      user:        userCard,
      grandparents: grandparentCards,
      parents:      parentCards,
      spouse:       spouseCard,
      children:     childNodes,
    });
    await status.edit({
      content: `🌳 **${userCard.username}**'s Family Tree`,
      files: [{ attachment: buf, name: "family.png" }],
    });
  } catch (err) {
    logger.error({ err }, "Family card failed");
    await status.edit("Yaar family tree mein kuch gadbad ho gayi! Try again later.").catch(() => {});
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
  const isOwner = message.author.id === process.env.OWNER_DISCORD_ID;

  type HelpPage = { id: string; label: string; emoji: string; color: number; title: string; desc: string; fields: { name: string; value: string; inline?: boolean }[] };

  const pages: HelpPage[] = [
    {
      id: "fun",
      label: "Fun & Games",
      emoji: "🎮",
      color: 0xe74c3c,
      title: "🎮 Fun & Games",
      desc: "Timepass ke liye best commands hai yaar!",
      fields: [
        { name: "`" + prefix + "roast @user`", value: "Kisi ko AI se roast karwao 🔥", inline: true },
        { name: "`" + prefix + "hug @user`", value: "Kisi ko hug karo 🤗", inline: true },
        { name: "`" + prefix + "slap @user`", value: "Kisi ko thappad maro 👋", inline: true },
        { name: "`" + prefix + "ship @user1 @user2`", value: "Dono ki compatibility check karo 💘", inline: true },
        { name: "`" + prefix + "8ball <sawaal>`", value: "Magic 8-ball se poochho 🎱", inline: true },
        { name: "`" + prefix + "rate <kuch bhi>`", value: "Priya rate karegi ⭐", inline: true },
        { name: "`" + prefix + "coinflip`", value: "Heads ya tails? 🪙", inline: true },
        { name: "`" + prefix + "snipe`", value: "Last deleted message dekho 🔍", inline: true },
        { name: "`" + prefix + "rank [@user]`", value: "Server mein apna rank dekho 📊", inline: true },
        { name: "`" + prefix + "lb`", value: "Server leaderboard dekho 🏆", inline: true },
        ...(siteUrl ? [{ name: "🌐 Portal", value: `[User Portal](${siteUrl}/dashboard/portal) — Chat history & settings`, inline: false }] : []),
      ],
    },
    {
      id: "family",
      label: "Family",
      emoji: "👨‍👩‍👧",
      color: 0x2ecc71,
      title: "👨‍👩‍👧 Family System",
      desc: "Apna parivaar banao, rishtey nibhao!",
      fields: [
        { name: "`" + prefix + "marry @user`", value: "Kisi ko propose karo 💍", inline: true },
        { name: "`" + prefix + "divorce`", value: "Partner se alag ho jao 💔", inline: true },
        { name: "`" + prefix + "adopt @user`", value: "Kisi ko apna bachcha banao 👶", inline: true },
        { name: "`" + prefix + "unadopt @user`", value: "Bachche ko unadopt karo 🚪", inline: true },
        { name: "`" + prefix + "leave`", value: "Apne parents se bhaag jao 🏃", inline: true },
        { name: "`" + prefix + "parents [@user]`", value: "Parents dekho 👨‍👩‍👧", inline: true },
        { name: "`" + prefix + "family [@user]`", value: "Pura parivaar dekho 🏠", inline: true },
        { name: "`" + prefix + "profile [@user]`", value: "Profile card dekho ✨", inline: true },
        { name: "`" + prefix + "marriagecard [@user]`", value: "Marriage card dekho 💍", inline: true },
      ],
    },
    {
      id: "slash",
      label: "Slash Commands",
      emoji: "⚡",
      color: 0x3498db,
      title: "⚡ Slash Commands",
      desc: "Ye `/` se start hote hain — Discord mein type karo `/` aur dekho!",
      fields: [
        { name: "`/nsfw enable:true/false`", value: "Channel mein NSFW on/off karo 🔞", inline: true },
        { name: "`/reset`", value: "Apni chat history Priya ke saath reset karo 🗑️", inline: true },
        { name: "`/truth`", value: "Priya se sach poochho 🤔", inline: true },
        { name: "`/dare`", value: "Priya se dare lo 😈", inline: true },
        { name: "`/setprefix <prefix>`", value: "Server prefix change karo (Admin) ⚙️", inline: true },
        { name: "`/setpingchannel #channel`", value: "Random ping channel set karo 🎯", inline: true },
        { name: "`/setwelcome #channel`", value: "Welcome channel set karo 👋", inline: true },
        { name: "`/aioff` / `/aion`", value: "Priya AI replies on/off karo (Admin) 🤖", inline: true },
        { name: "`/say <msg> [#channel]`", value: "Priya se kuch bulwao (Admin) 🗣️", inline: true },
        { name: "`/resetserver`", value: "Server ki saari history clear karo (Admin) ⚠️", inline: true },
      ],
    },
  ];

  if (isOwner) {
    pages.push({
      id: "owner",
      label: "Owner",
      emoji: "🔒",
      color: 0xf39c12,
      title: "🔒 Owner Commands",
      desc: "Sirf bot owner ke liye — baaki log door raho! 😤",
      fields: [
        { name: "`" + prefix + "forceadopt @parent @child`", value: "Kisi ko forcefully adopt karwao 👑", inline: true },
        { name: "`" + prefix + "botban <userid>`", value: "Kisi ko bot se ban karo 🔨", inline: true },
        { name: "`" + prefix + "botunban <userid>`", value: "Bot ban hatao ✅", inline: true },
        { name: "`" + prefix + "clearhistory <userid>`", value: "Kisi ki saari chat history delete karo 🗑️", inline: true },
        { name: "`/ping`", value: "Bot status check karo 🏓", inline: true },
        { name: "`/announce <msg>`", value: "Saare servers mein broadcast karo 📢", inline: true },
        { name: "`/ban @user`", value: "Kisi ko bot se ban karo 🔨", inline: true },
        { name: "`/unban <userid>`", value: "Ban hatao ✅", inline: true },
        { name: "`/serverlist`", value: "Saare servers ki list dekho 📋", inline: true },
        { name: "`/clearhistory <userid>`", value: "Kisi ki chat history clear karo 🗑️", inline: true },
        { name: "`/forceadopt @parent @child`", value: "Force adoption karo 👑", inline: true },
        { name: "`/setprovider <provider>`", value: "AI provider change karo 🤖", inline: true },
        ...(siteUrl ? [{ name: "🌐 Dashboard", value: `[Owner Dashboard](${siteUrl}/dashboard/login)`, inline: false }] : []),
      ],
    });
  }

  let currentPage = 0;

  function buildEmbed(page: HelpPage, pageNum: number): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(page.color)
      .setTitle(page.title)
      .setDescription(page.desc)
      .addFields(page.fields)
      .setFooter({ text: `Page ${pageNum + 1}/${pages.length}  •  Prefix: ${prefix}  •  Priya Bot` })
      .setTimestamp();
  }

  function buildRow(activePage: number): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (let i = 0; i < pages.length; i++) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`help_page_${i}`)
          .setLabel(pages[i].label)
          .setEmoji(pages[i].emoji)
          .setStyle(i === activePage ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(i === activePage)
      );
    }
    return row;
  }

  const reply = await message.reply({
    embeds: [buildEmbed(pages[currentPage], currentPage)],
    components: [buildRow(currentPage)],
  });

  const collector = reply.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.user.id === message.author.id && i.customId.startsWith("help_page_"),
    time: 120_000,
  });

  collector.on("collect", async (interaction) => {
    const idx = parseInt(interaction.customId.replace("help_page_", ""), 10);
    if (isNaN(idx) || idx < 0 || idx >= pages.length) return;
    currentPage = idx;
    await interaction.update({
      embeds: [buildEmbed(pages[currentPage], currentPage)],
      components: [buildRow(currentPage)],
    });
  });

  collector.on("end", async () => {
    const disabledRow = new ActionRowBuilder<ButtonBuilder>();
    for (let i = 0; i < pages.length; i++) {
      disabledRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`help_page_expired_${i}`)
          .setLabel(pages[i].label)
          .setEmoji(pages[i].emoji)
          .setStyle(i === currentPage ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(true)
      );
    }
    await reply.edit({ components: [disabledRow] }).catch(() => {});
  });
}

// ─── Owner-only prefix commands ───────────────────────────────────────────────

async function isOwnerCheck(message: Message): Promise<boolean> {
  if (message.author.id !== process.env.OWNER_DISCORD_ID) {
    await message.reply("Yaar ye command sirf bot owner ke liye hai! Tu owner nahi hai 😤");
    return false;
  }
  return true;
}

async function handleForceAdopt(message: Message, client: Client, args: string[]): Promise<void> {
  if (!(await isOwnerCheck(message))) return;
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }

  const mentionedIds = message.mentions.users.map((u) => u.id);
  if (mentionedIds.length < 2) {
    await message.reply("Usage: `forceadopt @parent @child` — dono ko mention karo!");
    return;
  }

  const [parentId, childId] = mentionedIds;
  if (parentId === childId) {
    await message.reply("Parent aur child same nahi ho sakte!");
    return;
  }

  const guildId = message.guild.id;
  const status = await message.reply("Processing... ⏳");

  await Promise.all([
    UserRelationship.findOneAndUpdate(
      { userId: parentId, guildId },
      { $addToSet: { children: childId } },
      { upsert: true }
    ),
    UserRelationship.findOneAndUpdate(
      { userId: childId, guildId },
      { $addToSet: { parents: parentId } },
      { upsert: true }
    ),
  ]);

  const parentUser = client.users.cache.get(parentId) ?? await client.users.fetch(parentId).catch(() => null);
  const childUser = client.users.cache.get(childId) ?? await client.users.fetch(childId).catch(() => null);

  const parentName = parentUser?.displayName ?? parentUser?.username ?? `User#${parentId.slice(-4)}`;
  const childName = childUser?.displayName ?? childUser?.username ?? `User#${childId.slice(-4)}`;

  try {
    const toCard = (u: import("discord.js").User): CardUser => ({
      id: u.id,
      username: u.displayName ?? u.username,
      avatarUrl: u.avatarURL({ size: 256 }) ?? undefined,
    });
    if (parentUser && childUser) {
      const buf = await generateAdoptCard(toCard(parentUser), toCard(childUser));
      await status.edit({
        content: `✅ Done! **${parentName}** ne **${childName}** ko forcefully adopt kar liya! 👑`,
        files: [{ attachment: buf, name: "force-adopt.png" }],
      });
      return;
    }
  } catch (err) {
    logger.error({ err }, "forceadopt card failed");
  }

  await status.edit(`✅ Done! **${parentName}** ne **${childName}** ko forcefully adopt kar liya! 👑`);
}

async function handleBotBan(message: Message, args: string[]): Promise<void> {
  if (!(await isOwnerCheck(message))) return;

  const targetId = args[0]?.replace(/[<@!>]/g, "").trim();
  if (!targetId || !/^\d+$/.test(targetId)) {
    await message.reply("Usage: `botban <userid>` — valid Discord user ID do!");
    return;
  }

  await BotUser.findOneAndUpdate(
    { userId: targetId },
    { $set: { banned: true } },
    { upsert: true }
  );

  await message.reply(`🔨 User \`${targetId}\` ko bot se ban kar diya! Ab ye Priya se baat nahi kar sakta.`);
}

async function handleBotUnban(message: Message, args: string[]): Promise<void> {
  if (!(await isOwnerCheck(message))) return;

  const targetId = args[0]?.replace(/[<@!>]/g, "").trim();
  if (!targetId || !/^\d+$/.test(targetId)) {
    await message.reply("Usage: `botunban <userid>` — valid Discord user ID do!");
    return;
  }

  const result = await BotUser.findOneAndUpdate(
    { userId: targetId },
    { $set: { banned: false } }
  );

  if (result) {
    await message.reply(`✅ User \`${targetId}\` ka bot ban hata diya! Ab ye Priya se baat kar sakta hai.`);
  } else {
    await message.reply(`⚠️ User \`${targetId}\` database mein mila nahi — shayad kabhi baat hi nahi ki!`);
  }
}

async function handleClearHistory(message: Message, args: string[]): Promise<void> {
  if (!(await isOwnerCheck(message))) return;

  const targetId = args[0]?.replace(/[<@!>]/g, "").trim();
  if (!targetId || !/^\d+$/.test(targetId)) {
    await message.reply("Usage: `clearhistory <userid>` — valid Discord user ID do!");
    return;
  }

  const result = await ChatHistory.updateMany({ userId: targetId }, { $set: { messages: [] } });
  await message.reply(
    `🗑️ User \`${targetId}\` ki **${result.modifiedCount}** chat histories clear kar di! Priya unhe bilkul naya jaanegi.`
  );
}

// ─── !snipe ───────────────────────────────────────────────────────────────────

async function handleSnipe(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const snipes = snipeStore.get(message.channelId);
  if (!snipes || snipes.length === 0) {
    await message.reply("Is channel mein koi deleted message nahi mila yaar! 🤷");
    return;
  }

  const requestedIdx = parseInt(args[0] ?? "1");
  const idx = Math.max(0, Math.min(isNaN(requestedIdx) ? 0 : requestedIdx - 1, snipes.length - 1));
  const deleted = snipes[idx];
  const total = snipes.length;

  let status: Message | null = null;
  try {
    status = await message.reply("Snooping around... 🔍");
    const buf = await generateSnipeCard(deleted);
    await status.delete().catch(() => {});
    if ("send" in message.channel) {
      await message.channel.send({
        content: total > 1 ? `📋 Snipe **${idx + 1}/${total}** — use \`!snipe 2\`, \`!snipe 3\` etc. for older ones` : undefined,
        files: [{ attachment: buf, name: "snipe.png" }],
      });
    }
  } catch (err) {
    logger.error({ err }, "Snipe card generation failed");
    if (status) {
      await status.edit(
        `🔍 [${idx + 1}/${total}] **${deleted.authorName}** said: ${deleted.content.slice(0, 200)}`
      ).catch(() => {});
    }
  }
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
      case "snipe":
        await handleSnipe(message, args);
        break;
      case "forceadopt":
        await handleForceAdopt(message, client, args);
        break;
      case "botban":
        await handleBotBan(message, args);
        break;
      case "botunban":
        await handleBotUnban(message, args);
        break;
      case "clearhistory":
        await handleClearHistory(message, args);
        break;
    }
  } catch (err) {
    logger.error({ err, command }, "Prefix command error");
    await message.reply("Yaar kuch gadbad ho gayi. Thodi der baad try karo!").catch(() => {});
  }
}
