# Phase 0 Research: Account and Material-to-Lesson Flow

**Feature**: `001-material-lesson-flow`
**Date**: 2026-11-07
**Status**: Complete — no unresolved clarification items

## 1. Runtime and Application Framework

**Decision**: TypeScript 5.x in strict mode on Node.js 20 LTS, using Next.js 15 with the
App Router for both UI and route handlers.

**Rationale**: The constitution mandates Next.js App Router, React, and TypeScript
strict. Node.js 20 LTS is the mandated floor and remains supported. App Router route
handlers avoid a second HTTP framework and keep validation, auth, and tenant scoping in
one codebase.

**Alternatives considered**:
- Separate Express service: allowed by the constitution only through an approved plan;
  adds a network boundary and duplicated middleware without benefit for the walking
  skeleton.
- Node.js 22 LTS: acceptable, but 20 LTS is the lowest supported version and maximizes
  deployment compatibility.

## 2. Authentication and Session Management

**Decision**: Custom email/password authentication using `argon2` (Argon2id) for hashing,
`jose` for signed JWTs, a 15-minute access token, and a 7-day rotating refresh token
stored as a SHA-256 hash in MongoDB. Tokens are delivered in `HttpOnly`, `Secure`,
`SameSite=Lax` cookies. State-changing requests require a double-submit CSRF token. Email
verification and password reset use single-use, hashed tokens.

**Rationale**: Constitution v1.1.0 requires access tokens of at most 15 minutes, rotating
refresh tokens of at most 7 days stored hashed, CSRF protection for cookie sessions,
Argon2id or bcrypt cost 12, single-use reset tokens expiring in 30 minutes, and session
invalidation on logout or password change. A small, explicit JWT implementation meets
each requirement directly.

**Alternatives considered**:
- NextAuth.js/Auth.js: strong default integrations, but its JWT session model does not
  natively rotate refresh tokens with hashed storage, which would require custom
  callbacks and still diverge from the constitution's token requirements.
- Database-only opaque sessions: simpler revocation, but does not provide the
  access/refresh token pair the constitution specifies.
- bcrypt: permitted, but Argon2id is the preferred option in the constitution.

## 3. Data Layer and Tenant Isolation

**Decision**: MongoDB Atlas 7.x with Mongoose 8. A single `getTenantModel`/repository
layer requires a `userId` argument and injects it into every query. Route handlers call
`requireUser()` and pass the session user ID; client-supplied owner IDs are ignored.
Every tenant collection has a compound index beginning with `userId`.

**Rationale**: Constitution Principle II requires explicit `userId` filtering, a
centralized guard, ownership checks, compound indexes, and deny-by-default behavior.
Repository enforcement removes the chance that a single handler forgets a filter.

**Alternatives considered**:
- Per-handler filters: rejected because one omission creates a cross-tenant breach.
- MongoDB row-level security: not available natively.
- Separate database per tenant: strong isolation but disproportionate operational cost
  for a single-user-per-workspace MVP.

**Documented exception**: Authentication lookups (user by normalized email, refresh or
reset token by hash) necessarily occur before a session exists. These queries return
only credential material, never tenant content, are rate-limited, and are audited. Once a
session exists, every tenant query is scoped by the session's `userId`.

## 4. Upload Flow and Object Storage

**Decision**: Two-step upload. `POST /api/materials/presign` creates a `Material` record in
`awaiting_upload` and returns a single-object presigned S3 PUT URL valid for 15 minutes
with content-type and content-length conditions. `POST /api/materials` confirms the
upload, verifies the stored object, and enqueues scanning and parsing. Objects are
private, server-side encrypted, and never publicly readable.

**Rationale**: Constitution Principle IV requires short-lived, single-object presigned
URLs, type and size constraints, and no public access. The confirmation step prevents a
client from claiming a successful upload that does not exist or exceeds limits.

**Alternatives considered**:
- Proxying uploads through the web server: simpler but consumes request memory and
  bandwidth and weakens the 25 MB and timeout boundaries.
- Direct public uploads: violates the private-storage requirement.
- Long-lived URLs: violates the 15-minute expiry requirement.

## 5. Malware Scanning

**Decision**: ClamAV (`clamd`) runs as a dedicated local service. The worker streams each
uploaded object to ClamAV before parsing. If the scanner is unavailable, the material
fails closed with `scan_unavailable` and is retried; it is never parsed unscanned.

**Rationale**: Constitution Principle IV requires malware scanning before parsing. Fail
closed prevents an availability outage from becoming a security bypass.

**Alternatives considered**:
- VirusTotal or another cloud scanner: sends user documents to a third party and adds a
  data-processing dependency.
- Extension-only checks: explicitly forbidden by the constitution.
- Skipping scanning for small files: no security basis.

## 6. Asynchronous Processing and Job Queue

**Decision**: BullMQ on Redis 7, with one worker container. Jobs are keyed by material ID
and use a unique job ID so retries are idempotent. The worker persists status transitions
(`queued`, `processing`, `ready`, `failed`) to MongoDB and uses bounded exponential
backoff with a maximum of three attempts. A lease/heartbeat prevents duplicate processing.

**Rationale**: Parsing and AI calls exceed typical request lifetimes, and the
constitution requires isolated parsing with hard resource limits. Redis is also required
for shared rate limiting, so BullMQ adds no new infrastructure category. Unique job IDs
prevent duplicate lessons on retry.

**Alternatives considered**:
- In-request processing: risks timeouts and violates the isolated-worker requirement.
- Managed queues (SQS, Inngest, Trigger.dev): viable, but add a vendor and another
  credential surface; BullMQ keeps the MVP self-contained.
- MongoDB-backed polling queue: avoids Redis but offers weaker locking and retry
  semantics; Redis is already required.

## 7. Document Parsing and Resource Limits

**Decision**: `pdfjs-dist` for PDF text extraction, `mammoth` for DOCX, and direct reads
for Markdown and plain text. The worker enforces a 200-page limit, a 2,000,000-character
extraction cap, a 120-second per-job timeout, and a 1 GB memory ceiling. PDFs whose extracted text is
below 200 non-whitespace characters total, or below 100 characters per page on average,
are classified as image-only and rejected with the OCR message.

**Rationale**: Constitution Principle IV requires isolated parsing with hard CPU,
memory, and timeout limits, and the spec requires image-only rejection. Pure-JavaScript
parsers avoid native binaries and reduce the attack surface inside the worker.

**Alternatives considered**:
- `pdf-parse`: thin wrapper with less active maintenance and weaker error reporting.
- LibreOffice headless: powerful but large, slow, and a high-risk parser surface.
- OCR pipeline: explicitly out of scope for this feature.

## 8. AI Lesson Generation

**Decision**: Vercel AI SDK with a provider abstraction: OpenAI GPT-4o as the default and
Google Gemini as the fallback. `generateObject` uses a Zod schema for the lesson
(`title`, `summary`, `sections[]` with heading and Markdown body, optional tables/lists).
The worker converts the validated object to Markdown deterministically. Untrusted
document text is wrapped in explicit delimiters with instructions to treat it as data.
Per-request limits are 32,768 input tokens and 4,096 output tokens; the per-user daily
budget is $2.00.

**Rationale**: Constitution Principle I requires validated inputs before model calls,
Principle IV requires prompt-injection resistance and token/cost caps, and the workflows
section requires schema-validated output. Structured generation prevents malformed or
partially rendered lessons and keeps Markdown construction under application control.

**Alternatives considered**:
- Free-form Markdown generation: harder to validate and more prone to broken output.
- Direct provider SDKs: duplicates retry, schema, and fallback logic.
- No fallback provider: a single provider outage would block all generation.

## 9. Markdown Rendering and Sanitization

**Decision**: `react-markdown` with `remark-gfm` renders lessons and previews. Raw HTML is
not enabled (`rehype-raw` is not used). The server sanitizes content with
`isomorphic-dompurify` before persistence and before server rendering; the client runs
DOMPurify again before display. Allowed URL schemes are limited to `http`, `https`, and
`mailto`. A strict Content-Security-Policy is applied.

**Rationale**: Constitution Principle III names DOMPurify and requires sanitization on
render and after every edit. Using a renderer that does not interpret raw HTML removes an
entire class of injection, and defense-in-depth sanitization covers manually saved
content.

**Alternatives considered**:
- `rehype-raw` plus `rehype-sanitize`: workable but enables raw HTML parsing and requires
  careful allowlists; rejecting raw HTML is safer for an MVP.
- `sanitize-html`: viable server-side, but the constitution explicitly names DOMPurify.
- Client-only sanitization: insufficient against stored payloads and other consumers.

## 10. Markdown Editor

**Decision**: `@uiw/react-md-editor` (CodeMirror 6 based) with a side-by-side preview using
the same `react-markdown` renderer, plus accessible toolbar controls and keyboard
shortcuts. Autosave is debounced at 1.5 seconds and coalesced; explicit save remains
available.

**Rationale**: The constitution requires a maintained Markdown editor with CommonMark,
live preview, and keyboard-only operation. Reusing the renderer guarantees preview and
saved output match.

**Alternatives considered**:
- Monaco: excellent code editing but heavy and less Markdown-focused.
- TipTap: rich-text-first; Markdown round-tripping is lossy.
- Plain textarea: fails the live-preview and editing-experience expectation.

## 11. Rate Limiting

**Decision**: `rate-limiter-flexible` backed by Redis, applied per authenticated user and
per IP for authentication routes. Limits: uploads 10/hour and 5/minute per user; chat
60/hour and 5/minute per user (reserved for the future feature); login 5 failures per
15 minutes per account and 10 attempts per 15 minutes per IP. Responses return HTTP 429
with `Retry-After` and a correlation ID.

**Rationale**: Constitution Principle IV requires shared-store rate limits with exact
values and `Retry-After` behavior. Redis already supports the job queue.

**Alternatives considered**:
- In-memory counters: fail across multiple instances and restarts.
- API gateway limits only: cannot enforce per-user quotas for authenticated endpoints.

## 12. Email Delivery

**Decision**: Resend behind a small `EmailSender` interface, with React Email templates for
verification and password reset. The interface allows an SMTP/SES implementation without
changing feature code.

**Rationale**: The spec depends on deliverable verification and reset emails. An adapter
keeps the provider replaceable and testable with a local MailHog transport.

**Alternatives considered**:
- Direct SMTP via Nodemailer: portable but requires more deliverability configuration.
- AWS SES: strong fit if already on AWS, but adds IAM setup; supported later through the
  same interface.

## 13. Validation, Configuration, and Errors

**Decision**: Zod 4 schemas for every request body, query, path, and worker message.
Environment variables are validated at process start with a Zod schema. A single error
envelope returns `code`, `message`, `correlationId`, and optional field errors; internal
details are logged, never returned.

**Rationale**: Constitution Principle I requires strict validation before business logic
and safe 400 responses. Validating worker messages prevents a compromised or malformed
queue entry from bypassing HTTP-layer checks. Startup env validation prevents insecure
defaults.

**Alternatives considered**:
- Ad hoc checks: untestable and easy to omit.
- Validation only at the HTTP edge: leaves the worker trust boundary open.

## 14. Observability and Audit Logging

**Decision**: `pino` structured JSON logs with a per-request correlation ID propagated to
workers. Audit events are stored in MongoDB for authentication, authorization denials,
account changes, and destructive actions, retained for 90 days. Sensitive fields
(passwords, tokens, full prompts, file contents) are redacted.

**Rationale**: Constitution Principle IV and the Security & Data Lifecycle section require
structured logs, correlation, audit of auth events and denials, 90-day retention, and no
sensitive data in logs. Correlation IDs make cross-process debugging possible.

**Alternatives considered**:
- Plain console logging: unstructured and hard to query.
- Full prompt logging: leaks user content and violates the privacy rule.
- Third-party APM: useful later, but not required for the MVP.

## 15. Testing Strategy and CI Gates

**Decision**: Vitest for unit tests, Supertest in URL mode against a Next.js test server
for route-handler contract tests, Testcontainers for MongoDB and Redis integration tests,
and Playwright for end-to-end journeys. A dedicated security suite covers validation rejection, XSS payloads,
cross-tenant access, MIME spoofing, oversized uploads, unauthorized routes, and rate
limits. GitHub Actions runs lint, typecheck, unit, integration, build, `pnpm audit
--audit-level=high`, and Gitleaks on every pull request; Playwright runs on main and on
PRs touching auth, upload, or editor code.

**Rationale**: Constitution Principle V requires test-first delivery, mandatory security
tests, CI gates, 80% changed-line coverage, and 100% branch coverage on authorization,
validation, sanitization, and upload modules. Layered tests give fast feedback while the
security suite proves the non-negotiable controls.

**Alternatives considered**:
- Jest: viable, but Vitest is faster with the TypeScript/ESM stack and shares Vite
  configuration.
- Mock-only integration tests: cannot verify compound indexes or Redis rate-limit
  behavior.
- Manual security review only: violates the automated-test requirement.

## 16. Deployment Topology

**Decision**: Two containers (web and worker) on Railway, MongoDB Atlas, AWS S3, Railway
Redis, and Resend. Docker Compose provides the equivalent local stack (MongoDB, Redis,
MinIO, ClamAV, MailHog). Secrets are injected as environment variables from the platform
secret store.

**Rationale**: The two-process design maps directly to the web and worker containers.
Railway supports both services and managed Redis with minimal operational overhead.
Atlas is mandated, S3 satisfies presigned uploads, and Resend covers email.

**Alternatives considered**:
- Vercel for web plus Fly.io for worker: viable but splits deployment and secret
  management across two platforms.
- Kubernetes: unnecessary complexity for an MVP.
- Single container running both processes: couples scaling and complicates graceful
  shutdown and resource limits for parsing.

## 17. Backup and Data Lifecycle

**Decision**: MongoDB Atlas continuous backups with encryption at rest, S3 versioning
disabled (to honor deletion), and a 30-day backup retention window. Account deletion
enqueues a cascade job that removes materials, lessons, revisions, audit references,
stored objects, and (when added) embeddings. Exports produce a ZIP of JSON metadata and
Markdown lessons.

**Rationale**: The constitution requires encrypted backups, deletion within 30 days,
export before deletion, and removal of derived data. A queued cascade handles large
accounts without blocking the request.

**Alternatives considered**:
- Synchronous deletion: risks request timeouts and partial cleanup.
- Soft deletion without purge: violates the 30-day removal requirement.
- Infinite backups: conflicts with deletion obligations.

## 18. Security Headers and CORS

**Decision**: Set HSTS with `max-age` of at least 15,552,000 seconds (six months) and
`includeSubDomains`, CSP with per-request nonces, `X-Content-Type-Options`,
`X-Frame-Options`/frame-ancestors, `Referrer-Policy`, and `Permissions-Policy` through
`next.config.ts` and middleware. Configure CORS from an explicit allowlist of the web
origin and local development origin; wildcard origins are never combined with
credentials. Header presence and values are asserted in integration tests.

**Rationale**: The constitution names Helmet for secure HTTP headers. Helmet is Express
middleware, and its default CSP breaks Next.js hydration scripts. The App Router-native
header configuration provides the same protections without a custom Express server or a
weakened CSP. Using a nonce-based policy keeps inline Next.js bootstrap scripts working
while blocking injected scripts.

**Alternatives considered**:
- Express custom server with Helmet: literal compliance but adds an HTTP server wrapper
  and requires relaxing Helmet's CSP for Next.js, with more operational surface.
- Helmet defaults with CSP disabled: loses a key defense and does not satisfy the intent.
- No explicit CORS configuration: risks credentialed wildcard behavior.

## 19. Constitution Endpoint Mapping

**Decision**: Map the constitution's named endpoints to the API surface in this feature:

| Constitution name | This feature |
|---|---|
| `/api/process-material` rate limit | `POST /api/materials` (confirm) and `POST /api/materials/presign`, both limited to 10/hour and 5/minute per user |
| `/api/chat` rate limit | Reserved; the chat feature will implement 60/hour and 5/minute per user |

**Rationale**: The constitution's intent is that material-processing and chat operations
cannot be abused. The walking skeleton exposes upload as a two-step presign/confirm flow,
so the limit is enforced at both steps. The chat endpoint does not exist until its own
specification, at which point the reserved limit applies.

**Alternatives considered**:
- Adding `/api/process-material` as an alias: creates two write paths and doubles the
  surface to secure.
- Deferring the limit until chat exists: unacceptable for the upload path.

