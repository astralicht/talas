# Feature Specification: Lesson Read View and Material Download

**Feature Branch**: `002-lesson-view-material-download`

**Created**: 2026-11-09

**Status**: Implemented

**Constitution**: Amended as v1.2.0 ("Automatic Layout & Editing" — rendered lesson
view with edit affordance; owner-downloadable source materials)

**Input**: User description: "When clicking lessons, I don't want the markdown editor
to pop up. I want a clean-looking rendered page from the markdown file that can be
easily browsed. Add an edit button at the top to give the user the option to edit the
lesson manually to enable adding notes and whatnot. The uploaded materials should also
be available for download by the user should they need it."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Browse a Rendered Lesson (Priority: P1)

A signed-in user clicks a lesson anywhere in the app and lands on a clean, read-only,
rendered page that displays the lesson's Markdown content as formatted prose — not an
editor. An explicit "Edit lesson" affordance at the top of the view opens the editor
when they want to add notes or make corrections.

**Why this priority**: Reading is the dominant activity for study lessons; opening an
editor by default makes browsing noisy and invites accidental edits.

**Independent Test**: Generate a lesson, click its title from the lessons list or
dashboard, and confirm a rendered read view appears with headings, lists, and tables
formatted, a title header, an "Edit lesson" affordance, and no editable textarea.

**Acceptance Scenarios**:

1. **Given** a signed-in user with a generated lesson, **When** they click the lesson
   from the lessons list or dashboard, **Then** they see a read-only page that renders
   the lesson Markdown through the same sanitized pipeline used for saving, with
   typography applied (headings, paragraphs, lists, tables, code).
2. **Given** the lesson read view, **When** the user clicks "Edit lesson", **Then** the
   existing editor at `/lessons/{lessonId}/edit` opens with the full current content,
   preserving autosave, revision history, and conflict handling.
3. **Given** the editor, **When** the user saves changes, **Then** returning to the read
   view shows the updated content rendered identically to the editor preview.
4. **Given** a lesson URL bookmarked from before this change (`/lessons/{id}`), **When**
   the user navigates to it, **Then** the read view is shown and no editor opens by
   default.

---

### User Story 2 — Download the Original Upload (Priority: P1)

From the lesson read view or the material detail page, a user can download the original
file they uploaded (PDF, DOCX, Markdown, or plain text) without re-uploading it.
Downloads are only available to the owner, for materials that are still stored (never
quarantined or deleted).

**Why this priority**: The upload is the user's own document; keeping a way to retrieve
it closes the gap where uploads became write-only after ingestion.

**Independent Test**: Upload a text material, confirm it, then request
`/api/materials/{id}/download` and confirm the exact original bytes come back as an
attachment with the original filename. Repeat from a second account and confirm 404.

**Acceptance Scenarios**:

1. **Given** a signed-in user whose material is stored, **When** they click "Download
   original material" on the lesson read view or "Download original" on the material
   detail page, **Then** the browser downloads the original file with its original
   filename via `Content-Disposition: attachment`.
2. **Given** user A signed in, **When** user A requests user B's material by identifier,
   **Then** the request is denied with a non-revealing 404.
3. **Given** a quarantined material (malware-flagged), **When** the owner requests a
   download, **Then** the request is denied and no bytes are served.
4. **Given** a malformed material identifier, **When** any user requests a download,
   **Then** the request fails validation with 400.
5. **Given** any download attempt by an authenticated owner, **When** it succeeds,
   **Then** a `material_downloaded` audit event with a correlation ID and user ID is
   written.

---

## Requirements

### Functional

- FR-1: `/lessons/{lessonId}` MUST render a read-only lesson view using the shared,
  sanitized Markdown renderer (`components/lessons/markdown-renderer.tsx`); no editor
  may open by default.
- FR-2: The read view MUST show the lesson title, current version, and last-updated
  timestamp, plus a link to the source material.
- FR-3: The read view MUST provide an "Edit lesson" affordance that navigates to
  `/lessons/{lessonId}/edit`, where all existing editor behavior (textarea editor, live
  preview, formatting toolbar, autosave, optimistic concurrency, revision history,
  conflict banner, delete dialog) remains unchanged.
- FR-4: The editor page MUST offer a "← Back to lesson" link returning to the read view.
- FR-5: `GET /api/materials/{materialId}/download` MUST stream the stored object to the
  owning, authenticated user with `Content-Type` from the verified detected MIME type
  (falling back to the declared MIME type) and `Content-Disposition: attachment;
  filename="originalFilename"`.
- FR-6: The download route MUST refuse (404) materials whose status is `deleted` or
  `quarantined`, MUST 404 for foreign or unknown identifiers, and MUST 400 on malformed
  identifiers.
- FR-7: The lesson read view and the material detail page MUST expose a download
  affordance only when the material status allows it.
- FR-8: Download responses MUST include `Cache-Control: no-store`,
  `X-Content-Type-Options: nosniff`, and a correlation ID header, and MUST emit a
  `material_downloaded` audit event.

### Non-Functional

- NFR-1: Styling uses `@tailwindcss/typography` (`prose prose-slate`) so
  AI-generated structures (tables, lists, headings, code) render as proper UI
  components, per the constitution's layout-and-editing workflow.
- NFR-2: No new unsanitized render path: the read view reuses the existing
  sanitize-before-parse pipeline with no `rehype-raw` and no `dangerouslySetInnerHTML`
  additions, so editor preview and saved view remain byte-identical.
- NFR-3: Downloads are buffered reads bounded by the 25 MB upload cap; no new rate
  limits are required beyond the standard session guard (downloads are reads).

### Constraints from Constitution v1.2.0

- Lessons open in a rendered read view with an explicit edit affordance (workflow
  standard "Automatic Layout & Editing").
- Uploaded materials MUST remain owner-downloadable through an authenticated,
  tenant-scoped endpoint that never serves quarantined or deleted files and audits
  download attempts.

---

## Checklists

### Crossing Concerns

- [x] All three constitution security principles apply unchanged: input validation
      (params are Zod-validated), tenant isolation (session-derived `userId`), and
      output sanitization (shared renderer).
- [x] Cross-tenant access test added for the download route.
- [x] Quarantine/deleted denial test added for the download route.

### Communications

- [x] Empty/missing material states: download affordance only appears when
      downloadable; lesson view always renders the lesson content.

### Data Lifecycle

- [x] No new persisted data models; only a `material_downloaded` audit event type was
      added (90-day retention applies automatically).
