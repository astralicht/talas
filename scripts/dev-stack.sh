#!/usr/bin/env bash
# No-Docker dev stack for Talas: MongoDB 7 (replica set) + Redis + SeaweedFS S3.
#
# scripts/dev-stack.sh start [--seed] [--fresh]
# scripts/dev-stack.sh stop | status | env | seed
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
S3_PORT="${S3_PORT:-9002}"
DATA_DIR="${DATA_DIR:-$REPO_ROOT/.data/dev-stack}"
MONGO_VERSION="${MONGO_VERSION:-7.0.14}"
WEED_VERSION="${WEED_VERSION:-4.53}"

MONGO_DIR="$DATA_DIR/mongo"
LOG_DIR="$DATA_DIR/logs"
mkdir -p "$MONGO_DIR" "$DATA_DIR/weed" "$LOG_DIR"

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
  aarch64|arm64) MONGO_ARCH="aarch64-ubuntu2204"; WEED_ARCH="arm64" ;;
  x86_64|amd64)  MONGO_ARCH="x86_64-debian12";    WEED_ARCH="amd64" ;;
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

resolve_weed() {
  if [[ -n "${WEED_BIN:-}" && -x "$WEED_BIN" ]]; then echo "$WEED_BIN"; return; fi
  if command -v weed >/dev/null 2>&1; then command -v weed; return; fi
  if [[ -x "$DATA_DIR/weed/weed" ]]; then echo "$DATA_DIR/weed/weed"; return; fi
  if [[ -x /opt/weed/weed ]]; then echo /opt/weed/weed; return; fi
  log "Downloading SeaweedFS $WEED_VERSION (linux_$WEED_ARCH)..."
  curl -fsSL "https://github.com/seaweedfs/seaweedfs/releases/download/${WEED_VERSION}/linux_${WEED_ARCH}.tar.gz" \
    -o "$DATA_DIR/weed.tar.gz"
  tar -xzf "$DATA_DIR/weed.tar.gz" -C "$DATA_DIR/weed" weed
  chmod +x "$DATA_DIR/weed/weed"
  rm -f "$DATA_DIR/weed.tar.gz"
  echo "$DATA_DIR/weed/weed"
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

start_s3() {
  local weed; weed="$(resolve_weed)"
  if port_open 127.0.0.1 "$S3_PORT"; then
    log "S3 already running at http://127.0.0.1:$S3_PORT"
  else
    # Clear stale instances from a previous unclean stop (they hold the master
    # port 9333 even when the S3 port is free, and the bind failure is silent).
    pkill -9 -f '[w]eed server' 2>/dev/null || true
    sleep 1
    log "Starting SeaweedFS S3 ($weed, data in $DATA_DIR/weed)..."
    nohup "$weed" server -dir "$DATA_DIR/weed" -ip 127.0.0.1 -s3 -s3.port "$S3_PORT" \
      > "$LOG_DIR/weed.log" 2>&1 &
    echo $! > "$DATA_DIR/weed.pid"
    for _ in $(seq 1 30); do
      port_open 127.0.0.1 "$S3_PORT" && break
      sleep 1
    done
    port_open 127.0.0.1 "$S3_PORT" || die "SeaweedFS did not open port $S3_PORT (see $LOG_DIR/weed.log)"
    log "S3 ready at http://127.0.0.1:$S3_PORT (bucket talas-local)"
  fi
  # Create the bucket and set browser-upload CORS (idempotent). Requires
  # @aws-sdk/client-s3 from node_modules, so run through pnpm exec.
  S3_ENDPOINT="http://127.0.0.1:$S3_PORT" S3_KEY="talas" S3_SECRET="talas-local-secret" \
    S3_BUCKET="talas-local" S3_REGION="us-east-1" \
    pnpm exec node --input-type=module -e '
    import { S3Client, CreateBucketCommand, PutBucketCorsCommand } from "@aws-sdk/client-s3";
    const client = new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: process.env.S3_KEY, secretAccessKey: process.env.S3_SECRET },
    });
    try { await client.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET })); console.log("bucket created"); }
    catch (e) { if (!/BucketAlready|already exists/i.test(String(e.name ?? e))) throw e; }
    await client.send(new PutBucketCorsCommand({
      Bucket: process.env.S3_BUCKET,
      CORSConfiguration: { CORSRules: [{
        AllowedOrigins: ["*"], AllowedMethods: ["PUT", "GET", "HEAD"],
        AllowedHeaders: ["*"], ExposeHeaders: ["ETag"], MaxAgeSeconds: 3600,
      }] },
    }));
    console.log("bucket CORS configured");
  '
  log "Bucket talas-local + CORS verified"
}

# ---------------------------------------------------------------- env file

print_env() {
  local a r c
  a="$(openssl rand -hex 24 2>/dev/null || echo dev-access-secret-please-replace-me-123456)"
  r="$(openssl rand -hex 24 2>/dev/null || echo dev-refresh-secret-please-replace-me-12345)"
  c="$(openssl rand -hex 24 2>/dev/null || echo dev-csrf-secret-please-replace-me-123456)"
  cat <<EOF
NODE_ENV=development
APP_URL=http://localhost:3000

DATABASE_URL=mongodb://127.0.0.1:$MONGO_PORT/talas?replicaSet=rs0
REDIS_URL=redis://127.0.0.1:$REDIS_PORT

S3_ENDPOINT=http://127.0.0.1:$S3_PORT
S3_REGION=us-east-1
S3_BUCKET=talas-local
S3_ACCESS_KEY_ID=talas
S3_SECRET_ACCESS_KEY=talas-local-secret
S3_FORCE_PATH_STYLE=true
S3_FAKE=false

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
CORS_ALLOWED_ORIGINS=http://localhost:3000
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

cmd_status() {
  local ok=1
  port_open 127.0.0.1 "$MONGO_PORT" && echo "mongo   : up   (mongodb://127.0.0.1:$MONGO_PORT, rs0)" || { echo "mongo   : down"; ok=0; }
  [[ "$(redis-cli -p "$REDIS_PORT" ping 2>/dev/null || true)" == "PONG" ]] && echo "redis   : up   (redis://127.0.0.1:$REDIS_PORT)" || { echo "redis   : down"; ok=0; }
  port_open 127.0.0.1 "$S3_PORT" && echo "s3      : up   (http://127.0.0.1:$S3_PORT, bucket talas-local)" || { echo "s3      : down"; ok=0; }
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
  if [[ -f "$DATA_DIR/weed.pid" ]] && kill -0 "$(cat "$DATA_DIR/weed.pid")" 2>/dev/null; then
    kill "$(cat "$DATA_DIR/weed.pid")" 2>/dev/null || true
    released="$released seaweedfs"
  fi
  rm -f "$DATA_DIR/weed.pid"
  pgrep -f '[w]eed server' >/dev/null 2>&1 && pkill -f '[w]eed server' 2>/dev/null || true
  # Dying daemons accept TCP connects during shutdown grace; wait until every
  # port actually refuses connections so an immediately following start does
  # not mistake the death rattle for a live service.
  for _ in $(seq 1 20); do
    local busy=0
    if port_open 127.0.0.1 "$MONGO_PORT" || port_open 127.0.0.1 "$REDIS_PORT" || port_open 127.0.0.1 "$S3_PORT"; then
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
    rm -rf "$MONGO_DIR" "$DATA_DIR/weed"
    mkdir -p "$MONGO_DIR" "$DATA_DIR/weed"
    log "Wiped service data (--fresh)"
  fi
  start_mongo
  start_redis
  start_s3
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
  *) die "Usage: scripts/dev-stack.sh start [--seed] [--fresh] | stop | status | env | seed" ;;
esac
