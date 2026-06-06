# Priya Discord Bot + Dashboard

A sassy Hinglish Discord bot named Priya, with a web dashboard for the owner to control all settings, API keys, servers, and users.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server + Discord bot (port 8080)
- `pnpm --filter @workspace/dashboard run dev` — run the owner dashboard (port 23183)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API + Bot: Express 5 + discord.js 14
- DB: MongoDB (mongoose) for chat history/users/servers; PostgreSQL (Drizzle) available but unused
- AI: Groq, Gemini, Nvidia — multi-key per provider with automatic failover on rate limit
- Dashboard: React + Vite + Tailwind + shadcn/ui
- Validation: Zod, Orval-generated React Query hooks
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/` — Express API + Discord bot
  - `lib/bot.ts` — Discord bot logic (message handler, slash commands, random pings, new member greet)
  - `lib/ai-router.ts` — Multi-provider AI routing with key rotation + fallback
  - `lib/models.ts` — Mongoose models (ChatHistory, BotUser, ServerConfig, ApiKey, Personality)
  - `lib/personality.ts` — Personality cache + default system prompt
  - `lib/auth.ts` — JWT auth for dashboard
  - `routes/` — All API route handlers
- `artifacts/dashboard/src/` — Owner dashboard React app
  - `pages/` — login, dashboard, servers, server-detail, users, user-detail, api-keys, personality
  - `components/layout.tsx` — Sidebar + navigation layout
  - `lib/api.ts` — Auth token setup (setAuthTokenGetter)
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth)

## Architecture decisions

- MongoDB used for all bot data (chat history, users, servers, API keys, personality) — flexible schema needed for Discord data
- Multi-key API rotation: keys sorted by error count + last used; on rate limit, increments error count and tries next key, then falls back to next provider
- Chat history kept per (userId, guildId) pair — same user has separate history per server AND in DMs
- Dashboard auth via JWT stored in localStorage — token injected via `setAuthTokenGetter` from `@workspace/api-client-react`
- Bot ignores messages unless: DM, bot is @mentioned, or message is a reply to bot

## Product

- **Priya** — Sassy Hinglish AI Discord bot that responds in English-alphabet Hindi (Hinglish)
- Remembers users' past 1 week of chat history per server
- NSFW mode per-channel via `/nsfw enable:true/false` command
- Users can `/reset` their own chat history
- Truth & dare via `/truth` and `/dare` slash commands
- Randomly pings members to start conversations
- Greets new members when they join
- Refuses to admit she's an AI

## Discord Commands

- `/nsfw enable:true/false` — Enable/disable NSFW in a channel (requires Manage Channels or owner)
- `/reset` — Reset your personal chat history with Priya
- `/truth` — Ask Priya for a truth question
- `/dare` — Ask Priya for a dare

## Dashboard Access

- URL: `/dashboard/`
- Password: value of `DASHBOARD_SECRET` environment variable
- Shows: overview stats, all servers, all users + chat history, API key management, personality editor

## User Portal

- URL: `/dashboard/portal`
- Login: Discord OAuth (users log in with their Discord account)
- Requires: `DISCORD_CLIENT_ID` + `DISCORD_CLIENT_SECRET` in secrets
- Features: view chat history per server, reset history, set nickname/pronouns/vibe/language
- Personal settings affect how Priya talks to that user across ALL servers
- User must have chatted with Priya at least once on Discord to use the portal

## User preferences

- Bot name: Priya
- Language: Hinglish (Hindi written in English alphabets)
- Personality: sassy, flirty, shy, bossy, short replies, very rarely uses emojis
- Bot claims to be human if asked

## Gotchas

- Must set `DISCORD_BOT_TOKEN`, `MONGODB_URI`, `OWNER_DISCORD_ID`, `DASHBOARD_SECRET`, and at least one AI key
- For the user portal: set `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` from Discord Developer Portal → OAuth2 tab; add redirect URI `https://<your-domain>/api/auth/discord/callback` in Discord app settings
- API keys from env vars (`GROQ_API_KEY_1`, `GEMINI_API_KEY_1`, `NVIDIA_API_KEY_1`) are seeded into MongoDB on first run
- After adding keys via dashboard, they take effect immediately without restart
- Bot needs `MESSAGE_CONTENT` intent enabled in Discord Developer Portal

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
