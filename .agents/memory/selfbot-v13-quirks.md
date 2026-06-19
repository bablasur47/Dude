---
name: discord.js-selfbot-v13 API quirks
description: Runtime differences vs regular discord.js that caused crashes during migration
---

# selfbot-v13 quirks

**Events enum does not exist.**
discord.js-selfbot-v13 does not export an `Events` enum. Use plain strings: `"messageCreate"`, `"ready"`, `"guildCreate"`, `"guildMemberAdd"`, `"messageDelete"`, `"error"`, `"shardDisconnect"`, `"shardReconnecting"`.
**Why:** Library is a fork that stripped intents/Events abstraction for user-token compatibility.
**How to apply:** Any `client.on(Events.Foo, ...)` → `client.on("fooEvent", ...)`.

**messages.fetch() is not always Promise-chainable.**
`channel.messages.fetch(id)` can return synchronously from cache. `.then()` / `.catch()` chaining fails. Always use `await` + `try/catch`.
**Why:** The method short-circuits to cache when the message is already loaded.
**How to apply:** Replace `.fetch(id).then(...).catch(...)` with `try { const m = await ...fetch(id); } catch {}`.

**Message edit rejects empty content.**
`msg.edit({ content: "" })` throws `RangeError: Message content must be a non-empty string`. Use `"\u200b"` (zero-width space) as placeholder when editing with only files.

**Selfbots can only edit their own messages.**
`DiscordAPIError: Cannot edit a message authored by another user` — always check `msg.author.id === client.user?.id` before editing.
