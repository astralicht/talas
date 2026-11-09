# Phase 1 Data Model: Account and Material-to-Lesson Flow

**Feature**: `001-material-lesson-flow`
**Date**: 2026-11-07
**Database**: MongoDB Atlas 7.x via Mongoose 8

## Modeling Rules

- Every tenant-scoped collection stores `userId` as an `ObjectId` reference to `User`.
- Every tenant-scoped query receives `userId` from the authenticated session through the
  repository layer; client-supplied owner identifiers are never used.
- Every tenant-scoped collection has a compound index whose first key is `userId`.
- Timestamps are UTC. All dates are stored as BSON `Date`.
- Sensitive fields (`passwordHash`, token hashes) are excluded from query results by
  default and never serialized to clients.
- Mongoose schema validators mirror the rules below; Zod remains the first validation
  layer at the HTTP and worker boundaries.
- Collections for the deferred chat feature (`LessonChunk`, `ChatSession`, `ChatMessage`,
  `Embedding`) are not created by this feature; when added, they MUST follow the same
  tenant rules.

## Entities

### User

| Field | Type | Rules |
|---|---|---|
| `_id` | ObjectId | Primary key |
| `email` | string | Required, lowercase, trimmed, unique, max 254 chars, valid email format |
| `passwordHash` | string | Required, Argon2id, `select: false` |
| `emailVerifiedAt` | Date \| null | Null until verification succeeds |
| `status` | enum | `active`, `disabled`, `deleting`, `deleted`; default `active` |
| `failedLoginAttempts` | number | Default 0; reset on successful login |
| `lockedUntil` | Date \| null | Set after 5 failures within 15 minutes |
| `lastLoginAt` | Date \| null | Updated on successful login |
| `createdAt` | Date | Auto |
| `updatedAt` | Date | Auto |
| `deletedAt` | Date \| null | Set when deletion is requested |

**Indexes**: `{ email: 1 }` unique; `{ status: 1, deletedAt: 1 }`.

**Validation**: email normalized before uniqueness check; password policy (minimum 12
characters) enforced before hashing; `passwordHash` never leaves the data layer.

### RefreshToken

| Field | Type | Rules |
|---|---|---|
| `_id` | ObjectId | Primary key |
| `userId` | ObjectId | Required, ref `User` |
| `tokenHash` | string | Required, unique, SHA-256 hex |
| `expiresAt` | Date | Required, at most 7 days after creation |
| `revokedAt` | Date \| null | Set on rotation, logout, or password change |
| `replacedByTokenId` | ObjectId \| null | Audit link during rotation |
| `ipHash` | string | SHA-256 of IP, never the raw address |
| `userAgentHash` | string | SHA-256 of user agent |
| `createdAt` | Date | Auto |

**Indexes**: `{ tokenHash: 1 }` unique; `{ userId: 1, revokedAt: 1 }`;
TTL `{ expiresAt: 1 }` with `expireAfterSeconds: 0`.

**Validation**: a refresh token is usable only when `revokedAt` is null and
`expiresAt > now`. Rotation revokes the old token and issues a new one in one transaction.

### EmailVerificationToken

| Field | Type | Rules |
|---|---|---|
| `_id` | ObjectId | Primary key |
| `userId` | ObjectId | Required, ref `User` |
| `tokenHash` | string | Required, unique, SHA-256 hex |
| `expiresAt` | Date | Required, 24 hours after creation |
| `consumedAt` | Date \| null | Single use |
| `createdAt` | Date | Auto |

**Indexes**: `{ tokenHash: 1 }` unique; `{ userId: 1, consumedAt: 1 }`;
TTL `{ expiresAt: 1 }`.

### PasswordResetToken

| Field | Type | Rules |
|---|---|---|
| `_id` | ObjectId | Primary key |
| `userId` | ObjectId | Required, ref `User` |
| `tokenHash` | string | Required, unique, SHA-256 hex |
| `expiresAt` | Date | Required, 30 minutes after creation |
| `consumedAt` | Date \| null | Single use |
| `requestedIpHash` | string | SHA-256 of requester IP |
| `createdAt` | Date | Auto |

**Indexes**: `{ tokenHash: 1 }` unique; `{ userId: 1, consumedAt: 1 }`;
TTL `{ expiresAt: 1 }`.

### Material

| Field | Type | Rules |
|---|---|---|
| `_id` | ObjectId | Primary key |
| `userId` | ObjectId | Required, ref `User`, first key in all indexes |
| `originalFilename` | string | Required, sanitized, max 255 chars |
| `storageKey` | string | Required, unique, server-generated |
| `declaredMime` | string | Required, client value retained for audit only |
| `detectedMime` | string \| null | Set from magic bytes after upload |
| `sizeBytes` | number | Required, 1 to 26,214,400 (25 MB) |
| `status` | enum | See state machine |
| `scanResult` | enum | `pending`, `clean`, `infected`, `unavailable`; default `pending` |
| `pageCount` | number \| null | Extracted page count |
| `charCount` | number \| null | Extracted character count, max 2,000,000 |
| `failureCode` | string \| null | Stable machine code |
| `failureMessage` | string \| null | Safe user-facing message |
| `uploadExpiresAt` | Date | Presigned URL expiry, 15 minutes after creation |
| `createdAt` | Date | Auto |
| `updatedAt` | Date | Auto |
| `deletedAt` | Date \| null | Set on deletion |

**Indexes**: `{ storageKey: 1 }` unique; `{ userId: 1, createdAt: -1 }`;
`{ userId: 1, status: 1 }`; `{ status: 1, createdAt: 1 }` for worker polling.

**Validation**: `detectedMime` must be one of `application/pdf`,
`application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `text/markdown`,
or `text/plain`. `storageKey` must match the server-generated pattern
`materials/{userId}/{materialId}`. Original filenames are sanitized before storage.

### ProcessingJob

| Field | Type | Rules |
|---|---|---|
| `_id` | ObjectId | Primary key |
| `userId` | ObjectId | Required, ref `User` |
| `materialId` | ObjectId | Required, ref `Material`, unique (one job per material) |
| `status` | enum | `queued`, `processing`, `ready`, `failed` |
| `attempts` | number | Default 0, maximum 3 |
| `maxAttempts` | number | Default 3 |
| `leaseUntil` | Date \| null | Prevents duplicate processing |
| `lastErrorCode` | string \| null | Stable code |
| `lastErrorMessage` | string \| null | Safe text, no internals |
| `startedAt` | Date \| null | |
| `completedAt` | Date \| null | |
| `createdAt` | Date | Auto |
| `updatedAt` | Date | Auto |

**Indexes**: `{ materialId: 1 }` unique; `{ status: 1, leaseUntil: 1 }`;
`{ userId: 1, createdAt: -1 }`.

**Retry rules**: automatic retries are capped at three attempts. A user-initiated retry
resets `attempts` to 0 and is subject to the upload rate limit, so a terminal failure is
recoverable without allowing unlimited reprocessing.

### Lesson

| Field | Type | Rules |
|---|---|---|
| `_id` | ObjectId | Primary key |
| `userId` | ObjectId | Required, ref `User` |
| `materialId` | ObjectId | Required, ref `Material`, unique |
| `title` | string | Required, 1 to 200 chars |
| `summary` | string | Required, max 2,000 chars |
| `contentMarkdown` | string | Required, max 1 MB, sanitized |
| `version` | number | Starts at 1, increments per save |
| `status` | enum | `draft`, `ready`, `deleted`; default `ready` |
| `generationProvider` | string | `openai` or `google` |
| `generationModel` | string | Model identifier used |
| `promptVersion` | string | Version of the generation prompt |
| `createdAt` | Date | Auto |
| `updatedAt` | Date | Auto |
| `deletedAt` | Date \| null | Set on deletion |

**Indexes**: `{ materialId: 1 }` unique; `{ userId: 1, updatedAt: -1 }`;
`{ userId: 1, status: 1 }`.

### LessonRevision

| Field | Type | Rules |
|---|---|---|
| `_id` | ObjectId | Primary key |
| `lessonId` | ObjectId | Required, ref `Lesson` |
| `userId` | ObjectId | Required, ref `User` |
| `version` | number | Required, matches the lesson version at save time |
| `title` | string | Required |
| `contentMarkdown` | string | Required, sanitized |
| `authorType` | enum | `system` (generated) or `user` (manual save) |
| `createdAt` | Date | Auto |

**Indexes**: `{ lessonId: 1, version: 1 }` unique;
`{ userId: 1, lessonId: 1, version: -1 }`.

**Rules**: append-only; revisions are never updated in place; restoring a revision
creates a new revision rather than rewriting history.

### AuditEvent

| Field | Type | Rules |
|---|---|---|
| `_id` | ObjectId | Primary key |
| `userId` | ObjectId \| null | Null for unauthenticated events |
| `type` | string | Enum of auth, authorization, account, and data events |
| `correlationId` | string | Required |
| `ipHash` | string | SHA-256, never raw IP |
| `userAgentHash` | string | SHA-256 |
| `metadata` | object | Redacted; no content, tokens, or secrets |
| `createdAt` | Date | Auto |

**Indexes**: `{ userId: 1, createdAt: -1 }`; `{ type: 1, createdAt: -1 }`;
TTL `{ createdAt: 1 }` with `expireAfterSeconds: 7776000` (90 days).

### AccountDeletionRequest

| Field | Type | Rules |
|---|---|---|
| `_id` | ObjectId | Primary key |
| `userId` | ObjectId | Required, ref `User`, unique |
| `status` | enum | `queued`, `processing`, `completed`, `failed` |
| `attempts` | number | Default 0, maximum 3 |
| `requestedAt` | Date | Required |
| `startedAt` | Date \| null | |
| `completedAt` | Date \| null | |
| `failureCode` | string \| null | Stable code |

**Indexes**: `{ userId: 1 }` unique; `{ status: 1, requestedAt: 1 }`.

## Relationships

```text
User 1 ── N Material
User 1 ── N Lesson
User 1 ── N RefreshToken
User 1 ── N EmailVerificationToken
User 1 ── N PasswordResetToken
User 1 ── N AuditEvent
User 1 ── 0..1 AccountDeletionRequest

Material 1 ── 1 ProcessingJob
Material 1 ── 0..1 Lesson

Lesson 1 ── N LessonRevision
```

Deletion rules:

- Deleting a `Material` cascades to its `ProcessingJob`, `Lesson`, `LessonRevision`
  records, stored object, and any future embeddings.
- Deleting a `Lesson` removes its revisions and any derived data.
- Deleting a `User` cascades to every owned record and object within 30 days.

## State Machines

### Material

```text
awaiting_upload ──confirm──> uploaded ──scan──> scanning
scanning ──clean──> queued ──worker──> processing ──success──> ready
scanning ──infected──> quarantined
scanning ──scanner unavailable──> failed (retryable)
processing ──failure──> failed (retryable)
failed ──retry──> queued
any non-deleted ──delete──> deleted
```

Rules: `awaiting_upload` expires after the presigned URL lifetime and is cleaned up by a
scheduled task. `quarantined` is terminal for the user; only an operator may review it.
`failed` is retryable up to three attempts.

### ProcessingJob

```text
queued ──lease──> processing ──success──> ready
processing ──transient failure, attempts < 3──> queued
processing ──terminal failure or attempts = 3──> failed
failed ──user retry──> queued
```

Rules: only one job exists per material. A job is claimable only when `status = queued` or
when `status = processing` and `leaseUntil < now`. Every transition is conditional on the
expected current state.

### Lesson

```text
draft ──generation validated──> ready
ready ──user save──> ready (version + 1, new revision)
ready ──delete──> deleted
```

Rules: saves use optimistic concurrency on `version`. A stale version returns a conflict
and no write occurs. Every successful save appends a `LessonRevision` in the same MongoDB
transaction as the lesson update, so content and history cannot diverge. Restoring a
revision also runs as a transaction and appends a new revision.

### AccountDeletionRequest

```text
queued ──worker──> processing ──success──> completed
processing ──failure, attempts < 3──> queued
processing ──terminal failure──> failed
```

Rules: user access ends immediately when the request is created; the cascade must
complete within 30 days. Failures are alerted and retried.

## Validation Rules Mapped to Requirements

| Rule | Requirement |
|---|---|
| Email format, unique, normalized | FR-001 |
| Password minimum 12 characters | FR-001 |
| Verification required before upload and AI | FR-002 |
| Refresh rotation, revocation on logout/password change | FR-003, FR-004 |
| Reset token single use, 30-minute expiry | FR-004 |
| Session-derived `userId` only | FR-005 |
| Ownership checks on every read, update, delete | FR-006 |
| Auth attempt limits and lockout | FR-007 |
| Allowed MIME types and 25 MB cap | FR-008 |
| Magic-byte verification and malware scan | FR-009 |
| Persistent processing status | FR-010 |
| Unique material-to-job and bounded retries | FR-011 |
| Upload rate limits | FR-012 |
| Image-only detection | FR-013 |
| Structured lesson schema | FR-014, FR-016 |
| Untrusted content delimiters | FR-015 |
| Token caps and daily budget | FR-017 |
| Autosave, revisions, optimistic concurrency | FR-019, FR-020 |
| Sanitization on save and render | FR-021 |
| Preview and final render parity | FR-022 |
| Tenant-scoped listing and retrieval | FR-023 |
| Cascade deletion | FR-024, FR-025 |
| Export before deletion | FR-027 |
| Safe error envelope | FR-026 |

## Query Patterns and Index Support

| Query | Index |
|---|---|
| List a user's materials, newest first | `{ userId: 1, createdAt: -1 }` |
| Poll one user's material status | `{ userId: 1, status: 1 }` + `_id` |
| Worker claim next job | `{ status: 1, leaseUntil: 1 }` |
| Load a lesson by owner | `{ userId: 1, updatedAt: -1 }` + `_id` |
| List revisions for one lesson | `{ userId: 1, lessonId: 1, version: -1 }` |
| Expire tokens | TTL indexes on `expiresAt` / `createdAt` |
| Retention purge of audit events | TTL index, 90 days |

## Retention Summary

| Data | Retention |
|---|---|
| Access token | 15 minutes |
| Refresh token | 7 days, revoked on rotation/logout |
| Email verification token | 24 hours |
| Password reset token | 30 minutes |
| Materials, lessons, revisions | Until user deletion; cascade within 30 days |
| Audit events | 90 days |
| Backups | 30 days, encrypted |
| Quarantined files | 30 days for review, then purged |
