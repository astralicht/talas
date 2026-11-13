# Spec: Lesson Authoring Flow (specs/005)

**Status**: Implemented (Nov 2026). Constitution v2.0.0.
**Supersedes**: the single-material auto-generate pipeline from specs/001.

## Overview

Lessons become first-class authored artifacts: a learner names a lesson, picks
1–5 processed source materials, and the system generates a grounded,
pedagogical lesson on request. Materials no longer auto-generate lessons;
they become reusable reference inputs. Lessons track every source they were
built from, image content flows from materials into lessons, and
regeneration is compare-and-swap safe against concurrent edits.

## Functional requirements

- **FR-101**: Lessons MUST track `sourceMaterialIds` (1–5 distinct materials)
  in addition to the primary `materialId`, which stays the first source.
- **FR-102**: More than one lesson MUST be able to reference the same
  material; the global unique `{ materialId }` lesson index is replaced by a
  tenant-scoped non-unique `{ userId, materialId }` index.
- **FR-103**: The automatic upload pipeline MUST end at `ready`
  (scan → parse → ready); lesson generation MUST NOT be enqueued
  automatically.
- **FR-104**: Lesson generation MUST be requested explicitly through
  `POST /api/lessons/generate` (auth + CSRF + verified user + rate limit),
  which creates a request row (`queued`) and enqueues
  `generate_lesson_{requestId}` on a dedicated queue.
- **FR-105**: Foreign, missing, or not-ready materials MUST answer the same
  non-revealing 404 as a missing resource.
- **FR-106**: Request progress MUST be pollable via
  `GET /api/lesson-requests/{id}` (tenant-scoped, non-revealing 404) with
  status `queued | processing | ready | failed` and safe failure details.
- **FR-107**: An existing lesson MUST be regenerable via
  `POST /api/lessons/{lessonId}/regenerate` with compare-and-swap on the
  version the requester saw (409 on stale) and an optional replacement
  source list; the worker CAS-appends a system revision.
- **FR-108**: The generation worker MUST fetch and extract every source with
  a per-source 32k-character cap and a ~128k total cap, announce truncation,
  wrap every source in `<untrusted_material>` delimiters, and use the
  user-supplied title verbatim.
- **FR-109**: The model output MUST be schema-validated, sanitized, and
  post-processed so only catalogued image URLs survive into stored content.
- **FR-110**: Extracted images (DOCX inline images; PDF raster XObjects;
  image-only PDF pages rendered via a canvas backend) MUST be stored as
  tenant-scoped assets at `materials/{userId}/{materialId}/images/{assetId}`
  and served only to their owner through an authenticated route with
  `Cache-Control: private`.
- **FR-111**: Image-only sources MUST be supported: pages render as image
  assets and ride a vision path to the model instead of failing with
  `ocr_not_supported`.
- **FR-112**: The OpenCode Go inference endpoint (`AI_PROVIDER=opengo`) MUST
  be supported as a first-class provider option, identifying with a stable
  `x-opencode-session` header per generation.
- **FR-113**: The session TTLs MUST be environment-configurable with bounded
  validation (access ≤ 24 h, refresh ≤ 30 d, refresh ≥ access), defaulting to
  the constitutional maximums.
- **FR-114**: The UI MUST offer lesson creation from ready materials
  (multi-select + title + polling), lesson regeneration from the read view,
  a "Use in lesson" hint on ready materials, dark mode via semantic tokens
  with a Sun/Moon toggle, and image rendering in lesson content.

## Non-functional requirements

- Every provider failure path is fail-closed: the request row carries safe
  failure details, auth cookies are never leaked, and no partial lesson is
  ever stored (transactional creation/append).
- The request row is the single progress surface; BullMQ retries that exhaust
  finalize the request as failed.
- Rate limits and account lockout remain per the constitution; local e2e
  stacks disable them explicitly via `RATE_LIMIT_DISABLED`.

## Dependencies

- The AI provider (OpenAI/Google/OpenCode Go) for generation; `AI_FAKE_LESSON`
  fakes cover the test and e2e stacks.
- Private object storage (S3-compatible; RustFS locally) and malware scanning.
- pdfjs-dist + @napi-rs/canvas (worker-only) for image extraction/rendering.
