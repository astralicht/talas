# Feature Specification: Production Deployment

**Feature Branch**: `004-production-deployment`

**Created**: 2026-11-09

**Status**: Draft (hosting target not yet selected — see Open Decisions)

**Constitution**: No amendment required; existing "Transport and Headers,"
"Secrets and Dependencies," and "Data Lifecycle and Privacy" sections govern the
deployment and are mapped in [plan.md](./plan.md).

**Input**: User description: "How do I deploy this?"

## User Story — Deploy Talas to a Running System (Priority: P2)

An operator takes the two container images the repo already builds
(`infra/Dockerfile.web`, `infra/Dockerfile.worker`), wires them to managed
external services, and ends up with a reachable, healthy, smoke-tested
production system.

**Why this priority**: The application is feature-complete for the MVP scope
and stable only locally; shipping is blocked entirely on this.

**Independent Test**: From a clean environment, following only the deployment
document, an operator reaches `/api/health` over TLS, registers and verifies an
account through real email, uploads a material, and receives a generated lesson —
without touching the codebase.

**Acceptance Scenarios**:

1. **Given** the configured external services, **When** the web and worker
   containers start, **Then** `/api/health` returns 200 through the TLS proxy
   and the worker reports a connected queue and database in its logs.
2. **Given** a fresh database, **When** the operator runs the index-bootstrap
   command once, **Then** tenant-scoped/compound indexes exist for all
   tenant collections.
3. **Given** an unregistered visitor, **When** they register with an email
   address on a real domain, **Then** they receive the verification email
   through the production transport.
4. **Given** a verified account, **When** they upload a supported material,
   **Then** the worker scans (ClamAV reachable), parses, and generates a lesson
   end-to-end within the performance goals.
5. **Given** any access-token expiry, **When** the user navigates back,
   **Then** the silent renewal hop works in production (see
   `specs/003-session-renewal`).

## Requirements

### Functional

- FR-1: Two deployable units MUST exist — web (standalone Next server, port
  3000) and worker (`pnpm worker:start`) — matching the existing Dockerfiles.
- FR-2: A production composition file MUST define web, worker, ClamAV sidecar,
  and a TLS reverse proxy, using environment-only configuration.
- FR-3: Every secret MUST be supplied through the container environment;
  images MUST NOT contain credentials (they are build-time `--secret`-free today).
- FR-4: The reverse proxy MUST terminate TLS and forward
  `X-Forwarded-For`/`X-Forwarded-Proto` so rate limiting, client IP, and HSTS
  behave correctly.
- FR-5: Health endpoints/commands MUST be usable for orchestration probes:
  `GET /api/health` for web; worker liveness via process + queue connection.
- FR-6: A documented post-deploy bootstrap MUST apply database indexes
  (`pnpm db:indexes`) exactly once per environment.

### Non-Functional

- NFR-1: The stack MUST hold the constitution's operational commitments:
  HTTPS-only with HSTS, structured logs without PII/secrets, 90-day audit
  retention, 30-day deletion cascade including backups.
- NFR-2: Dependency audits and secret scans run in CI (existing workflow) and a
  deploy SHOULD only be triggered from a green pipeline.

## Open Decisions (block implementation)

1. **Hosting target** — single VM with Docker Compose (matches the repo
   as-is and is the working default), managed web (e.g. Vercel) + worker VM, or
   Kubernetes.
2. **External provisioners** — MongoDB Atlas (mandated), Redis, S3-compatible
   bucket, Resend: which services/regions, and who owns them?
3. **ClamAV** — sidecar container (default) or a managed/remote daemon
   (`CLAMAV_HOST` already abstracts this).
4. **Trade-off** — worker scans are CPU-bound; the target must either place
   ClamAV close to the worker or budget network latency accordingly.

## Checklists

### Crossing Concerns

- [ ] Security headers verified end-to-end through the proxy (not stripped).
- [ ] `CORS_ALLOWED_ORIGINS` matches the production origin.
- [ ] Email domain verified with the transport provider.

### Data Lifecycle

- [ ] Backup/restore procedure for Atlas documented (30-day encrypted backup
      requirement).
- [ ] Audit-log TTL (90 days) confirmed in production.
