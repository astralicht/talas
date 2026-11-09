# Implementation Plan: Production Deployment

**Branch**: `004-production-deployment` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-production-deployment/spec.md`

## Summary

Ship the existing container images to a running production system: a web service
(Next.js standalone), a worker (BullMQ consumer with ClamAV sidecar), external
managed services, and a TLS reverse proxy. This plan intentionally stops at the
target-agnostic layer and records the decisions that pick a concrete host.

## Technical Context

**Runtime**: Node.js 20 containers (existing `infra/Dockerfile.web` producing
`.next/standalone`; existing `infra/Dockerfile.worker` exposing
`pnpm worker:start`), pnpm 9 lockfile

**Services (external)**: MongoDB Atlas (SRV), Redis 7, any S3-compatible object
store, Resend for transactional email, ClamAV daemon (sidecar by default)

**New artifacts**: `infra/docker-compose.prod.yml`, `DEPLOY.md`,
(optionally) `.env.production.example` with placeholder values only

**Open Questions**: the [Open Decisions](./spec.md#open-decisions-blocks-implementation)
in the spec — hosting target, provisioners, ClamAV topology.

## Constitution Check (no amendment required)

| Principle / Section | Gate | How this plan satisfies it | Status |
|---|---|---|---|
| Transport and Headers | HTTPS-only, HSTS ≥ 6 months, CSP, no wildcard CORS | Caddy/Nginx terminates TLS; middleware + `next.config.ts` already emit HSTS and CSP nonces; `CORS_ALLOWED_ORIGINS` set to the prod origin only | PASS (verify at runtime) |
| Secrets and Dependencies | No committed secrets; lockfile; audits in CI | Env-only configuration; `pnpm-lock.yaml` committed; CI runs `pnpm audit` + Gitleaks; deploy from green pipeline | PASS |
| Data Lifecycle and Privacy | Backups encrypted/retained; audit 90-day TTL; deletion cascade | Atlas backup config documented in DEPLOY.md; audit TTL ships with the schema; worker owns the 30-day cascade | PASS (to verify after deploy) |
| Error Handling and Logging | Structured logs, correlation IDs, no secrets | `pino` JSON logs in both processes; correlation propagated through middleware | PASS (to verify in dev first) |
| Testing & Quality Gates | Deploy from a green pipeline | `ci.yml` gates stand in as the merge gate; feature 003's pending contract suite must be green first | **Gate open — blocked by 003 T007/T008** |

## Deployment Topology (target-agnostic)

```
            ┌────────────┐        ┌────────────────┐
 Internet → │ TLS proxy  │──────▶│ web (standalone │
            │ (Caddy)    │        │  :3000)        │
            └────────────┘        └───────┬────────┘
                                          │ MongoDB Atlas / Redis
            ┌────────────┐   job queue  │ S3-compatible
            │  worker    │◀─────────────┘
            │ (BullMQ)   │──▶ ClamAV sidecar (3310)   ──▶ object storage
            └────────────┘    (parse → scan → generate)
```

Defaults per container come from `.env.example` with `NODE_ENV=production`;
cookie security flags and `secure: true` flip automatically.

## Deployment Order

1. Provision externals (Atlas, Redis, bucket, Resend domain, ClamAV).
2. Generate three secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
   `CSRF_SECRET`) with `openssl rand -hex 32`; store in the secret manager.
3. Build both images from a green CI commit.
4. Write the production composition + environment mapping (T001–T003 below).
5. `docker compose -f infra/docker-compose.prod.yml up -d` (or platform
   equivalent).
6. Bootstrap indexes once (`pnpm db indexes` semantics through the worker image)
   then verify (smoke test in spec scenarios 1–4).
7. Confirm hardening end-to-end: headers, HSTS, CSP nonce, cookie flags.

## Testing Strategy

- **Smoke journey** is the acceptance test: health → register → real-email
  verify → upload → lesson flagged ready → renewal hop works after idle.
- **Security spot-checks** against the deployed origin: header presence,
  401/403 envelopes, rate-limit 429s, cross-tenant 404 behavior.

## Rollout

Blue/green or rolling per service; web is stateless and may be scaled
horizontally behind the proxy; worker count scales via `WORKER_CONCURRENCY`.
No data migrations beyond the one-time index bootstrap.
