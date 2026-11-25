# Talas — Continuation Roadmap

Constitution is at v2.5.0 (v2.1.0 = commit `a8cdbed` cross-platform dev +
list search; v2.2.0 dev tunneling; v2.3.0 plan-based feature limits; v2.4.0
server-side upload transport; v2.5.0 GridFS object storage — see step 11).
**All seventeen steps are complete (Nov 2026).** Gate order note: run e2e LAST —
its dev server overwrites `.next` chunks, so contract/security suites must
run against a fresh `pnpm build`. The same applies to a long-running
`pnpm dev` on the machine: its recompiles corrupt `.next` for concurrently
running suites (2026-11-20: security suite register 500s traced to a stale
`.next` while `next dev` was live — stop dev processes and rebuild before
gating).

## Step 1 — Session TTLs + redirect hardening (DONE in working tree, UNCOMMITTED)

Completed and tested changes sitting uncommitted:

- lib/env.ts, lib/auth/{access-token,tokens,cookies,refresh}.ts — 24h access / 30d
  refresh TTLs, env-configurable (`SESSION_ACCESS_TTL_SECONDS`,
  `SESSION_REFRESH_TTL_SECONDS`, bounds + refresh >= access validation)
- components/auth/login-form.tsx + lib/auth/access-token.ts — `next` redirect guard
  rejects protocol-relative `//` URLs (open-redirect fix)
- tests/unit/auth/tokens.test.ts — TTL assertions updated
- tests/contract/session-renew.test.ts (specs/003 T007) — NEW, 7/7 passing:
  one-hop renewal, bounded redirect loop, nonce fail-closed (missing/tampered/
  mismatched), cross-site rejection, reuse family revocation
- lib/auth/refresh.ts — BUG FIX: reuse-path family revocation moved OUTSIDE the
  rotation transaction (the throw previously rolled back its own revocation, so
  stolen token families survived)
- Windows harness fixes: tests/helpers/app-server.ts (node spawn + TMPDIR guard),
  next.config.ts (standalone output opt-in via NEXT_OUTPUT_STANDALONE),
  infra/Dockerfile.web (sets that env var)
- .env.example — session TTL vars documented

- [x] Run `pnpm lint`, `pnpm test`, `pnpm test:contract` — verify no regressions
      (2026-11-13: re-implemented on Linux; full gate set green — typecheck,
      lint, 93/93 unit+security, 20/20 integration, 33/33 contract, build)
- [x] Commit Step 1 (feat(auth): high-trust session TTLs, redirect hardening, renewal contract tests + reuse fix)

## Step 2 — OpenCode Go LLM option + v2 insightful lessons (APPROVED plan)

Source: ~/.opencode/plan/plan.md (decided with user, Nov 2026). Land Phase 1
before Phase 2. Touches the same files as Step 1 (lib/env.ts, .env.example),
so do this right after the Step 1 commit.

Locked decisions: grounded-but-pedagogical (not source-only, not full
enrichment); new structural pedagogy fields; MAX_OUTPUT_TOKENS stays 4096
(unit test asserts <= 4096); temperature 0.2 -> max ~0.4; Go subscription
required (Bearer key against https://opencode.ai/inference/go/...).

### Phase 1 — OpenCode Go provider option (AI_PROVIDER=opengo)

- [x] pnpm add @ai-sdk/openai-compatible (1.0.x line — the 3.x line targets the
      newer LanguageModelV4 spec and does not compile against ai@5)
- [x] lib/env.ts: AI_PROVIDER enum ['openai','google','opengo']; add
      OPENCODE_API_KEY (default '') + AI_MODEL_OPENGO (default
      'glm-5.3-flash'); superRefine: OPENCODE_API_KEY required when
      AI_PROVIDER=opengo (production gate, matching the openai/google
      convention)
- [x] lib/ai/provider.ts: createOpenAICompatible({ baseURL:
      'https://opencode.ai/inference/go/openai/v1', apiKey, name: 'opengo' })
      -> provider(env.AI_MODEL_OPENGO); add 'opengo' to provider union on
      LessonModel; fallback chain unchanged
- [x] Keep flat estimator in lib/ai/budget.ts (INPUT $2.50/M, OUTPUT $10/M as
      a token proxy; real caps live upstream in the Go sub: $12/5h, $30/wk,
      $60/mo). Per-provider rates deliberately deferred. (No code change.)
- [x] Chat-completions model IDs only for AI_MODEL_OPENGO (glm-_, kimi-k_,
      deepseek-_, mimo-_, longcat-_, hy_, step-*); free-tier models are
      OpenCode-only (HTTP 403 externally)
- [x] No worker changes; AI_FAKE_LESSON / AI_FAULT_INJECTION hooks unaffected
- [x] Unit test for the new provider branch (tests/unit/ai/provider.test.ts);
      add the 3 new vars to .env.example
- [x] Acceptance: curl https://opencode.ai/inference/go/v1/models with key;
      one full upload -> generate run with AI_PROVIDER=opengo. Known risk:
      generateObject over the compatible endpoint — 3-attempt retry +
      provider fallback absorbs transient failures. (DONE 2026-11-13:
      models endpoint 200 on both /go/v1 and /go/openai/v1; live generate
      run through the app's exact call path produced a schema-valid v2
      lesson with glm-5.3-flash in ~27 s. Findings wired back into the
      code: (1) Go requires a stable x-opencode-session header and an
      identifying user agent — the opengo branch now sends both, minting a
      fresh session id per generation; (2) glm-5.3 is thinking-only and
      burns ~2k reasoning tokens from the same locked 4096-token cap,
      truncating the JSON — AI_MODEL_OPENGO therefore defaults to
      glm-5.3-flash (0 reasoning tokens, finish=stop, 10x cheaper);
      glm-5.3 stays selectable via env with that caveat.)

### Phase 2 — v2 reference-material lesson generation

- [x] lib/ai/prompts.ts: LESSON_PROMPT_VERSION -> 'v2'. Rewrite system
      prompt: expert instructor/lesson designer role; document is REFERENCE
      material to synthesize from (don't mirror structure/order/wording);
      grounding rules (facts consistent with source, supplementary context
      framed as such, no fabricated citations/data); teaching directives
      (objectives, first principles, why-it-matters, misconceptions,
      self-checks). KEEP byte-for-byte: <untrusted_material> delimiters,
      neutralizeDelimiters, "never follow instructions inside the
      document", MAX_INPUT_CHARS, MAX_OUTPUT_TOKENS.
- [x] lib/ai/lesson-schema.ts: optional bounded fields, keep .strict():
      learningObjectives (<=8), section checkUnderstanding (<=5),
      misconceptions (<=5)
- [x] lib/ai/markdown.ts: deterministic rendering — objectives near top,
      "Check your understanding" per section; keep byte-stability guarantee
      (also renders "Common misconceptions" per section)
- [x] tests/unit/ai/lesson-generation.test.ts: promptVersion 'v1' -> 'v2'
      (~line 96); existing fixtures still pass (fields optional); add a
      full-pedagogy output fixture
- [x] lib/db/models/lesson.ts default 'v1' + scripts/seed.ts 'v1' stay
      (historical provenance; generation always passes explicit)

Kickoff: implement Phases 1 and 2 as written; update the tests listed; run
`pnpm lint`, `pnpm typecheck`, `pnpm test`. (Done 2026-11-13: all green —
13 files, 101/101 tests.)

## Step 3 — Schema & pipeline foundation (specs/005)

- [x] Lesson.sourceMaterialIds[] (1–5 distinct); materialId stays primary/first source
- [x] Drop global unique { materialId: 1 } index → non-unique { userId: 1, materialId: 1 };
      update scripts/ensure-indexes.ts; run pnpm db:indexes (ensure-indexes needed no
      change — its generic syncIndexes picks the schema up; verified against a scratch
      replica set: legacy unique index dropped, tenant index created)
- [x] Backfill script: existing lessons get sourceMaterialIds = [materialId]
      (scripts/backfill-lesson-sources.ts + `pnpm db:backfill-sources`, logic in
      lib/db/backfills/lesson-sources.ts with an integration test; verified on
      legacy rows in the scratch DB)
- [x] Explicit-only generation: worker/processors/parse-material.ts stops enqueueing
      generate (scan → parse → ready)
- [x] lib/jobs/schemas.ts — payload { requestId, materialIds[1..5], title, userId,
      correlationId }; job id `generate_lesson_{requestId}`
      (generateLessonRequestJobSchema + generateLessonJobIdFor; wired into the
      worker in Step 4)
- [x] lib/materials/delete-service.ts — no lesson cascade; $pull material from
      lessons' sourceMaterialIds; update delete-material-dialog copy (lessons that
      lose their last source are removed; the next surviving source is promoted to
      the primary materialId)

Step 3 notes (2026-11-13): retry route — generation failures on parsed materials
reset the material to `ready` instead of enqueueing a pipeline stage (and
stageForRetry now keys the parsed check on charCount, not pageCount, which is
always null for text documents). The dormant single-material generate processor
accepts invocation after the pipeline ends (transition gate widened); tests use
the new `generateLessonForMaterial` helper for explicit generation. Gates: typecheck,
lint, 101/101 unit+security, 21/21 integration (new backfill test), 33/33 contract.

## Step 4 — Generation request API + worker rewrite

- [x] lib/db/models/lesson-generation-request.ts { userId, title, materialIds,
      existingLessonId?, status queued|processing|ready|failed, lessonId?,
      lastErrorCode/Message } + indexes; register in ensure-indexes
      (also a worker leaseUntil for crash recovery, ProcessingJob pattern)
- [x] POST /api/lessons/generate { title 1–200, materialIds 1–5 } — auth+CSRF+
      verified-user gate+rate limit; foreign material → non-revealing 404
      (10/hour per user via GENERATE_HOURLY; not-ready materials answer the
      same 404; audit event generation_requested)
- [x] GET /api/lesson-requests/{id} — polling route
- [x] POST /api/lessons/{lessonId}/regenerate — optional materialIds, CAS on version
- [x] Worker: multi-source fetch/extract (per-material 32k + total ~128k caps,
      truncation notices, untrusted-material delimiters), user-supplied title in
      prompts, new-lesson transaction (Lesson v1 + LessonRevision v1), regenerate
      CAS append (save-service pattern), AI budget + audit events
      (processGenerateLessonRequest on the dedicated LESSON_GENERATION_QUEUE;
      title override is deterministic — the requested title always wins;
      exhausted BullMQ retries finalize the request as failed)
- [x] Unit/contract/integration tests for all the above

Step 4 notes (2026-11-13): prompt caps live in lib/ai/prompts.ts
(SOURCE_CHAR_CAP / TOTAL_SOURCE_CHAR_CAP); generate-lesson accepts sources[] +
title and prefers the multi-source prompt builder. Gates: typecheck, lint,
108/108 unit+security, 27/27 integration, 38/38 contract.

## Step 5 — Material image assets

- [x] lib/parsing/extract.ts returns images[]: DOCX via mammoth image emitter
      (position markers); PDF raster XObjects (skip <8KB icons, dedupe by hash,
      cap 10/material, ≤1280px, skip exotic colorspaces)
- [x] Image-only PDFs: render pages via pdfjs + @napi-rs/canvas (new worker-only
      dependency) → PNG assets (also fixed a pre-existing bug: the null-byte
      scan in verify-object ran before binary MIME detection, so real
      DOCX/PDF uploads could never pass confirm)
- [x] lib/db/models/material-asset.ts { userId, materialId, assetKey, contentType,
      byteSize, pageNumber?, width?, height? } + indexes; S3 at
      materials/{userId}/{materialId}/images/{assetId}
- [x] GET /api/materials/{materialId}/images/{assetId} — auth, tenant-scoped,
      Cache-Control private
- [x] Prompt image catalog; post-processing URL allowlist (lib/ai/images.ts) —
      only catalog URLs survive; vision parts for image-only sources; extend
      AI_FAKE_LESSON fake path
- [x] MarkdownRenderer img component (responsive, dark-mode border)
- [x] Tests: extraction heuristics, URL allowlist, image-route contract
      (tenant isolation, non-revealing 404), image-only lifecycle

Step 5 notes (2026-11-13): rendering requires registering @napi-rs/canvas's
Path2D/Image/ImageData on globalThis BEFORE the pdfjs import (pdfjs caches its
polyfill at module init). Images are best-effort throughout — extraction and
storage failures never fail the parse; generation rides the vision path for
image-only sources and the allowlist strips every non-catalog URL from stored
lesson content. Gates: typecheck, lint, 115/115 unit+security, 30/30
integration, 38/38 contract.

## Step 6 — UI flow

- [x] app/(app)/lessons/new/page.tsx + components/lessons/new-lesson-form.tsx —
      title input + checkbox multi-select of ready materials + request polling
      (lands on the fresh lesson when the request turns ready)
- [x] Dashboard + lessons list "New lesson" CTA
- [x] Lesson read view: Regenerate dialog (pick additional materials, poll,
      success banner "Version N generated") + Built-from-sources line with
      links; lesson lookup via sourceMaterialIds on material pages, plus a
      "Use in lesson" hint for ready materials without a lesson
- [x] Material pages: status copy updates (no auto-generate messaging — the
      processing label now says "Extracting the document text")
- [x] Update tests/e2e journeys for the new navigation (11/11 e2e tests green
      against the real stack: Mongo RS + Redis + RustFS S3 + worker)

Step 6 notes (2026-11-13): the e2e stack is provisioned by the new
scripts/dev-services.sh (Linux counterpart of dev-services.ps1 — Mongo RS via
host networking so the announced address resolves, Redis, and RustFS as the
S3-compatible store because the MinIO image is unreachable from this network;
bucket CORS is configured by the script since presigned browser uploads need
it). The e2e server env used to need RATE_LIMIT_DISABLED=true because the
constitutional limiters accumulate across runs in the long-lived dev process —
that escape hatch is gone (Step 9, Nov 2026): limits are live everywhere and
the e2e suite resets them per test through /api/test/reset-limits,
and two app-level fixes came out of the journeys: the CSP connect-src now
allows http://127.0.0.1:* and http://localhost:* outside production (local S3
uploads are plain HTTP), and the auth e2e expectations were updated for the
strict-mode duplicate-email display. Gates: typecheck, lint, 115/115
unit+security, 30/30 integration, 38/38 contract, 11/11 e2e.

## Step 7 — Dark mode (semantic tokens)

- [x] next-themes + ThemeProvider + suppressHydrationWarning on html (app/layout.tsx)
- [x] app/globals.css: @custom-variant dark; :root/.dark semantic vars
      (--background, --foreground, --card, --muted, --border, --input,
      --muted-foreground via @theme inline); color-scheme light dark
- [x] Refactor ~15 components from hardcoded slate classes to semantic classes
      (34 files swept: bg-white→bg-card, bg-slate-50→bg-background,
      text-slate-_/border-slate-_/divide-* → semantic equivalents); status
      badges and banners gained dark:* variants (emerald/red/amber/indigo/sky
      → dark:bg-_-950/dark:text-_-300); dark:prose-invert for MarkdownRenderer
- [x] Sun/Moon toggle in components/auth/session-nav.tsx
      (components/auth/theme-toggle.tsx, hydration-safe mounted guard)

Step 7 notes (2026-11-13): dialog scrims (bg-slate-900/40) and text-white
accents are intentionally theme-neutral. Gates: typecheck, lint, 115/115
unit+security, 30/30 integration, 38/38 contract, 11/11 e2e.

## Step 8 — Gates & bookkeeping

- [x] Full gates: pnpm typecheck lint test test:integration test:contract test:e2e
      (2026-11-13: typecheck, lint, 115/115 unit+security, 30/30 integration,
      38/38 contract, 11/11 e2e, build — all green. IMPORTANT ORDERING: run
      e2e LAST; its dev server overwrites .next chunks, so contract/security
      suites must run against a fresh `pnpm build`.)
- [x] Write specs/005-lesson-authoring-flow/{spec,plan,tasks}.md with checked tasks
- [x] Amendment notes: specs/001 (FR-008 image-only support, FR-011 unique-index
      reinterpretation), specs/003 (new TTLs; check off T007/T008)
- [x] Final commit(s)

## Step 9 — Plan-based feature limits (DONE 2026-11-18)

Every user is on a plan by default (`free`). Limits are per tier and derived
from one config source, so adding a higher tier later is a config + enum
change only — no enforcement logic edits. Billing/checkout is out of scope;
tiers change via script/DB.

Quotas (single source of truth: `lib/plans.ts`, `PLANS` keyed by plan id):

| Limit                          | free  | plus  | Notes                                                             |
| ------------------------------ | ----- | ----- | ----------------------------------------------------------------- |
| Materials stored               | 5     | 25    | counts non-deleted (incl. awaiting_upload / failed / quarantined) |
| Chars per material (extracted) | 10000 | 10000 | same storage conditions as free, per the plan decision            |
| Lessons stored                 | 1     | 5     | non-deleted                                                       |
| Lesson generations per day     | 1     | 5     | = tier lesson quota; UTC daily reset; failed attempts refunded    |

- [x] `lib/plans.ts` — `PLANS` record + `PLAN_IDS` enum (`'free'`, `'plus'`);
      `dailyLessonGenerations` defaults to the tier's `lessons` quota (unit
      test pins that derivation invariant; the field stays overridable so a
      future high-storage tier could be capped lower). Failure codes
      (`plan_material_limit`, `plan_lesson_limit`, `plan_char_limit`,
      `plan_generation_limit`) declared here.
- [x] User model: `plan` enum field, default `'free'` (existing users read as
      free — no migration). `scripts/set-plan.ts` + `pnpm db:set-plan <email>
    <plan>` for manual tier changes; seed makes bob `plus`, alice stays
      `free` (two-tier e2e coverage).
- [x] Usage service: per-user counts of non-deleted materials and lessons.
- [x] Enforcement: - presign (the record-creating step) → material quota exceeded → 403
      quota envelope; second check at upload confirm (double-submit race
      guard) - parse processor → `charCount` > plan cap → status `failed`,
      `failureCode: plan_char_limit`, user-visible reason + split
      guidance; fails BEFORE chunking/embedding (no wasted cost) - split flow (user decision): an over-limit upload asks the user to
      split it into multiple files, each counting against the quota; if
      split re-uploads hit the quota wall, INFORM FIRST (403 states the
      shortfall), then auto-purge the over-limit originals (existing
      delete-service: S3 + chunks + assets + record; audit event
      `plan_limit_purge`); the retry then fits - `POST /api/lessons/generate` → lesson storage 403 first, then daily
      allowance 403. Regeneration is EXEMPT from the allowance (user
      decision); the 10/hour limiter and `AI_DAILY_BUDGET_USD` stay as-is.
- [x] Daily allowance counter: Redis key `plan:gen:{userId}:{UTC-date}`,
      TTL to next UTC midnight; atomic reserve (Lua INCR with cap check) at
      request admission, refund on terminal failure; the 403 response
      carries `resetsAt` so the UI can show "resets in 7h".
- [x] `GET /api/me/usage` → `{ plan, materials: {used, limit},
    lessons: {used, limit}, maxMaterialChars, generations: {used, limit,
    resetsAt} }` — deliberately a SEPARATE endpoint: the list APIs MUST
      NOT change their response envelope shapes (constitution v2.1.0). UI:
      usage badges ("3/5 materials", "2/5 generations today · resets in
      7h") on materials + lessons pages, quota-error dialog copy, and a
      split-guidance banner on char-limit failures.
- [x] Tests: unit (plans config invariants incl. the allowance derivation,
      usage service, allowance/reset math) · integration (each limit
      blocked → delete frees the slot → plan switch applies immediately;
      char-limit failure path; auto-purge on split-block; allowance refund
      on failure; UTC rollover frees the counter) · contract (403 quota
      envelope shape, usage endpoint auth/shape) · e2e (free journey: fill
      both limits → errors → delete → reclaim → succeed; second generation
      the same day → 403 even after deleting the lesson).
- [x] Gates: typecheck, lint, unit+security, integration, contract, build,
      e2e LAST (fresh build for contract if e2e ran first).

Step 9 notes (2026-11-18):

- Landed WITH the "rate limiting live everywhere" change: the
  `RATE_LIMIT_DISABLED` escape hatch is REMOVED from
  `lib/security/rate-limit.ts` — every limiter enforces in every
  environment. The e2e suite stays green via `/api/test/reset-limits`
  (e2e-mode-only) which flushes BOTH the in-memory limiter/allowance maps
  AND the shared-store keys (`talas-rl:*`, `talas-plan-gen:*`) — necessary
  because `next dev` forces NODE_ENV=development, so the e2e server runs
  Redis-backed limiters that would otherwise accumulate across runs in the
  long-lived dev process. Limiter maps live on `globalThis` (the repo's
  singleton convention) because next dev compiles per-route bundles.
- The quota error envelope is a NEW `plan_limit` 403 code with a
  `details` object (`reason`/`used`/`limit`/`purged`/`resetsAt`); the
  generic `AppError` gained an optional `details` field (error envelope
  stays consistent, existing consumers unaffected).
- Playwright runs with `workers: 1` — parallel workers raced the same
  seeded lesson's CAS versions across spec files (pre-existing flake the
  stricter run exposed) and share the live rate-limit budget.
- e2e repeatability: the upload journey runs as bob (plus) and reclaims his
  content through the public API only when his usage approaches the plan
  limits (`clearAccountContent` in tests/e2e/helpers.ts).

Notes:

- Grandfathering: existing over-limit data is NEVER purged to satisfy the
  limits — they gate only new actions. E2e uses fresh accounts (seeded data
  may exceed free limits).
- Constitution v2.3.0 reflects this under Principle IV (File Upload
  Security & Resource Control).
- Future enhancements (not this step): server-side guided document
  splitting (PDF/DOCX auto-split is its own project); billing-driven tier
  upgrades; per-tier AI USD budgets.

## Step 10 — Mobile nav UX polish (brand restyle follow-up, DONE 2026-11-20)

Follow-ups from the Nov 2026 brand restyle of the session nav
(components/auth/session-nav.tsx + session-nav-links.tsx):

- [x] Hamburger menu on mobile: below the breakpoint the nav links collapse
      into a hamburger toggle (the restyled rounded card currently wraps the
      links inline); keep the orange active-page pill highlight inside the
      opened menu
- [x] Don't squish the logo: reserve its natural size on narrow screens
      (it currently shrinks when the nav row wraps)
- [x] Sign out stays at the end: it is the last action in the nav on all
      viewport sizes (mobile menu bottom, desktop row end)
- [x] The light/dark theme toggle is NOT inside the hamburger menu — keep it
      as a standalone icon button outside the collapsible section

Gates: typecheck, lint, unit tests, visual check of the nav at mobile and
desktop widths in both themes.

Step 10 notes (2026-11-20): SessionNav is now a client component (the `user`
prop is the plain serializable object `getSessionUser` returns). Collapse
breakpoint is md: below it the links live in `#session-nav-mobile-menu`,
which closes on Escape and on any route change; the toggle carries
`aria-expanded`/`aria-controls` and `data-testid="mobile-nav-toggle"`. The
card stays `rounded-3xl` until md so the opened menu sits inside a card
instead of a pill. Sign out is `hidden md:inline-flex` in the row and
full-width at the menu bottom. Also landed this session: the logged-out
homepage (`app/page.tsx`) shows the shared ThemeToggle next to Sign in.
Gates green 2026-11-20: typecheck, lint, 139/139 unit+security; visual
check via Playwright screenshots (375×812 + 1280×800, both themes, menu
open/closed, homepage light+dark).

## Step 11 — MongoDB Atlas + GridFS object storage, S3 removed (DONE 2026-11-20)

Locked with the user (plan session): DB target is Atlas (already mandated by
specs/004) and object storage moves into the database as GridFS — the
S3-compatible store is dropped entirely. Defaults: local Mongo in dev, Atlas
in prod config; fresh contract amendment for the unused presign fields;
constitution amendment as v2.5.0. A one-off migration copied the existing dev
objects before the S3 driver was deleted.

- [x] Phase 1 — storage seam: lib/storage/object-store.ts defines the
      six-operation contract (putObject / headObject / getObjectBytes /
      getObjectPrefixBytes / deleteObject / deleteObjectPrefix) and every
      call site (upload route, confirm, download, assets, delete-service,
      delete-account, scan/parse/generate processors, seed) imports the seam.
      Gates: typecheck + lint.
- [x] Phase 2 — GridFS driver (lib/storage/gridfs.ts, bucket `objects`,
      mongoose.mongo.GridFSBucket): same key scheme, `name: 'NotFound'`
      errors preserved (confirm maps them to `upload_missing`), prefix reads
      capped at one 255 KiB chunk, prefix deletes by escaped-regex filename.
      Legacy `createPresignedUpload` + the in-process fake store deleted;
      presign route returns `{ materialId, expiresAt }` only;
      openapi.yaml `PresignResponse` amended; tests de-faked — the fake
      store helper became `tests/helpers/material-upload.ts`
      (`uploadToStorage`, real putObject) and image-asset assertions read
      GridFS directly. Gates: build, 139/139 unit+security, 53/53
      integration, 49/49 contract.
- [x] Migration — objects copied from RustFS into GridFS before deletion
      (source list from Material.storageKey + MaterialAsset.assetKey,
      idempotent skip, byte-length verification): 8 copied, 0 failed.
- [x] Phase 3 — S3 deleted: `lib/storage/s3.ts`, both `@aws-sdk/*`
      dependencies, all `S3_*` env vars (env schema + .env.example +
      .env.local + both stack env templates), RustFS/SeaweedFS services and
      bucket-CORS blocks removed from infra/docker-compose.yml,
      scripts/dev-services.sh, scripts/dev-stack.sh, and
      scripts/dev-stack.ps1 (platform parity); CSP `connect-src` narrowed
      to `'self' https:` (the localhost extras existed only for presigned
      uploads). Gates: build, 139/139 unit+security, 53/53 integration,
      49/49 contract.
- [x] Phase 4 — docs & amendments: constitution v2.5.0 (Principle IV:
      storage rides the database, presigned-URL clause retired);
      specs/001 presign-response amendment; specs/004 provisioner list +
      Data Lifecycle amendment (one Atlas backup covers records and bytes);
      TODO deployment checklist storage item rewritten; infra/README and the
      dev-env notes updated. E2E 12/12 LAST against the real stack
      (upload journey + lesson generation through the browser, with the
      RustFS container stopped).

Notes (2026-11-20):

- One backing service fewer in dev and prod: records AND bytes live in the
  same replica set, so `mongodump`/Atlas backups capture everything.
- Atlas sizing now includes blob bytes: M0 free tier (512 MB) is dev-only;
  production wants M10+ once 25 MB uploads per user multiply.
- e2e repeatability unchanged: journeys still reclaim bob's content through
  the public API before hitting plan limits.
- Constitution v2.3.0 note elsewhere in this file (step 9 section, upload
  route comments) predates this amendment; v2.5.0 is authoritative.

## Step 12 — Image-aware lesson generation (DONE 2026-11-23)

The FR-008 image pipeline existed end to end (extraction → tenant-scoped
assets → URL allowlist), but the model was never told to use it: the v3
system prompt's output contract did not mention figures, and the catalog
appended to the user prompt was a bare URL list with no source context, so a
text-only model (glm-5.3-flash) had neither instruction nor information to
judge relevance — generated lessons shipped without images.

- [x] prompts v4 (`lib/ai/prompts.ts`): new `LessonImageInput` (url, filename,
      pageNumber, width, height); `renderFigureSection` lists each figure with
      its source context ("Figure 1 (from photosynthesis.pdf, page 3,
      1600×900): url"); `buildMultiSourceLessonPrompt` and
      `buildLessonPrompt` take `images`; the system-prompt output contract
      now allows figures inside `contentMarkdown` as `![alt](url)` — only
      catalog URLs, only when they genuinely illustrate the point, at most
      1 per section and 6 per lesson (protects the locked 4096-token cap),
      never invented or altered. `LESSON_PROMPT_VERSION` 'v3' -> 'v4'
      (historical rows keep their stored version).
- [x] wiring (`lib/ai/generate-lesson.ts` + worker): `GenerateLessonInput.images`
      feeds the prompt builders; `imageCatalog` remains the sanitization
      allowlist and is derived from `images` when absent (fake path and
      confirm-time `sanitizeGeneratedImages` unchanged). The worker builds the
      enriched catalog from `MaterialAsset` + a materialId→filename map.
- [x] tests: 3 new unit tests (figure section rendered into the prompt with
      context; allowlist derived from `images`; non-catalog URLs stripped);
      prompt-version expectations moved to 'v4'. Vision-parts behavior for
      image-only sources unchanged (deliberately out of scope: inline vision
      for text-bearing sources, AI-written alt text).
- [x] Gates (run in an isolated git worktree so the live dev stack was never
      interrupted): build ✓, 142/142 unit+security (one pdfjs test timed out
      once under cold-start load and passed on retry), 53/53 integration,
      49/49 contract, 12/12 e2e LAST.

Notes (2026-11-23):

- Relevance with a text-only provider is judged from context (source file,
  page, surrounding prose), not pixels — the browser renders the images.
  Inline vision parts for openai/google providers are a possible follow-up.
- To see figures in a generated lesson, upload a PDF or DOCX that contains
  them (Markdown sources have nothing to extract).
- Worktree pattern recorded: gate runs against a live user stack use a
  separate checkout (own .next build, ephemeral test DBs) — no more
  stopping the user's web server for suites.

## Step 13 — Raster extraction actually extracts (DONE 2026-11-23)

Step 12 made the model image-aware, but generated lessons still shipped
without figures — and the cause turned out to be upstream of the prompt: the
raster-extraction path for text-bearing PDFs never extracted anything.

- [x] Root cause: `lib/parsing/pdf.ts` built its image-operator filter from
      `document.OPS` — but the OPS enum lives on the pdfjs MODULE, not on the
      document proxy. `imageOps` was silently empty, so every text-bearing
      PDF matched zero image operators and returned 0 assets. Invisible for
      days because the extractor is deliberately best-effort and no test
      covered a text-bearing PDF with embedded rasters (DOCX fixtures and
      image-only PDFs take the other two paths).
- [x] Fix: build the filter from `pdfjs.OPS`; replace the synchronous
      `page.objs.get()` read (which can throw "object isn't resolved yet"
      right after the operator list is built) with the pdfjs callback API
      bounded by a short timeout, falling back to `commonObjs` for shared
      XObjects.
- [x] Vision-parts scope fix (worker): base64 image parts attach only for
      IMAGE-ONLY sources. A text-bearing source rides the catalog path; the
      previous loop attached megabytes of image data to text-only providers
      (glm-5.3-flash) and the request died with provider_unavailable.
- [x] Observability: the parse log now reports the extracted image count
      alongside pageCount/charCount; a leftover `[render-debug]`
      console.error in the page-render fallback was removed (best-effort
      failures stay visible through the parse log).
- [x] Tests: `buildPdfWithImage` fixture (hand-assembled PDF with text +
      FlateDecode DeviceRGB raster — deterministic pseudo-random pixels so
      the PNG clears the 8 KB floor); unit test asserts extraction returns
      the image with page/dimensions; integration test pushes the fixture
      through the real pipeline and asserts the asset lands in GridFS and the
      generated lesson embeds its catalog URL. Fixture text must exceed the
      sparse threshold (200 chars) or the document correctly routes to the
      image-only render path instead.
- [x] Live verification with the real pipeline (eve@talas.local): the
      "Module 3 — Dynamics, Newton's laws" PDF produced 5 assets
      (pages 1/3/5/7), generation came back ready with 3 figures embedded
      in an 8,194-char lesson.
- [x] Gates (isolated git worktree, live stack untouched): build ✓, 143/143
      unit+security, 54/54 integration, 49/49 contract. E2E skipped this
      round: its lesson-editor tests expect alice's seeded lesson, which the
      user's own cleanup had deleted (shared-DB drift, not code) —
      `pnpm db:seed` restores it whenever a future e2e run is wanted.

Notes (2026-11-23):

- The 8 KB "worth keeping" floor still drops tiny logos/bullets by design.
- Vision parts for text-bearing sources on vision-capable providers
  (openai/google) remain a possible follow-up; today the catalog path is
  provider-agnostic and works with text-only models.

## Step 14 — Long quizzes from multiple lessons (DONE 2026-11-24)

Learners can generate practice quizzes of exactly 20, 30, or 50
multiple-choice items from 1–N finished lessons. Plan-tiered: stored quizzes
3 (free) / 5 (plus); lessons per quiz 3 (free) / 7 (plus); each generation
consumes one daily-generation point (refunded on terminal failure).

- [x] Data + API: Quiz model (status/lease/questions with per-question source
      attribution, 20/30/50 item-count enum), POST/GET/DELETE /api/quizzes —
      auth + verified + CSRF + GENERATE_HOURLY; foreign/not-ready lessons
      answer the same non-revealing 404; plan failures use the 403 envelope
      (plan_quiz_limit, plan_quiz_sources, plan_generation_limit); deleting
      frees the storage slot immediately. The answer key (correctIndex,
      explanation) never leaves the server — reveal/scoring are deferred.
- [x] AI: batched generation — ceil(items/5) sequential generateObject calls
      (each inside the locked 4096-token cap), later batches see already-
      written topics to avoid repetition, +2 replacement batches, exact-count
      enforcement with dedupe, per-call budget recording, provider fallback
      per batch, deterministic fake under AI_FAKE_LESSON. Quiz jobs run under
      a 10-minute ceiling (the default 120 s MAX_JOB_MS cannot fit ten
      batches) with the same lease/crash-recovery pattern; the reconcile
      sweep and finalize-on-exhaustion paths cover the new queue.
- [x] UI: Quizzes nav entry (hamburger picks it up), list page with status
      badges + pagination, new-quiz form (multi-select lessons capped by
      plan, 20/30/50 length selector, polling), quiz read view that polls
      until ready and renders questions without the answer key, and a
      "Generate quiz" entry on the lesson read view.
- [x] Plans: PLANS gains quizzes (3/5) + maxQuizSources (3/7) with failure
      codes; unit test pins the tier invariants.
- [x] Constitution v2.6.0: quizzes consume the daily allowance; quiz storage
      and per-quiz source limits are plan-tiered under Principle IV.
- [x] Gates (isolated git worktree, live stack untouched): build ✓, 147/147
      unit+security, 61/61 integration, 49/49 contract. E2E skipped per the
      standing preference. Two flakes traced to machine load (a concurrent
      vitest run in another project starved mongodb-memory-server boots)
      plus one real fake-fidelity bug: the deterministic quiz fake repeated
      question texts across batches, tripping the exact-count dedupe — fixed
      with a per-call counter so every fake batch is fresh.

Notes (2026-11-24):

- Reveal-answer and scored-attempt modes are deliberately deferred; the
  answer key stays server-side until then.
- Item attribution comes from the model naming the source lesson; a later
  vision-capable pass could tighten it.

## Step 15 — Lesson quota bump + quizzes list UX (DONE 2026-11-24)

- [x] Plan limits (option A): lessons stored free 1 → 3, plus 5 → 7; the
      daily-generation allowance follows the derivation (free 3 / plus 7) —
      lessons and quizzes share the pool, so a free user can now generate a
      lesson and a quiz the same day. Materials, characters, stored quizzes,
      and per-quiz source caps unchanged. Unit test pins the new numbers.
- [x] Failed quizzes never appear: the worker deletes the row at terminal
      failure (processor error, exhausted retries) after the audit event and
      allowance refund — nothing failed is ever stored, listed, or counted.
      Both pollers translate the resulting 404 into a retryable failure
      message.
- [x] Quizzes list matches the other lists: title search (q), status groups
      (all / ready / generating — no failed group exists), sorts (recent /
      oldest / title), pagination via the shared buildListHref helper;
      quizListQuerySchema joins lib/validation/list-queries.ts. The shared
      ListToolbar was restyled to the pill design (search pill, status tab
      pills, sort links — debounced search, immediate pill navigation,
      testids preserved) and the materials and lessons screens adopted the
      same toolbar, standalone list cards, pagination links, and row
      styling, so all three list screens look identical. The e2e journey was
      updated from selectOption to pill clicks for the future run.
- [x] Constitution v2.7.0 (MINOR): lesson storage 3/7; failed quiz attempts
      are removed at terminal failure and never occupy storage or lists.
- [x] Gates (isolated git worktree, live stack untouched; run once for steps
      15+16 together): build ✓, 150/150 unit+security, 64/64 integration,
      49/49 contract. E2E skipped per the standing preference.

Notes (2026-11-24):

- Deleting a quiz remains available for ready quizzes (frees the slot);
  failed ones are already gone by the time you'd look.
- Reveal-answer and scored-attempt modes stay deferred (step 14 note).

## Step 16 — Interactive quizzes: select → submit → score (DONE 2026-11-26)

Quizzes become two-mode experiences. Interactive mode: radio picks per
question (leave blank to skip), a sticky answered-count bar, and submit.
Results mode: server-side grading against the answer key — score header,
per-question your-answer vs correct option (red/green), and the model's
explanation finally visible — plus the score history across unlimited
retakes and a Retake button. The answer key never leaves the database
before the matching submission.

- [x] Data: Quiz.attempts[] — { answers (-1 = skipped), scoreCorrect,
      scoreTotal, submittedAt }; unlimited submissions append attempts.
- [x] API: POST /api/quizzes/{id}/submit (auth + CSRF, length-checked against
      itemCount, 409 while generating, 404 for foreign ids); grading in
      lib/quizzes/grading.ts; GET /{id} serves three shapes — progress,
      interactive (no key), results (?attempt=N replays any attempt, default
      latest) with the score history.
- [x] UI: components/quizzes/quiz-experience.tsx — interactive form
      (selection state client-side; a mid-retake refresh discards
      selections), results rendering with your-pick/correct highlighting,
      history chips, retake button. The server page passes the latest
      results when attempts exist.
- [x] Tests: grading unit tests (correct/wrong/skipped/out-of-range);
      integration — append semantics across retakes, history + ?attempt
      replay, length and range validation, foreign 404, pre-submission key
      withholding. Grading consumes no allowance.
- [x] Constitution v2.8.0 (MINOR): server-side graded attempts stored with
      scores; answer keys exposed only after the matching submission.
- [x] Gates (isolated worktree, live stack untouched; the same run as step
      15): build ✓, 150/150 unit+security, 64/64 integration, 49/49
      contract. E2E skipped per the standing preference. One
      fake-fidelity bug fixed en route: the deterministic quiz fake repeated
      question texts across batches, tripping the exact-count dedupe — fixed
      with a per-call counter. Test-side rate-limit collisions were fixed
      with spoofed per-registration client IPs, the allowance-separation
      test now exhausts the allowance directly, and one stale contract
      assertion moved to the new allowance numbers.
- [x] Step 16.1 (same day): submissions require EVERY question answered —
      the submit schema rejects skips (-1) with a 400, the sticky bar
      disables Submit until all N are answered, and the grading/results
      paths drop the skip semantics. Gates re-run in the worktree: build ✓,
      150/150 unit+security, 64/64 integration, 49/49 contract.

## Step 17 — Output cap doubled to 8192 tokens (DONE 2026-11-26)

Found live (step 15/16 verification): `glm-5.3-flash` DOES reason on
complex, figure-rich input — and hidden reasoning shares the completion
budget. The figure-dense physics lesson burned all 4096 tokens on
`reasoning_content` alone (`finish_reason: length`, `content: null`, no
JSON emitted), failing generation deterministically. The .env comment's
"no reasoning tokens" assumption was wrong for complex inputs.

- [x] `MAX_OUTPUT_TOKENS` 4096 → 8192 (lib/ai/prompts.ts); the quiz path now
      reads the shared constant instead of a hardcoded 4096; unit test pins
      the new ceiling; comments updated (.env.example, quiz-prompt,
      generate-quiz). Historical step-2 note stays as the record of what we
      believed then.
- [x] Constitution v2.9.0 (MINOR): generation output cap is 8192 tokens,
      accommodating reasoning models whose hidden reasoning shares the
      completion budget.
- [x] Gates: typecheck, lint, 39/39 AI unit tests (lesson + quiz + plans).
      Integration/contract untouched (the fake ignores token limits); the
      running worker picked the constant up via tsx watch automatically.

## Step 18 — Staged lesson generation: outline → per-section → quiz (DONE 2026-11-26)

The 8192 cap (step 17) was still not enough: on the figure-rich physics
PDF the reasoning model burned the whole budget drafting inside hidden
reasoning before emitting any JSON, so single-call lesson generation
failed deterministically on complex input. Structural fix instead of
another cap bump: the pipeline now runs THREE small `generateObject`
calls whose tasks are each small enough that reasoning cannot exhaust
the token cap — an outline (summary, objectives, 3–8 section headings,
figure assignment), one call PER SECTION (≤1200-char body + pedagogy
fields), and a quiz call grounded in the finished lesson text.

- [x] `lib/ai/lesson-staged-schemas.ts` — outline/section/quiz zod
      schemas; `lib/ai/prompts.ts` — staged system+user prompt builders
      (`v5`), including the stored-figure catalog in the outline prompt
      and the assigned-figure instruction in each section call;
      `lib/ai/generate-lesson.ts` rewritten as the staged pipeline
      (provider chain + 3 retries per stage preserved, per-call token
      accounting summed across stages, `reasoningEffort: high` on every
      opengo call, user title forced at assembly, catalog allowlist
      sanitization unchanged).
- [x] Lesson version recorded as `v5`; single-call prompt builders stay
      exported but unused.
- [x] `AI_FAKE_LESSON` fake covers all three stages, including figure
      assignment (outline picks `- Figure 1 (…): URL`, section embeds it
      once) so the FR-008 figure flow exercises end-to-end.
- [x] Position distribution (step 16.2) interacts with retake tests:
      correct options no longer always sit at index 0 — the quizzes
      integration test now locates the correct option by its TEXT in the
      pre-submission view instead of blindly answering A.
- [x] Gates (isolated worktree): build ✓, unit suite green, integration
      suite green (materials figure-flow 17/17, quizzes 10/10 incl. the
      retake rewrite), contract suite green. E2E skipped per the
      standing preference.

## Dev environment notes (Windows + PowerShell, Linux + bash)

Shared:

- Node >=20 (engines warn on Node 24; benign). pnpm 9.15.9
  (`npm i -g pnpm@9.15.9` on Windows; corepack works too).
- Windows: `git config core.longpaths true` and
  `pnpm config set store-dir D:\talas\.pnpm-store` keep long paths and the
  package store off the small C: drive. mongod 7 needs the VC++ 2015-2022 x64
  redistributable (both the dev stack and the mongodb-memory-server binaries).
- `pnpm exec playwright install chromium` once per machine before e2e.
- Replica-set bootstrap is shared: scripts/init-replica-set.mjs (mongoose
  directConnection — no mongosh, which the MongoDB Windows zip lacks). Run it
  whenever a data dir is wiped.
- pnpm db:seed → five demo accounts, password talas-local-password:
  alice/carol/dave@talas.local (free plan), bob/eve@talas.local (plus plan,
  so journeys can exercise higher-tier limits). Alice also gets a sample
  lesson. Switch tiers by hand with `pnpm db:set-plan <email> <free|plus>`.
- Worker does not read .env.local itself: bash `set -a; . ./.env.local; set +a;
pnpm worker:dev`; Windows `scripts/dev-stack.ps1 worker` (`-Db <name>` to
  point it at another db, e.g. talas-e2e for e2e runs).
- e2e runs LAST (its dev server overwrites .next chunks — fresh `pnpm build`
  before contract/security if e2e ran first). Local e2e needs the dev stack up
  plus `DATABASE_URL`/`REDIS_URL` pointing at it (export the
  `scripts/dev-stack.ps1 env` template in-shell — NODE_ENV=test skips
  .env.local). Rate limits and plan quotas are LIVE in e2e: the suite resets
  limiter + allowance state per test through `/api/test/reset-limits`
  (e2e-mode only), the upload journey runs as bob (plus plan), and its
  beforeAll clears bob's content so repeated runs never hit the storage
  quotas. A plain `pnpm dev` server (no E2E_MODE) must not be reused for e2e.

No-Docker stacks (same ports: Mongo rs0 27098, Redis 6399;
data/binaries/logs under .data/dev-stack):

- Windows: scripts/dev-stack.ps1 — `start [-Seed] [-Fresh] | stop | status |
env [-Write] | seed | worker [-Db <name>]`. Binaries auto-download (MongoDB
  Windows zip, Redis 7.4.5 community build with a Redis 5.0.14 fallback).
  `env -Write` creates .env.local (PowerShell
  `>` redirects are UTF-16, which dotenv parsers reject). Redis builds are
  community projects — dev use only.
- Linux: scripts/dev-stack.sh (same interface, bash; mongod auto-downloads
  from fastdl.mongodb.org). Use it when Docker is
  unavailable (ARM boxes, restricted sandboxes).
- Docker (Linux): scripts/dev-services.sh (Mongo RS via host networking, Redis;
  data under .data/dev-services).
- Uploaded files live in GridFS inside MongoDB (the `objects` bucket, TODO
  step 11) — the same replica set backs records and bytes, so `mongodump`
  captures everything; login/AI/email work
  via fake modes in .env.local.
- Exposing the dev server (ngrok): install ngrok (Windows: `winget install
ngrok.ngrok` — needs >= 3.29 for current accounts; `ngrok update` if winget
  shipped an old one. Linux: snap, brew, or the official deb repo). Both dev
  stacks expose a `tunnel` subcommand — `scripts/dev-stack.ps1 tunnel` /
  `scripts/dev-stack.sh tunnel` — with the same NGROK_DOMAIN semantics:
  empty in .env.local serves a random free URL that changes on every
  restart; set `NGROK_DOMAIN=<name>.ngrok-free.app` after claiming the one
  free static domain at dashboard.ngrok.com/domains for a permanent URL.
  `status` reads the real public URL from ngrok's local inspection API on
  127.0.0.1:4040. Same-origin browsing through the tunnel needs no CORS
  change (bucket CORS is `*` locally); cross-origin API calls additionally
  need the origin in CORS_ALLOWED_ORIGINS. next.config.ts
  allowedDevOrigins covers *.ngrok-free.dev / *.ngrok-free.app; machine-
  specific hosts (e.g. the LAN IP) go through NEXT_DEV_ALLOWED_ORIGINS.
  Uploads and generation work fully through the tunnel: the browser PUTs
  the file to the app route (/api/materials/{id}/upload) and the server
  writes it into the object store, which stays private and unreachable
  from browsers (constitution v2.4.0). Anyone with the URL can use the app
  (demo accounts have a known password) — stop the tunnel when done.
  (Constitution v2.2.0 covers this under Principle V.)

## Deployment pre-flight checklist (standing session rule)

**When deployment details are requested, ALL of the following must be
activated and confirmed BEFORE proceeding — anything off is a blocker.**

- [ ] Secrets: real `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `CSRF_SECRET`
      and S3 credentials set (the env schema rejects `development-*` defaults
      in production — that validation must pass, never be bypassed)
- [ ] AI provider: real key + `AI_PROVIDER` set; Go subscription caps
      acknowledged ($12/5h, $30/wk, $60/mo); `AI_DAILY_BUDGET_USD` deliberate
- [ ] Rate limits & lockout: live for every environment — there is no disable
      switch anymore (Step 9 removed `RATE_LIMIT_DISABLED`); upload limits,
      login lockout, and the plan quotas are always enforced. Production
      builds never mount the e2e-only `/api/test/reset-limits` endpoint.
- [ ] Malware scanning: real ClamAV endpoint (`CLAMAV_FAKE` empty) — infected
      files are actually quarantined
- [ ] Storage: GridFS in the primary database (constitution v2.5.0 — no
      separate object store); private-cache headers verified on asset/download
      routes; Atlas cluster sized for blob bytes (25 MB × plan quota per user)
- [ ] Session TTLs: `SESSION_ACCESS_TTL_SECONDS` / `SESSION_REFRESH_TTL_SECONDS`
      deliberately chosen (24h/30d defaults or stricter), not dev values
- [ ] Email: real transport (`RESEND_API_KEY`), not mailhog/memory
- [ ] CSP/connect-src: no dev-only localhost allowances (production-excluded
      by code — confirm the deployed build reflects that)
- [ ] Gate order respected on the build machine: e2e LAST (its dev server
      overwrites `.next` chunks) — or a fresh `pnpm build` before deploy

Linux Docker dev stack: scripts/dev-services.sh (Mongo RS on 27098 via host
networking, Redis 6399; data under .data/dev-services). Object storage is
GridFS in the database — no S3 service.
