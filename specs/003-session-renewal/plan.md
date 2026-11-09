# Implementation Plan: Silent Session Renewal and Redirect-Loop Elimination

**Branch**: `003-session-renewal` | **Date**: 2026-11-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-session-renewal/spec.md`

## Summary

Make the middleware's "signed in" decision honest (verify the access-token JWT
instead of checking cookie presence), route expired-access navigations through a
single silent-renewal hop that reuses the existing refresh rotation pipeline, and
guarantee that every alternative terminates on a rendered page so the
`/login` ↔ `/dashboard` redirect loop is unreachable by construction.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20 LTS; middleware runs in the
Edge-compatible Next.js middleware bundle (`jose` + `TextEncoder` only)

**Primary Dependencies**: existing Next.js 15 App Router, React 19; **no new
dependencies** — the renewal hop reuses `rotateRefreshToken`,
`signAccessToken`, and the audit pipeline

**Storage**: no schema changes; `refresh_tokens` and audit events reused

**Testing**: Vitest security matrix (awaited middleware calls) plus a contract
suite against the in-process Next app: owner renewal, bounded-redirect loop
regression, CSRF/nonce fail-closed cases, token-reuse case

**Target Platform**: evergreen browsers (fetch-metadata headers); graceful
fail-closed fallback (clear cookies → login) for very old clients

**Open Questions**: None.

## Constitution Check

| Principle / Section | Gate | How this plan satisfies it | Status |
|---|---|---|---|
| I. Zero-Trust Strict Input Validation | Route inputs validated; unknown/forged rejected | `next` path restricted to a narrow printable-ASCII, single-segmented, same-app path; nonce JWT verified with issuer/audience/expiry; fetch-metadata enforced | PASS |
| II. Tenant Data Isolation | Session-derived tenant scoping | The hop operates strictly on the caller's own refresh cookie; `rotateRefreshToken` resolves and revokes per-`userId`; blocked statuses revoke all | PASS |
| III. Anti-XSS / Output Sanitization | Not applicable to this data path | No rendered user content added; destination is used only as a redirect target after validation | PASS (n/a) |
| IV. File Upload Security & Resource Control | Upload/LLM endpoints unaffected | No new upload/LLM surface; hop is bounded one-per-navigation | PASS (n/a) |
| Auth: silent renewal allowance (v1.3.0) | Same rotation rules as the programmatic endpoint; fail-closed | Reuses `rotateRefreshToken`, blocked-status checks, audit events; every failure clears cookies → `/login` | PASS |
| Auth: CSRF for the navigation-initiated hop (v1.3.0) | Nonce + fetch-metadata, fail-closed | `talas-renew`-audience nonce bound to `next`, 60 s expiry, `Sec-Fetch-Site: same-origin` + `Sec-Fetch-Mode: navigate` | PASS |
| Testing & Quality Gates | Tests before/at implementation; every principle mapped to an automated test | Middleware matrix tests landed; contract suite + developer gates (**typecheck, lint, unit/security, integration, contract, build**) must be green before completion | **Tests pending — gate open** |

## Implementation Notes (as landed)

- **Decision — verify, don't trust presence (FR-1).** Middleware evaluates three
  booleans: access-cookie present, access-token signature/claims valid,
  refresh-cookie present. Auth pages bounce only on a **valid** access token;
  protected routes pass for valid access, fall through to the layout gate for
  fetch requests, and jump to the renewal hop for `navigate` requests.
- **Decision — one route, one hop (FR-3/FR-5).** The middleware constructs the hop
  (`/api/auth/session/renew`) with a nonce signed against the access secret
  (`talas-renew` audience, 60 s expiry) bound to the `next` path. The endpoint
  refuses anything the middleware would not have generated: missing/mismatched
  nonce, cross-site fetch metadata, non-navigation requests.
- **Decision — termination guarantee.** Both cycle-forming decisions now live in
  middleware (auth-page bounce only with a valid access token; renewal hop
  is one direction), and the hop terminates: rotate → back, or clear → `/login`.
  The `(app)` layout keeps a plain `redirect('/login')` fallback for RSC requests,
  which the middleware allows once the access token is not currently valid.
- **Structure.** Edge-safe verification lives in `lib/auth/access-token.ts`;
  `lib/auth/tokens.ts` re-exports for Node callers; `securityHeaders()` moved to
  `lib/http/security-headers.ts` so the hop and middleware share one definition.

## Testing Strategy

- **security matrix (tests/security/headers.test.ts — landed):** stale access
  must not bounce `/login`; only-refresh access does not bounce; navigation
  renewal hop produced for expired access + refresh; RSC/cors pass-through;
  unauthenticated → `/login?next=…`; header set intact.
- **contract (tests/contract/session-renew.test.ts — pending):** full-hop round
  trip with fresh cookie assertions; bounded-redirect regression (supertest
  auto-follow with a redirect cap lands on a 200 page); missing nonce; cross-site
  nonce reuse; revoked refresh → cleared cookies and `/login`.
- **Existing suites unaffected** but must re-run green (auth-everywhere suites
  exercise middleware through the in-process test app).

## Rollout

No flag needed; the middleware behavior change is immediate on deploy. Users
holding a stale access token will either be renewed silently or land on `/login`
with cleared cookies. No data migration.
