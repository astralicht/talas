---
description: "Dependency-ordered tasks for Silent Session Renewal and Redirect-Loop Elimination"
---

# Tasks: Silent Session Renewal and Redirect-Loop Elimination

**Input**: Design documents from `specs/003-session-renewal/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), constitution v1.3.0

**Tests**: Required. Constitution Testing & Quality Gates mandates test-first
delivery; the contract suite (T007) is the remaining gate and MUST pass before
completion. Test code and implementation code landed in the same change because
the triggering defect was user-blocking; the pending tests close the gate.

**Organization**: Landing order matches dependency flow: edge-safe primitives →
middleware routing → renewal endpoint → shared helpers → test matrix.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Independent, no ordering dependency
- Every task names the exact file or files it changes

---

## Phase 1: Edge-Safe Primitives

- [x] T001 Extract the edge-safe access-token verification (`verifyAccessToken`,
      claims types, `ACCESS_TOKEN_TTL_SECONDS`, JWT issuer/audience constants) and
      renew-nonce sign/verify (`talas-renew` audience, 60 s expiry, path-bound
      payload) into `lib/auth/access-token.ts` — no `node:crypto`, no mongoose.
- [x] T002 Restructure `lib/auth/tokens.ts` to keep Node-side signing/derivation
      (`signAccessToken`, `generateOpaqueToken`, `hashToken`, refresh/access
      expiry helpers) and re-export the edge-safe verification and constants for
      existing callers.

## Phase 2: Middleware Routing Matrix

- [x] T003 Rewrite `middleware.ts` into an async session-state matrix:
      verify access token via `verifyAccessToken`; bounce auth pages only on a
      **valid** access token; protected routes renew on `navigate` GET with a
      refresh cookie; unauthenticated → `/login?next=…`; RSC/xhr/tampered-token
      requests pass through to the page-level gate. Extract shared
      `securityHeaders()` to `lib/http/security-headers.ts` for reuse by the hop.

## Phase 3: Renewal Endpoint

- [x] T004 Create `app/api/auth/session/renew/route.ts`: nonce validation
      (audience, expiry, path equality), `Sec-Fetch-Site/Mode` enforcement,
      safe `next` sanitization, rotation via `rotateRefreshToken`, blocked-status
      checks, fresh access/refresh/CSRF cookies via response-cookie helpers,
      `token_refresh` and `refresh_reuse_detected` audit events, and
      fail-closed cleared-cookie landings on `/login`.
- [x] T005 [P] Add response-cookie helpers and max-age constants to
      `lib/auth/cookies.ts` (`setAuthCookiesOnResponse`,
      `clearAuthCookiesOnResponse`, `ACCESS_COOKIE_MAX_AGE`,
      `REFRESH_COOKIE_MAX_AGE`, `CSRF_COOKIE_MAX_AGE`).

## Phase 4: Tests and Quality Gates

- [x] T006 Update `tests/security/headers.test.ts` for the awaited middleware
      and the new matrix (stale-token must not bounce `/login`; navigation
      renewal hop; RSC pass-through; valid-token auth-page bounce), and add
      `getWithoutCookies` to `tests/helpers/client.ts` for expired-token
      simulations.
- [x] T007 Write `tests/contract/session-renew.test.ts`: one-hop owner renewal
      with fresh-cookie assertions; bounded-redirect loop regression (follow with
      a redirect cap, assert a rendered 200); missing/tampered/mismatched-nonce
      fail-closed; cross-site fetch-metadata rejection; revoked-refresh reuse
      path with cleared cookies.
- [x] T008 Run and green the full gate set: `pnpm typecheck`, `pnpm lint`,
      `pnpm test` (unit + security), `pnpm test:integration`,
      `pnpm test:contract`, `pnpm build`.

## Phase 5: Governance

- [x] T009 Amend the constitution to v1.3.0 (Authentication and Sessions:
      silent-renewal allowance, redirect-loop prohibition, navigation-CSRF
      mechanism), refresh the version/Last Amended lines, and leave the combined
      pre-commit Sync Impact Report in place (remove before the amendments are
      committed — the v1.2.0 lesson-view amendment is also still uncommitted).
- [x] T010 Create `specs/003-session-renewal/` (spec.md, plan.md, tasks.md)
      documenting the feature against constitution v1.3.0.

---

## Notes

- The renewal hop deliberately does NOT run for RSC/prefetch requests: server
  components cannot set cookies, and redirect chains that lose RSC headers
  mid-hop are fragile. Those requests rely on the existing page-level
  `/login` fallback and the client `apiRequest` 401-refresher.
- Nonce TTL is 60 seconds with `clockTolerance: 0`; a slow device retries through
  a fresh navigation and the middleware re-issues the nonce.
