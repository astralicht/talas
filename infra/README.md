# Local infrastructure

`docker compose -f infra/docker-compose.yml up -d` starts MongoDB (single-node
replica set `rs0`), Redis, MinIO, ClamAV, and MailHog. Copy `.env.example` to
`.env.local`, then run `pnpm db:seed` and `pnpm dev` / `pnpm worker:dev`.

| Service | Address | Notes |
|---|---|---|
| MongoDB | `localhost:27017` | Replica set required for transactions |
| Redis | `localhost:6379` | Queue and shared rate limits |
| MinIO | `localhost:9000` | Console at `localhost:9001`; bucket `talas-local` |
| ClamAV | `localhost:3310` | `clamd` INSTREAM endpoint |
| MailHog | `localhost:1025` SMTP, `localhost:8025` UI | Captured email |

The web image uses Next.js standalone output. The worker image runs the same
repository code through `tsx` and is limited to one process per container.
