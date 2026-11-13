# Tasks: Lesson Authoring Flow (specs/005)

**Status**: All tasks complete and verified (Nov 2026).

- [x] T001 Extend `lib/env.ts` with `AI_PROVIDER=opengo`, `OPENCODE_API_KEY`,
      `AI_MODEL_OPENGO` (default `glm-5.3-flash`) and bounded session TTLs
      (`SESSION_ACCESS_TTL_SECONDS` 300–86400, `SESSION_REFRESH_TTL_SECONDS`
      3600–2592000, refresh ≥ access).
- [x] T002 `lib/ai/provider.ts`: OpenCode Go branch via
      `@ai-sdk/openai-compatible` against
      `https://opencode.ai/inference/go/openai/v1` with
      `x-opencode-session` + identifying user agent; fallback chain unchanged.
- [x] T003 `lib/ai/prompts.ts`: v2 system prompt (instructor role, reference
      material, grounding rules, output contract) + multi-source prompt
      builder with per-source/total caps and truncation notices.
- [x] T004 `lib/ai/lesson-schema.ts` + `markdown.ts`: optional bounded
      pedagogy fields and deterministic rendering.
- [x] T005 `Lesson.sourceMaterialIds[]` (1–5 distinct), tenant-scoped
      non-unique index, and the backfill script (`pnpm db:backfill-sources`).
- [x] T006 Explicit-only pipeline: parse processor ends at `ready`; retry
      route resets parsed materials; `enqueueGenerateForMaterial` removed.
- [x] T007 `LessonGenerationRequest` model + `POST /api/lessons/generate` +
      `GET /api/lesson-requests/{id}` + `POST /api/lessons/{lessonId}/regenerate`.
- [x] T008 Worker: `processGenerateLessonRequest` — multi-source extraction
      with caps, user-supplied title, transactional new-lesson creation and
      CAS-append regeneration, budget + audit events, dedicated
      `LESSON_GENERATION_QUEUE` with finalize-as-failed.
- [x] T009 Image extraction (DOCX markers, PDF raster XObjects, image-only
      PDF page rendering via @napi-rs/canvas) + MaterialAsset model, S3
      layout, and the tenant-scoped image route.
- [x] T010 Prompt image catalog + allowlist post-processing
      (`lib/ai/images.ts`) + vision path for image-only sources + fake path.
- [x] T011 UI: /lessons/new form, CTAs, RegenerateLessonDialog, source
      line + "Use in lesson" hint, `scripts/dev-services.sh`, CSP localhost
      allowance, e2e journeys (11/11 green).
- [x] T012 Dark mode: semantic tokens, next-themes provider, component
      sweep, dark variants, Sun/Moon toggle.
- [x] T013 Tests: unit (prompt caps/notices/title, job schemas, allowlist,
      provider branches, TTL bounds), integration (generation requests, CAS
      regenerate, image lifecycle, backfill), contract (auth envelopes,
      polling shape, tenant isolation), e2e (full journeys).
