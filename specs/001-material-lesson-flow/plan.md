# Implementation Plan: Account and Material-to-Lesson Flow

**Branch**: `001-material-lesson-flow` | **Date**: 2026-11-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-material-lesson-flow/spec.md`

## Summary

Deliver the Talas walking skeleton: verified email/password accounts, a strictly
tenant-isolated workspace, secure upload of PDF/DOCX/Markdown/text study materials,
asynchronous AI generation of structured Markdown lessons, and a Markdown editor with
autosave, revisions, and conflict detection. The architecture is a Next.js App Router
web application backed by MongoDB Atlas, Redis, and S3-compatible object storage, with a
separate worker process for parsing, malware scanning, and model calls. All security
controls from constitution v1.1.0 are enforced and verified by automated tests.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20 LTS (strict mode)

**Primary Dependencies**: Next.js 15 (App Router), React 19, Tailwind CSS 4, shadcn/ui,
Mongoose 8, Zod 4, `jose`, `argon2`, BullMQ, ioredis, `rate-limiter-flexible`,
Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/google`), `pdfjs-dist`, `mammoth`,
`file-type`, `isomorphic-dompurify`, `react-markdown`, `remark-gfm`,
`@uiw/react-md-editor`, `@react-email/components`, `pino`, Resend

**Storage**: MongoDB Atlas 7.x via Mongoose; Redis 7 for job queues and shared rate
limits; S3-compatible object storage for private uploads

**Testing**: Vitest 3 (unit), Supertest in URL mode against a Next.js test server plus
Testcontainers MongoDB/Redis (integration and contract), Playwright 1.x (end-to-end),
`mongodb-memory-server` for fast unit fixtures

**Target Platform**: Linux x86_64 containers for web and worker; evergreen browsers for
the client

**Project Type**: Full-stack web application with a background worker

**Performance Goals**: p95 lesson generation within 2 minutes for 20-page/25 MB
documents; autosave acknowledgement within 2 seconds; API p95 under 300 ms excluding AI
work; 100 concurrent signed-in users without errors

**Constraints**: 25 MB upload cap; 200-page and 2M-character extraction cap; 15-minute
single-object presigned URLs; 10 uploads/hour and 5/minute per user; 32,768 input and
4,096 output tokens per model call; $2.00 per-user daily AI budget; 30-day deletion
cascade; 90-day audit log retention; HTTPS-only with HSTS and CSP

**Scale/Scope**: 1,000 registered users, 100 concurrent users, 10,000 materials and
lessons, single region, 14 primary screens

**Open Questions**: None. All unknowns are resolved in [research.md](./research.md).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / Section | Gate | How this plan satisfies it | Status |
|---|---|---|---|
| I. Zero-Trust Strict Input Validation | Every route, worker input, and env var validated; unknown keys rejected | Zod schemas per route and per worker message; `lib/validation` shared by web and worker; strict env validation; 400 envelope with correlation ID | PASS |
| II. Tenant Data Isolation | Centralized authorization, session-derived `userId`, ownership checks, compound indexes, cross-tenant tests | `requireUser()` guard plus tenant-scoped repository helpers; every query includes `userId`; update/delete re-check ownership; compound indexes on all tenant collections; security test suite for user A vs user B. Pre-session credential lookups (email, token hash) return no tenant content and are documented, rate-limited, and audited. This feature exposes no administrative surface; any future admin access must be explicit and audited. | PASS |
| III. Anti-XSS and Output Sanitization | Sanitize on render and after edits; no raw HTML; safe URL schemes | `react-markdown` without raw-HTML rehype; `isomorphic-dompurify` on save and server render; client DOMPurify at display; no unsanitized `dangerouslySetInnerHTML`; CSP | PASS |
| IV. File Upload Security & Resource Control | Magic-byte MIME, allowlist, 25 MB, malware scan, isolated parser, presigned URLs, rate limits, token/cost caps | `file-type` verification at confirm; presigned PUT 15 min with type/size conditions; ClamAV scan; worker container with CPU/memory/time limits; Redis rate limiter; per-call token caps and daily budget. The constitution's `/api/process-material` limit is enforced on the equivalent `POST /api/materials` confirm and presign operations; `/api/chat` is deferred to its own feature. | PASS |
| V. Verified Security and Test-First Delivery | Tests first; security tests; CI gates; coverage thresholds | Vitest/Supertest/Playwright suites written before implementation; mandatory security matrix; GitHub Actions gates; 80% changed-line and 100% branch on security modules | PASS |
| Technology Stack Constraints | Mandated stack | Next.js App Router route handlers, React, TypeScript strict, Tailwind, shadcn/ui, MongoDB Atlas/Mongoose with schema validators, AI SDK with OpenAI default and Gemini fallback, Argon2id, and an explicit CORS allowlist. Helmet's Express middleware is replaced by the App Router-native equivalent header set (HSTS, CSP with nonces, frame and MIME protections) because Helmet's default CSP is incompatible with Next.js hydration; intent is preserved and verified by header tests. | PASS |
| Core Workflows & Feature Standards | Async pipeline, structured output, autosave/revisions, grounding | BullMQ job with persisted states and idempotent retry; structured lesson schema validated before save; editor autosave + revisions + optimistic concurrency; chatbot deferred, grounding rules recorded for its future feature | PASS |
| Security & Data Lifecycle | Auth hardening, CSRF, transport, secrets, logging, deletion, backups, privacy, budgets | `jose` access tokens (15 min) + rotating hashed refresh tokens (7 days); CSRF double-submit; HSTS/CSP/CORS; env-only secrets; pino structured logs + audit events; deletion cascade worker; encrypted backups; provider data-use review; daily budget | PASS |
| Testing & Quality Gates | CI gates and coverage | Lint, typecheck, unit, integration, build, dependency audit, secret scan on every PR; E2E on main and critical PRs; coverage enforced | PASS |
| Governance | Plan and PR review | This plan and its artifacts are the review input; post-design re-check recorded below | PASS |

**Post-Design Re-Check (Phase 1)**: PASS. The data model adds `userId` to every
tenant-scoped collection with leading compound indexes, the OpenAPI contract requires
session cookies and CSRF headers on state-changing routes, and the quickstart includes
cross-tenant and XSS validation scenarios. No new violations or complexity exceptions
were introduced.

## Project Structure

### Documentation (this feature)

```text
specs/001-material-lesson-flow/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── openapi.yaml
├── checklists/
│   └── requirements.md
└── tasks.md              # created later by /speckit.tasks
```

### Source Code (repository root)

```text
app/
├── (auth)/
│   ├── login/
│   ├── register/
│   ├── verify-email/
│   ├── forgot-password/
│   └── reset-password/
├── (app)/
│   ├── dashboard/
│   ├── materials/
│   │   ├── new/
│   │   └── [materialId]/
│   ├── lessons/
│   │   └── [lessonId]/
│   └── settings/
├── api/
│   ├── auth/
│   │   ├── register/
│   │   ├── verify-email/
│   │   ├── resend-verification/
│   │   ├── login/
│   │   ├── logout/
│   │   ├── refresh/
│   │   ├── forgot-password/
│   │   ├── reset-password/
│   │   └── csrf/
│   ├── health/
│   ├── me/
│   ├── materials/
│   │   ├── presign/
│   │   ├── route.ts
│   │   └── [materialId]/
│   │       ├── route.ts
│   │       ├── status/
│   │       └── retry/
│   ├── lessons/
│   │   ├── route.ts
│   │   └── [lessonId]/
│   │       ├── route.ts
│   │       └── revisions/
│   └── account/
│       ├── route.ts
│       └── export/
├── layout.tsx
├── page.tsx
└── globals.css

components/
├── ui/                   # shadcn/ui primitives
├── auth/
├── materials/
├── lessons/
└── editor/

hooks/                    # client polling, autosave, session refresh

lib/
├── auth/                 # jwt, password, session, csrf, verification gate
├── db/                   # connection, models, tenant repositories
├── validation/           # Zod schemas shared by web and worker
├── storage/              # presign, object verification
├── security/             # sanitize, rate-limit, malware client
├── ai/                   # provider abstraction, prompts, schema, budget
├── parsing/              # pdf, docx, text extraction, quality checks
├── jobs/                 # queues, producers, schemas
├── logging/              # pino logger, correlation IDs, audit
├── http/                 # handler wrapper, error envelope, client
├── email/                # sender adapter and templates
├── account/              # export service
├── materials/            # failure messages, deletion service
├── lessons/              # save and revision services
└── env.ts

worker/
├── index.ts
├── processors/
│   ├── scan-material.ts
│   ├── parse-material.ts
│   ├── generate-lesson.ts
│   └── delete-account.ts
└── runtime/              # resource limits and shutdown handling

tests/
├── fixtures/
├── unit/
├── integration/
├── contract/
├── security/
└── e2e/

scripts/                  # openapi lint, index sync, seed
docs/                     # architecture, operations, security, validation
infra/
├── docker-compose.yml    # MongoDB, Redis, MinIO, ClamAV, MailHog
├── Dockerfile.web
├── Dockerfile.worker
└── README.md
railway.json              # web and worker deployment manifests
.github/workflows/
├── ci.yml
└── e2e.yml
```

**Structure Decision**: A single Next.js application provides the UI and route handlers,
while a separate worker container consumes BullMQ jobs for malware scanning, parsing, AI
generation, and account deletion. Shared code under `lib/` keeps validation, models,
authorization, and sanitization identical across both processes. Tests are split by
layer so the security suite can run independently in CI.

## Complexity Tracking

No constitution violations and no complexity exceptions are requested. The two-process
design is the minimum structure that satisfies the constitution's isolation and
long-running-job requirements: route handlers cannot safely perform untrusted parsing or
multi-minute AI calls inside request lifecycles.
