#!/usr/bin/env bash
# No-Docker dev stack for Talas: MongoDB 7 (replica set) + Redis. Object
# storage is GridFS inside the database itself (TODO step 11), so there is no
# third service anymore.
#
# scripts/dev-stack.sh start [--seed] [--fresh]
# scripts/dev-stack.sh stop | status | env | seed | tunnel
#
# `tunnel` exposes the web app through ngrok (https://ngrok.com/download).
# With NGROK_DOMAIN empty in .env.local you get a random free URL (it changes
# on every restart); set NGROK_DOMAIN=<name>.ngrok-free.app for a static
# domain after claiming it once at dashboard.ngrok.com/domains.
#
# Use this when Docker is unavailable (ARM boxes, restricted sandboxes). It is
# the daemon counterpart of scripts/dev-services.sh: same ports and URLs, but
# binaries run directly and live under .data/dev-stack (gitignored).
#
# Binaries are resolved in order: env override -> PATH -> .data/dev-stack ->
# well-known /opt locations -> automatic download (curl + tar required).
#
# The web app reads .env.local via Next.js; the worker does not load it, so
# source it before `pnpm worker:dev` (the `env` subcommand writes the file).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

MONGO_PORT="${MONGO_PORT:-27098}"
REDIS_PORT="${REDIS_PORT:-6399}"
DATA_DIR="${DATA_DIR:-$REPO_ROOT/.data/dev-stack}"
MONGO_VERSION="${MONGO_VERSION:-7.0.14}"

MONGO_DIR="$DATA_DIR/mongo"
LOG_DIR="$DATA_DIR/logs"
mkdir -p "$MONGO_DIR" "$LOG_DIR"

log() { echo "[dev-stack] $*"; }
die() { echo "[dev-stack] ERROR: $*" >&2; exit 1; }

port_open() { # host port -> exit 0 when a TCP connection succeeds
  node -e "
    const net = require('net');
    const socket = net.connect({ host: process.argv[1], port: Number(process.argv[2]), timeout: 1500 });
    socket.on('connect', () => { console.log('open'); process.exit(0); });
    socket.on('error', () => process.exit(1));
    socket.on('timeout', () => process.exit(1));
  " "$1" "$2" >/dev/null 2>&1
}

# ---------------------------------------------------------------- binaries

case "$(uname -m)" in
  aarch64|arm64) MONGO_ARCH="aarch64-ubuntu2204" ;;
  x86_64|amd64)  MONGO_ARCH="x86_64-debian12" ;;
  *) die "Unsupported architecture: $(uname -m)" ;;
esac

resolve_mongod() {
  if [[ -n "${MONGO_BIN:-}" && -x "$MONGO_BIN" ]]; then echo "$MONGO_BIN"; return; fi
  if command -v mongod >/dev/null 2>&1; then command -v mongod; return; fi
  if [[ -x "$DATA_DIR/mongo-dist/bin/mongod" ]]; then echo "$DATA_DIR/mongo-dist/bin/mongod"; return; fi
  if [[ -x /opt/mongo/bin/mongod ]]; then echo /opt/mongo/bin/mongod; return; fi
  log "Downloading MongoDB $MONGO_VERSION ($MONGO_ARCH)..."
  curl -fsSL "https://fastdl.mongodb.org/linux/mongodb-linux-${MONGO_ARCH}-${MONGO_VERSION}.tgz" \
    -o "$DATA_DIR/mongo.tgz"
  mkdir -p "$DATA_DIR/mongo-dist"
  tar -xzf "$DATA_DIR/mongo.tgz" -C "$DATA_DIR/mongo-dist" --strip-components=1
  rm -f "$DATA_DIR/mongo.tgz"
  echo "$DATA_DIR/mongo-dist/bin/mongod"
}

# ---------------------------------------------------------------- services

start_mongo() {
  local mongod; mongod="$(resolve_mongod)"
  if port_open 127.0.0.1 "$MONGO_PORT"; then
    log "Mongo already running at mongodb://127.0.0.1:$MONGO_PORT/talas?replicaSet=rs0"
  else
    log "Starting mongod ($mongod, data in $MONGO_DIR)..."
    "$mongod" --replSet rs0 --port "$MONGO_PORT" --bind_ip 127.0.0.1 \
      --dbpath "$MONGO_DIR" --fork \
      --logpath "$LOG_DIR/mongod.log" \
      --pidfilepath "$DATA_DIR/mongod.pid" >/dev/null
    port_open 127.0.0.1 "$MONGO_PORT" || die "mongod did not open port $MONGO_PORT (see $LOG_DIR/mongod.log)"
    log "Mongo ready at mongodb://127.0.0.1:$MONGO_PORT/talas?replicaSet=rs0"
  fi
  # Initiate the replica set (idempotent) and wait for a writable primary.
  # Shared with the Windows stack: scripts/init-replica-set.mjs.
  MONGO_URI="mongodb://127.0.0.1:$MONGO_PORT" MONGO_HOST="127.0.0.1:$MONGO_PORT" \
    pnpm exec node scripts/init-replica-set.mjs
}

start_redis() {
  command -v redis-server >/dev/null 2>&1 || die "redis-server not found (Debian/Ubuntu: apt-get install redis-server)"
  if [[ "$(redis-cli -p "$REDIS_PORT" ping 2>/dev/null || true)" == "PONG" ]]; then
    log "Redis already running at redis://127.0.0.1:$REDIS_PORT"
    return
  fi
  log "Starting redis-server on port $REDIS_PORT..."
  redis-server --port "$REDIS_PORT" --bind 127.0.0.1 --daemonize yes \
    --dir "$DATA_DIR" --pidfile "$DATA_DIR/redis.pid" --logfile "$LOG_DIR/redis.log"
  [[ "$(redis-cli -p "$REDIS_PORT" ping 2>/dev/null || true)" == "PONG" ]] || die "redis did not answer PING (see $LOG_DIR/redis.log)"
  log "Redis ready at redis://127.0.0.1:$REDIS_PORT"
}

# ---------------------------------------------------------------- env file

print_env() {
  local a r c t cors
  a="$(openssl rand -hex 24 2>/dev/null || echo dev-access-secret-please-replace-me-123456)"
  r="$(openssl rand -hex 24 2>/dev/null || echo dev-refresh-secret-please-replace-me-12345)"
  c="$(openssl rand -hex 24 2>/dev/null || echo dev-csrf-secret-please-replace-me-123456)"
  # NGROK_DOMAIN is inherited from the caller's environment when regenerating
  # the template; normally set it directly in .env.local (see cmd_tunnel).
  t="${NGROK_DOMAIN:-}"
  cors="http://localhost:3000"
  if [[ -n "$t" ]]; then cors="$cors,https://$t"; fi
  cat <<EOF
NODE_ENV=development
APP_URL=http://localhost:3000

DATABASE_URL=mongodb://127.0.0.1:$MONGO_PORT/talas?replicaSet=rs0
REDIS_URL=redis://127.0.0.1:$REDIS_PORT

CLAMAV_FAKE=clean

JWT_ACCESS_SECRET=$a
JWT_REFRESH_SECRET=$r
CSRF_SECRET=$c

AI_PROVIDER=openai
AI_DAILY_BUDGET_USD=2.00
AI_FAULT_INJECTION=false
AI_FAKE_LESSON=true

EMAIL_TRANSPORT=memory
EMAIL_FROM="Talas <no-reply@talas.local>"

LOG_LEVEL=debug
NGROK_DOMAIN=$t
CORS_ALLOWED_ORIGINS=$cors
WORKER_CONCURRENCY=2
MAX_JOB_MS=120000
EOF
}

# ---------------------------------------------------------------- commands

seed_db() {
  [[ -f .env.local ]] || die "No .env.local yet. Run: scripts/dev-stack.sh env > .env.local"
  set -a; . ./.env.local; set +a
  pnpm db:indexes
  pnpm db:seed
}

cmd_tunnel() {
  [[ -f .env.local ]] || die "No .env.local yet. Run: scripts/dev-stack.sh env > .env.local"
  set -a; . ./.env.local; set +a
  command -v ngrok >/dev/null 2>&1 \
    || die "ngrok not found. Install it (https://ngrok.com/download): e.g. snap install ngrok or brew install ngrok"
  if ! port_open 127.0.0.1 3000; then
    log "Web is not listening on port 3000 - start it first: pnpm dev"
  fi
  if [[ -n "${NGROK_DOMAIN:-}" ]]; then
    if [[ -n "${CORS_ALLOWED_ORIGINS:-}" && "${CORS_ALLOWED_ORIGINS}" != *"https://$NGROK_DOMAIN"* ]]; then
      log "Note: add https://$NGROK_DOMAIN to CORS_ALLOWED_ORIGINS in .env.local to also allow cross-origin API calls (browsing through the tunnel needs no change)."
    fi
    log "Starting ngrok: https://$NGROK_DOMAIN -> http://localhost:3000 (Ctrl+C to stop)"
    exec ngrok http 3000 --domain="$NGROK_DOMAIN"
  else
    log "Starting ngrok with a random free URL (changes on every restart; set NGROK_DOMAIN in .env.local for a static domain once claimed)..."
    log 'The public URL appears in the ngrok output below ("Forwarding https://...").'
    exec ngrok http 3000
  fi
}

cmd_status() {
  local ok=1
  port_open 127.0.0.1 "$MONGO_PORT" && echo "mongo   : up   (mongodb://127.0.0.1:$MONGO_PORT, rs0)" || { echo "mongo   : down"; ok=0; }
  [[ "$(redis-cli -p "$REDIS_PORT" ping 2>/dev/null || true)" == "PONG" ]] && echo "redis   : up   (redis://127.0.0.1:$REDIS_PORT)" || { echo "redis   : down"; ok=0; }
  if [[ -f .next/dev-server-info || -n "$(pgrep -f '[n]ext dev' || true)" ]]; then
    echo "web     : up   (pnpm dev, http://localhost:3000)"
  else
    echo "web     : down (run: pnpm dev)"; ok=0
  fi
  if pgrep -f '[t]sx watch worker/index.ts' >/dev/null 2>&1; then
    echo "worker  : up   (pnpm worker:dev)"
  else
    echo "worker  : down (run: set -a; . .env.local; set +a; pnpm worker:dev)"; ok=0
  fi
  # Optional, never fails the status: the tunnel is a user-level process. The
  # real public URL comes from ngrok's local inspection API (works for random
  # and static domains alike).
  local ngrok_pid tunnel_url
  ngrok_pid="$(pgrep -x ngrok 2>/dev/null | head -n1 || true)"
  if [[ -n "$ngrok_pid" ]]; then
    tunnel_url="$(curl -fsS --max-time 2 http://127.0.0.1:4040/api/tunnels 2>/dev/null \
      | node -e 'let raw="";process.stdin.on("data",(c)=>(raw+=c));process.stdin.on("end",()=>{try{const t=JSON.parse(raw).tunnels.filter((x)=>x.proto==="https");if(t.length>0)console.log(t[0].public_url);}catch{}});' \
      || true)"
    if [[ -n "$tunnel_url" ]]; then
      echo "tunnel  : up   (ngrok, $tunnel_url)"
    else
      echo "tunnel  : up   (ngrok, endpoint starting)"
    fi
  else
    echo "tunnel  : down (optional, run: scripts/dev-stack.sh tunnel)"
  fi
  [[ "$ok" == 1 ]] || exit 1
}

cmd_stop() {
  local released=""
  if [[ -f "$DATA_DIR/mongod.pid" ]] && kill -0 "$(cat "$DATA_DIR/mongod.pid")" 2>/dev/null; then
    kill "$(cat "$DATA_DIR/mongod.pid")" 2>/dev/null || true
    released=mongo
    rm -f "$DATA_DIR/mongod.pid"
  fi
  rm -f "$DATA_DIR/mongod.pid"
  if redis-cli -p "$REDIS_PORT" shutdown nosave >/dev/null 2>&1; then
    released="$released redis"
  fi
  # Dying daemons accept TCP connects during shutdown grace; wait until every
  # port actually refuses connections so an immediately following start does
  # not mistake the death rattle for a live service.
  for _ in $(seq 1 20); do
    local busy=0
    if port_open 127.0.0.1 "$MONGO_PORT" || port_open 127.0.0.1 "$REDIS_PORT"; then
      busy=1; sleep 1
    else
      break
    fi
  done
  [[ -n "$released" ]] && log "Stopped:$released"
  log "Note: web (pnpm dev) and worker (pnpm worker:dev) are app processes; stop them separately."
}

cmd_start() {
  local seed=false fresh=false
  for arg in "$@"; do
    case "$arg" in
      --seed) seed=true ;;
      --fresh) fresh=true ;;
      *) die "Unknown argument: $arg" ;;
    esac
  done
  if [[ "$fresh" == true ]]; then
    cmd_stop >/dev/null 2>&1 || true
    rm -rf "$MONGO_DIR"
    mkdir -p "$MONGO_DIR"
    log "Wiped service data (--fresh)"
  fi
  start_mongo
  start_redis
  if [[ "$seed" == true ]]; then
    log "Syncing indexes and seeding demo accounts..."
    seed_db
    log "Seeded: alice@talas.local / bob@talas.local (password talas-local-password)"
  fi
  echo ""
  if [[ ! -f .env.local ]]; then
    log "No .env.local found — create one:"
    log "  scripts/dev-stack.sh env > .env.local"
  fi
  echo "Next steps:"
  echo "  pnpm dev                                    # web at http://localhost:3000"
  echo "  set -a; . .env.local; set +a; pnpm worker:dev  # worker (needs env sourced)"
  echo "  scripts/dev-stack.sh seed                   # indexes + demo accounts (idempotent)"
  echo "Logs: $LOG_DIR"
}

case "${1:-}" in
  start) shift; cmd_start "$@" ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  env) print_env ;;
  seed) seed_db ;;
  tunnel) cmd_tunnel ;;
  *) die "Usage: scripts/dev-stack.sh start [--seed] [--fresh] | stop | status | env | seed | tunnel" ;;
esac
