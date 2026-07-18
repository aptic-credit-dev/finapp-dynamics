# Pull request — ready to paste

**Base:** `main` ← **Head:** `feature/stage-1c-authentication-sessions` (head SHA `98f367e`)
**Create at:** https://github.com/aptic-credit-dev/finapp-dynamics/compare/main...feature/stage-1c-authentication-sessions?expand=1

**Title:**

```
Stage 1C: Implement M02 Authentication & Sessions (m02-auth)
```

**Body:**

```markdown
Implements Stage 1C — Authentication & Sessions (m02-auth) from certified Stage 1B (`e3e51a5`). Full gate
report: `docs/build/stages/STAGE_1C_AUTH_SESSIONS_COMPLETION.md`.

## Architecture decisions
- **ADR-015** (ACCEPTED) — opaque, revocable, server-side sessions + rotating refresh with reuse→family
  revoke. Not stateless JWTs.
- **ADR-016** (ACCEPTED) — Argon2id via `@node-rs/argon2` (first runtime dependency); `node:crypto.scrypt`
  documented fallback.
- **D3** (RESOLVED) — Secure, HttpOnly, SameSite=Lax cookies with CSRF; strict credentialed CORS; production
  fail-closed.

## Scope
Credentials (Argon2id, rehash-on-login, no plaintext) · durable lockout/throttle · login/logout · session
issue/validate/refresh/rotate/**reuse→family-revoke**/revoke/list/expiry · `SessionActorAdapter` (the
UNCHANGED `ActorResolver` re-gates account/identity/membership every request) · **DevActorAdapter and
`x-dev-actor` DELETED** · `/api/v1/auth` API · secure cookies + global CSRF + CORS · `identity.authentication`
events · `AUTH_` audit codes · `auth.*` permissions.

## Stage 1D boundary (preserved)
`x-permissions` and `ContextAuthz` are untouched. Stage 1C authenticates; Stage 1D authorizes.

## Test evidence (local)
- Smoke: **8 suites / 1004 assertions**, 0 failures (build/lint/format clean, on a clean checkout).
- DB: **7 specs / 301 assertions**, 0 failures — incl. new `m02-auth` (32) and `api-auth` (37): login
  cookies/attributes, enumeration resistance, session-backed actor, `x-actor-id`/`x-dev-actor` rejected, CSRF
  enforcement, refresh + reuse over HTTP, logout, durable lockout, admin revoke; no plaintext column; no
  DELETE grant. Local PostgreSQL **15.2**; **PostgreSQL 16 CI on this PR is the authoritative gate.**

## Security
Enumeration resistance · constant-time verify · 256-bit tokens hashed at rest · session fixation prevented ·
refresh rotation + reuse detection · idle + absolute expiry · credential-change + suspension revocation ·
CSRF + strict CORS · production fail-closed · pooled-connection non-leak · no permission injection.

## Merge conditions
- ⏳ **PG16 CI on this PR green** (Smoke + DB lanes).
- ⏳ PAT revocation; branch protection already active.

Do not begin Stage 1D until this PR merges and the Stage 1C gate is accepted.
```
