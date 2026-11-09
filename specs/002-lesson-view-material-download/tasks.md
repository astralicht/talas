---
description: "Dependency-ordered tasks for the Lesson Read View and Material Download feature"
---

# Tasks: Lesson Read View and Material Download

**Input**: Design documents from `specs/002-lesson-view-material-download/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), constitution v1.2.0

**Tests**: Required. Constitution Testing & Quality Gates mandates test-first delivery.
Every test task below was observed failing (or, for the new endpoint, exercised before
final verification) and maps to at least one automated test as built.

**Organization**: Two user stories; US1 (read view) and US2 (download) are independent
of each other and both build on the existing lesson/material stack. All tasks are
complete at commit time; checkmarks reflect delivered work.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Independent, no ordering dependency
- **[Story]**: Owning user story
- Every task names the exact file or files it changes

---

## Phase 1: Styling Foundation

- [x] T001 Install `@tailwindcss/typography` and register it in `app/globals.css` via
      `@plugin '@tailwindcss/typography';` so `prose prose-slate` classes in
      `components/lessons/markdown-renderer.tsx` actually apply (this also styles the
      editor's live preview).

## Phase 2: US1 — Rendered Lesson Read View

- [x] T002 Replace `app/(app)/lessons/[lessonId]/page.tsx` with the read-only view:
      back link, title/version/updated header, "Edit lesson" affordance
      (`data-testid="edit-lesson"`), delete dialog, source-material link, and a bordered
      article rendering `<MarkdownRenderer content={lesson.contentMarkdown} />`.
- [x] T003 Load the lesson's source material (via `MaterialRepository.findOwnedById` on
      `lesson.materialId`) to compute download visibility in T005, keeping the page a
      server component.
- [x] T004 Create `app/(app)/lessons/[lessonId]/edit/page.tsx` with the previous editor
      page content (lesson + revisions load, `LessonEditor`, `DeleteLessonDialog`) and a
      "← Back to lesson" link to the read view.
- [x] T005 Update e2e journeys for the new navigation: `tests/e2e/lesson-editor.spec.ts`
      and `tests/e2e/lesson-editor-accessibility.spec.ts` click "Edit lesson" after
      opening a lesson; `tests/e2e/upload-to-lesson.spec.ts` asserts the rendered
      `.markdown-body` and the visible download affordance.

## Phase 3: US2 — Material Download

- [x] T006 [P] Add the `material_downloaded` audit event type to
      `lib/db/models/audit-event.ts` and `auditEvents.materialDownloaded` to
      `lib/logging/audit-events.ts`.
- [x] T007 Create `app/api/materials/[materialId]/download/route.ts`: `route({ auth:
      true, params: regexSchema })`, ownership via `MaterialRepository.findOwnedById`,
      status gate (deny `deleted`/`quarantined`), bounded `getObjectBytes` read,
      re-sanitized header-safe filename, `Content-Type` from detected MIME (fallback
      declared), `Content-Disposition: attachment`, `Cache-Control: no-store`,
      `X-Content-Type-Options: nosniff`, correlation ID header, and the
      `material_downloaded` audit event.
- [x] T008 Add the download affordance to the material detail header in
      `app/(app)/materials/[materialId]/page.tsx` gated by the same downloadable-status
      set.

## Phase 4: Tests and Quality Gates

- [x] T009 Write `tests/contract/material-download.test.ts` covering: exact-bytes
      round-trip with attachment headers for the owner; foreign and unknown identifier
      404; quarantined material 404 (ClamAV fake scanner); malformed id 400.
- [x] T010 Verify quality gates: `pnpm typecheck`, `pnpm lint`, `pnpm test` (unit +
      security), `pnpm test:integration`, `pnpm test:contract`, and `pnpm build` — all
      green.

## Phase 5: Governance Trickle-Down

- [x] T011 Amend `.specify/memory/constitution.md` to v1.2.0: expanded
      "Automatic Layout & Editing" workflow (read view by default, explicit edit
      affordance, owner-downloadable audited material downloads that refuse
      quarantined/deleted files), updated version and Last Amended lines, and a Sync
      Impact Report (to be removed before the amendment is committed).
- [x] T012 Create `specs/002-lesson-view-material-download/spec.md`, `plan.md`, and
      `tasks.md` documenting the feature against constitution v1.2.0.

---

## Notes

- `pnpm format:check` / formatting: keep `prettier-plugin-tailwindcss` ordering
  consistent when editing the touched components.
- The contract-suite helper `tests/helpers/app-server.ts` builds `next build` when
  `.next/BUILD_ID` is missing; run a build once before parallel contract runs to avoid
  concurrent-build races.
