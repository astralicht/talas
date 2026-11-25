# Talas MVP Constitution

## Core Principles

### I. Zero-Trust Strict Input Validation

Every API endpoint MUST validate its payload and query parameters against
predefined Zod schemas before any business logic runs. If validation fails, the
server MUST immediately return a 400 Bad Request with a safe, actionable error
response. Raw, unvalidated data MUST NOT reach the database, the file parser, or
any LLM provider. Validation schemas MUST reject unknown keys by default, enforce
size and depth limits, and cover path, query, header, and body inputs.

### II. Tenant Data Isolation

Every database query that reads or writes tenant-scoped data MUST enforce
authorization by explicitly filtering on `userId: req.user.id`. This includes
every collection derived from user content, at minimum User, Material, Lesson,
LessonChunk, ChatSession, ChatMessage, Embedding, and Upload metadata. The
`userId` used for scoping MUST come from the authenticated session and MUST NOT
be accepted from client input.

Authorization MUST be enforced through a centralized guard or middleware rather
than repeated per handler, and every update or delete MUST verify ownership
before execution. Tenant-scoped collections MUST have compound indexes beginning
with `userId`. Deny-by-default applies: access without an explicit authorization
decision MUST fail closed. Administrative access MUST be explicitly granted and
audited.

A user MUST NEVER be able to read, modify, or delete another user's data. Every
tenant-scoped endpoint MUST have automated cross-tenant tests proving that user A
cannot access, modify, or delete user B's records.

### III. Anti-XSS and Output Sanitization

Because the application renders user-editable Markdown, all rendered output MUST
be sanitized with DOMPurify before React renders it, and content MUST be
re-sanitized after every manual edit and before display. Raw HTML MUST NOT be
rendered unless it has passed the sanitizer. `dangerouslySetInnerHTML` MUST NOT
receive unsanitized content. Sanitization MUST restrict URL schemes for links and
images to safe protocols and MUST strip event handlers and embedded scripts.
Under no circumstances may raw, unvalidated data be rendered to the client.

### IV. File Upload Security & Resource Control

The backend MUST verify the actual MIME type of uploaded files from magic bytes
rather than trusting client-provided extensions or `Content-Type` headers. Only
PDF, DOCX, Markdown, and plain-text files MUST be accepted unless a feature
specification explicitly adds another type. Files MUST be rejected when larger
than 25 MB, and rejection messages MUST state the limit.

Uploads MUST follow a two-step declare-then-commit flow. The presign step
validates the declared type and size, applies quota and rate limits, and creates
the tenant-scoped record; the upload step commits the bytes. The bytes MUST
travel through the authenticated, tenant-scoped application upload endpoint,
with the object write performed server-side and the store never exposed to
browsers. The upload step MUST verify
ownership, an unexpired upload window, the declared status, and the exact
declared byte size before storing, and the confirm step MUST still verify the
stored object's size and magic-byte media type. Blob storage lives behind the
storage seam (`lib/storage/object-store`); since v2.5.0 the bytes are stored
in the application database itself via GridFS under the same tenant-scoped
key scheme, so database backups cover them and no separate object-store
service exists. Since v2.6.0, practice quizzes generated from lessons
consume one daily-generation point per quiz (refunded on terminal failure),
and quiz storage (3 free / 5 plus) plus the per-quiz lesson-source cap
(3 free / 7 plus) are plan-tiered under the same quota machinery. Since
v2.7.0, lesson storage holds 3 lessons on the free plan and 7 on plus, and
failed quiz attempts are removed at terminal failure — audited with the
reason, allowance refunded — so they never occupy storage slots or appear
in lists. Since v2.8.0, quizzes support unlimited scored retakes: learners
answer in the browser, submissions are graded server-side (the answer key
leaves the database only after that attempt's submission), and every
attempt is stored with its score. Uploaded files MUST be
malware-scanned before parsing, filenames MUST be sanitized, and file parsing
MUST run in an isolated worker with hard CPU, memory, and timeout limits.
Image-only PDF documents MUST be accepted: their pages are
rendered into image assets, and lesson generation MAY use vision-capable
providers to interpret them. Diagram and image extraction from text-bearing
PDF and DOCX files MUST be supported. Standalone raster image file types
(for example, JPEG or PNG uploads) remain prohibited unless a feature
specification explicitly adds another type.

LLM and upload endpoints MUST enforce per-user rate limits backed by a shared
store so limits hold across instances. The `/api/process-material` endpoint MUST
allow at most 10 requests per hour and 5 per minute per user. The `/api/chat`
endpoint MUST allow at most 60 requests per hour and 5 per minute per user.
Rejected requests MUST return 429 with a `Retry-After` header. Authentication
endpoints MUST be rate-limited per IP and per account. LLM calls MUST also
enforce per-request input and output token caps and a per-user daily cost
budget. Since v2.9.0 the per-request output cap is 8192 tokens (doubled
from the original 4096: reasoning models spend hidden reasoning tokens
from the same completion budget, and complex figure-rich lessons exceed
the smaller cap before emitting any JSON).

Account plans constrain resource use. Every user has a plan (default `free`),
and each plan declares — as configuration, so higher tiers can be added
without changing enforcement logic — a material storage quota, a
per-material extracted-text character cap, a lesson storage quota, and a
daily lesson-generation allowance derived from that lesson quota. Uploads
MUST be rejected with 403 once the material storage quota is reached, and
lesson generation MUST be rejected with 403 once the lesson storage quota or
the daily allowance is reached. A material whose extracted text exceeds the
plan's character cap MUST fail parsing with a user-visible reason rather
than being silently truncated or generated from. Deleting a material or
lesson MUST free its quota, so every user can reclaim space through
deletion. Limits apply only to new actions: records that predate a limit
MUST NOT be purged to satisfy it.

The daily generation allowance MUST be counted in a shared store so it holds
across instances. It MUST reserve atomically when a generation request is
admitted and MUST be refunded when that request fails terminally, and it
MUST reset daily. Failed generation attempts MUST NOT consume the allowance,
and regenerating an existing lesson MUST NOT consume it. When a
quota-blocked follow-up upload meets a record that failed the character cap,
the user MUST be informed first, after which the dead over-limit record MUST
be purged automatically and the purge MUST be audited.

### V. Cross-Platform Development Compatibility

The repository MUST be developable on both Windows and Linux. Shared code
(`lib/`, `app/`, `components/`, the worker, and the test harness) MUST be
platform-neutral: POSIX-only assumptions MUST NOT be hardcoded (absolute POSIX
paths, `TMPDIR`-only temp handling, shell-executed `node_modules/.bin` entries),
and anything genuinely platform-specific MUST be gated on `process.platform`
without changing the other platform's behavior.

Local development services MUST start on both platforms with an equivalent
contract — same subcommands, ports, URLs, and `.env.local` output. The bash
(`scripts/dev-stack.sh`) and PowerShell (`scripts/dev-stack.ps1`) stacks are
maintained as siblings; logic both stacks need MUST live in cross-platform
Node scripts (for example, `scripts/init-replica-set.mjs`), and platform-native
mechanisms (fork/daemonize on POSIX, background processes on Windows) stay
inside their own script.

Build and test tooling MUST remain platform-neutral: the Next.js build MUST be
spawned through the Node executable rather than a shell shim, the Playwright
web server MUST NOT depend on shell-specific wrappers, and Next standalone
output MUST stay opt-in (`NEXT_OUTPUT_STANDALONE`) so local and test-harness
builds skip it while the Docker web image enables it. CI continues to run the
gates on Linux; the same suite MUST pass on a Windows checkout (the temp and
data dirs route to gitignored repo-local paths so both platforms write heavy
files off the system drive).

Optional public tunneling is part of the dev-stack contract: both stacks MUST
expose an equivalent `tunnel` subcommand that fronts the local web app
(`http://localhost:3000`) through ngrok. The public host is configuration
(`NGROK_DOMAIN`): unset, the stack serves a random free URL that changes on
every restart; set, it serves a claimed static domain. Dev asset origins MUST
accept the ngrok free-tunnel domains (wildcard `allowedDevOrigins` entries for
`*.ngrok-free.app` and `*.ngrok-free.dev`, overridable per machine via
`NEXT_DEV_ALLOWED_ORIGINS`), while the CORS allowlist for credentialed API
calls stays explicit — wildcard origins remain forbidden with credentials.
The tunnel is a foreground, user-level process: `status` MUST report it as
optional and MUST NOT fail when it is down.

Tunneling is a development convenience only: production MUST be served behind
its own HTTPS host. An active tunnel MUST NOT weaken any guarantee —
authentication, tenant isolation, validation, rate limits, and secrets hygiene
apply identically to requests arriving through it — and dev credentials
reachable behind the tunnel (for example, seeded demo accounts) MUST be
treated as public knowledge while it is up.

## Technology Stack Constraints

The following technology stack and implementation constraints are mandated for
all development:

*   **Runtime:** Node.js 20 LTS or later with TypeScript in strict mode.
*   **Frontend:** Next.js (App Router), React, TypeScript, Tailwind CSS, and
    shadcn/ui.
*   **Markdown:** `react-markdown` MUST be used for rendering alongside a
    maintained Markdown editor component that supports CommonMark, live preview,
    and keyboard-only operation.
*   **Backend & Database:** Next.js Route Handlers are the default backend. A
    separate Express.js service MAY be introduced only through an approved plan.
    Persistence MUST use MongoDB Atlas (required for Vector Search) with Mongoose.
    All Mongoose schemas MUST use schema validation rules in addition to Zod API
    validation.
*   **AI & Vector Search:** OpenAI API (GPT-4o) or Google Gemini API paired with
    MongoDB Atlas Vector Search for vector embeddings. LLM access MUST be wrapped
    behind a provider abstraction so providers can be swapped without changing
    feature code.
*   **Security Tools:** NextAuth.js or JWT for authentication, Argon2id
    (preferred) or bcrypt with a cost factor of at least 12 for password hashing,
    and Helmet plus an explicit CORS allowlist for secure HTTP headers.
*   **Testing:** Vitest or Jest for unit and integration tests, Supertest for API
    contract tests, and Playwright for end-to-end tests of critical journeys.

## Core Workflows & Feature Standards

All implementations MUST conform to the following workflow definitions:

*   **Document Processing Pipeline:** Uploads MUST be processed asynchronously
    with explicit status states (queued, processing, ready, failed). Jobs MUST be
    idempotent, MUST retry transient failures with bounded backoff, and MUST
    surface terminal failures to the user. The backend triggers a parser based on
    verified file types. Any raw text sent to the LLM MUST be wrapped in a
    prompt-injection-resistant structure that delimits untrusted content, and
    model output MUST be validated against an expected schema before persistence.
*   **Automatic Layout & Editing:** The system MUST initially apply corresponding
    UI components (for example, tables and bulleted lists) to the AI output. A
    generated lesson MUST open in a rendered, read-only lesson view that is
    optimized for reading and browsing, with an explicit edit affordance at the
    top of the view; the editor MUST be reached through that affordance and MUST
    itself support standard Markdown syntax. The editor MUST autosave, retain
    revision history, and use optimistic concurrency so concurrent edits cannot
    silently overwrite each other. Manual edits MUST be sanitized on save and
    MUST render identically in the final saved lesson view. Uploaded source
    materials MUST remain downloadable by their owner through an
    authenticated, tenant-scoped endpoint; downloads MUST use a
    `Content-Disposition: attachment` response, MUST never serve quarantined or
    deleted materials, and download attempts MUST be audited. Every stored
    material MUST offer its owner an explicit deletion action behind a
    confirmation step, an in-flight upload MUST be cancellable, and abandoned
    or failed upload attempts MUST remain deletable so the storage quota is
    reclaimed.
*   **List Search, Filtering, and Sorting:** The materials and lessons list
    pages and their list APIs MUST share one validated query contract: a bounded
    search term, a status filter, a sort option, and pagination. List state MUST
    live in the URL (query parameters) so views are shareable and restorable;
    the APIs MUST validate the same schemas and reject unknown or out-of-range
    values with 400, while the pages MUST fall back to defaults for invalid
    parameters instead of erroring. Search MUST match case-insensitively on
    user-visible text (material filenames; lesson titles and summaries) and MUST
    treat the raw input literally, never as a regular expression. Status
    filters MUST be tenant-scoped by construction, and the list APIs MUST NOT
    change their response envelope shapes. Result sets MUST be paginated with
    visible totals rather than silently truncated.
*   **AI Chatbot Boundaries:** AI chat responses MUST be strictly grounded in the
    context of the user's saved lesson library, using vector search filtered by
    `userId`. Responses MUST cite the lesson or chunk they draw from. When no
    sufficiently relevant context is found, the assistant MUST decline to answer
    rather than answer from general knowledge. Chat history MUST be tenant-scoped.

## Security & Data Lifecycle

**Authentication and Sessions**

*   Access tokens MUST expire within 24 hours, and refresh tokens MUST rotate,
    be stored hashed, and expire within 30 days. Both TTLs MUST be configurable
    via environment variables with bounded validation, defaulting to 24 hours
    and 30 days respectively. Logout, password change, and account disable MUST
    invalidate active sessions and refresh tokens. Rotation, hashing, single-use,
    and reuse-detection rules are unchanged.
*   Access-token expiration MUST NOT lock out users who hold a valid, unrevoked
    refresh token. A full-page, same-origin navigation from a signed-in browser
    MAY silently renew the access token through an explicit renewal hop that
    enforces the same rotation rules as the programmatic refresh endpoint
    (single-use, hashed at rest, transactional, and reuse-detected). The
    renewal hop MUST fail closed by clearing authentication cookies and landing
    on the sign-in screen, and no routing path MAY be able to produce a
    login-page redirect loop.
*   Navigation-initiated state changes that the application itself originates
    (today, only the silent session-renewal hop) MUST satisfy the CSRF
    requirement through a short-lived, signed nonce issued by the application
    and bound to the exact destination path, combined with
    `Sec-Fetch-Site: same-origin` and `Sec-Fetch-Mode: navigate` validation,
    failing closed to session termination.
*   Password authentication MUST require at least 12 characters. Password reset
    tokens MUST be single-use, hashed at rest, and expire within 30 minutes.
*   Cookie-based sessions MUST use `HttpOnly`, `Secure`, and `SameSite=Lax` or
    stricter cookies. State-changing requests on cookie-authenticated routes MUST
    require CSRF protection.
*   Failed logins MUST trigger backoff or lockout after 5 attempts within
    15 minutes. Registration, login, and reset endpoints MUST be rate-limited.
*   Email verification MUST be required before a user can use paid LLM features.

**Transport and Headers**

*   All traffic MUST use HTTPS. Responses MUST include HSTS with a max-age of at
    least six months.
*   A Content-Security-Policy MUST restrict script sources and forbid inline
    script execution except where explicitly nonce-authorized.
*   CORS MUST use an explicit allowlist. Wildcard origins MUST NOT be combined
    with credentialed requests.

**Secrets and Dependencies**

*   Secrets and credentials MUST NOT be committed to the repository. They MUST be
    supplied through environment configuration or a managed secret store and MUST
    be rotatable without code changes.
*   Dependency lockfiles MUST be committed. CI MUST run a dependency vulnerability
    scan and MUST block merges on known critical or high vulnerabilities without a
    documented, time-boxed exception.
*   A secret scan MUST run in CI and MUST block merges when credentials are found.

**Error Handling and Logging**

*   Client-facing errors MUST use a consistent error envelope with a correlation
    ID. Stack traces, database errors, provider responses, and secrets MUST NOT be
    exposed to clients.
*   Logs MUST be structured and MUST NOT contain passwords, tokens, full prompt
    content, or other sensitive personal data.
*   Authentication events and authorization denials MUST be audited. Audit logs
    MUST be retained for at least 90 days and MUST be access-controlled.

**Data Lifecycle and Privacy**

*   Account deletion MUST remove the user's database records, vector embeddings,
    and stored files within 30 days, including backups according to the backup
    retention schedule. Users MUST be able to export their content before deletion.
*   Backups MUST be encrypted, access-controlled, and retained for no longer than
    30 days unless a longer period is justified in the feature plan.
*   Only the minimum necessary content MAY be sent to LLM providers. Provider
    data-use and training terms MUST be reviewed before launch, and training on
    customer content MUST be disabled where the provider offers that control.
*   Retention periods for uploaded materials and generated lessons MUST be
    documented before production deployment.

## Testing & Quality Gates

*   Tests MUST be written before the implementation they verify and MUST fail for
    the intended reason before implementation starts. Every principle and every
    functional requirement MUST map to at least one automated test.
*   The test suite MUST include unit tests, API integration tests against a real
    or containerized database, contract tests for public interfaces, and
    end-to-end tests for critical user journeys: registration, upload, lesson
    generation, editing, and grounded chat.
*   The following security tests are mandatory: validation rejection for every
    endpoint, stored and reflected XSS payloads, cross-tenant access attempts for
    every tenant-scoped endpoint, MIME spoofing and oversized uploads, unauthorized
    access to every protected route, and rate-limit enforcement.
*   CI MUST run linting, type checking, unit and integration tests, a production
    build, dependency auditing, and secret scanning on every pull request. A
    failing gate MUST block merge.
*   New or changed code MUST have at least 80 percent line coverage. Authorization,
    validation, sanitization, and upload-handling modules MUST have 100 percent
    branch coverage. Coverage MUST NOT decrease.
*   Every bug fix MUST include a regression test that fails without the fix.
    Flaky tests MUST be fixed or quarantined with a tracked issue before merge.

## Governance

This constitution supersedes all other engineering practices and guidelines.
When a conflict exists between this document and any other project guidance, this
constitution prevails.

Amendments MUST be proposed as a documented change to this file that includes the
rationale, the expected migration impact, and any affected feature plans.
Amendments MUST be approved by the project maintainers before taking effect. The
amending change MUST update the Sync Impact Report, the version line, and the
`Last Amended` date. The Sync Impact Report MUST be removed before the amendment
is committed.

Versioning follows semantic versioning:

*   **MAJOR:** removal or backward-incompatible redefinition of a principle or
    governance rule.
*   **MINOR:** addition of a principle or section, or materially expanded
    guidance.
*   **PATCH:** clarifications, wording refinements, and non-semantic corrections.

Compliance MUST be reviewed at plan approval and at every pull request. Reviewers
MUST verify that the plan's Constitution Check reflects the current version of
this document. A violation MUST block merge until it is resolved or formally
waived in writing by the maintainers with a stated rationale and expiry. The
constitution MUST be reviewed at least quarterly and after any security incident.

**Version**: 2.9.0 | **Ratified**: 2026-11-07 | **Last Amended**: 2026-11-26

