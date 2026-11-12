# Talas — Continuation Roadmap

Constitution is at v2.0.0 (commit `7e73516`). Nothing below is committed yet unless noted.

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

- [ ] Run `pnpm lint`, `pnpm test`, `pnpm test:contract` — verify no regressions
- [ ] Commit Step 1 (feat(auth): high-trust session TTLs, redirect hardening, renewal contract tests + reuse fix)

## Step 2 — Schema & pipeline foundation (specs/005)

- [ ] Lesson.sourceMaterialIds[] (1–5 distinct); materialId stays primary/first source
- [ ] Drop global unique { materialId: 1 } index → non-unique { userId: 1, materialId: 1 };
      update scripts/ensure-indexes.ts; run pnpm db:indexes
- [ ] Backfill script: existing lessons get sourceMaterialIds = [materialId]
- [ ] Explicit-only generation: worker/processors/parse-material.ts stops enqueueing
      generate (scan → parse → ready)
- [ ] lib/jobs/schemas.ts — payload { requestId, materialIds[1..5], title, userId,
      correlationId }; job id `generate_lesson_{requestId}`
- [ ] lib/materials/delete-service.ts — no lesson cascade; $pull material from
      lessons' sourceMaterialIds; update delete-material-dialog copy

## Step 3 — Generation request API + worker rewrite

- [ ] lib/db/models/lesson-generation-request.ts { userId, title, materialIds,
      existingLessonId?, status queued|processing|ready|failed, lessonId?,
      lastErrorCode/Message } + indexes; register in ensure-indexes
- [ ] POST /api/lessons/generate { title 1–200, materialIds 1–5 } — auth+CSRF+
      verified-user gate+rate limit; foreign material → non-revealing 404
- [ ] GET /api/lesson-requests/{id} — polling route
- [ ] POST /api/lessons/{lessonId}/regenerate — optional materialIds, CAS on version
- [ ] Worker: multi-source fetch/extract (per-material 32k + total ~128k caps,
      truncation notices, untrusted-material delimiters), user-supplied title in
      prompts, new-lesson transaction (Lesson v1 + LessonRevision v1), regenerate
      CAS append (save-service pattern), AI budget + audit events
- [ ] Unit/contract/integration tests for all the above

## Step 4 — Material image assets

- [ ] lib/parsing/extract.ts returns images[]: DOCX via mammoth image emitter
      (position markers); PDF raster XObjects (skip <8KB icons, dedupe by hash,
      cap 10/material, ≤1280px, skip exotic colorspaces)
- [ ] Image-only PDFs: render pages via pdfjs + @napi-rs/canvas (new worker-only
      dependency) → PNG assets
- [ ] lib/db/models/material-asset.ts { userId, materialId, assetKey, contentType,
      byteSize, pageNumber?, width?, height? } + indexes; S3 at
      materials/{userId}/{materialId}/images/{assetId}
- [ ] GET /api/materials/{materialId}/images/{assetId} — auth, tenant-scoped,
      Cache-Control private
- [ ] Prompt image catalog; post-processing URL allowlist (lib/ai/images.ts) —
      only catalog URLs survive; vision parts for image-only sources; extend
      AI_FAKE_LESSON fake path
- [ ] MarkdownRenderer img component (responsive, dark-mode border)
- [ ] Tests: extraction heuristics, URL allowlist, image-route contract
      (tenant isolation, non-revealing 404), image-only lifecycle

## Step 5 — UI flow

- [ ] app/(app)/lessons/new/page.tsx + components/lessons/new-lesson-form.tsx —
      title input + checkbox multi-select of ready materials + request polling
- [ ] Dashboard + lessons list "New lesson" CTA
- [ ] Lesson read view: Regenerate dialog (pick additional materials, poll,
      success banner "Version N generated")
- [ ] Material pages: status copy updates (no auto-generate messaging),
      lesson lookup via sourceMaterialIds, "Use in lesson" hint
- [ ] Update tests/e2e journeys for the new navigation

## Step 6 — Dark mode (semantic tokens)

- [ ] next-themes + ThemeProvider + suppressHydrationWarning on html (app/layout.tsx)
- [ ] app/globals.css: @custom-variant dark; :root/.dark semantic vars
      (--background, --foreground, --card, --muted, --border...); color-scheme light dark
- [ ] Refactor ~15 components from hardcoded slate classes to semantic classes;
      dark:prose-invert for MarkdownRenderer
- [ ] Sun/Moon toggle in components/auth/session-nav.tsx

## Step 7 — Gates & bookkeeping

- [ ] Full gates: pnpm typecheck lint test test:integration test:contract test:e2e
- [ ] Write specs/005-lesson-authoring-flow/{spec,plan,tasks}.md with checked tasks
- [ ] Amendment notes: specs/001 (FR-008 image-only support, FR-011 unique-index
      reinterpretation), specs/003 (new TTLs; check off T007/T008)
- [ ] Final commit(s)

## Dev environment notes (Windows + PowerShell)

- pnpm 9.15.9 global (engine warning about Node 24 is benign)
- scripts/dev-services.ps1 — starts Mongo 7 (rs0, data in .data/mongo) + Redis 8
  (tools/redis7); node scripts/init-replica-set.mjs if .data/mongo is wiped
- pnpm db:seed → alice@talas.local / bob@talas.local, password talas-local-password
- Alice's sample-lesson download 404s until real MinIO exists (S3_FAKE store is
  per-process); login/AI/email all work via fake modes in .env.local
