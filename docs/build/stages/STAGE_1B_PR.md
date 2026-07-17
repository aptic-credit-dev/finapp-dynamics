# Pull request — ready to paste

**Base:** `main` ← **Head:** `feature/stage-1b-m02-identity` (head SHA `6cd3918`)
**Create at:** https://github.com/aptic-credit-dev/finapp-dynamics/compare/main...feature/stage-1b-m02-identity?expand=1

**Title:**

```
Stage 1B: Implement M02 Identity Foundation
```

**Body:**

```markdown
Implements Stage 1B — M02 Identity Foundation (substage 1B of the m02 split). Full gate report:
`docs/build/stages/STAGE_1B_M02_IDENTITY_COMPLETION.md`.

## Scope completed
- Identity Registry, User Account Registry, Tenant Membership — three **separate** lifecycles (a person, a
  login, a tenant relationship), never one collapsed status.
- `ActorResolver` — three independent gates: account active AND identity active AND membership active.
- Development-only **signed** actor assertion (HMAC-SHA256, time-limited) replacing `x-actor-id`.
- Identity APIs (`/api/v1/identities`), Account APIs (`/api/v1/accounts`), Tenant Membership APIs
  (`/api/v1/tenant-memberships`) — every mutating route carries `@Endpoint({ permission, auditCode })`.
- M01 migrated to the authoritative `ActorContext`; **raw `x-actor-id` trust removed** (parser deleted).
- PostgreSQL RLS tests, API + integration tests, conformance checks, docs and manifest updates.

## Temporary boundaries (stated plainly)
- The development identity adapter (`DevActorAdapter`, `x-dev-actor`) is **removed in Stage 1C**.
- `x-permissions` remains temporary (read in exactly one file, behind the AUTHZ port) — **removed in 1D**.
- `ContextAuthz` remains temporary — **deleted in 1D** when `RbacAuthz` is bound.
- Persistent RBAC is Stage 1D. Audit stays behind the AUDIT port (m03). Events stay behind the OUTBOX
  port (m06). No second event path or outbox table is introduced.

## Security limitations
- The development assertion must **never** run in production; the adapter refuses to construct outside
  `development`/`test`, and the API refuses to boot in production rather than serve without an actor source.
- The API is **not yet production-authenticated** — Stage 1C is required before trusted-network exposure.
- Final persistent authorization requires Stage 1D.

## Test evidence
- Smoke: **7 suites / 919 assertions**, 0 failures (build, lint, format all clean).
- DB: **5 specs / 254 assertions**, 0 failures (m01-tenant 46, m02-actor-resolution 52, m02-identity 45,
  api-identity 85, rls-convention 26) — RLS exercised as the non-superuser `finapp_app` role.
- Local PostgreSQL: **15.2**. **PostgreSQL 16 CI on this PR is the authoritative certification gate.**

## Merge conditions
- ✅/⏳ **PG16 CI on this PR must be green** — confirm `Assert PostgreSQL 16` passed and `DB integration
  specs` shows 5 specs / 254 assertions, no skip.
- ⏳ Revoke the previously exposed PAT (`ghp_0jL…`).
- ⏳ Enable branch protection on `main` (require Smoke + DB lanes; block force-push and deletion).

Do not begin Stage 1C until this PR merges and the Stage 1B gate is formally accepted.
```
