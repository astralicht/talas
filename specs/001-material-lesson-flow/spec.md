# Feature Specification: Account and Material-to-Lesson Flow

**Feature Branch**: `001-material-lesson-flow`

**Created**: 2026-11-07

**Status**: Draft

**Input**: User description: "Build the Talas walking skeleton: a user can register and
sign in, upload a PDF or DOCX study material (up to 25 MB), have it processed
asynchronously into a structured Markdown lesson via an AI model, and view and edit
that lesson in a Markdown editor with autosave. All data is strictly isolated per user.
The grounded chatbot and vector search are deferred to a later feature."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Secure Account and Personal Workspace (Priority: P1)

A new visitor creates an account, verifies their email, signs in, and lands in a
personal workspace that contains only their own materials and lessons. They can sign
out and reset a forgotten password. No user can see or act on another user's content,
even by guessing identifiers.

**Why this priority**: Every later capability depends on trustworthy identity and
strict data isolation. Shipping this alone delivers a safe, usable account system and
establishes the security boundary the rest of the product relies on.

**Independent Test**: Create two accounts. Sign in as the first, create a sample item,
then sign in as the second and confirm the first user's item is neither listed nor
reachable by direct reference. Sign out and confirm the session no longer grants
access.

**Acceptance Scenarios**:

1. **Given** a visitor with no account, **When** they register with a valid email and a
   password meeting the stated policy, **Then** the account is created, a verification
   email is sent, and they are asked to verify before using AI-powered features.
2. **Given** a registered but unverified user, **When** they attempt to upload material,
   **Then** they are blocked with a clear explanation and an option to resend
   verification.
3. **Given** a verified user, **When** they sign in, **Then** they see only their own
   materials and lessons.
4. **Given** user A is signed in, **When** user A requests a lesson or material owned by
   user B using its identifier, **Then** the request is denied without revealing whether
   the item exists.
5. **Given** a signed-in user, **When** they sign out, **Then** the session ends and
   navigating back does not restore access.
6. **Given** a user who has forgotten their password, **When** they request a reset and
   complete it with a valid single-use link, **Then** the old password no longer works
   and active sessions are invalidated.
7. **Given** a signed-in user, **When** they request an export of their content, **Then**
   they receive a downloadable copy of their materials and lessons.
8. **Given** a signed-in user, **When** they confirm account deletion, **Then** access
   ends immediately and their materials, lessons, revisions, and derived data are
   scheduled for removal within 30 days.

---

### User Story 2 - Upload Material and Receive a Structured Lesson (Priority: P1)

A verified user uploads a study document in a supported format and size. The system
accepts it, shows clear processing status, and produces a structured Markdown lesson
they can open. Unsupported, oversized, corrupted, or unsafe files are rejected with
actionable guidance. Transient failures can be retried without re-uploading.

**Why this priority**: This is the core product value: turning a user's own study
material into a usable lesson. Without it, the workspace has no content and the editor
has nothing to edit.

**Independent Test**: With a verified account and a supported sample document, upload
the file, observe status progression to ready, and open the resulting lesson. Repeat
with an unsupported file and an oversized file and confirm clear rejection messages.

**Acceptance Scenarios**:

1. **Given** a verified signed-in user, **When** they upload a supported document of
   25 MB or less, **Then** the material appears with a visible status and, on
   completion, a structured Markdown lesson becomes available.
2. **Given** an unsupported file type, **When** the user uploads it, **Then** it is
   rejected immediately and the message lists the supported types.
3. **Given** a file larger than 25 MB, **When** the user uploads it, **Then** it is
   rejected with the size limit stated.
4. **Given** a file whose declared type does not match its actual content, **When** it is
   uploaded, **Then** it is rejected as invalid.
5. **Given** a file containing malware, **When** it is uploaded, **Then** it is
   quarantined and never processed, and the user receives a safe explanation.
6. **Given** a transient processing failure, **When** the user retries, **Then** the
   material is reprocessed without requiring a new upload, and duplicate lessons are not
   created.
7. **Given** a user who has reached the upload rate limit, **When** they attempt another
   upload, **Then** they are told when they may retry.
8. **Given** a document containing instructions aimed at the AI model, **When** it is
   processed, **Then** those instructions cannot change system behavior or grant access
   to other users' data.
9. **Given** an AI response that does not match the expected lesson structure, **When**
   processing completes, **Then** the system retries or marks the job failed rather than
   presenting malformed content as a lesson.
10. **Given** the user closes the browser during processing, **When** they return later,
    **Then** the current status is still visible.

---

### User Story 3 - Review, Edit, and Save a Lesson (Priority: P2)

A user opens a generated lesson, reviews the structured content, edits it in a Markdown
editor with live preview, and relies on autosave and revision history so their work is
never silently lost. They can restore an earlier revision and delete content they no
longer need.

**Why this priority**: Generated lessons are a starting point, not the final product.
Editing makes the lesson the user's own and delivers lasting value, but the feature is
usable without it for a first demonstration.

**Independent Test**: Open a ready lesson, make edits, wait for autosave, reload the
page, and confirm the edits persist and render identically. Open the same lesson in a
second tab, edit both, and confirm a conflict is surfaced rather than one edit silently
overwriting the other.

**Acceptance Scenarios**:

1. **Given** a ready lesson, **When** the user opens it, **Then** it appears in an editor
   supporting standard Markdown with a live preview.
2. **Given** the user edits a lesson, **When** the autosave interval elapses, **Then**
   the changes are saved and survive a page reload.
3. **Given** the same lesson is open in two tabs, **When** both save, **Then** the system
   detects the conflict and prevents silent data loss.
4. **Given** Markdown containing scripts, event handlers, or unsafe links, **When** it is
   previewed or saved, **Then** the unsafe content does not execute and is safely
   rendered.
5. **Given** a saved lesson, **When** the user views revision history, **Then** they can
   inspect and restore a previous revision.
6. **Given** a keyboard-only user, **When** they edit and save a lesson, **Then** every
   action is reachable without a pointing device.
7. **Given** a material and its lesson, **When** the user deletes the material, **Then**
   the lesson and its revisions are removed from their workspace.

---

### Edge Cases

- A zero-byte, truncated, encrypted, or password-protected document is uploaded.
- A scanned or image-only PDF contains no extractable text.
- A document exceeds the supported page count.
- Two uploads of the same file happen in quick succession.
- Processing exceeds its time limit or the AI provider is unavailable.
- The user's session expires while they are editing.
- The user deletes a material while its lesson is still processing.
- A lesson contains very long tables or deeply nested lists.
- A filename contains unsafe characters or non-Latin characters.
- A user reaches the daily AI usage budget mid-lesson.
- A cross-tenant request is attempted with a valid-looking but foreign identifier.
- The same user opens many tabs and triggers repeated autosaves.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST let visitors register with an email address and a password
  of at least 12 characters.
- **FR-002**: The system MUST send a verification email and MUST require verification
  before the user can upload material or use AI-powered features.
- **FR-003**: Users MUST be able to sign in, sign out, and end a session such that
  browser history cannot restore access.
- **FR-004**: Users MUST be able to request a password reset that uses a single-use link
  expiring within 30 minutes, and completing the reset MUST invalidate active sessions.
- **FR-005**: The system MUST identify ownership from the authenticated session and MUST
  NOT accept a client-supplied identity for scoping data access.
- **FR-006**: The system MUST deny access by default and MUST prevent any user from
  reading, modifying, or deleting another user's materials, lessons, or revisions.
- **FR-007**: Authentication, registration, and password-reset attempts MUST be rate
  limited and MUST apply backoff or lockout after repeated failures.
- **FR-008**: Users MUST be able to upload PDF, DOCX, Markdown, and plain-text documents
  up to 25 MB and MUST receive a clear, immediate rejection for any other type or size.
- **FR-009**: The system MUST verify that an uploaded file's actual content matches a
  supported type and MUST scan it for malware before processing.
- **FR-010**: The system MUST process uploads asynchronously and expose a status of
  queued, processing, ready, or failed that persists across sessions.
- **FR-011**: The system MUST retry transient processing failures with bounded backoff,
  MUST allow a user-initiated retry, and MUST NOT create duplicate lessons for one
  material.
- **FR-012**: The system MUST enforce per-user upload limits of 10 requests per hour and
  5 per minute and MUST tell the user when they may retry.
- **FR-013**: The system MUST reject image-only documents with an actionable message
  until text extraction from images is explicitly supported.
- **FR-014**: Generated lessons MUST use structured Markdown with headings, lists, and
  tables where the source material supports them.
- **FR-015**: The system MUST treat all uploaded content as untrusted and MUST prevent
  embedded instructions from altering system behavior or accessing data beyond the
  current user.
- **FR-016**: The system MUST validate AI output against an expected lesson structure and
  MUST retry or fail the job rather than present malformed content as a lesson.
- **FR-017**: The system MUST enforce per-request AI usage caps and a per-user daily
  budget, and MUST inform the user when a limit is reached.
- **FR-018**: Users MUST be able to open a ready lesson in an editor that supports
  standard Markdown with live preview and full keyboard operation.
- **FR-019**: The editor MUST autosave changes, retain revision history, and let users
  restore a previous revision.
- **FR-020**: The editor MUST detect concurrent edits to the same lesson and MUST prevent
  silent overwrites.
- **FR-021**: The system MUST sanitize all rendered and re-saved Markdown so that
  scripts, event handlers, and unsafe link schemes never execute.
- **FR-022**: Manual edits MUST persist and MUST render identically in the editor preview
  and the final saved lesson view.
- **FR-023**: Users MUST be able to view their materials and lessons with their current
  status and open any item they own.
- **FR-024**: Users MUST be able to delete a material, which MUST also remove its lesson
  and revisions.
- **FR-025**: Users MUST be able to delete their account, which MUST remove their
  materials, lessons, revisions, and derived data within 30 days.
- **FR-026**: User-facing errors MUST be clear, actionable, and free of internal system
  details, stack traces, or secrets.
- **FR-027**: Users MUST be able to export their materials and lessons in a portable
  format before deleting their account.

### Key Entities *(include if feature involves data)*

- **User**: A person with a unique email address, credential state, verification status,
  and workspace ownership.
- **Material**: An uploaded source document owned by one user, with a filename, detected
  type, size, malware-scan result, and processing status.
- **ProcessingJob**: The attempt to turn one material into a lesson, with status, attempt
  count, failure category, and timestamps.
- **Lesson**: A structured Markdown document owned by one user and derived from one
  material, with current content and save state.
- **LessonRevision**: A saved snapshot of a lesson, with the author, timestamp, and the
  content needed to restore it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 90% of new users complete registration, email verification, and first
  sign-in within 3 minutes.
- **SC-002**: 95% of supported uploads of typical documents (up to 20 pages and 25 MB)
  produce a ready lesson within 2 minutes.
- **SC-003**: 90% of first-time users complete the flow of uploading a document, opening
  the lesson, editing it, and saving it on their first attempt.
- **SC-004**: 100% of attempted cross-account access in automated security tests is
  denied without revealing whether the target exists.
- **SC-005**: Zero script executions occur from malicious Markdown or document content
  across the security test suite.
- **SC-006**: 100% of unsupported or oversized uploads are rejected within 2 seconds with
  a message that states the supported types or the size limit.
- **SC-007**: 99% of autosaves complete within 2 seconds, and no saved edit is lost across
  100 consecutive reload tests.
- **SC-008**: 95% of transient processing failures recover on retry without the user
  re-uploading the document.
- **SC-009**: Users with up to 100 lessons can locate and open any lesson within
  10 seconds.

## Out of Scope

- The grounded AI chatbot and vector search, which will be specified as a separate
  feature.
- Optical character recognition for image-only or scanned documents.
- Team or shared workspaces, roles, and an administrative console.
- Native mobile applications and offline editing.
- Payments, subscriptions, and paid plan management.
- Integrations with external content sources such as cloud drives or note tools.
- Public sharing links and lesson export to PDF or DOCX.
- Multiple interface languages; the first release is English-only.

## Assumptions

- Accounts use email and password only; social sign-in and enterprise single sign-on are
  deferred.
- A user has a single personal workspace and does not share content with other users.
- Users have a modern browser and a stable internet connection.
- Typical documents are up to 20 pages; documents beyond 200 pages may be rejected with
  an actionable message.
- Verification and password-reset emails can be delivered through an email service.
- An AI model provider is available; provider outages are surfaced as clear processing
  failures rather than silent degradation.
- Private file storage and malware scanning are available to the system.
- The daily AI budget is enforced as a safety limit; no billing or paid tiers exist yet.
- Data retention and deletion follow the project constitution, including removal of
  derived data within 30 days of account deletion.

**Dependencies**

- Email delivery for verification and password reset.
- A third-party AI model provider for lesson generation.
- Private object storage and malware scanning for uploaded files.

## Amendments (specs/005, Nov 2026)

- **FR-008 amendment (image-only support)**: image-only documents are no longer
  rejected. Sparse-text/image-only PDFs render their pages as image assets
  (pdfjs + a canvas backend) and ride a vision path to the model; the
  `ocr_not_supported` rejection now applies only to non-PDF formats. See
  specs/005 FR-111.
- **FR-011 amendment (unique-index reinterpretation)**: "no duplicate lessons
  for one material" is now scoped per lesson creation, not per storage. The
  global unique `{ materialId }` lesson index was replaced by a non-unique
  `{ userId, materialId }` index: one material can power many lessons
  (`sourceMaterialIds[]`, 1–5 distinct). Idempotency is preserved per
  generation request (`generate_lesson_{requestId}` job ids) instead of per
  material.
