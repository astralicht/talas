---
description: "Dependency-ordered implementation tasks for the Account and Material-to-Lesson flow"
---

# Tasks: Account and Material-to-Lesson Flow

**Input**: Design documents from `specs/001-material-lesson-flow/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/openapi.yaml](./contracts/openapi.yaml),
[quickstart.md](./quickstart.md)

**Tests**: Required. Constitution v1.1.0, Principle V mandates test-first delivery and a
mandatory security test matrix. Every test task below MUST be written and observed failing
before the matching implementation task begins.

**Organization**: Tasks are grouped by user story so each story is independently
verifiable. This walking skeleton has a real dependency chain: US1 establishes identity
and the tenant boundary, US2 consumes that boundary for uploads and generation, and US3
edits the lesson US2 produces.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Owning user story (`US1`, `US2`, `US3`); omitted in Setup, Foundational,
  and Polish phases
- Every task names the exact file or files it changes

## Path Conventions

Paths follow [plan.md](./plan.md#source-code-repository-root):

- `app/` — Next.js App Router pages and route handlers
- `components/`, `hooks/` — React UI and client hooks
- `lib/` — shared server and client modules
- `worker/` — BullMQ worker process and processors
- `tests/` — `unit/`, `integration/`, `contract/`, `security/`, `e2e/`
- `infra/`, `scripts/`, `.github/workflows/` — local stack, tooling, CI

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize the Next.js application, tooling, local services, and CI shell.

- [ ] T001 Create the project skeleton and initialize Next.js 15 App Router with React 19 and TypeScript strict mode in `package.json`, `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/page.tsx`, and `app/globals.css`
- [ ] T002 Install the runtime dependencies named in `plan.md`: Next.js 15, React 19, Tailwind CSS 4, shadcn/ui, Mongoose 8, Zod 4, `jose`, `argon2`, BullMQ, `ioredis`, `rate-limiter-flexible`, `ai`, `@ai-sdk/openai`, `@ai-sdk/google`, `pdfjs-dist`, `mammoth`, `file-type`, `isomorphic-dompurify`, `react-markdown`, `remark-gfm`, `@uiw/react-md-editor`, `@react-email/components`, `pino`, and Resend in `package.json`, and commit `pnpm-lock.yaml`
- [ ] T003 [P] Configure ESLint and Prettier with strict TypeScript rules in `eslint.config.mjs`, `.prettierrc`, and `.prettierignore`
- [ ] T004 [P] Configure Vitest with `tests/setup.ts`, MongoDB memory server helpers, and path aliases in `vitest.config.ts`
- [ ] T005 [P] Configure Playwright with a `webServer` entry for the app and a Chromium project in `playwright.config.ts`
- [ ] T006 [P] Create the Zod-validated environment schema for every variable listed in `quickstart.md` and a committed template with no secrets in `lib/env.ts` and `.env.example`
- [ ] T007 [P] Create the local stack with a single-node MongoDB replica set `rs0` (transactions), Redis 7, MinIO, ClamAV, and MailHog in `infra/docker-compose.yml`
- [ ] T008 [P] Create separate production images for the web and worker processes in `infra/Dockerfile.web` and `infra/Dockerfile.worker`
- [ ] T009 [P] Implement the structured JSON logger and request correlation context in `lib/logging/logger.ts` and `lib/logging/correlation.ts`
- [ ] T010 [P] Implement the shared safe error envelope (`code`, `message`, `correlationId`, optional `fields`) and JSON response helpers in `lib/http/errors.ts` and `lib/http/responses.ts`
- [ ] T011 [P] Add an OpenAPI lint script that parses and resolves `specs/001-material-lesson-flow/contracts/openapi.yaml`, wired as `pnpm openapi:lint` in `scripts/lint-openapi.ts` and `package.json`
- [ ] T012 [P] Create the CI workflow with lint, typecheck, unit, integration, build, `pnpm audit --audit-level=high`, and Gitleaks gates, MongoDB/Redis service containers, and `.gitleaks.toml` in `.github/workflows/ci.yml`
- [ ] T013 [P] Create shared test fixtures for users, materials, lessons, and S3/MinIO objects in `tests/fixtures/users.ts`, `tests/fixtures/materials.ts`, `tests/fixtures/lessons.ts`, and `tests/fixtures/storage.ts`
- [ ] T014 [P] Add repository hygiene files: `.gitignore` (ignoring `.env*` except `.env.example`), `.editorconfig`, and `.nvmrc` pinned to Node 20

**Checkpoint**: Tooling, local services, and CI shell exist; no product behavior yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Data layer, tenant boundary, shared validation, security primitives, queue
plumbing, and worker bootstrap required by every user story.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T015 Implement the MongoDB connection with transaction support and test database switching in `lib/db/connection.ts`
- [ ] T016 [P] Create the `User` Mongoose model with `email` "lowercase, trimmed, unique, max 254 chars", `passwordHash` "Argon2id, `select: false`", `emailVerifiedAt`, `status` enum `active | disabled | deleting | deleted`, `failedLoginAttempts`, `lockedUntil`, and `deletedAt`; indexes `{ email: 1 }` unique and `{ status: 1, deletedAt: 1 }` in `lib/db/models/user.ts`
- [ ] T017 [P] Create the `RefreshToken` model with unique `tokenHash` "SHA-256 hex", `expiresAt` "at most 7 days after creation", `revokedAt`, `replacedByTokenId`, and `ipHash`/`userAgentHash`; indexes `{ tokenHash: 1 }` unique, `{ userId: 1, revokedAt: 1 }`, and TTL `{ expiresAt: 1 }` with `expireAfterSeconds: 0` in `lib/db/models/refresh-token.ts`
- [ ] T018 [P] Create the `EmailVerificationToken` model with unique `tokenHash`, `expiresAt` "24 hours after creation", and `consumedAt` single use; indexes `{ tokenHash: 1 }` unique, `{ userId: 1, consumedAt: 1 }`, and TTL `{ expiresAt: 1 }` with `expireAfterSeconds: 0` in `lib/db/models/email-verification-token.ts`
- [ ] T019 [P] Create the `PasswordResetToken` model with unique `tokenHash`, `expiresAt` "30 minutes after creation", `consumedAt` single use, and `requestedIpHash`; indexes `{ tokenHash: 1 }` unique, `{ userId: 1, consumedAt: 1 }`, and TTL `{ expiresAt: 1 }` with `expireAfterSeconds: 0` in `lib/db/models/password-reset-token.ts`
- [ ] T020 [P] Create the `Material` model with required `userId`, sanitized `originalFilename` max 255 chars, unique server-generated `storageKey` matching `materials/{userId}/{materialId}`, `declaredMime` retained for audit, nullable `detectedMime`, `sizeBytes` "1 to 26,214,400 (25 MB)", status enum `awaiting_upload | uploaded | scanning | queued | processing | ready | failed | quarantined | deleted`, `scanResult` enum `pending | clean | infected | unavailable`, `pageCount`, `charCount` max 2,000,000, and failure fields; indexes `{ storageKey: 1 }` unique, `{ userId: 1, createdAt: -1 }`, `{ userId: 1, status: 1 }`, and `{ status: 1, createdAt: 1 }` in `lib/db/models/material.ts`
- [ ] T021 [P] Create the `ProcessingJob` model with unique `materialId`, status `queued | processing | ready | failed`, `attempts` default 0 maximum 3, `leaseUntil`, and safe `lastErrorCode`/`lastErrorMessage`; indexes `{ materialId: 1 }` unique, `{ status: 1, leaseUntil: 1 }`, and `{ userId: 1, createdAt: -1 }` in `lib/db/models/processing-job.ts`
- [ ] T022 [P] Create the `Lesson` model with unique `materialId`, `title` "1 to 200 chars", `summary` "max 2,000 chars", `contentMarkdown` "max 1 MB, sanitized", `version`, status `draft | ready | deleted`, and generation provenance; indexes `{ materialId: 1 }` unique, `{ userId: 1, updatedAt: -1 }`, and `{ userId: 1, status: 1 }` in `lib/db/models/lesson.ts`
- [ ] T023 [P] Create the append-only `LessonRevision` model with unique `{ lessonId, version }`, required `userId`, `authorType` `system | user`, and indexes `{ lessonId: 1, version: 1 }` unique and `{ userId: 1, lessonId: 1, version: -1 }` in `lib/db/models/lesson-revision.ts`
- [ ] T024 [P] Create the `AuditEvent` model with nullable `userId`, required `correlationId`, hashed `ipHash`/`userAgentHash`, redacted `metadata`, indexes `{ userId: 1, createdAt: -1 }` and `{ type: 1, createdAt: -1 }`, and a 90-day TTL (`expireAfterSeconds: 7776000`) in `lib/db/models/audit-event.ts`
- [ ] T025 [P] Create the `AccountDeletionRequest` model with unique `userId`, status `queued | processing | completed | failed`, `attempts` maximum 3, and safe failure fields; indexes `{ userId: 1 }` unique and `{ status: 1, requestedAt: 1 }` in `lib/db/models/account-deletion-request.ts`
- [ ] T026 Create the model registry and an idempotent `pnpm db:indexes` script that applies every index above in `lib/db/models/index.ts` and `scripts/ensure-indexes.ts`
- [ ] T027 Implement the tenant repository base that REQUIRES a session-derived `userId` argument and injects it into every read, update, and delete, with a compile-time check that no tenant method accepts an owner ID, in `lib/db/repositories/tenant-repository.ts`
- [ ] T028 [P] Create shared Zod primitives that reject unknown keys: ObjectId, email (max 254), password (minimum 12, maximum 128), pagination (`page` ≥ 1, `limit` 1–50, default 20), and strict object helpers in `lib/validation/common.ts`
- [ ] T029 [P] Implement HttpOnly/Secure/SameSite=Lax cookie helpers and the `requireUser()` session guard that derives `userId` only from the access token and rejects `disabled`, `deleting`, and `deleted` users in `lib/auth/cookies.ts` and `lib/auth/session.ts`
- [ ] T030 [P] Implement the CSRF double-submit token issue/verify pair binding the `X-CSRF-Token` header to the CSRF cookie in `lib/auth/csrf.ts`
- [ ] T031 [P] Implement the Redis-backed rate limiter factory supporting per-user and per-IP keys, standard rate-limit headers, and `Retry-After` in `lib/security/rate-limit.ts`
- [ ] T032 [P] Implement the DOMPurify sanitizer (via `isomorphic-dompurify`) that removes scripts, event handlers, and URL schemes other than `http`, `https`, and `mailto` in `lib/security/sanitize.ts`
- [ ] T033 [P] Implement the private S3 client and single-object presign helper with a 15-minute expiry, content-type constraint, and content-length constraint in `lib/storage/s3.ts`
- [ ] T034 [P] Implement the ClamAV streaming client that fails closed when the scanner is unavailable in `lib/security/clamav.ts`
- [ ] T035 [P] Implement the `EmailSender` interface with Resend and MailHog transports and verification/reset templates in `lib/email/sender.ts` and `lib/email/templates/verify-email.tsx` / `lib/email/templates/reset-password.tsx`
- [ ] T036 Create the BullMQ queue definitions and Zod schemas for every worker message (`scan_material`, `parse_material`, `generate_lesson`, `delete_account`) with stable unique job IDs in `lib/jobs/queues.ts` and `lib/jobs/schemas.ts`
- [ ] T037 [P] Implement the audit-event writer with secret redaction and correlation ID propagation in `lib/logging/audit.ts`
- [ ] T038 [P] Configure HSTS (`max-age` ≥ 15,552,000 with `includeSubDomains`), nonce-based CSP, `X-Content-Type-Options`, frame protections, `Referrer-Policy`, `Permissions-Policy`, and an explicit credentialed CORS allowlist in `next.config.ts` and `middleware.ts`
- [ ] T039 Create the worker bootstrap with graceful shutdown, concurrency limits, a 120-second per-job timeout, a 1 GB memory ceiling, and Zod validation of every incoming job payload in `worker/index.ts` and `worker/runtime/limits.ts`
- [ ] T040 Implement the route-handler wrapper that validates body/query/path with Zod, enforces auth and CSRF where required, injects the correlation ID, and maps failures to the safe envelope in `lib/http/handler.ts`; implement `GET /api/health` in `app/api/health/route.ts`

**Checkpoint**: Foundation ready — models, tenant guard, validation, security primitives,
queues, and worker exist. User story implementation can begin.

---

## Phase 3: User Story 1 — Secure Account and Personal Workspace (Priority: P1) 🎯 MVP

**Goal**: A visitor registers, verifies email, signs in, reaches a tenant-isolated
workspace, signs out, resets a password, exports content, and deletes the account.

**Independent Test**: Create two accounts, verify both, sign in as A and create a sample
item, then sign in as B and confirm A's item is neither listed nor reachable by direct
identifier. Sign out and confirm the session no longer grants access. Complete a password
reset and confirm old sessions fail.

### Tests for User Story 1 ⚠️

> Write these tests first and confirm they fail before starting the implementation tasks below.

- [ ] T041 [P] [US1] Unit-test Argon2id hashing, password policy, access-token claims, and refresh-token rotation/hashing in `tests/unit/auth/password.test.ts` and `tests/unit/auth/tokens.test.ts`
- [ ] T042 [P] [US1] Contract-test `POST /api/auth/register`, `POST /api/auth/verify-email`, `POST /api/auth/resend-verification`, `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, and `GET /api/auth/csrf` against `contracts/openapi.yaml`, including unknown-key rejection, in `tests/contract/auth.test.ts`
- [ ] T043 [P] [US1] Contract-test `GET /api/me`, `GET /api/account/export` (including ZIP contents), and `DELETE /api/account`, including strict unknown-key rejection and the safe error envelope with `correlationId`, in `tests/contract/account.test.ts`
- [ ] T044 [P] [US1] Integration-test registration → verification → sign-in → workspace listing, the unverified-upload block, export contents, deletion-request access cutoff, and cascade cleanup in `tests/integration/auth/account-lifecycle.test.ts`
- [ ] T045 [P] [US1] Integration-test single-use password reset with a 30-minute expiry and active-session invalidation in `tests/integration/auth/password-reset.test.ts`
- [ ] T046 [P] [US1] Security-test cross-tenant denial for every tenant-scoped route using user A and user B, asserting a non-revealing 404, in `tests/security/tenant-isolation.test.ts`
- [ ] T047 [P] [US1] Security-test CSRF rejection, login lockout after 5 failures in 15 minutes, 10 attempts per 15 minutes per IP, cookie flags, and unauthenticated denial for every protected route in `tests/security/auth-hardening.test.ts`
- [ ] T048 [P] [US1] End-to-end test register → verify via MailHog → sign in → sign out → reset password in `tests/e2e/auth.spec.ts`

### Implementation for User Story 1

- [ ] T049 [US1] Implement Argon2id hashing (cost parameters meeting the constitution), the 12-character minimum policy, and constant-time verification in `lib/auth/password.ts`
- [ ] T050 [US1] Implement 15-minute `jose` access tokens and 7-day hashed rotating refresh tokens with reuse detection and family revocation in `lib/auth/tokens.ts` and `lib/auth/refresh.ts`
- [ ] T051 [US1] Implement `POST /api/auth/register` with normalized unique email, hashed password, verification email, safe 409, per-IP rate limiting, and audit events in `app/api/auth/register/route.ts` and `lib/validation/auth.ts`
- [ ] T052 [US1] Implement `POST /api/auth/verify-email` and `POST /api/auth/resend-verification` with single-use hashed tokens and rate limiting in `app/api/auth/verify-email/route.ts` and `app/api/auth/resend-verification/route.ts`
- [ ] T053 [US1] Implement `POST /api/auth/login` with failure counting, account lockout, per-IP rate limiting, `lastLoginAt`, session and CSRF issuance, and failed-login audit events in `app/api/auth/login/route.ts`
- [ ] T054 [US1] Implement `POST /api/auth/refresh`, `POST /api/auth/logout`, and `GET /api/auth/csrf` with rotation, revocation, cleared cookies, and CSRF issuance in `app/api/auth/refresh/route.ts`, `app/api/auth/logout/route.ts`, and `app/api/auth/csrf/route.ts`
- [ ] T055 [US1] Implement `POST /api/auth/forgot-password` (non-revealing 202) and `POST /api/auth/reset-password` (single use, 30-minute expiry, revoke all sessions, per-IP rate limits) in `app/api/auth/forgot-password/route.ts` and `app/api/auth/reset-password/route.ts`
- [ ] T056 [US1] Implement the current-user read surface: `GET /api/me` returning only `id`, `email`, `emailVerified`, and `createdAt`, plus tenant-scoped read-only `GET /api/materials`, `GET /api/materials/{materialId}`, `GET /api/lessons`, and `GET /api/lessons/{lessonId}` with non-revealing 404s in `app/api/me/route.ts`, `app/api/materials/route.ts`, `app/api/materials/[materialId]/route.ts`, `app/api/lessons/route.ts`, and `app/api/lessons/[lessonId]/route.ts`
- [ ] T057 [US1] Implement `GET /api/account/export` as a streaming ZIP of material metadata and Markdown lessons, limited to the session user, in `app/api/account/export/route.ts` and `lib/account/export.ts`
- [ ] T058 [US1] Implement `DELETE /api/account` to mark status `deleting`, end access immediately, and enqueue exactly one cascade job in `app/api/account/route.ts`
- [ ] T059 [US1] Implement the account-deletion processor that removes materials, lessons, revisions, stored objects, and derived data within 30 days, and register it with the worker queue in `worker/processors/delete-account.ts` and `worker/index.ts`
- [ ] T060 [P] [US1] Build the auth pages and forms at `app/(auth)/layout.tsx`, `app/(auth)/register/page.tsx`, `app/(auth)/login/page.tsx`, `app/(auth)/verify-email/page.tsx`, `app/(auth)/forgot-password/page.tsx`, and `app/(auth)/reset-password/page.tsx` with accessible labels and safe error display
- [ ] T061 [P] [US1] Build the authenticated app shell with session-aware navigation and sign-out control in `app/(app)/layout.tsx` and `components/auth/session-nav.tsx`
- [ ] T062 [P] [US1] Build the workspace dashboard and settings pages showing only the session user's materials and lessons plus export/delete controls in `app/(app)/dashboard/page.tsx` and `app/(app)/settings/page.tsx`
- [ ] T063 [US1] Wire route protection and auth redirects for `(app)` and `(auth)` groups in `middleware.ts`
- [ ] T064 [US1] Emit audit events for registration, verification, sign-in, failed sign-in, lockout, refresh reuse, password reset, export, and deletion request in `lib/logging/audit-events.ts`
- [ ] T065 [US1] Implement the verified-user gate used by upload and generation routes in `lib/auth/require-verified.ts`
- [ ] T066 [US1] Propagate correlation IDs through auth handlers and map all failures to the safe envelope in `app/api/auth/**/route.ts` and `lib/http/errors.ts`
- [ ] T067 [US1] Create an idempotent seed script with two verified local test users and one sample document, wired as `pnpm db:seed`, in `scripts/seed.ts` and `package.json`

**Checkpoint**: US1 fully functional and independently testable. The tenant boundary is
proven by the security suite before any upload code exists.

---

## Phase 4: User Story 2 — Upload Material and Receive a Structured Lesson (Priority: P1)

**Goal**: A verified user uploads a supported document, sees persistent processing
status, and opens a structured Markdown lesson. Unsafe, unsupported, oversized, or
malformed inputs are rejected safely, and transient failures retry without duplicate
lessons.

**Independent Test**: With a verified account from US1, upload a supported sample,
observe status move to `ready`, and open the lesson. Repeat with an unsupported file, an
oversized file, a spoofed MIME type, and the EICAR test string. Inject an AI failure,
confirm a safe failed state, and retry without re-uploading.

### Tests for User Story 2 ⚠️

> Write these tests first and confirm they fail before starting the implementation tasks below.

- [ ] T068 [P] [US2] Contract-test `POST /api/materials/presign`, `POST /api/materials`, `GET /api/materials`, `GET|DELETE /api/materials/{materialId}`, `GET /api/materials/{materialId}/status`, and `POST /api/materials/{materialId}/retry` against `contracts/openapi.yaml`, including unknown-key rejection, in `tests/contract/materials.test.ts`
- [ ] T069 [P] [US2] Unit-test magic-byte detection, the four allowed MIME types, the 26,214,400-byte cap, filename sanitization, and extension/MIME mismatch rejection in `tests/unit/materials/file-validation.test.ts`
- [ ] T070 [P] [US2] Unit-test PDF/DOCX/Markdown/text extraction, the 200-page cap, the 2,000,000-character cap, image-only detection with the OCR message, and truncated/encrypted document errors in `tests/unit/parsing/extract.test.ts`
- [ ] T071 [P] [US2] Unit-test the structured lesson Zod schema, deterministic Markdown conversion, and rejection of malformed model output in `tests/unit/ai/lesson-generation.test.ts`
- [ ] T072 [P] [US2] Integration-test presign → upload to MinIO → confirm → scan → parse → generate → `ready` with exactly one lesson and one initial revision in `tests/integration/materials/upload-to-lesson.test.ts`
- [ ] T073 [P] [US2] Integration-test bounded retry, user-initiated retry, idempotent job IDs, no duplicate lessons, and persisted status across a new session in `tests/integration/materials/retry-idempotency.test.ts`
- [ ] T074 [P] [US2] Security-test MIME spoofing, oversized uploads, EICAR quarantine, scanner-unavailable fail-closed behavior, and the 10/hour and 5/minute upload limits in `tests/security/upload.test.ts`
- [ ] T075 [P] [US2] Security-test prompt-injection containment, the 32,768 input / 4,096 output token caps, the $2.00 daily budget, and malformed-output failure in `tests/security/ai-boundaries.test.ts`
- [ ] T076 [P] [US2] End-to-end test upload → status progression → generated lesson view in `tests/e2e/upload-to-lesson.spec.ts`

### Implementation for User Story 2

- [ ] T077 [US2] Implement `POST /api/materials/presign` with the exact filename, declaredMime enum, and `sizeBytes` 1–26,214,400 constraints, creating an `awaiting_upload` material and a 15-minute presigned PUT in `lib/validation/materials.ts` and `app/api/materials/presign/route.ts`
- [ ] T078 [US2] Implement `POST /api/materials` to confirm the object, verify magic-byte MIME with `file-type`, reject size/type mismatches, and enqueue scanning in `app/api/materials/route.ts` and `lib/storage/verify-object.ts`
- [ ] T079 [US2] Implement `DELETE /api/materials/{materialId}`, `GET /api/materials/{materialId}/status`, and `POST /api/materials/{materialId}/retry` with tenant scoping and safe non-revealing 404s in `app/api/materials/[materialId]/route.ts`, `app/api/materials/[materialId]/status/route.ts`, and `app/api/materials/[materialId]/retry/route.ts`
- [ ] T080 [US2] Implement upload rate limiting at presign, confirm, and user retry using per-user keys of 10/hour and 5/minute with `Retry-After` in `lib/security/upload-rate-limit.ts`
- [ ] T081 [US2] Implement the material job producer with a unique job ID per material and enqueue-after-commit behavior in `lib/jobs/material-jobs.ts`
- [ ] T082 [US2] Implement the ClamAV scan processor that persists `clean`, `infected`, or `unavailable` and never parses unclean input in `worker/processors/scan-material.ts`
- [ ] T083 [US2] Implement PDF (`pdfjs-dist`), DOCX (`mammoth`), Markdown, and plain-text extraction with the 200-page and 2,000,000-character caps in `lib/parsing/extract.ts`, `lib/parsing/pdf.ts`, `lib/parsing/docx.ts`, and `lib/parsing/text.ts`
- [ ] T084 [US2] Implement image-only detection using fewer than 200 non-whitespace characters total or fewer than 100 per page on average and return the OCR-not-supported message in `lib/parsing/quality.ts`
- [ ] T085 [US2] Implement the parse processor with the 120-second job timeout, bounded retry, and persisted `pageCount`/`charCount` in `worker/processors/parse-material.ts`
- [ ] T086 [US2] Implement the AI provider abstraction with OpenAI GPT-4o as default and Google Gemini as fallback, including provider outage handling in `lib/ai/provider.ts`
- [ ] T087 [US2] Implement the lesson generation prompt with explicit untrusted-data delimiters, the structured Zod lesson schema, and deterministic Markdown conversion in `lib/ai/prompts.ts`, `lib/ai/lesson-schema.ts`, and `lib/ai/markdown.ts`
- [ ] T088 [US2] Implement the generation processor with `generateObject`, 32,768 input and 4,096 output token caps, schema validation, bounded retry, and no malformed lesson persistence in `worker/processors/generate-lesson.ts`
- [ ] T089 [US2] Implement per-user daily AI budget accounting with a $2.00 limit and a safe limit-reached failure message in `lib/ai/budget.ts`
- [ ] T090 [US2] Implement the material and processing-job repositories with conditional state transitions, lease claiming, and the documented retry rules in `lib/db/repositories/material-repository.ts` and `lib/db/repositories/processing-job-repository.ts`
- [ ] T091 [US2] Implement lesson persistence with unique `materialId`, `version` starting at 1, and the initial `system` revision in `lib/db/repositories/lesson-repository.ts`
- [ ] T092 [US2] Implement safe failure codes and messages for every rejection and terminal failure path in `lib/materials/failure-messages.ts`
- [ ] T093 [P] [US2] Build the upload form with client-side type/size pre-checks, progress, and actionable errors in `app/(app)/materials/new/page.tsx` and `components/materials/upload-form.tsx`
- [ ] T094 [P] [US2] Build the material list with persistent status badges and accessibility-safe polling in `app/(app)/materials/page.tsx`, `components/materials/material-list.tsx`, and `components/materials/status-badge.tsx`
- [ ] T095 [P] [US2] Build the material detail page with failure reason and retry action in `app/(app)/materials/[materialId]/page.tsx`
- [ ] T096 [US2] Implement the status polling hook with backoff, visibility pause, and cleanup in `hooks/use-material-status.ts`
- [ ] T097 [US2] Build the read-only lesson view reached when generation completes, including a sanitized shared Markdown renderer, in `app/(app)/lessons/[lessonId]/page.tsx` and `components/lessons/markdown-renderer.tsx`
- [ ] T098 [US2] Add processing timeouts, provider-unavailable handling, and daily-budget messaging to the worker failure paths in `worker/processors/generate-lesson.ts` and `lib/materials/failure-messages.ts`
- [ ] T099 [US2] Emit audit events for upload confirmation, scan outcome, generation success/failure, and retry in `lib/logging/audit-events.ts`, and register the scan, parse, and generate processors with the worker queue in `worker/index.ts`

**Checkpoint**: US2 fully functional. Uploads produce exactly one validated, structured
lesson, and every rejection path is covered by the security suite.

---

## Phase 5: User Story 3 — Review, Edit, and Save a Lesson (Priority: P2)

**Goal**: A user edits a lesson in a keyboard-operable Markdown editor with live preview,
autosave, revision history, conflict detection, XSS-safe rendering, and cascading deletion.

**Independent Test**: Open a ready lesson, edit and autosave, reload, and confirm content
persists and renders identically. Open the lesson in two tabs, save both, and confirm the
second save reports a conflict instead of overwriting. Restore a revision and confirm a
new version is appended. Delete the material and confirm the lesson and revisions vanish.

### Tests for User Story 3 ⚠️

> Write these tests first and confirm they fail before starting the implementation tasks below.

- [ ] T100 [P] [US3] Contract-test `GET /api/lessons`, `GET|PATCH|DELETE /api/lessons/{lessonId}`, `GET /api/lessons/{lessonId}/revisions`, and `POST /api/lessons/{lessonId}/revisions/{revisionId}/restore` against `contracts/openapi.yaml`, including unknown-key rejection, in `tests/contract/lessons.test.ts`
- [ ] T101 [P] [US3] Unit-test optimistic concurrency, stale-version conflict with no write, and same-transaction revision append in `tests/unit/lessons/save-service.test.ts`
- [ ] T102 [P] [US3] Security-test `<script>`, event handlers, `javascript:` links, and unsafe image sources on save, preview, and final render in `tests/security/markdown-sanitization.test.ts`
- [ ] T103 [P] [US3] Integration-test autosave persistence across reload and two-tab conflict detection against a real MongoDB replica set in `tests/integration/lessons/autosave-conflict.test.ts`
- [ ] T104 [P] [US3] Integration-test revision list/restore as a new version and material deletion cascading to lesson, revisions, and stored object in `tests/integration/lessons/revisions-deletion.test.ts`
- [ ] T105 [P] [US3] End-to-end test edit → autosave → reload → preview/final render parity → conflict → restore in `tests/e2e/lesson-editor.spec.ts`
- [ ] T106 [P] [US3] End-to-end keyboard-only editing, saving, and revision restore in `tests/e2e/lesson-editor-accessibility.spec.ts`
- [ ] T107 [P] [US3] Unit-test revision restore transaction rollback and immutable history in `tests/unit/lessons/restore-service.test.ts`

### Implementation for User Story 3

- [ ] T108 [US3] Implement the lesson save service with sanitize-on-save, optimistic concurrency on `version`, and revision append in the same MongoDB transaction in `lib/lessons/save-service.ts`
- [ ] T109 [US3] Implement revision listing and restore-as-new-version, never rewriting history, in `lib/lessons/revision-service.ts` and `lib/db/repositories/lesson-revision-repository.ts`
- [ ] T110 [US3] Implement `PATCH|DELETE /api/lessons/{lessonId}` with tenant scoping, title 1–200 chars, content max 1,048,576 chars (1 MB), and 409 on stale version, including strict lesson save schemas in `lib/validation/lessons.ts`, `app/api/lessons/route.ts`, and `app/api/lessons/[lessonId]/route.ts`
- [ ] T111 [US3] Implement `GET /api/lessons/{lessonId}/revisions` and `POST /api/lessons/{lessonId}/revisions/{revisionId}/restore` in `app/api/lessons/[lessonId]/revisions/route.ts` and `app/api/lessons/[lessonId]/revisions/[revisionId]/restore/route.ts`
- [ ] T112 [US3] Apply server-side sanitization in the save path, rejecting or stripping unsafe content before persistence while preserving safe Markdown, in `lib/lessons/save-service.ts`
- [ ] T113 [P] [US3] Harden the shared renderer introduced by the read-only lesson view with `react-markdown` and `remark-gfm`, no `rehype-raw`, `isomorphic-dompurify` sanitization before display, allowed `http`/`https`/`mailto` URLs, and identical preview/final output in `components/lessons/markdown-renderer.tsx`
- [ ] T114 [P] [US3] Build the side-by-side editor with accessible toolbar controls and keyboard shortcuts in `components/editor/lesson-editor.tsx`
- [ ] T115 [US3] Implement the debounced 1.5-second autosave hook with coalescing, in-flight serialization, and retry on transient failure in `hooks/use-autosave.ts`
- [ ] T116 [US3] Implement the conflict banner and reload/resolve flow in `components/editor/conflict-banner.tsx`
- [ ] T117 [P] [US3] Build revision history inspection and restore UI in `components/editor/revision-history.tsx`
- [ ] T118 [US3] Build the lesson editor page that loads the lesson, wires autosave, conflict handling, and revisions in `app/(app)/lessons/[lessonId]/page.tsx`
- [ ] T119 [P] [US3] Build the lesson list page with status and last-updated ordering in `app/(app)/lessons/page.tsx`
- [ ] T120 [US3] Implement cascading material deletion covering job, lesson, revisions, and stored object in `lib/materials/delete-service.ts`
- [ ] T121 [US3] Add delete controls with confirmation for materials and lessons in `components/materials/delete-material-dialog.tsx` and `components/lessons/delete-lesson-dialog.tsx`
- [ ] T122 [US3] Implement the client request wrapper with CSRF header injection, one automatic refresh-and-retry on 401, and local draft preservation plus re-authentication prompt when refresh fails in `lib/http/client.ts` and `hooks/use-autosave.ts`
- [ ] T123 [US3] Emit audit events for lesson save, revision restore, lesson delete, and material delete in `lib/logging/audit-events.ts`
- [ ] T124 [US3] Guarantee preview/final render parity by using the same sanitizer and renderer configuration in `components/lessons/markdown-renderer.tsx` and `components/editor/lesson-editor.tsx`
- [ ] T125 [US3] Map conflicts, expired sessions, and sanitization failures to the safe error envelope with correlation IDs in `app/api/lessons/**/route.ts`

**Checkpoint**: All three stories functional. Editing is durable, concurrent-safe,
XSS-safe, and history-preserving.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Hardening, documentation, performance, accessibility, and full-gate
validation across all stories.

- [ ] T126 [P] Write architecture, environment, and operations runbooks in `docs/architecture.md`, `docs/environment.md`, and `docs/operations.md`
- [ ] T127 [P] Add unit tests for shared Zod schemas, unknown-key rejection, and pagination bounds in `tests/unit/validation/schemas.test.ts`
- [ ] T128 [P] Add a performance test for listing 100 lessons and materials within the SC-009 target in `tests/integration/performance/listing.test.ts`
- [ ] T129 [P] Enforce dependency audit and Gitleaks secret scanning as required checks in `.github/workflows/ci.yml`
- [ ] T130 Configure coverage gates of 80% changed lines and 100% branches on authorization, validation, sanitization, and upload modules in `vitest.config.ts`
- [ ] T131 [P] Add the main-branch and critical-path Playwright workflow in `.github/workflows/e2e.yml`
- [ ] T132 Add security-header assertions for HSTS, CSP nonces, frame, MIME, referrer, and permissions policies in `tests/security/headers.test.ts`
- [ ] T133 [P] Add log-redaction tests proving passwords, tokens, prompts, and file contents never appear in logs in `tests/unit/logging/redaction.test.ts`
- [ ] T134 Execute all ten scenarios in [quickstart.md](./quickstart.md) against the local stack and record pass/fail evidence in `docs/validation-report.md`
- [ ] T135 [P] Add deployment manifests for the web and worker services with env-only secrets in `railway.json` and `infra/README.md`
- [ ] T136 Tune queries and verify compound indexes against the query patterns in `data-model.md` in `lib/db/repositories/*.ts` and `scripts/ensure-indexes.ts`
- [ ] T137 Run an accessibility audit across auth, upload, editor, and settings pages and fix violations in `components/auth/`, `components/materials/`, `components/editor/`, and `tests/e2e/accessibility.spec.ts`
- [ ] T138 Perform the final threat-model and security review, updating `docs/security.md` with the tenant, upload, prompt-injection, and XSS controls
- [ ] T139 Run the full gate suite (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm openapi:lint`, `pnpm build`) defined in `.github/workflows/ci.yml` and fix every failure before declaring the feature complete

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; starts immediately.
- **Foundational (Phase 2)**: Depends on Setup; blocks every user story.
- **US1 (Phase 3)**: Depends on Foundational. Establishes the session and tenant boundary.
- **US2 (Phase 4)**: Depends on Foundational and on US1's verified-user gate and session
  guard. Its security tests additionally rely on US1's cross-tenant probe helpers.
- **US3 (Phase 5)**: Depends on Foundational and US2's lesson persistence. Its independent
  test assumes one ready lesson from US2.
- **Polish (Phase 6)**: Depends on the stories being delivered.

### User Story Dependencies

- **US1 (P1)**: No story dependencies. Delivers the MVP account and tenant boundary.
- **US2 (P1)**: Requires US1 because the spec defines uploads for verified signed-in users.
- **US3 (P2)**: Requires US2 because editing requires a generated lesson.
- This chain is intentional for the walking skeleton; each phase still ends at a checkpoint
  with its own independent test suite.

### Within Each User Story

- Tests are written first and MUST fail before implementation.
- Models and repositories precede services; services precede routes.
- Shared renderers and primitives precede pages.
- Story checkpoints are validated before the next story begins.

### Parallel Opportunities

- Setup: T003–T014 are parallel after T001–T002.
- Foundational: T016–T025 (models) and T028–T035 (primitives) are parallel; T015, T026,
  T027, T036, T039, and T040 are sequencing points.
- US1: T041–T048 (tests) run in parallel; T060–T062 (pages) run in parallel after
  T049–T056.
- US2: T068–T076 (tests) run in parallel; T083, T086, T093, T094, and T095 are parallel
  within their dependency groups.
- US3: T100–T107 (tests) run in parallel; T113, T114, T117, and T119 are parallel after
  T108–T112.
- Polish: T126–T129, T131, T133, and T135 are parallel.

---

## Parallel Example: User Story 1

```bash
# Launch all US1 tests first (each is a distinct file):
Task: "Unit-test hashing and tokens in tests/unit/auth/password.test.ts and tokens.test.ts"
Task: "Contract-test auth endpoints in tests/contract/auth.test.ts"
Task: "Contract-test account endpoints in tests/contract/account.test.ts"
Task: "Integration-test account lifecycle in tests/integration/auth/account-lifecycle.test.ts"
Task: "Integration-test password reset in tests/integration/auth/password-reset.test.ts"
Task: "Security-test tenant isolation in tests/security/tenant-isolation.test.ts"
Task: "Security-test auth hardening in tests/security/auth-hardening.test.ts"
Task: "End-to-end auth journey in tests/e2e/auth.spec.ts"

# Then launch independent pages/UI work:
Task: "Build auth pages in app/(auth)/**/page.tsx"
Task: "Build app shell in app/(app)/layout.tsx and components/auth/session-nav.tsx"
Task: "Build dashboard and settings in app/(app)/dashboard/page.tsx and settings/page.tsx"
```

## Parallel Example: User Story 2

```bash
# Launch US2 tests together:
Task: "Contract-test materials endpoints in tests/contract/materials.test.ts"
Task: "Unit-test file validation in tests/unit/materials/file-validation.test.ts"
Task: "Unit-test parsing in tests/unit/parsing/extract.test.ts"
Task: "Unit-test AI lesson schema in tests/unit/ai/lesson-generation.test.ts"
Task: "Integration-test upload path in tests/integration/materials/upload-to-lesson.test.ts"
Task: "Integration-test retry/idempotency in tests/integration/materials/retry-idempotency.test.ts"
Task: "Security-test uploads in tests/security/upload.test.ts"
Task: "Security-test AI boundaries in tests/security/ai-boundaries.test.ts"
Task: "End-to-end upload in tests/e2e/upload-to-lesson.spec.ts"

# Then parallel UI and parser work:
Task: "Build upload form in components/materials/upload-form.tsx"
Task: "Build material list in components/materials/material-list.tsx"
Task: "Build material detail in app/(app)/materials/[materialId]/page.tsx"
```

## Parallel Example: User Story 3

```bash
Task: "Contract-test lesson endpoints in tests/contract/lessons.test.ts"
Task: "Unit-test save concurrency in tests/unit/lessons/save-service.test.ts"
Task: "Security-test sanitization in tests/security/markdown-sanitization.test.ts"
Task: "Integration-test autosave/conflict in tests/integration/lessons/autosave-conflict.test.ts"
Task: "Integration-test revisions/deletion in tests/integration/lessons/revisions-deletion.test.ts"
Task: "End-to-end editor in tests/e2e/lesson-editor.spec.ts"
Task: "End-to-end keyboard access in tests/e2e/lesson-editor-accessibility.spec.ts"
Task: "Unit-test restore rollback in tests/unit/lessons/restore-service.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational — this is the critical tenant and validation boundary.
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: run the US1 independent test and the cross-tenant security
   suite. Deploy the secure account/workspace MVP.
5. Only then begin US2.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → secure accounts and workspace (safe MVP).
3. US2 → uploads and generated lessons (core product value).
4. US3 → editing, revisions, and conflict safety (full walking skeleton).
5. Polish → CI gates, coverage, accessibility, performance, and documented validation.
6. Each checkpoint is a deployable increment that does not break the previous one.

### Parallel Team Strategy

1. One team completes Setup + Foundational together.
2. After Foundational, US1 must land first because US2 and US3 consume its session and
   tenant boundary.
3. Once US1 is stable, frontend work (US2 UI) and backend work (US2 pipeline) can proceed
   in parallel within Phase 4.
4. Within Phase 5, API/service work and editor/UI work can proceed in parallel once the
   save and revision contracts are fixed.

---

## Notes

- Tests are mandatory because the constitution requires them; do not implement a task
  before its test fails for the right reason.
- `[P]` means different files and no dependency on an incomplete task; never parallelize
  edits to the same file.
- Every tenant query must pass the session `userId`; client-supplied owner IDs are never
  accepted.
- Every user-facing failure must use the safe envelope with a correlation ID.
- Commit after each task or logical group and stop at each checkpoint to validate.
- Avoid: vague tasks, shared-file conflicts, and cross-story shortcuts that bypass the
  Foundational security boundary.

---

## Requirement Coverage

| Requirement | Description | Primary tasks |
|---|---|---|
| FR-001 | register and password policy | T041, T044, T049, T051 |
| FR-002 | verification before upload/AI | T044, T052, T065 |
| FR-003 | sign in, sign out, session end | T042, T044, T047, T053, T054 |
| FR-004 | single-use reset and session invalidation | T045, T055 |
| FR-005 | session-derived ownership | T046, T027, T029 |
| FR-006 | deny-by-default tenant isolation | T046, T027 |
| FR-007 | auth rate limits and lockout | T047, T031, T053 |
| FR-008 | supported types and 25 MB cap | T069, T077, T078 |
| FR-009 | magic-byte check and malware scan | T074, T078, T082 |
| FR-010 | asynchronous persistent status | T072, T073, T081, T090 |
| FR-011 | bounded retry and no duplicates | T073, T090 |
| FR-012 | upload limits | T074, T080 |
| FR-013 | image-only rejection | T070, T084 |
| FR-014 | structured Markdown lesson | T071, T087 |
| FR-015 | prompt-injection containment | T075, T087 |
| FR-016 | AI output validation | T071, T088 |
| FR-017 | token caps and daily budget | T075, T088, T089 |
| FR-018 | keyboard-operable editor | T106, T114 |
| FR-019 | autosave, revisions, restore | T103, T105, T107, T108, T109, T115, T117 |
| FR-020 | concurrent-edit conflicts | T101, T103, T108, T116 |
| FR-021 | sanitize render and re-save | T102, T032, T112, T113 |
| FR-022 | persist and render identically | T103, T105, T124 |
| FR-023 | view owned materials and lessons | T044, T046, T094, T119 |
| FR-024 | material deletion cascade | T104, T120 |
| FR-025 | account deletion cascade | T044, T058, T059 |
| FR-026 | safe actionable errors | T043, T010, T092, T125 |
| FR-027 | export before deletion | T043, T057 |

---

## Format Validation

All 139 tasks use `- [ ] Txxx [P?] [USx?] Description with file path`. Setup, Foundational,
and Polish tasks carry no story label; every US1, US2, and US3 task carries its label;
every task names at least one exact repository path.
