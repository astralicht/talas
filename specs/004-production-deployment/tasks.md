---
description: "Tasks for Production Deployment — target-agnostic scaffolding"
---

# Tasks: Production Deployment

**Input**: Design documents from `specs/004-production-deployment/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), constitution v1.3.0

**Blocker**: [Open Decisions](./spec.md#open-decisions) — T004+ MUST NOT start
until the hosting target and external provisioners are chosen. Everything
through T003 is target-agnostic.

**Tests**: The acceptance journey is the deployed smoke test; no new
application code is required by this feature.

---

## Phase 1: Target-Agnostic Artifacts

- [ ] T001 Create `infra/docker-compose.prod.yml` with four services — `web`
      (image `talas-web`, `GET /api/health` healthcheck), `worker`
      (image `talas-worker`, depends_on web optional), `clamav`
      (`clamav/clamav`, sidecar next to the worker), and `caddy` with a
      minimal `Caddyfile` (TLS on demand, proxy → `web:3000`, forward
      `X-Forwarded-For/Proto`).
- [ ] T002 Write `DEPLOY.md` at the repo root: step-by-step op runbook
      (provision externals → generate secrets with `openssl rand -hex 32` →
      build images → `docker compose -f infra/docker-compose.prod.yml up -d` →
      `pnpm db:indexes` once → smoke test) plus the constitution-mandated
      operational notes (HSTS/CSP verification, backup schedule for Atlas,
      90-day audit TTL confirmation, log inspection).
- [ ] T003 [P] Create `.env.production.example` mirroring `.env.example` with
      `NODE_ENV=production`, `EMAIL_TRANSPORT=resend`,
      `S3_FORCE_PATH_STYLE=false`, placeholder-only values, and the
      never-commit warning.

## Phase 2: Target-Specific (blocked on Open Decisions)

- [ ] T004 Depending on the chosen target, either (a) verify the compose stack
      end-to-end on the deployment VM (ports, DNS, firewall, TLS issuance), or
      (b) document the platform-mapped equivalent (web on the platform runtime,
      worker VM/cluster with ClamAV co-location).
- [ ] T005 Record external-service ownership/region/DR notes in `DEPLOY.md`
      (Atlas tier, Redis SKU, bucket lifecycle rules, Resend domain).

## Phase 3: Post-Deploy Verification

- [ ] T006 Run the acceptance journey: health → register → real-email verify →
      upload → scan/parse/generate → lesson read view → download original →
      silent renewal after idle.
- [ ] T007 Spot-check hardening in production: security headers through the
      proxy, 401/403 error envelopes, rate-limit 429 with `Retry-After`,
      cross-tenant 404s, audit-log TTL.
- [ ] T008 Configure/verify Atlas backups (encrypted, ≥30-day retention option)
      and confirm the deletion cascade reaches stored objects in production.

---

## Notes

- Blockers first: feature 003's contract suite and quality gates (T007/T008
  in `specs/003-session-renewal/tasks.md`) MUST be green before any deploy;
  deploying auth-critical middleware with an open test gate would violate the
  constitution's Testing & Quality Gates section.
- Images must be built from a commit where the constitution's Sync Impact
  Report comments have been removed (governance rule).
