#!/bin/bash
# ── Priya Bot — Pterodactyl Startup Script ──────────────────────────────────
# Uses PRE-BUILT files — no pnpm, no build step, starts in seconds.
# Only installs @napi-rs/canvas (native image library) on first run.
# ─────────────────────────────────────────────────────────────────────────────

set -e

# Always run from THIS script's directory so relative paths work
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load .env from server root (one level up from pterodactyl/)
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
if [ -f "$ROOT_DIR/.env" ]; then
  echo "[startup] Loading .env..."
  set -a
  source "$ROOT_DIR/.env"
  set +a
elif [ -f ".env" ]; then
  set -a
  source ".env"
  set +a
fi

export PORT="${PORT:-8080}"
export NODE_ENV="${NODE_ENV:-production}"
# Dashboard static files live next to this script
export DASHBOARD_STATIC_PATH="$SCRIPT_DIR/dashboard-dist"

echo "[startup] Node: $(node --version)"
echo "[startup] PORT=$PORT"
echo "[startup] Dashboard: $DASHBOARD_STATIC_PATH"

# Install ONLY the one native package needed (everything else is pre-bundled)
if [ ! -d "node_modules/@napi-rs/canvas" ]; then
  echo "[startup] First run — installing @napi-rs/canvas (30-60 seconds)..."
  npm install --omit=dev --prefer-offline 2>&1 || npm install --omit=dev 2>&1
  echo "[startup] Done installing."
else
  echo "[startup] Native deps already present, skipping install."
fi

# Launch the pre-built bot + dashboard
echo "[startup] Starting Priya Bot on port $PORT..."
exec node dist/index.mjs
