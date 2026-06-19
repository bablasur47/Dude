---
name: Bot reply access model
description: Who can get AI replies vs who can use prefix commands — split access model
---

# Access model

**AI replies** (when @mentioned, DM'd, or replying to bot): open to everyone except banned users.
**Prefix commands** (`!help`, `!roast`, etc.): require `isWhitelisted(userId)` — owner always passes; others need explicit `!whitelist add @user`.

**Why:** Original whitelist blocked all non-whitelisted users from even getting AI replies, making the bot useless by default.
**How to apply:** `isAllowed()` checks ban only. `isWhitelisted()` checks owner + whitelisted flag. Use `isAllowed` for AI path, `isWhitelisted` for command path in bot.ts messageCreate handler.
