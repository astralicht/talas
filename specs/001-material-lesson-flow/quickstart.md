# Quickstart Validation: Account and Material-to-Lesson Flow

**Feature**: `001-material-lesson-flow`
**Purpose**: Prove the walking skeleton works end-to-end and that the constitution's
security controls are enforced. This is a validation guide, not an implementation guide.

## Prerequisites

- Node.js 20 LTS and pnpm 9
- Docker and Docker Compose
- A modern browser
- Optional cloud accounts for a staging run: MongoDB Atlas, S3-compatible storage,
  Redis, Resend, and OpenAI or Google Gemini

## Local Stack

`infra/docker-compose.yml` provides:

| Service | Local address | Purpose |
|---|---|---|
| MongoDB | `localhost:27017` | Primary data store; single-node replica set `rs0` for transactions |
| Redis | `localhost:6379` | Job queue and rate limits |
| MinIO | `localhost:9000` (console `:9001`) | S3-compatible private storage |
| ClamAV | `localhost:3310` | Malware scanning |
| MailHog | `localhost:8025` | Captured verification and reset emails |

## Setup

```bash
pnpm install
docker compose -f infra/docker-compose.yml up -d
cp .env.example .env.local
pnpm db:seed
pnpm dev          # Next.js web app on http://localhost:3000
pnpm worker:dev   # background worker
```

Required environment variables (values supplied locally, never committed):

```text
APP_URL
DATABASE_URL
REDIS_URL
S3_ENDPOINT
S3_REGION
S3_BUCKET
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
S3_FORCE_PATH_STYLE
CLAMAV_HOST
CLAMAV_PORT
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
CSRF_SECRET
OPENAI_API_KEY
GOOGLE_GENERATIVE_AI_API_KEY
AI_PROVIDER
AI_DAILY_BUDGET_USD
RESEND_API_KEY
EMAIL_FROM
LOG_LEVEL
```

`pnpm db:seed` creates two verified test users and one sample PDF. Credentials are
printed locally; they are not production credentials.

## Contracts and Data Model

- API contract: [contracts/openapi.yaml](./contracts/openapi.yaml)
- Entities, indexes, and state machines: [data-model.md](./data-model.md)

## Validation Scenarios

### 1. Account, Verification, and Sign-In

1. Register a new email at `/register`.
2. Confirm the message tells the user to verify before uploading.
3. Open MailHog, follow the verification link, then sign in.

**Expected**: Account is created; unverified upload is blocked; verification unlocks
upload and generation; sign-in lands on an empty personal workspace.

### 2. Tenant Isolation

1. Sign in as user A and upload a sample document.
2. Copy the lesson identifier from the URL.
3. Sign in as user B in a separate browser profile.
4. Request the lesson and material identifiers directly.

**Expected**: User B receives a safe not-found response that does not reveal whether the
record exists. The database query for user B returns no documents. The security suite
contains the same check for every tenant-scoped route.

### 3. Happy Path: Upload to Lesson

1. As a verified user, upload the seeded sample PDF (under 25 MB).
2. Watch the status move through queued, processing, and ready.
3. Open the generated lesson.

**Expected**: A structured Markdown lesson with headings, lists, and tables renders in
under 2 minutes. Refreshing preserves the status and the lesson.

### 4. Upload Rejections

| Test | Expected |
|---|---|
| Executable renamed to `.pdf` | Rejected as invalid content type |
| File larger than 25 MB | Rejected with the 25 MB limit stated |
| Image-only or scanned PDF | Rejected with an OCR-not-supported message |
| Text file containing the EICAR test string | Quarantined, never parsed |
| Unsupported extension | Rejected with the supported type list |

### 5. Processing Failure and Retry

1. Use the development-only fault-injection switch to make the AI call fail.
2. Upload a document and wait for the failed state.
3. Turn off fault injection and choose retry.

**Expected**: The failure shows a safe reason and a retry action. Retry succeeds without a
new upload and without creating a duplicate lesson.

### 6. Editor, Autosave, and Conflicts

1. Open a ready lesson and edit the Markdown.
2. Wait for autosave, then reload.
3. Open the same lesson in a second tab, edit both, and save both.
4. Open revision history and restore an older revision.

**Expected**: Autosave survives reload; the second stale save returns a conflict instead
of overwriting; restoring a revision creates a new version and preserves history.

### 7. Output Sanitization

1. Save a lesson containing `<script>alert(1)</script>`.
2. Save a link using a `javascript:` URL.
3. Save an image with an `onerror` handler.

**Expected**: No script executes in preview or saved view; unsafe tags, handlers, and URL
schemes are removed; safe Markdown still renders.

### 8. Rate Limiting

1. Attempt six uploads within one minute as the same user.

**Expected**: The sixth request returns a rate-limit response with a `Retry-After` value;
the UI shows when to retry. Hourly and per-minute limits both hold.

### 9. Export and Account Deletion

1. Request an account export.
2. Confirm the ZIP contains material metadata and Markdown lessons.
3. Request account deletion and confirm sign-in no longer works.
4. Run the cascade test and inspect MongoDB, Redis, and object storage.

**Expected**: Export is complete and portable; access ends immediately; materials,
lessons, revisions, and stored objects are removed within the deletion window.

### 10. Automated Gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm openapi:lint
pnpm build
```

**Expected**: All commands pass. The security suite proves validation rejection, XSS
containment, cross-tenant denial, MIME spoofing rejection, oversized upload rejection,
unauthorized-route denial, and rate-limit enforcement. CI blocks merge on any failure,
on new high or critical dependency vulnerabilities, or on a detected secret.

## Manual Review Checklist

- [ ] No secrets are present in the repository or client bundles.
- [ ] Cookies are `HttpOnly`, `Secure` in production, and `SameSite=Lax` or stricter.
- [ ] State-changing authenticated requests reject a missing CSRF header.
- [ ] HSTS and Content-Security-Policy headers are present in production.
- [ ] Errors show a correlation ID and no stack traces or internal details.
- [ ] Audit events exist for sign-in, failed sign-in, authorization denial, and deletion.
- [ ] Logs contain no passwords, tokens, full prompts, or file contents.
- [ ] The worker fails closed when ClamAV is unavailable.
