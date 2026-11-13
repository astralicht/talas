#!/usr/bin/env bash
# Linux dev services for Talas (bash counterpart of scripts/dev-services.ps1).
# Starts Mongo 7 (replica set) and Redis 8 in Docker; optionally MinIO for S3.
#
# Usage: scripts/dev-services.sh [--with-minio]
# Env:  MONGO_PORT (default 27098), REDIS_PORT (default 6399),
#       MINIO_API_PORT (default 9002), MINIO_CONSOLE_PORT (default 9003),
#       DATA_DIR (default .data/dev-services)
#
# Mongo data lives on the host filesystem (mount), so container storage stays
# tiny on machines where the root filesystem is nearly full.
set -euo pipefail

MONGO_PORT="${MONGO_PORT:-27098}"
REDIS_PORT="${REDIS_PORT:-6399}"
MINIO_API_PORT="${MINIO_API_PORT:-9002}"
MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-9003}"
DATA_DIR="${DATA_DIR:-.data/dev-services}"

WITH_MINIO=false
for arg in "$@"; do
  case "$arg" in
    --with-minio) WITH_MINIO=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

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

if [[ "$WITH_MINIO" == "true" ]]; then
  if ! docker ps --format '{{.Names}}' | grep -q talas-dev-s3; then
    docker rm -f talas-dev-s3 > /dev/null 2>&1 || true
    mkdir -p "$DATA_DIR/rustfs"
    chmod 777 "$DATA_DIR/rustfs"
    # RustFS: S3-compatible object store (docker hub access to MinIO images is
    # not available everywhere; rustfs ships the same API surface).
    docker run -d --name talas-dev-s3 \
      -p "$MINIO_API_PORT:9000" \
      -v "$PWD/$DATA_DIR/rustfs:/data" \
      -e RUSTFS_ACCESS_KEY=talas -e RUSTFS_SECRET_KEY=talas-local-secret \
      rustfs/rustfs:latest > /dev/null
    echo "RustFS (S3) ready at http://127.0.0.1:$MINIO_API_PORT (access key talas)"
  else
    echo "RustFS (S3) already running at http://127.0.0.1:$MINIO_API_PORT"
  fi

  # One-time: allow the browser to PUT presigned uploads and GET downloads
  # cross-origin from the app origin (production S3 needs the same bucket CORS).
  node --input-type=module -e "
    import { S3Client, PutBucketCorsCommand } from '@aws-sdk/client-s3';
    const client = new S3Client({
      region: 'us-east-1',
      endpoint: 'http://127.0.0.1:$MINIO_API_PORT',
      forcePathStyle: true,
      credentials: { accessKeyId: 'talas', secretAccessKey: 'talas-local-secret' },
    });
    await client.send(new PutBucketCorsCommand({
      Bucket: 'talas-local',
      CORSConfiguration: {
        CORSRules: [{
          AllowedOrigins: ['*'],
          AllowedMethods: ['PUT', 'GET', 'HEAD'],
          AllowedHeaders: ['*'],
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3600,
        }],
      },
    }));
    console.log('Bucket CORS configured for talas-local');
  " 2>/dev/null || echo "Bucket CORS setup skipped (run again once the bucket exists)"
fi

echo ""
echo "Development env (add to .env.local):"
echo "  DATABASE_URL=mongodb://127.0.0.1:$MONGO_PORT/talas?replicaSet=rs0"
echo "  REDIS_URL=redis://127.0.0.1:$REDIS_PORT"
if [[ "$WITH_MINIO" == "true" ]]; then
  echo "  S3_ENDPOINT=http://127.0.0.1:$MINIO_API_PORT"
  echo "  S3_BUCKET=talas-local"
  echo "  S3_ACCESS_KEY_ID=talas"
  echo "  S3_SECRET_ACCESS_KEY=talas-local-secret"
  echo "  S3_FORCE_PATH_STYLE=true"
  echo "  S3_FAKE=false"
fi