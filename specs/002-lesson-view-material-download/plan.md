# Implementation Plan: Lesson Read View and Material Download

**Branch**: `002-lesson-view-material-download` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-lesson-view-material-download/spec.md`

## Summary

Replace the editor-as-lesson-default with a browsable, rendered read view for lessons,
move the existing editor to `/lessons/{lessonId}/edit` with all behavior intact, and add
an authenticated, tenant-scoped download endpoint that streams an owner's uploaded
material from object storage as an attachment. Rendered styling is provided by
`@tailwindcss/typography`; the sanitize-before-parse Markdown pipeline is reused
unchanged. Download attempts are audited; quarantined and deleted materials are never
served.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20 LTS (strict mode)

**Primary Dependencies**: existing Next.js 15 (App Router), React 19, Tailwind CSS 4;
**added**: `@tailwindcss/typography` 0.5.x (registered via `@plugin` in `app/globals.css`)

**Storage**: no schema changes; reads Lesson, LessonRevision, Material (existing
tenant-scoped repositories); writes one new audit event type `material_downloaded`

**Testing**: Vitest contract suite (Supertest against the in-process Next app with the
S3 fake store, ClamAV fake scanner, memory email/queues); Playwright e2e updated for the
new navigation flow

**Target Platform**: evergreen browsers; Next.js server runtime

**Performance Goals**: read view is a server component — one lesson read plus at most
one material read; download route is a single bounded S3 read (≤ 25 MB)

**Constraints**: same tenant isolation, validation, and sanitization envelopes as the
rest of the app; no new principal types; no write path to lesson or material state

**Open Questions**: None.

## Constitution Check

*GATE: Must pass against constitution v1.2.0.*

| Principle / Section | Gate | How this plan satisfies it | Status |
|---|---|---|---|
| I. Zero-Trust Strict Input Validation | Route params validated by Zod; malformed ids → 400 | `materialId` regex schema (`.strict()`) via the shared `route()` guard | PASS |
| II. Tenant Data Isolation | All tenant-scoped reads session-derived | `MaterialRepository(user.id).findOwnedById()` — same scope helpers as every other material route; 404 for foreign/unknown | PASS |
| III. Anti-XSS and Output Sanitization | Rendered Markdown sanitized before parse; no raw HTML | Read view reuses `MarkdownRenderer` (sanitize → react-markdown, no `rehype-raw`); editor and saved view remain byte-identical inside a `prose` container | PASS |
| IV. File Upload Security & Resource Control | Uploads still guarded; downloads must not bypass object-scanning decisions | Download route denies `quarantined` (and `deleted`) materials; serving back the exact bytes that were scanned by the existing pipeline; `X-Content-Type-Options: nosniff` and `attachment` disposition prevent active content from executing in the browser context | PASS |
| Workflow: Automatic Layout & Editing (v1.2.0) | Lesson opens in a rendered read view with an explicit edit affordance; editor keeps autosave/revisions/optimistic concurrency; materials owner-downloadable via audited endpoint | `app/(app)/lessons/[lessonId]/page.tsx` is the read view with an "Edit lesson" affordance; editor unchanged at `/lessons/{lessonId}/edit`; download route streams bounded bytes with `Content-Disposition: attachment` and emits `material_downloaded` audit events; quarantined/deleted denied | PASS |

**Post-design re-check**: PASS — see tasks for the test-first contract coverage
(`tests/contract/material-download.test.ts`) and updated e2e navigation specs.

## Implementation Notes (as built)

- Rendering: the read view renders `<article class="rounded-xl border bg-white p-6 sm:p-8">`
  containing `<MarkdownRenderer content={lesson.contentMarkdown} />`. Typography comes
  from the newly installed `@tailwindcss/typography` plugin so the previously inert
  `prose prose-slate` classes now apply; this also improves the editor's live preview.
- Routing: `/lessons/[lessonId]/page.tsx` (read view) and
  `/lessons/[lessonId]/edit/page.tsx` (previously the lesson page content, unchanged
  data loading for lesson + revisions). Dashboard, lessons list, and material detail
  links were already pointed at `/lessons/{id}` and now land on the read view
  automatically.
- Download endpoint: `app/api/materials/[materialId]/download/route.ts` —
  `route({ auth: true })`, Zod-param validated, ownership 404, status gate
  (`awaiting_upload`/`uploaded`/`scanning`/`queued`/`processing`/`ready`/`failed` only),
  `getObjectBytes(storageKey)` bounded by the 25 MB cap, header-derived filename
  re-sanitized and stripped of `\`/`"` metacharacters, `no-store` + `nosniff` +
  correlation header, and a `material_downloaded` audit event (new `AuditEventType` in
  `lib/db/models/audit-event.ts`, emitted from `auditEvents`).
- Download affordances: read view (`data-testid="download-material"`) via
  `lesson.materialId`, and material detail header via the same `DOWNLOADABLE_STATUSES`
  gate; both hide the link for quarantined materials.

## Testing Strategy

- **Contract** (`tests/contract/material-download.test.ts`): exact bytes round-trip with
  attachment headers; foreign/unknown 404; quarantined 404 (ClamAV fake `infected`);
  malformed id 400.
- **e2e**: updated `tests/e2e/lesson-editor.spec.ts` and
  `tests/e2e/lesson-editor-accessibility.spec.ts` to reach the editor through the read
  view's "Edit lesson" affordance; `tests/e2e/upload-to-lesson.spec.ts` asserts the read
  view renders `.markdown-body` and exposes the download affordance.
- Existing unit/integration/security suites are unaffected and pass.

## Rollout

No flags needed. URL structure change is internal navigation; bookmarks to
`/lessons/{id}` continue to work and now show the read view.
