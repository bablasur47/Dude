import {
  type Message,
  type Client,
} from "discord.js-selfbot-v13";
import { logger } from "./logger";
import { BotUser, UserRelationship, ServerConfig, ChatHistory, Personality } from "./models";
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

// ─── Pending requests ─────────────────────────────────────────────────────────

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
  const discordUser = client.users.cache.get(userId) ?? await client.users.fetch(userId).catch(() => null);
  if (discordUser) {
    const avatarUrl = discordUser.avatarURL({ size: 256 }) ?? undefined;
    BotUser.updateOne({ userId }, { $set: { avatarUrl: avatarUrl ?? null, username: discordUser.username } }).catch(() => {});
    return { id: userId, username: discordUser.username, avatarUrl: avatarUrl ?? null };
  }
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

// ─── Text-based consent (replaces buttons) ───────────────────────────────────

async function awaitConsent(
  message: Message,
  targetId: string,
  prompt: string
): Promise<boolean> {
  await message.channel.send(prompt);
  try {
    const filter = (m: Message) =>
      m.author.id === targetId &&
      ["yes", "no", "haan", "nahi", "y", "n"].includes(m.content.toLowerCase().trim());
    const collected = await message.channel.awaitMessages({ filter, max: 1, time: 60_000, errors: ["time"] });
    const response = collected.first()?.content.toLowerCase().trim() ?? "no";
    return response === "yes" || response === "haan" || response === "y";
  } catch {
    return false;
  }
}

// ─── !ship ────────────────────────────────────────────────────────────────────

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

  let status: Message | null = null;
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

// ─── !marry ───────────────────────────────────────────────────────────────────

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
    await message.reply("Aww tujhse pyaar hai mujhe, par main selfbot hun 😔💔 Kisi insaan se kar shaadi!");
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
    await message.reply(`Yaar tu pehle se **${spouse.username}** se married hai! Pehle divorce le.`);
    return;
  }
  if (theirRel.marriedTo) {
    const target = await resolveCardUser(targetId, client, guildId);
    await message.reply(`**${target.username}** pehle se kisi aur se married hai!`);
    return;
  }
  const isMyFamily = myRel.children.includes(targetId) || myRel.parents.includes(targetId);
  const isTheirFamily = theirRel.children.includes(message.author.id) || theirRel.parents.includes(message.author.id);
  if (isMyFamily || isTheirFamily) {
    await message.reply("Yaar apne hi family member se shaadi? That's weird 🤢");
    return;
  }

  const [proposer, target] = await Promise.all([
    resolveCardUser(message.author.id, client, guildId),
    resolveCardUser(targetId, client, guildId),
  ]);

  pendingRequests.add(pendingKey);
  try {
    const accepted = await awaitConsent(
      message,
      targetId,
      `💍 **${proposer.username}** ne **${target.username}** ko propose kiya! <@${targetId}>, kya tum shaadi karna chahte ho? Reply \`yes\` ya \`no\` mein (60 seconds hain!)`
    );

    if (accepted) {
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
        await message.channel.send({
          content: `🎉 **${proposer.username}** aur **${target.username}** ab officially married hain! Mubarak ho! 💍`,
          files: [{ attachment: buf, name: "marriage.png" }],
        });
      } catch (err) {
        logger.error({ err }, "Marriage card failed");
        await message.channel.send(`💍 **${proposer.username}** aur **${target.username}** ab officially married hain! Mubarak ho!`).catch(() => {});
      }
    } else {
      await message.channel.send(`💔 **${target.username}** ne proposal decline kar diya. Better luck next time, **${proposer.username}**!`);
    }
  } catch {
    await message.channel.send(`⏰ **${target.username}** ne 60 seconds mein jawab nahi diya. Proposal expire ho gaya! 💨`).catch(() => {});
  } finally {
    pendingRequests.delete(pendingKey);
  }
}

// ─── !divorce ─────────────────────────────────────────────────────────────────

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

// ─── !adopt ───────────────────────────────────────────────────────────────────

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

  pendingRequests.add(pendingKey);
  try {
    const accepted = await awaitConsent(
      message,
      targetId,
      `🏠 **${parent.username}** tumhe adopt karna chahta/chahti hai, <@${targetId}>! Kya tum unki family join karna chahte ho? Reply \`yes\` ya \`no\` mein (60 seconds hain!)`
    );

    if (accepted) {
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
        await message.channel.send({
          content: `🎉 **${parent.username}** ne **${child.username}** ko adopt kar liya! Welcome to the family! 🏠`,
          files: [{ attachment: buf, name: "adopt.png" }],
        });
      } catch (err) {
        logger.error({ err }, "Adopt card failed");
        await message.channel.send(`🏠 **${parent.username}** ne **${child.username}** ko adopt kar liya! Welcome to the family!`).catch(() => {});
      }
    } else {
      await message.channel.send(`❌ **${child.username}** ne adoption decline kar diya. Better luck next time, **${parent.username}**!`);
    }
  } catch {
    await message.channel.send(`⏰ **${child.username}** ne 60 seconds mein jawab nahi diya. Request expire ho gaya! 💨`).catch(() => {});
  } finally {
    pendingRequests.delete(pendingKey);
  }
}

// ─── !unadopt ─────────────────────────────────────────────────────────────────

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

// ─── !family ──────────────────────────────────────────────────────────────────

async function handleFamily(message: Message, client: Client, args: string[]) {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const guildId = message.guild.id;
  const targetId = getMentionedUser(message, args) ?? message.author.id;

  let status: Message;
  try {
    status = await message.reply({ content: "Building family tree... 🌳" });
  } catch { return; }

  try {
    const rel = await UserRelationship.findOne({ userId: targetId, guildId });
    const spouseRel = rel?.marriedTo
      ? await UserRelationship.findOne({ userId: rel.marriedTo, guildId })
      : null;

    const parentIds = [...new Set<string>(rel?.parents ?? [])].slice(0, 4);
    const gpSets = await Promise.all(
      parentIds.map((pid) =>
        UserRelationship.findOne({ userId: pid, guildId }).then((r) => r?.parents ?? [])
      )
    );
    const grandparentIds = [...new Set<string>(gpSets.flat())].slice(0, 6);
    const ownChildIds: string[] = rel?.children ?? [];
    const spouseChildIds: string[] = spouseRel?.children ?? [];
    const childIds = [...new Set<string>([...ownChildIds, ...spouseChildIds])].slice(0, 12);
    const childRels = await Promise.all(
      childIds.map((cid) => UserRelationship.findOne({ userId: cid, guildId }))
    );
    const childSpouseRels = await Promise.all(
      childRels.map((cr) =>
        cr?.marriedTo
          ? UserRelationship.findOne({ userId: cr.marriedTo, guildId })
          : Promise.resolve(null)
      )
    );

    const [userCard, spouseCard, grandparentCards, parentCards, ...childDataArrays] =
      await Promise.all([
        resolveCardUser(targetId, client, guildId),
        rel?.marriedTo ? resolveCardUser(rel.marriedTo, client, guildId) : Promise.resolve(null),
        Promise.all(grandparentIds.map((id) => resolveCardUser(id, client, guildId))),
        Promise.all(parentIds.map((id) => resolveCardUser(id, client, guildId))),
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

// ─── !marriagecard ────────────────────────────────────────────────────────────

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

// ─── !parents ─────────────────────────────────────────────────────────────────

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

  const lines = parentCards.map((p, i) => `${i + 1}. **${p.username}** (<@${p.id}>)`).join("\n");
  await message.reply(`👨‍👩‍👧 **${targetUser.username}'s Parents:**\n${lines}\n\n_Use \`!leave\` to run away from your family_`);
}

// ─── !profile ─────────────────────────────────────────────────────────────────

async function handleProfile(message: Message, client: Client, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const guildId = message.guild.id;
  const targetId = getMentionedUser(message, args) ?? message.author.id;

  const status = await message.reply({ content: "Tera profile bana rahi hoon... ✨" });

  const [cardUser, dbUser, rel] = await Promise.all([
    resolveCardUser(targetId, client, guildId),
    BotUser.findOne({ userId: targetId }),
    UserRelationship.findOne({ userId: targetId, guildId }),
  ]);

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

// ─── !leave / !runaway ────────────────────────────────────────────────────────

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
  for (const parentId of parentIds) {
    await UserRelationship.findOneAndUpdate(
      { userId: parentId, guildId },
      { $pull: { children: userId } }
    );
  }
  rel.parents = [];
  await rel.save();

  await message.reply(
    `🏃💨 **${message.author.username}** ghar se bhaag gaya/gayi!\n` +
    `${parentIds.length} parent${parentIds.length > 1 ? "s" : ""} se rishta tod diya. Goodbye! 👋\n` +
    `_Use \`!adopt\` to be adopted again_`
  );
}

// ─── !roast ───────────────────────────────────────────────────────────────────

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

// ─── !hug ─────────────────────────────────────────────────────────────────────

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

// ─── !slap ────────────────────────────────────────────────────────────────────

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

// ─── !8ball ───────────────────────────────────────────────────────────────────

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
  await message.reply(`🎱 **Magic 8-Ball**\n\n**Sawaal:** ${question.length > 200 ? question.slice(0, 197) + "..." : question}\n**Jawab:** ${answer}`);
}

// ─── !rate ────────────────────────────────────────────────────────────────────

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
    await status.edit(`⭐ **Priya's Rating**\n\n**Cheez:** ${thing.length > 200 ? thing.slice(0, 197) + "..." : thing}\n**Rating:** ${rating}`);
  } catch (err) {
    logger.error({ err }, "Rate command failed");
    await status.edit("Yaar rate nahi kar paai abhi 😅").catch(() => {});
  }
}

// ─── !coinflip ────────────────────────────────────────────────────────────────

async function handleCoinflip(message: Message): Promise<void> {
  const result = Math.random() < 0.5 ? "Heads 🪙" : "Tails 🔄";
  const comments = [
    "Fate ne decide kar diya!", "Lucky day!", "Tera number aa gaya!",
    "Theek hai, pagal!", "Agar tu khush nahi hai toh dobara karte hain lol",
  ];
  const comment = comments[Math.floor(Math.random() * comments.length)];
  await message.reply(`🪙 **${result}!** — ${comment}`);
}

// ─── !rank ────────────────────────────────────────────────────────────────────

async function handleRank(message: Message, client: Client, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const guildId = message.guild.id;
  const targetId = getMentionedUser(message, args) ?? message.author.id;

  const dbUser = await BotUser.findOne({ userId: targetId });
  const count = dbUser?.messageCount ?? 0;

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

// ─── !lb (leaderboard) ────────────────────────────────────────────────────────

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
  const isAdmin = member?.permissions.has("ADMINISTRATOR") ?? false;
  const isServerOwner = message.guild.ownerId === message.author.id;
  const isOwner = message.author.id === process.env.OWNER_DISCORD_ID;

  if (!isAdmin && !isServerOwner && !isOwner) {
    await message.reply("❌ Yaar sirf server admins ye kar sakte hain!");
    return;
  }

  const guildId = message.guild.id;
  const result = await BotUser.updateMany({ servers: guildId }, { $set: { messageCount: 0 } });
  await ServerConfig.findOneAndUpdate({ guildId }, { $set: { totalMessages: 0 } });

  await message.reply(`✅ Done! **${result.modifiedCount}** users ke message counts reset kar diye. Leaderboard ab zero se shuru hoga! 🔄`);
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

// ─── Owner-only commands ──────────────────────────────────────────────────────

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
    if (parentUser && childUser) {
      const toCard = (u: import("discord.js-selfbot-v13").User): CardUser => ({
        id: u.id,
        username: u.displayName ?? u.username,
        avatarUrl: u.avatarURL({ size: 256 }) ?? undefined,
      });
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

  await status.edit(`✅ Done! **${parentName}** ne **${childName}** ko adopt kar liya! 👑`);
}

async function handleBotBan(message: Message, args: string[]): Promise<void> {
  if (!(await isOwnerCheck(message))) return;

  const targetId = args[0]?.replace(/[<@!>]/g, "").trim();
  if (!targetId || !/^\d+$/.test(targetId)) {
    await message.reply("Usage: `!botban <userid>` — valid Discord user ID do!");
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
    await message.reply("Usage: `!botunban <userid>` — valid Discord user ID do!");
    return;
  }

  const result = await BotUser.findOneAndUpdate(
    { userId: targetId },
    { $set: { banned: false } }
  );
  if (result) {
    await message.reply(`✅ User \`${targetId}\` ka bot ban hata diya!`);
  } else {
    await message.reply(`⚠️ User \`${targetId}\` database mein mila nahi.`);
  }
}

async function handleClearHistory(message: Message, args: string[]): Promise<void> {
  if (!(await isOwnerCheck(message))) return;

  const targetId = args[0]?.replace(/[<@!>]/g, "").trim();
  if (!targetId || !/^\d+$/.test(targetId)) {
    await message.reply("Usage: `!clearhistory <userid>` — valid Discord user ID do!");
    return;
  }

  const result = await ChatHistory.updateMany({ userId: targetId }, { $set: { messages: [] } });
  await message.reply(`🗑️ User \`${targetId}\` ki **${result.modifiedCount}** chat histories clear kar di!`);
}

// ─── Owner commands — formerly slash commands ─────────────────────────────────

async function handlePing(message: Message, client: Client): Promise<void> {
  if (!(await isOwnerCheck(message))) return;
  const latency = client.ws.ping;
  const servers = client.guilds.cache.size;
  const uptime = Math.floor((Date.now() - (await import("./bot").then(b => b.botStartTime))) / 1000 / 60);
  await message.reply(
    `**Priya Status**\n🏓 Latency: ${latency}ms\n🌐 Servers: ${servers}\n⏱️ Uptime: ${uptime} minutes`
  );
}

async function handleAnnounce(message: Message, client: Client, args: string[]): Promise<void> {
  if (!(await isOwnerCheck(message))) return;
  const msg = args.join(" ").trim();
  if (!msg) {
    await message.reply("Usage: `!announce <message>`");
    return;
  }
  let sent = 0; let failed = 0;
  for (const [, guild] of client.guilds.cache) {
    try {
      const channel = guild.systemChannel ?? guild.channels.cache.filter((c) => c.type === "GUILD_TEXT").first();
      if (channel && "send" in channel) {
        await (channel as TextChannel).send(msg);
        sent++;
      }
    } catch { failed++; }
  }
  await message.reply(`📢 Broadcast complete! Sent to ${sent} server${sent !== 1 ? "s" : ""}${failed > 0 ? `, failed on ${failed}` : ""}.`);
}

async function handleServerList(message: Message, client: Client): Promise<void> {
  if (!(await isOwnerCheck(message))) return;
  const guilds = client.guilds.cache.map((g) => `• **${g.name}** (${g.memberCount} members)`);
  const list = guilds.length > 0 ? guilds.join("\n") : "Koi server nahi!";
  const text = `**Servers where Priya is present (${guilds.length}):**\n${list}`;
  if (text.length <= 2000) {
    await message.reply(text);
  } else {
    const chunks = text.match(/[\s\S]{1,1900}/g) ?? [];
    for (const chunk of chunks) await message.reply(chunk).catch(() => {});
  }
}

async function handleSetPrefix(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const member = message.guild.members.cache.get(message.author.id);
  const isAdmin = member?.permissions.has("ADMINISTRATOR") ?? false;
  const isOwner = message.author.id === process.env.OWNER_DISCORD_ID;
  const hasManage = member?.permissions.has("MANAGE_GUILD") ?? false;
  if (!isAdmin && !isOwner && !hasManage) {
    await message.reply("Yaar tujhe permission nahi hai! Admin ya Manage Server chahiye.");
    return;
  }
  const newPrefix = args[0]?.trim();
  if (!newPrefix || newPrefix.length > 5 || newPrefix.includes(" ")) {
    await message.reply("Prefix 1-5 characters ka hona chahiye aur usme space nahi hona chahiye!");
    return;
  }
  await ServerConfig.findOneAndUpdate(
    { guildId: message.guild.id },
    { $set: { prefix: newPrefix } },
    { upsert: true }
  );
  invalidatePrefixCache(message.guild.id);
  await message.reply(`Done! Ab Priya ka prefix **\`${newPrefix}\`** ho gaya.`);
}

async function handleNsfw(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const member = message.guild.members.cache.get(message.author.id);
  const isOwner = message.author.id === process.env.OWNER_DISCORD_ID;
  const hasManage = member?.permissions.has("MANAGE_CHANNELS") ?? false;
  if (!isOwner && !hasManage) {
    await message.reply("Yaar tujhe permission nahi hai ye karne ki!");
    return;
  }
  const enable = ["on", "enable", "true", "1"].includes(args[0]?.toLowerCase() ?? "");
  const guildId = message.guild.id;
  if (enable) {
    await ServerConfig.findOneAndUpdate(
      { guildId },
      { $addToSet: { nsfwChannels: message.channelId } },
      { upsert: true }
    );
    await message.reply("NSFW mode on kar diya is channel mein! 😈");
  } else {
    await ServerConfig.findOneAndUpdate(
      { guildId },
      { $pull: { nsfwChannels: message.channelId } }
    );
    await message.reply("NSFW mode off kar diya is channel mein.");
  }
}

async function handleReset(message: Message): Promise<void> {
  const guildId = message.guild?.id ?? "dm";
  await ChatHistory.findOneAndUpdate(
    { userId: message.author.id, guildId },
    { $set: { messages: [] } }
  );
  await message.reply("Done yaar! Teri chat history delete kar di. Fresh start! 🗑️");
}

async function handleTruth(message: Message): Promise<void> {
  const guildId = message.guild?.id ?? "dm";
  const status = await message.reply("Soch rahi hun... 🤔");
  const personality = await getPersonality();
  const reply = await getAiResponse([
    { role: "system", content: personality.systemPrompt },
    { role: "user", content: "Mujhe ek interesting truth question do" },
  ], personality.activeProvider as "groq" | "gemini" | "nvidia");
  await status.edit(reply.trim());
}

async function handleDare(message: Message): Promise<void> {
  const guildId = message.guild?.id ?? "dm";
  const status = await message.reply("Soch rahi hun... 😈");
  const personality = await getPersonality();
  const reply = await getAiResponse([
    { role: "system", content: personality.systemPrompt },
    { role: "user", content: "Mujhe ek fun dare do" },
  ], personality.activeProvider as "groq" | "gemini" | "nvidia");
  await status.edit(reply.trim());
}

async function handleSetWelcome(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const member = message.guild.members.cache.get(message.author.id);
  const isOwner = message.author.id === process.env.OWNER_DISCORD_ID;
  const hasManage = member?.permissions.has("MANAGE_GUILD") ?? false;
  if (!isOwner && !hasManage) {
    await message.reply("Yaar tujhe permission nahi hai ye karne ki! Manage Server chahiye.");
    return;
  }
  const channelMention = message.mentions.channels.first();
  const channelId = channelMention?.id ?? args[0]?.replace(/[<#>]/g, "");
  if (!channelId) {
    await message.reply("Usage: `!setwelcome #channel`");
    return;
  }
  await ServerConfig.findOneAndUpdate(
    { guildId: message.guild.id },
    { $set: { welcomeChannelId: channelId, welcomeEnabled: true } },
    { upsert: true }
  );
  await message.reply(`Done! Ab naye members ko <#${channelId}> mein welcome karungi. Welcome bhi on kar di! 🎉`);
}

async function handleWelcome(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const member = message.guild.members.cache.get(message.author.id);
  const isOwner = message.author.id === process.env.OWNER_DISCORD_ID;
  const hasManage = member?.permissions.has("MANAGE_GUILD") ?? false;
  if (!isOwner && !hasManage) {
    await message.reply("Yaar tujhe permission nahi hai ye karne ki! Manage Server chahiye.");
    return;
  }
  const enable = ["on", "enable", "true", "1"].includes(args[0]?.toLowerCase() ?? "");
  await ServerConfig.findOneAndUpdate(
    { guildId: message.guild.id },
    { $set: { welcomeEnabled: enable } },
    { upsert: true }
  );
  await message.reply(enable ? "Welcome messages on kar diye! 🎉" : "Welcome messages off kar diye.");
}

async function handleSetPingChannel(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const member = message.guild.members.cache.get(message.author.id);
  const isOwner = message.author.id === process.env.OWNER_DISCORD_ID;
  const hasManage = member?.permissions.has("MANAGE_GUILD") ?? false;
  if (!isOwner && !hasManage) {
    await message.reply("Yaar tujhe permission nahi hai! Manage Server chahiye.");
    return;
  }
  const channelMention = message.mentions.channels.first();
  const channelId = channelMention?.id ?? args[0]?.replace(/[<#>]/g, "");
  if (!channelId) {
    await message.reply("Usage: `!setpingchannel #channel`");
    return;
  }
  await ServerConfig.findOneAndUpdate(
    { guildId: message.guild.id },
    { $set: { pingChannelId: channelId } },
    { upsert: true }
  );
  await message.reply(`Done! Ab main <#${channelId}> mein random members ko ping karungi.`);
}

async function handleResetServer(message: Message): Promise<void> {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const member = message.guild.members.cache.get(message.author.id);
  const isOwner = message.author.id === process.env.OWNER_DISCORD_ID;
  const isServerOwner = message.guild.ownerId === message.author.id;
  const isAdmin = member?.permissions.has("ADMINISTRATOR") ?? false;
  if (!isOwner && !isServerOwner && !isAdmin) {
    await message.reply("Yaar sirf server owner ya admin ye kar sakte hain!");
    return;
  }
  const guildId = message.guild.id;
  const result = await ChatHistory.updateMany({ guildId }, { $set: { messages: [] } });
  await message.reply(`Done! Is server ke ${result.modifiedCount} users ki chat history clear kar di. Fresh start! 🗑️`);
}

async function handleSay(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const member = message.guild.members.cache.get(message.author.id);
  const isAdmin = member?.permissions.has("ADMINISTRATOR") ?? false;
  const isOwner = message.author.id === process.env.OWNER_DISCORD_ID;
  if (!isAdmin && !isOwner) {
    await message.reply("Yaar sirf Administrators ye command use kar sakte hain!");
    return;
  }
  // Check if last arg is a channel mention
  let channelId: string | null = null;
  const lastArg = args[args.length - 1];
  const channelMatch = lastArg?.match(/^<#(\d+)>$/);
  if (channelMatch) {
    channelId = channelMatch[1];
    args = args.slice(0, -1);
  }
  const content = args.join(" ").trim();
  if (!content) {
    await message.reply("Usage: `!say <message> [#channel]`");
    return;
  }
  const hasMassPing = /@everyone|@here|<@&\d+>/.test(content);
  if (hasMassPing && !isOwner) {
    await message.reply("⚠️ Mass pings (@everyone, @here, role mentions) allowed nahi hain `!say` mein!");
    return;
  }
  const targetChannel = channelId
    ? message.guild.channels.cache.get(channelId)
    : message.channel;
  if (!targetChannel || !("send" in targetChannel)) {
    await message.reply("Channel valid nahi hai!");
    return;
  }
  await (targetChannel as TextChannel).send({ content, allowedMentions: isOwner ? undefined : { parse: ["users"] } });
  await message.reply(`Done! Message send kar diya${channelId ? ` <#${channelId}>` : ""} mein.`);
}

async function handleSetProvider(message: Message, args: string[]): Promise<void> {
  if (!(await isOwnerCheck(message))) return;
  const provider = args[0]?.toLowerCase() as "groq" | "gemini" | "nvidia" | undefined;
  if (!provider || !["groq", "gemini", "nvidia"].includes(provider)) {
    await message.reply("Usage: `!setprovider <groq|gemini|nvidia>`");
    return;
  }
  await Personality.findOneAndUpdate({}, { $set: { activeProvider: provider } }, { upsert: true });
  await message.reply(`Done! Ab Priya **${provider.toUpperCase()}** use karegi.`);
}

async function handleAiToggle(message: Message, args: string[], enable: boolean): Promise<void> {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const member = message.guild.members.cache.get(message.author.id);
  const isOwner = message.author.id === process.env.OWNER_DISCORD_ID;
  const isAdmin = member?.permissions.has("ADMINISTRATOR") ?? false;
  const isServerOwner = message.guild.ownerId === message.author.id;
  if (!isOwner && !isAdmin && !isServerOwner) {
    await message.reply("Yaar sirf admins ye kar sakte hain! 🔒");
    return;
  }
  await ServerConfig.findOneAndUpdate(
    { guildId: message.guild.id },
    { $set: { aiEnabled: enable } },
    { upsert: true }
  );
  await message.reply(
    enable
      ? "✅ Priya AI replies **on** kar di is server mein!"
      : "🔇 Priya AI replies **off** kar di is server mein. Commands abhi bhi kaam karengi."
  );
}

async function handleAiChannelToggle(message: Message, args: string[], disable: boolean): Promise<void> {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const member = message.guild.members.cache.get(message.author.id);
  const isOwner = message.author.id === process.env.OWNER_DISCORD_ID;
  const isAdmin = member?.permissions.has("ADMINISTRATOR") ?? false;
  const isServerOwner = message.guild.ownerId === message.author.id;
  if (!isOwner && !isAdmin && !isServerOwner) {
    await message.reply("Yaar sirf admins ye kar sakte hain! 🔒");
    return;
  }
  const channelMention = message.mentions.channels.first();
  const channelId = channelMention?.id ?? args[0]?.replace(/[<#>]/g, "");
  if (!channelId) {
    await message.reply(`Usage: \`!${disable ? "aioffchannel" : "aionchannel"} #channel\``);
    return;
  }
  if (disable) {
    await ServerConfig.findOneAndUpdate(
      { guildId: message.guild.id },
      { $addToSet: { aiDisabledChannels: channelId } },
      { upsert: true }
    );
    await message.reply(`🔇 Priya AI replies <#${channelId}> mein **off** kar di.`);
  } else {
    await ServerConfig.findOneAndUpdate(
      { guildId: message.guild.id },
      { $pull: { aiDisabledChannels: channelId } },
      { upsert: true }
    );
    await message.reply(`✅ Priya AI replies <#${channelId}> mein **on** kar di!`);
  }
}

async function handleSetupCounter(message: Message, client: Client): Promise<void> {
  if (!message.guild) {
    await message.reply("Ye command sirf server mein use hoti hai!");
    return;
  }
  const member = message.guild.members.cache.get(message.author.id);
  const isAdmin = member?.permissions.has("ADMINISTRATOR") ?? false;
  const isOwner = message.author.id === process.env.OWNER_DISCORD_ID;
  if (!isAdmin && !isOwner) {
    await message.reply("Yaar sirf Administrators ye set kar sakte hain!");
    return;
  }
  const guildId = message.guild.id;
  const guild = message.guild;
  const channel = message.channel as TextChannel;
  const serverConf = await ServerConfig.findOne({ guildId });

  const members = await guild.members.fetch().catch(() => guild.members.cache);
  const memberCount = members.size;
  const botCount = members.filter((m) => m.user.bot).size;
  const memberMap = new Map(members.map((m) => [m.user.id, m]));

  const topRaw = await BotUser.find({ servers: guildId, banned: { $ne: true } })
    .sort({ messageCount: -1 })
    .limit(10)
    .lean()
    .catch(() => []);

  const topMembers: CounterMember[] = topRaw.map((u) => {
    const m = memberMap.get(u.userId);
    return {
      userId: u.userId,
      username: m?.displayName ?? m?.user.username ?? u.username,
      avatarUrl: m?.user.avatarURL({ size: 64 }) ?? u.avatarUrl ?? undefined,
      messageCount: u.messageCount ?? 0,
    };
  });

  const buf = await generateCounterCard({
    guildName: guild.name,
    guildIconUrl: guild.iconURL({ size: 256 }) ?? undefined,
    totalMessages: serverConf?.totalMessages ?? 0,
    memberCount,
    botCount,
    updatedAt: new Date(),
    topMembers,
  });

  const posted = await channel.send({ content: "", files: [{ attachment: buf, name: "counter.png" }] });
  await ServerConfig.findOneAndUpdate(
    { guildId },
    { $set: { counterChannelId: channel.id, counterMessageId: posted.id } },
    { upsert: true }
  );
  await message.reply(`✅ Live counter setup kar diya <#${channel.id}> mein! Ye image har 30 seconds mein update hogi. 📊`);
}

// ─── !help ────────────────────────────────────────────────────────────────────

async function handleHelp(message: Message, prefix: string): Promise<void> {
  const isOwner = message.author.id === process.env.OWNER_DISCORD_ID;
  const siteUrl = process.env.SITE_URL?.replace(/\/$/, "");

  const lines = [
    `**🎮 Fun & Games**`,
    `\`${prefix}roast @user\` — AI se roast karwao 🔥`,
    `\`${prefix}hug @user\` — Hug karo 🤗`,
    `\`${prefix}slap @user\` — Thappad maro 👋`,
    `\`${prefix}ship @u1 @u2\` — Compatibility check 💘`,
    `\`${prefix}8ball <sawaal>\` — Magic 8-ball 🎱`,
    `\`${prefix}rate <kuch bhi>\` — Priya rate karegi ⭐`,
    `\`${prefix}coinflip\` — Heads ya tails? 🪙`,
    `\`${prefix}snipe [#]\` — Last deleted message 🔍`,
    `\`${prefix}rank [@user]\` — Server rank 📊`,
    `\`${prefix}lb\` — Leaderboard 🏆`,
    `\`${prefix}image <prompt>\` — AI image generate karo 🎨`,
    ``,
    `**👨‍👩‍👧 Family System**`,
    `\`${prefix}marry @user\` — Propose karo 💍`,
    `\`${prefix}divorce\` — Alag ho jao 💔`,
    `\`${prefix}adopt @user\` — Adopt karo 👶`,
    `\`${prefix}unadopt @user\` — Unadopt karo 🚪`,
    `\`${prefix}leave\` — Parents se bhaago 🏃`,
    `\`${prefix}parents [@user]\` — Parents dekho 👨‍👩‍👧`,
    `\`${prefix}family [@user]\` — Family tree 🌳`,
    `\`${prefix}profile [@user]\` — Profile card ✨`,
    `\`${prefix}marriagecard [@user]\` — Marriage card 💍`,
    ``,
    `**⚙️ Settings (Admin)**`,
    `\`${prefix}nsfw on/off\` — NSFW mode toggle 🔞`,
    `\`${prefix}reset\` — Chat history reset 🗑️`,
    `\`${prefix}truth\` — Truth question 🤔`,
    `\`${prefix}dare\` — Dare 😈`,
    `\`${prefix}setprefix <prefix>\` — Prefix change ⚙️`,
    `\`${prefix}setpingchannel #ch\` — Random ping channel 🎯`,
    `\`${prefix}setwelcome #ch\` — Welcome channel 👋`,
    `\`${prefix}welcome on/off\` — Welcome toggle`,
    `\`${prefix}resetserver\` — Server history clear ⚠️`,
    `\`${prefix}say <msg> [#ch]\` — Priya se bolwao 🗣️`,
    `\`${prefix}aioff / aion\` — AI toggle 🤖`,
    `\`${prefix}aioffchannel #ch\` — Channel AI off`,
    `\`${prefix}aionchannel #ch\` — Channel AI on`,
    `\`${prefix}setupcounter\` — Live counter 📊`,
    `\`${prefix}resetcount\` — Message counts reset 🔄`,
    ...(siteUrl ? [``, `🌐 [User Portal](${siteUrl}/dashboard/portal)`] : []),
  ];

  if (isOwner) {
    lines.push(
      ``,
      `**🔒 Owner Only**`,
      `\`${prefix}whitelist add/remove/list\` — Whitelist manage 👥`,
      `\`${prefix}ping\` — Bot status 🏓`,
      `\`${prefix}announce <msg>\` — Broadcast 📢`,
      `\`${prefix}botban <userid>\` — Ban user 🔨`,
      `\`${prefix}botunban <userid>\` — Unban user ✅`,
      `\`${prefix}serverlist\` — Server list 📋`,
      `\`${prefix}clearhistory <userid>\` — Clear history 🗑️`,
      `\`${prefix}forceadopt @parent @child\` — Force adopt 👑`,
      `\`${prefix}setprovider <groq|gemini|nvidia>\` — AI provider 🤖`,
    );
  }

  // Split into chunks if too long
  const fullText = lines.join("\n");
  if (fullText.length <= 2000) {
    await message.reply(fullText);
  } else {
    const chunks: string[] = [];
    let current = "";
    for (const line of lines) {
      if ((current + line + "\n").length > 1900) {
        chunks.push(current);
        current = "";
      }
      current += line + "\n";
    }
    if (current) chunks.push(current);
    for (const chunk of chunks) await message.reply(chunk).catch(() => {});
  }
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

type TextChannel = import("discord.js-selfbot-v13").TextChannel;

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
      case "ban":
        await handleBotBan(message, args);
        break;
      case "botunban":
      case "unban":
        await handleBotUnban(message, args);
        break;
      case "clearhistory":
        await handleClearHistory(message, args);
        break;
      case "ping":
        await handlePing(message, client);
        break;
      case "announce":
        await handleAnnounce(message, client, args);
        break;
      case "serverlist":
        await handleServerList(message, client);
        break;
      case "nsfw":
        await handleNsfw(message, args);
        break;
      case "reset":
        await handleReset(message);
        break;
      case "truth":
        await handleTruth(message);
        break;
      case "dare":
        await handleDare(message);
        break;
      case "setprefix":
        await handleSetPrefix(message, args);
        break;
      case "setwelcome":
        await handleSetWelcome(message, args);
        break;
      case "welcome":
        await handleWelcome(message, args);
        break;
      case "setpingchannel":
        await handleSetPingChannel(message, args);
        break;
      case "resetserver":
        await handleResetServer(message);
        break;
      case "say":
        await handleSay(message, args);
        break;
      case "setprovider":
        await handleSetProvider(message, args);
        break;
      case "aioff":
        await handleAiToggle(message, args, false);
        break;
      case "aion":
        await handleAiToggle(message, args, true);
        break;
      case "aioffchannel":
        await handleAiChannelToggle(message, args, true);
        break;
      case "aionchannel":
        await handleAiChannelToggle(message, args, false);
        break;
      case "setupcounter":
        await handleSetupCounter(message, client);
        break;
    }
  } catch (err) {
    logger.error({ err, command }, "Prefix command error");
    await message.reply("Yaar kuch gadbad ho gayi. Thodi der baad try karo!").catch(() => {});
  }
}
