#!/usr/bin/env bash
# Linux dev services for Talas (bash counterpart of scripts/dev-services.ps1).
# Starts Mongo 7 (replica set) and Redis in Docker. Object storage is GridFS
# inside the database (TODO step 11), so there is no S3 container anymore.
#
# Usage: scripts/dev-services.sh
# Env:  MONGO_PORT (default 27098), REDIS_PORT (default 6399),
#       DATA_DIR (default .data/dev-services)
#
# Mongo data lives on the host filesystem (mount), so container storage stays
# tiny on machines where the root filesystem is nearly full.
set -euo pipefail

MONGO_PORT="${MONGO_PORT:-27098}"
REDIS_PORT="${REDIS_PORT:-6399}"
DATA_DIR="${DATA_DIR:-.data/dev-services}"

mkdir -p "$DATA_DIR/mongo"

if ! docker ps --format '{{.Names}}' | grep -q talas-dev-mongo; then
  docker rm -f talas-dev-mongo > /dev/null 2>&1 || true
  # Host networking: mongod announces its listening address to the replica-set
  # config, and a port-mapped container would announce an unresolvable inner
  # name. With --network host the announced 127.0.0.1:PORT works for everyone.
  docker run -d --name talas-dev-mongo --network host \
    -v "$PWD/$DATA_DIR/mongo:/data/db" \
    mongo:7 --replSet rs0 --port "$MONGO_PORT" --bind_ip 127.0.0.1 > /dev/null
  echo "Waiting for mongod (data directory on the host disk; can take a while)..."
  ready=""
  for attempt in $(seq 1 60); do
    if docker exec talas-dev-mongo mongosh --quiet --host 127.0.0.1:"$MONGO_PORT" --eval 'db.runCommand({ ping: 1 }).ok' > /dev/null 2>&1; then
      ready=yes
      break
    fi
    sleep 2
  done
  if [[ -z "$ready" ]]; then
    echo "mongod did not become ready in time; check: docker logs talas-dev-mongo" >&2
    exit 1
  fi
  # Announce a host-reachable address so drivers on the host resolve the set.
  docker exec talas-dev-mongo mongosh --quiet --host 127.0.0.1:"$MONGO_PORT" --eval \
    "rs.initiate({_id: 'rs0', members: [{_id: 0, host: '127.0.0.1:$MONGO_PORT'}]}).ok" \
    > /dev/null
  sleep 2
  echo "Mongo ready at mongodb://127.0.0.1:$MONGO_PORT/talas?replicaSet=rs0"
else
  echo "Mongo already running at mongodb://127.0.0.1:$MONGO_PORT/talas?replicaSet=rs0"
fi

if ! docker ps --format '{{.Names}}' | grep -q talas-dev-redis; then
  docker rm -f talas-dev-redis > /dev/null 2>&1 || true
  docker run -d --name talas-dev-redis -p "$REDIS_PORT:6379" redis:7 > /dev/null
  echo "Redis ready at redis://127.0.0.1:$REDIS_PORT"
else
  echo "Redis already running at redis://127.0.0.1:$REDIS_PORT"
fi

echo ""
echo "Development env (add to .env.local):"
echo "  DATABASE_URL=mongodb://127.0.0.1:$MONGO_PORT/talas?replicaSet=rs0"
echo "  REDIS_URL=redis://127.0.0.1:$REDIS_PORT"