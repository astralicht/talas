# Plan: Lesson Authoring Flow (specs/005)

**Status**: Completed Nov 2026. Landing order followed the dependency flow:
schema → pipeline → request API/worker → assets → UI → theming.

## Phase breakdown (as implemented)

1. **OpenCode Go + v2 lessons** (commits `5d96e81`, `a2d6d66`)
   - `@ai-sdk/openai-compatible` (1.0.x — the 3.x line targets a newer spec);
     `lib/env.ts` gains `opengo`, `OPENCODE_API_KEY`, `AI_MODEL_OPENGO`
     (default `glm-5.3-flash`: thinking-only models burn the locked 4096-token
     output cap on reasoning and truncate the JSON).
   - `lib/ai/provider.ts`: opengo branch with `x-opencode-session` + user-agent
     headers; fallback chain unchanged; flat budget estimator kept (real caps
     live in the Go subscription).
   - v2 system prompt: expert-instructor role, reference-material grounding,
     output contract (exact JSON keys, 3–8 sections, ≤1200 chars/section).
   - Schema: optional `learningObjectives` (≤8), per-section
     `misconceptions`/`checkUnderstanding` (≤5), `.strict()` preserved;
     deterministic markdown rendering.

2. **Schema & pipeline foundation** (commit `dbd311a`)
   - `Lesson.sourceMaterialIds[]` (1–5 distinct) + index swap
     (`{ materialId: 1 } unique` → `{ userId: 1, materialId: 1 }`) with the
     `pnpm db:backfill-sources` one-time migration (verified against a scratch
     replica set seeded with legacy rows).
   - Explicit-only pipeline (scan → parse → ready); retry route resets parsed
     materials to ready on generation failures; `stageForRetry` keys "parsed"
     on `charCount` (pageCount is always null for text documents).

3. **Request API + worker rewrite** (commit `3bc71fd`)
   - `LessonGenerationRequest` model (lease-based claims), generate/poll/
     regenerate routes, multi-source worker with caps + truncation notices,
     transactional creation and CAS-append regeneration, audit events.

4. **Image assets** (commit `933432a`)
   - DOCX inline images with position markers; PDF raster XObjects
     (dedupe/hash, size/dimension caps); image-only PDF page rendering via
     @napi-rs/canvas (requires registering Path2D/Image/ImageData on
     globalThis BEFORE the pdfjs import); MaterialAsset model + S3 layout +
     tenant-scoped route; prompt image catalog + allowlist post-processing;
     vision path for image-only sources.
   - Bug fix: the null-byte scan in `verify-object.ts` ran before binary MIME
     detection, so real DOCX/PDF uploads could never pass confirm.

5. **UI flow** (commit `df7bafb`)
   - /lessons/new form (multi-select + title + polling), dashboard/lessons
     CTAs, RegenerateLessonDialog, source-line + "Use in lesson" hint,
     `scripts/dev-services.sh` (Mongo RS via host networking, Redis, RustFS),
     CSP connect-src localhost allowances for local-S3 uploads, e2e journeys.

6. **Dark mode** (commit `33f1358`)
   - Semantic tokens in globals.css + @custom-variant dark; next-themes
     provider; 34 files swept to semantic classes; status colors + prose get
     dark variants; Sun/Moon toggle in the session nav.

## Known environment notes

- The e2e stack requires `RATE_LIMIT_DISABLED=true` on the dev server
  (constitutional limiters otherwise accumulate across runs in the
  long-lived process) and a stable S3 endpoint with bucket CORS.
- Route changes require a `pnpm build` before contract/security suites: the
  in-process test harness serves the compiled bundle.
