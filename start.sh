#!/bin/bash
set -e

# ── Priya Bot — Single-File Startup Script ──────────────────────────────────
# Runs on Pterodactyl (or any Linux server with Node.js 20+ and pnpm)
# Usage: bash start.sh
# All config lives in .env — copy .env.example → .env and fill in values.
# ────────────────────────────────────────────────────────────────────────────

# Load .env if it exists
if [ -f ".env" ]; then
  echo "[startup] Loading .env..."
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Defaults
export PORT="${PORT:-8080}"
export NODE_ENV="${NODE_ENV:-production}"

echo "[startup] Node: $(node --version)"
echo "[startup] PORT=$PORT"

# ── Install dependencies ────────────────────────────────────────────────────
echo "[startup] Installing dependencies..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# ── Build dashboard (React → static files) ─────────────────────────────────
echo "[startup] Building dashboard..."
export BASE_PATH="${BASE_PATH:-/}"
(cd artifacts/dashboard && pnpm build)

# ── Build API server (TypeScript → bundled JS) ─────────────────────────────
echo "[startup] Building API server..."
(cd artifacts/api-server && pnpm build)

# ── Start everything ────────────────────────────────────────────────────────
echo "[startup] Starting Priya Bot on port $PORT..."
exec node --enable-source-maps artifacts/api-server/dist/index.mjs
