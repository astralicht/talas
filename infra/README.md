# Local infrastructure

`docker compose -f infra/docker-compose.yml up -d` starts MongoDB (single-node
replica set `rs0`) and Redis. Object storage is GridFS inside the MongoDB
database itself (TODO step 11) — there is no S3 container to run. Copy
`.env.example` to `.env.local`, then run `pnpm db:seed` and `pnpm dev` /
`pnpm worker:dev`.

| Service | Address | Notes |
|---|---|---|
| MongoDB | `localhost:27017` | Replica set required for transactions; also stores all uploaded files via GridFS (`objects` bucket) |
| Redis | `localhost:6379` | Queue and shared rate limits |

The web image uses Next.js standalone output. The worker image runs the same
repository code through `tsx` and is limited to one process per container.
