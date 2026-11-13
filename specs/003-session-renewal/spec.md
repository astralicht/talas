# Feature Specification: Silent Session Renewal and Redirect-Loop Elimination

**Feature Branch**: `003-session-renewal`

**Created**: 2026-11-09

**Status**: Implementation in progress (code landed; renewal contract tests and
quality gates pending)

**Constitution**: Amended as v1.3.0 ("Authentication and Sessions" — silent
session-renewal allowance and the navigation-CSRF mechanism; redirect-loop
prohibition)

**Input**: User description: "I'm being redirected to dashboard too many times. I can't
access the system anymore past clicking login on the home page."

## Problem

Two independent behaviors combined into an availability defect:

1. `middleware.ts` classified a visitor as "signed in" by the mere **presence**
   of an `access_token` or `refresh_token` cookie and bounced auth-page visitors
   to `/dashboard`.
2. `getSessionUser()` — the gate used by every protected page and the `(app)`
   layout — validates **only the 15-minute access token**. Expired or stale →
   anonymous → `redirect('/login')`.

A user idle past the access-token lifetime (cookie expires after 15 minutes;
refresh cookie lives 7 days) therefore ping-ponged between `/login` and
`/dashboard` until the browser aborted (`ERR_TOO_MANY_REDIRECTS`). Because Next
streams a 200 before the layout redirect fires, the loop also manifested as an
endless loading page with hundreds of rapid `/dashboard` requests.

## User Story — Resume a Session Without a Login Wall (Priority: P1)

A signed-in user who leaves the app idle beyond the access-token lifetime returns
and lands in their workspace as if never kicked out. If silent renewal is
impossible, they land on the sign-in screen — never in a redirect loop.

**Independent Test**: With a valid refresh cookie and an expired access token,
request a protected page as a full navigation and confirm the middleware routes
the request through one renewal hop and the original page renders with fresh
cookies; repeat with a cross-site navigation, a missing or tampered nonce, and a
revoked refresh token and confirm a cleared-cookie landing on `/login`.

**Acceptance Scenarios**:

1. **Given** a signed-in user whose access token has expired but whose refresh
   cookie is valid, **When** they open or navigate to a protected page as a
   browser navigation, **Then** exactly one renewal hop occurs and the page
   renders authenticated with re-issued access/refresh/CSRF cookies and a
   `token_refresh` audit event.
2. **Given** the same stale state, **When** the user visits an auth page
   (`/login`), **Then** they see the sign-in form (no middleware bounce).
3. **Given** a renewal attempt from a cross-site navigation, without the nonce,
   with a mismatched destination, or with an expired nonce, **When** the renewal
   endpoint receives it, **Then** it clears the auth cookies and redirects to
   `/login` without rotating anything.
4. **Given** a revoked or reused refresh token, **When** the renewal hop runs,
   **Then** all sessions for the user are revoked, cookies are cleared, the
   landing is `/login`, and a `refresh_reuse_detected` (or unauthorized) audit
   event is written.
5. **Given** any combination of cookie states, **When** redirects are followed
   with a bounded redirect cap, **Then** the chain always terminates on a
   rendered page — no `/login` ↔ `/dashboard` cycle is reachable.
6. **Given** an RSC/prefetch (non-navigation) request with a stale access token,
   **When** the middleware runs, **Then** the request passes through and the
   page-level gate falls back to the `/login` redirect (fetch flows still refresh
   via `apiRequest`).

## Requirements

### Functional

- FR-1: The middleware MUST verify the access-token JWT (signature, issuer,
  audience, expiry) rather than treating cookie presence as authentication.
- FR-2: Auth pages MUST only bounce signed-in users to `/dashboard` when the
  access token is currently valid.
- FR-3: A protected route requested as a `GET` navigation (`Sec-Fetch-Mode:
  navigate`) with an invalid/absent access token and a present refresh cookie
  MUST redirect to `GET /api/auth/session/renew?next=<path>&nonce=<token>`.
- FR-4: The renewal endpoint MUST validate a short-lived (≤ 60 s), signed nonce
  bound to the exact `next` path, MUST require `Sec-Fetch-Site: same-origin` and
  `Sec-Fetch-Mode: navigate`, and MUST fail closed (clear cookies → `/login`) on
  any miss.
- FR-5: The renewal endpoint MUST reuse the programmatic refresh pipeline:
  `rotateRefreshToken` (single-use, hashed, transactional, reuse-detected),
  blocked-status checks, fresh access + refresh + CSRF cookies, and a
  `token_refresh` audit event with correlation ID, IP, and user agent.
- FR-6: A stale refresh token MUST revoke all sessions for the user, clear the
  auth cookies, and land on `/login` with a `refresh_reuse_detected` audit event.
- FR-7: The `next` destination MUST be validated to a same-app printable-ASCII
  path (no `proto:` schemes, no `//` root-relative escape, no auth pages) default
  to `/dashboard`.
- FR-8: Non-navigation requests (RSC/prefetch/xhr) with a stale access token MUST
  pass through unchanged and rely on the existing page-level `/login` fallback
  and the `apiRequest` 401-refresh path.
- FR-9: Access-token verification used by the middleware MUST be edge-safe (no
  `node:crypto`/mongoose in the middleware bundle): a dedicated
  `lib/auth/access-token.ts` module (jose only) whose signings and legacy
  helpers stay in `lib/auth/token.ts` re-exporting the edge-safe verification.

### Non-Functional

- NFR-1: The renewal hop adds at most two redirect responses to a page load and
  is served with `Cache-Control: no-store`.
- NFR-2: Renewal nonces are HMAC-signed with the existing `JWT_ACCESS_SECRET`
  under a distinct audience (`talas-renew`); no new secret material is introduced.
- NFR-3: No persisted schema changes; the `refresh_tokens` collection and audit
  event types are reused as-is.
- NFR-4: Termination guarantee: every routing decision pair (middleware ↔ layout)
  must place both branches of each potential cycle on different terminations.

### Constraints from Constitution v1.3.0

- Access tokens 15 minutes; refresh rotation unchanged; renewal hop is the only
  sanctioned navigation-initiated state change, CSRF'd via nonce + fetch-metadata.
- Cross-tenant and rate-limiting principles untouched: renewal operates on the
  caller's own refresh cookie; the hop is not an upload/LLM endpoint and is
  bounded one hop per navigation.

## Checklists

### Crossing Concerns

- [ ] Contract tests: owner renewal (scenario 1), loop regression (scenario 5),
      fail-closed CSRF/nonce cases (scenario 3), reuse case (scenario 4).
- [x] Middleware routing-matrix unit tests (stale access must not bounce
      `/login`; navigation renewal hop; RSC pass-through).

### Data Lifecycle

- [x] No new collections; `token_refresh` and `refresh_reuse_detected` audit
      events retain the existing 90-day TTL.

### Implementation Inventory (as landed)

- `lib/auth/access-token.ts` — edge-safe `verifyAccessToken`, renew-nonce sign/verify.
- `lib/auth/tokens.ts` — re-exports for Node callers; signing stays Node-side.
- `middleware.ts` — session-state matrix (verify → auth-page bounce → renewal
  hop → login redirect), CSP/CORS/HSTS headers unchanged.
- `app/api/auth/session/renew/route.ts` — the renewal hop.
- `lib/auth/cookies.ts` — `setAuthCookiesOnResponse` / `clearAuthCookiesOnResponse`
  for redirect-style responses, max-age constants.
- `lib/http/security-headers.ts` — extracted so the renewal route shares the same
  hardening headers as the middleware.
- `tests/security/headers.test.ts` — awaited middleware matrix incl. loop-regression.
- `tests/helpers/client.ts` — `getWithoutCookies` for expired-token simulations.

## Amendments (constitution v2.0.0 + specs/005, Nov 2026)

- **Session TTLs**: access tokens default to 24 hours and refresh tokens to
  30 days (constitution v2.0.0 maximums), both configurable via
  `SESSION_ACCESS_TTL_SECONDS` / `SESSION_REFRESH_TTL_SECONDS` with bounded
  validation (access 300–86400, refresh 3600–2592000, refresh ≥ access).
  Cookie max-ages follow the configured TTLs.
- **T007** (contract suite `tests/contract/session-renew.test.ts`) and
  **T008** (full gate set) are complete and checked off in tasks.md.
