# Stage 1D — RBAC & Authorization (m02-rbac) — Readiness Assessment

**2026-07-18** · Branch `feature/stage-1d-rbac-authorization` · **Planning/design only. No Stage 1D source.**

## Verdict: CONDITIONAL GO for Stage 1D implementation

The design below replaces client-supplied permissions with persisted, tenant-aware authorization without
touching the ~36 existing `authz.require(ctx, permission)` call sites, and fails closed throughout.
Implementation is cleared once four ADRs are accepted — they are architecture sign-offs, not design gaps:

| # | Decision | ADR |
|---|---|---|
| **D1** | RBAC model: flat roles → concrete permission grants (no wildcards in grants, **no inheritance** in MVP); assignments on **tenant membership** (tenant roles) and **identity** (platform roles); allow-list + default-deny | ADR-017 (draft) |
| **D2** | Scope model: **tenant** scope in MVP + optional organizational (branch/department/entity) scope reusing m01's composite FKs; **defer** resource-instance/own-record/product/ABAC | ADR-018 (draft) |
| **D3** | SoD: incompatible role/permission pairs enforced **at assignment-time AND runtime**; **no explicit-deny records** in MVP | ADR-019 (draft) |
| **D4** | Administrator bootstrap: migration-seeded immutable platform-admin role + an environment-gated, idempotent, auditable grant to a configured bootstrap account; fails closed in production; no bypass secret | ADR-020 (draft) |

Four draft ADRs accompany this report. No code may be written until they are accepted.

---

## 1. Certified Stage 1C baseline

Stage 1C (m02-auth) is **certified and complete** — PR #5 merged (`48cba39`), certified via PR #6. Sessions,
credentials, `SessionActorAdapter`, the retired dev adapter, and `x-permissions`/`ContextAuthz` (still
temporary) are all on `main`. CI: run `29646472150` both lanes green.

## 2. Starting main SHA

**`004b2fd57f3caa15dad6c47c34dbd8a13093cbc2`** — PR #6 certification merge (contains the Stage 1C merge
`48cba39`). Local `main` == `origin/main`, tree clean.

## 3. Stage 1D branch

**`feature/stage-1d-rbac-authorization`**, created from `004b2fd`.

## 4. Objective

Answer, authoritatively and tenant-aware: *"given an authenticated actor, tenant, requested permission and
(optional) resource scope, is the action permitted?"* Replace `x-permissions` and `ContextAuthz` with a
persistent authorization foundation. Authentication stays Stage 1C; identity/account/membership resolution
stays Stage 1B.

## 5. Scope

Persistent permission catalogue, roles, role→permission, actor→role assignments (tenant- and identity-
scoped), tenant + organizational scope evaluation, allow-list + default-deny decision, role/assignment
lifecycles + append-only history, SoD foundation, time-bound assignments, `RbacAuthz` replacing
`ContextAuthz`, **x-permissions retirement**, RBAC administrative APIs (`/api/v1/roles` + `/api/v1/rbac/*`),
administrator bootstrap, RBAC events + audit intents through the existing ports, tests + conformance.

## 6. Explicit exclusions

Login/credentials/sessions/MFA/OAuth (Stage 1C) · audit persistence (m03) · outbox delivery (m06) · full
maker-checker **workflow** engine (m22) · business-module workflows · Feedback/Legal/Finance/Recon/AI ·
field-level masking · a general ABAC policy language · external IdPs · **break-glass** (deferred to a
hardening stage with its own ADR) · **explicit-deny records** (MVP uses allow-list + default-deny) · **role
inheritance** (MVP is flat). Stage 1D must not become a general policy-engine project.

## 7. Existing architecture inspected

- **`Authz` port** (`packages/kernel/src/authz.ts`): `can(ctx, permission)` / `require(ctx, permission)` —
  permission STRING only, no resource/scope param. Deny-by-default. Owned contract; single implementation.
- **`ContextAuthz`** (`packages/m01-tenant/src/adapters.ts`): reads `ctx.permissions` (a `RequestContext`) or
  a `SystemContext`'s carried permissions. Bound in `apps/api/src/platform.module.ts` (one line).
- **`x-permissions`**: read in exactly ONE file — `permissionsFor()` in
  `packages/m02-identity/src/actor-context.ts` (`PERMISSIONS_HEADER`), producing `ctx.permissions`; a system
  actor gets `[]` (`systemActorInheritsHumanPermissions() === false`).
- **~36 authz check sites**, all `authz.require(ctx, PERMISSION)` (m01 tenant/org services, m02 identity/
  membership services, auth controller). None passes a resource or scope — the replacement must honour this
  exact contract to avoid touching them.
- **`ActorContext`/`RequestContext`**: `{ tenantId, userId (identity), correlationId, permissions }`.
  `userId` is the **identity** (set only by `contextFromActor`). `SystemContext` is actorless.
- **`ActorResolver` / `SessionActorAdapter`**: authoritative for identity/account/membership/tenant; unchanged.
- **Registries**: `rbac.*` permission namespace + `RBAC_` audit prefix reserved (status `documented`,
  substage 1D); manifest substage 1D = `m02-rbac`, owns `[roles, permissions, user_roles, sod_catalogue]`,
  api `/api/v1/roles`. `/api/v1/roles` and `/api/v1/users` registered in naming-map.
- **RLS convention**: tenant-scoped tables = FORCE + `tenant_isolation` (`tenant_id = NULLIF(current_setting
  ('app.tenant_id',true),'')::uuid`), no escape; global control-plane = FORCE + system escape (ADR-014).
- **Conformance**: asserts `x-permissions` in exactly one file, and **no Stage 1D table exists**
  (`roles, permissions, user_roles, role_permissions, sod_catalogue`) — Stage 1D deletes that assertion as
  it builds them.
- **Highest ADR** = ADR-016; Stage 1D drafts ADR-017…020.

## 8. Current temporary authorization implementation

`x-permissions` (unauthenticated client header) → `ctx.permissions` → `ContextAuthz` set-membership check.
Real enforcement, untrusted input. It is the last client-supplied authoritative surface, isolated to two
sites (`permissionsFor`, the one `AUTHZ` binding). **It is not safe merely because it is behind the port** —
any caller reaching the API can claim any permission. Stage 1D closes this.

## 9. Trust boundary (target)

```
request → SessionActorAdapter → ActorResolver → ActorContext { identity, account, tenant, membership }
        → RBAC permission resolution (identity+tenant → effective permissions from active role assignments)
        → ctx.permissions populated FROM THE DATABASE (never the client, never the session)
        → authz.require(ctx, permission)  [RbacAuthz set-check]   → PERMIT / DENY (default deny)
        → (scope- or SoD-sensitive endpoints) authorize(request)  → richer decision
```

The engine never authenticates; the session carries no authoritative permissions; the client never supplies
roles/permissions. `ActorResolver` stays authoritative for identity/account/membership/tenant; Stage 1D
becomes authoritative for roles, assignments, permissions, scope, SoD, and the permit/deny decision.

## 10. Permission model

Format **`module.resource.action`** (three segments) — the existing repo convention the kernel's `@Endpoint`
validator already enforces (`identity.registry.view`, `auth.session.revoke`). Catalogue table `permissions`:
`id`, `code` (unique), `module`, `resource_type`, `description`, `risk` (normal|elevated|critical),
`privileged` (bool), `assignable` (bool), `deprecated` (bool), `replacement_code`, `allowed_scopes`. Seeded
by migration from each module's declared permission set (the same lists already in `permissions.ts` files).
Permissions are registered, unique, immutable in meaning, version-controlled, assigned only through roles,
and never client-injected. **Wildcards (`identity.*`) are NAMESPACE reservations, not grants** — a role
holds only concrete codes; evaluation is exact-match set membership, so there is no ambiguous wildcard
precedence. (ADR-017 records this.)

## 11. Role model

`roles`: `id`, `tenant_id` (NULL for system roles), `code`, `name`, `description`, `kind`
(system|tenant_custom), `is_immutable`, `status` (draft|active|suspended|retired), `risk`, `version`,
lifecycle timestamps. **System roles** are global, immutable, migration-seeded (e.g. `platform_admin`,
`tenant_admin`), **not editable by tenant administrators**. **Tenant custom roles** are tenant-scoped
(RLS, no escape), created/cloned/edited by an authorized tenant admin. **No inheritance in MVP** — a role is
a flat set of permission grants; composition is achieved by assigning multiple roles (ADR-017). This avoids
recursion, cycles and depth limits entirely; runtime evaluation is a union of the actor's active roles'
permissions. Role lifecycle: activate / suspend / retire, append-only `role_status_history`.

## 12. Assignment model

Assignments attach at **two levels**, deliberately:

- **Tenant roles → the tenant membership** (`role_assignments`, tenant-scoped, RLS, **no escape**). Because
  authorization is tenant-context dependent and 1B already anchors the actor's tenant relationship in
  `tenant_memberships`. An assignment in tenant A physically cannot grant in tenant B — the row is invisible
  outside A's tenant context.
- **Platform roles → the identity** (`platform_role_assignments`, global plane, system escape) — for the
  handful of cross-tenant platform administrators.

Fields: `id`, (`tenant_id`,) `membership_id`|`identity_id`, `role_id`, `assignment_scope` (nullable org
scope, §13), `effective_from`, `expires_at` (nullable, time-bound), `status` (active|suspended|revoked|
expired), `granted_by`, `revoked_by`, `revocation_reason`, `justification`, `version`, append-only
`assignment_status_history`. A membership in a suspended/ended state cannot yield permissions (the resolver
already gates membership). Delegation and emergency access are **out of MVP**.

## 13. Scope model

MVP scopes: **global platform**, **tenant**, and optional **organizational** (entity/branch/department)
reusing m01's composite `(tenant_id, id)` FKs. Most permission checks are tenant-scoped (cover every
existing call site). An assignment MAY carry an `assignment_scope` (entity/branch/department id in the same
tenant); a scope-sensitive endpoint calls the richer `authorize(request)` with the resource's scope and the
decision requires the assignment's scope to **contain** the resource's scope. Precedence: an unscoped
(tenant-wide) assignment contains all org scopes; a scoped one contains only its subtree. **Default deny**;
tenant boundary enforced by RLS, never by application filtering alone. **Deferred:** own-record,
assigned-record, product, resource-instance, ABAC (ADR-018 records the boundary).

## 14. Authorization decision semantics

Decision inputs: actor identity, account, tenant, membership, requested permission, (optional) resource
type/id + scope, correlation id. Outputs: `PERMIT` | `DENY` | `INDETERMINATE`. **`INDETERMINATE` (any
resolution error) fails closed to `DENY`.** Model is **allow-list + default-deny**: PERMIT iff the actor has
an active, unexpired assignment of an active role that grants the concrete permission in the request's tenant
and (if scoped) whose scope contains the resource. **No explicit-deny records in MVP** — allow-list +
default-deny is sufficient and avoids deny-precedence complexity; if a future business rule needs explicit
deny it arrives as its own ADR (ADR-019 records this). External denials stay generic (`Missing required
permission: <code>.` — no resource disclosure); internal reason codes are structured for audit.

## 15. SoD model

`sod_rules`: `id`, `tenant_id` (NULL = global mandatory), `rule_type` (role_pair|permission_pair),
`code_a`, `code_b`, `description`, `severity`, `status`. Seed the mandatory pairs (maker↔checker, initiator↔
final-approver, user-admin↔audit-admin, payment-creator↔payment-approver, recon-preparer↔recon-approver).
Enforced **at assignment time** (granting a role that would put an actor in an incompatible pair is refused,
`409`) **and at runtime** (a privileged action fails closed if the effective set somehow contains an
incompatible pair). Overrides require an authorized actor + justification + audit; **no silent override**.
(ADR-019.)

## 16. Temporary and emergency access

**Time-bound assignments ARE in MVP**: `effective_from` / `expires_at` on the assignment; an assignment is
inert outside its window (evaluated against `now()` — no background job needed for correctness, a sweeper
only tidies status). Requires justification + granting actor + audit + event; no silent renewal.
**Delegation and break-glass are OUT of MVP** — break-glass needs dual-control, a dedicated ADR and its own
audit discipline, and must never bypass tenant isolation or authentication; it belongs in a hardening stage.

## 17. System and service actor model

`SystemContext` stays **actorless and role-less**. `withSystem` relaxes WHICH ROWS the DB shows (ADR-014),
never WHICH ACTIONS are permitted. `RbacAuthz` for a `SystemContext` grants only permissions a platform
action explicitly supplies (as today) — never a blanket allow; the default is deny. Background jobs/
migrations/scheduled tasks run under a named `reason`, least privilege, with audit intent. There is no
`system = allow everything` rule for normal runtime. Service-account authentication remains deferred (1C).

## 18. Database design

| Table | Scope | Notes |
|---|---|---|
| `permissions` | **global reference** (no RLS, seeded) | catalogue; immutable meaning; risk/privileged/assignable/deprecated |
| `roles` | system rows **global** (system escape); tenant rows **tenant-scoped** (RLS, no escape) | immutable system roles; tenant custom roles |
| `role_permissions` | follows the role's scope | role → concrete permission code |
| `role_assignments` | **tenant-scoped, RLS, NO escape** | membership → role, optional org scope, time-bound |
| `platform_role_assignments` | **global**, system escape | identity → platform role (cross-tenant admins) |
| `role_status_history`, `assignment_status_history` | append-only (INSERT+SELECT by privilege) | lifecycle evidence |
| `sod_rules` | global (NULL tenant) + tenant-scoped | incompatible pairs |

Every table: composite `(tenant_id, id)` keys + composite FKs where tenant-scoped; `version`; effective/
expiry dates on assignments; `granted_by`/`revoked_by`/reason; **no `DELETE` grant**; retire by status +
append-only history (ADR-005/010). Indexes: assignment lookup by `(tenant_id, membership_id, status)`,
`(role_id)`, `expires_at`; permission by `code`; SoD by `(tenant_id, code_a, code_b)`.

## 19. RLS design

`permissions` global reference (no RLS). `roles`/`role_permissions`: tenant rows FORCE + `tenant_isolation`
(no escape); system rows readable via the global/system path. `role_assignments`: **tenant-scoped FORCE, no
escape** — a tenant sees only its own assignments; the permission RESOLVER reads them inside the actor's
tenant context, so cross-tenant assignment leakage is impossible. `platform_role_assignments`: global +
system escape. `sod_rules`: global mandatory readable everywhere; tenant rules tenant-scoped. Pooled-
connection safety via `SET LOCAL ROLE` + transaction-scoped GUCs (the proven 1B/1C pattern). No dependence
on application filtering for isolation.

## 20. AUTHZ adapter design

`RbacAuthz implements Authz` (m02-rbac), bound to `AUTHZ` in `platform.module.ts` — **replacing
`ContextAuthz`**. It keeps the exact `can/require(ctx, permission)` contract, so **no call site changes**.
Resolution strategy (ADR-017): the **`ActorContextFactory` pre-resolves the actor's effective permissions
ONCE per request** from the database (a `PermissionResolver` in m02-rbac, keyed by `ctx.userId` identity +
`ctx.tenantId`, reading active assignments inside the tenant context) and populates `ctx.permissions` — the
same field, now sourced from RBAC instead of the `x-permissions` header. `RbacAuthz.can` is then a
set-membership check over that RBAC-sourced set. Fresh every request (immediate revocation, no cache),
single query, minimal blast radius. A richer `authorize(request)` method (resource type/id + scope + SoD) is
added ONLY for the endpoints that need instance/scope decisions; the string-permission port stays the norm.
Fails closed on any resolution error.

## 21. `ContextAuthz` retirement

Delete the class from `m01-tenant/src/adapters.ts`, its export from `m01-tenant/src/index.ts`, and its
binding in `platform.module.ts` — in the **same commit** that binds `AUTHZ → RbacAuthz`. Update the m01
smoke fixtures that construct permissions by hand to use an explicit `Authz` test double. Conformance stops
allowing `ContextAuthz` and asserts `AUTHZ` is bound to the persistent adapter.

## 22. `x-permissions` retirement

Remove `PERMISSIONS_HEADER` and the header read in `permissionsFor()` (actor-context.ts); `ctx.permissions`
is populated by the RBAC `PermissionResolver` instead. **The header is no longer read anywhere** — supplying
it grants nothing (a test asserts this). Replace API/integration fixtures that inject `x-permissions` with
**real role assignments** (seed a role + assignment, then call). Unit tests use an explicit `Authz`/resolver
double rather than HTTP header injection. Conformance asserts **zero** live `x-permissions` use (like
`x-actor-id` / `x-dev-actor`), and the "one file" allowance is deleted.

## 23. Administrative API catalogue

Under the registered `/api/v1/rbac/*` (and `/api/v1/roles` reserved). Every mutating route carries
`@Endpoint({ permission, auditCode })`, optimistic concurrency (`expectedVersion`), and generic errors.

| Method & path | Permission |
|---|---|
| `GET /api/v1/rbac/permissions` | `rbac.permission.view` |
| `GET/POST /api/v1/rbac/roles`, `GET/PATCH /rbac/roles/:id`, `POST /rbac/roles/:id/(activate\|suspend\|retire)` | `rbac.role.view\|create\|edit\|activate\|suspend\|retire` |
| `GET/POST /api/v1/rbac/assignments`, `GET /rbac/assignments/:id`, `POST /rbac/assignments/:id/revoke` | `rbac.assignment.view\|grant\|revoke` |
| `GET/POST /api/v1/rbac/sod-rules`, `PATCH /rbac/sod-rules/:id` | `rbac.sod.view\|manage` |

Responses expose no internal decision internals; pagination + status/tenant filtering; assignment create is
idempotent on `(membership_id, role_id, scope)`; SoD checked on assignment create. No public self-service
role management.

## 24. Bootstrap strategy (mandatory decision)

Migration seeds an **immutable `platform_admin` system role** (all `*.view`/admin permissions) and a
`tenant_admin` template. An **environment-gated, idempotent, auditable bootstrap** grants `platform_admin` to
a configured bootstrap **account/identity reference** (`FINAPP_BOOTSTRAP_ADMIN_ACCOUNT`, an existing account
id — never a password, never a bypass secret). It **fails closed in production** without explicit config,
grants exactly once (idempotent — a second run is a no-op), writes audit + a `BootstrapAdminProvisioned`
event, and cannot mint arbitrary repeated admins. Documented as an operational runbook. (ADR-020.) This is
how the first platform/tenant admin obtains a role **without** `x-permissions`.

## 25. Cache and consistency strategy

**MVP: no cache.** Effective permissions are resolved per request from the DB inside the tenant context, so
revocation, role/permission changes and membership suspension take effect on the **next request** — the same
freshness guarantee the resolver already gives. One indexed query per request. Caching is a documented
future optimization requiring a keyed (identity+tenant) entry, an invalidation event on assignment/role
change, a version, and tenant isolation — **a stale cache must never preserve revoked privileged access**, so
it is deliberately out of the first cut.

## 26. Events

New family **`identity.authorization`** (m02-rbac; registered with the module; classification `confidential`;
identifiers only): `RoleCreated`, `RoleUpdated`, `RoleActivated`, `RoleSuspended`, `RoleRetired`,
`PermissionGrantedToRole`, `PermissionRemovedFromRole`, `RoleAssigned`, `AssignmentRevoked`,
`AssignmentExpired`, `SodRuleCreated`, `SodConflictDetected`, `AuthorizationDenied` (privileged only),
`PrivilegedRoleGranted`, `BootstrapAdminProvisioned`. Through the existing OUTBOX port — no second pipeline.

## 27. Audit codes

`RBAC_` prefix (registered), `<PREFIX>_<ENTITY>_<ACTION>`: `RBAC_ROLE_CREATED|UPDATED|ACTIVATED|SUSPENDED|
RETIRED`, `RBAC_ROLE_PERMISSION_GRANTED|REVOKED`, `RBAC_ASSIGNMENT_GRANTED|REVOKED|EXPIRED`,
`RBAC_SOD_RULE_CREATED|CONFLICT_DETECTED`, `RBAC_BOOTSTRAP_PROVISIONED`. Adverse/terminal actions
`reason_required`. Through the AUDIT port; details never contain a secret.

## 28. Security controls

Default deny; no permission injection (client can't supply roles/permissions; `x-permissions` gone); tenant
isolation by RLS; assignment-forgery/cross-tenant-reuse impossible (assignment rows are tenant-RLS-scoped);
self-escalation denied (granting requires `rbac.assignment.grant`, itself SoD-checked); role-escalation via
role edit gated by `rbac.role.edit` + immutable system roles; stale/revoked/suspended/expired access denied
(fresh per-request resolution); assignment races (unique constraint + status); SoD at write + runtime;
system-context not a bypass; resource-scope containment; enumeration-resistant errors; mass-assignment/IDOR
guarded (explicit field allow-lists, RLS on `:id`); pagination bounded; append-only audit; pooled-connection
non-leak; bootstrap idempotent + env-gated; **production fails closed** on unresolved authorization.

## 29. Test catalogue

**Pure:** permission set-matching; role/assignment lifecycle state machines; scope containment; expired/
suspended/revoked → deny; default-deny; SoD conflict; time-bound windows; reason mapping; registry
conformance (rbac.* perms, RBAC_ codes, identity.authorization family). **DB (PG16):** permission catalogue
seed; role + role_permission persistence; tenant-scoped assignment isolation (A can't see/use B's); org-scope
containment; expiry; append-only history; SoD constraints; concurrent/duplicate assignment; RLS under the app
role; system-context limits; pooled-connection cleanup; **no plaintext/no-DELETE**. **API:** list permissions;
create/update/activate/suspend/retire role; grant/revoke permission; assign/revoke role; suspended-role and
expired-assignment denied; cross-tenant denied; self-escalation denied; SoD conflict → 409; unauthorized RBAC
admin denied; tenant-admin vs platform-admin scoping; pagination/filtering; no sensitive fields. **Integration:**
login (1C) → resolve (1B) → authorize (1D); M01/M02 APIs with a REAL role assignment; revoke → next request
denied; suspend role/membership → denied; tenant mismatch denied; **`x-permissions` rejected**; **`ContextAuthz`
absent**; `AUTHZ` backed by the persistent adapter. **Security regression:** forged x-permissions; cross-tenant
assignment; self-grant privileged role; escalation via role update; system bypass; stale-after-revoke; duplicate
concurrent grants; SoD bypass; scope bypass; mass update; malformed/unknown/deprecated permission. No skips.

## 30. ADR requirements (drafts prepared, not accepted)

- **ADR-017** — RBAC authorization model (flat roles, concrete grants, no wildcards/inheritance, assignment
  on membership+identity, allow-list + default-deny, pre-resolve-per-request).
- **ADR-018** — Authorization scope model (tenant + optional org scope; defer resource/ABAC).
- **ADR-019** — SoD enforcement (assignment-time + runtime; no explicit-deny in MVP).
- **ADR-020** — Administrator bootstrap (seeded immutable role + env-gated idempotent grant).

## 31. Implementation sequence

1. Accept ADR-017…020. 2. Registry updates (rbac.* concrete perms, RBAC_ codes, identity.authorization
family, manifest). 3. `permissions` catalogue + seed. 4. `roles` + lifecycle. 5. `role_permissions`. 6.
`role_assignments` + `platform_role_assignments` + histories. 7. Scope evaluation. 8. `sod_rules` +
assignment-time + runtime checks. 9. `PermissionResolver` + `RbacAuthz`. 10. Bind AUTHZ → RbacAuthz; **delete
ContextAuthz**. 11. **Retire x-permissions** (boundary + fixtures + conformance). 12. `/api/v1/rbac/*` APIs.
13. Bootstrap. 14. Events + audit. 15. Pure tests. 16. PG16 DB tests. 17. API + integration tests. 18.
Conformance updates (1D tables now exist; x-permissions gone; AUTHZ persistent). 19. Completion report +
manifest. 20. PR + PG16 CI certification.

## 32. Commit plan

Small Conventional Commits mirroring §31 (docs(architecture) accept ADRs · chore(registry) · feat(rbac)
catalogue/roles/assignments/sod · feat(rbac) resolver+adapter · refactor(authz) delete ContextAuthz +
x-permissions · feat(api) rbac admin · feat(rbac) bootstrap · test(rbac) · docs(rbac) completion). Register
each cross-cutting artifact in the same commit as first use.

## 33. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Authorization fails **open** | **Critical** | Default-deny; INDETERMINATE→DENY; fail-closed on resolver error; tests assert |
| R2 | Cross-tenant assignment leakage | **High** | Assignments tenant-RLS-scoped, no escape; resolver reads in tenant context |
| R3 | Self/role escalation | **High** | grant/edit gated + SoD; immutable system roles; write-time checks |
| R4 | Stale permissions after revoke | **High** | No cache in MVP; per-request DB resolution |
| R5 | Bootstrap abuse / bypass secret | **High** | Env-gated, idempotent, no secret, prod fail-closed, audited (ADR-020) |
| R6 | Retiring x-permissions breaks every request | **High** | RbacAuthz keeps the exact port contract; per-request pre-resolve; real-assignment fixtures |
| R7 | Scope creep into ABAC/inheritance | Medium | Explicit exclusions + ADR boundaries |
| R8 | `ContextAuthz` lingering | Medium | Deleted in the same commit as the RbacAuthz bind; conformance asserts |
| R9 | PAT unrevoked / repo public | Medium | Standing governance |

## 34. Open decisions

1. **Org-scope depth in MVP** — ship branch/department scope now, or tenant-only first and org-scope in a
   follow-up? (Recommend: schema supports `assignment_scope`, evaluate only where a resource carries scope.)
2. **Time-bound assignments in 1D** vs deferred (recommend: in — it is a column, not an engine).
3. **`rbac.*` / `RBAC_` module owner** — registries say `m02-identity`, manifest says `m02-rbac`; reconcile
   to **m02-rbac** during registration.
4. Whether `/api/v1/roles` (reserved) or `/api/v1/rbac/roles` is the canonical prefix (recommend `/rbac/*`).
5. Sequence m03 (audit spine) so RBAC decisions are persisted — RBAC audit is what an auditor demands first.

## 35. Definition of Done (for the eventual implementation)

Persistent permissions/roles/role_permissions/assignments/SoD with RLS + append-only history + no DELETE ·
`RbacAuthz` bound to AUTHZ; **`ContextAuthz` deleted**; **`x-permissions` retired** and rejected · default-
deny, fail-closed, tenant-isolated · SoD at write + runtime · time-bound assignments · bootstrap idempotent +
env-gated + audited · `/api/v1/rbac/*` APIs with permission + audit + concurrency · identity.authorization
events + RBAC_ audit registered and agreeing · Stage 1A/1B/1C tests still green; new pure/DB(PG16)/API/
integration/security tests green, no skips · conformance updated (1D tables exist, x-permissions gone) ·
build/lint/format clean on a clean checkout · docs + manifest + ADRs updated · both CI lanes green under
branch protection.

## 36. Recommendation

### CONDITIONAL GO for Stage 1D implementation

The trust boundary, permission/role/assignment/scope/SoD models, decision semantics, RLS, the `RbacAuthz`
replacement, the `ContextAuthz` + `x-permissions` retirement, the admin APIs, bootstrap, caching stance,
events/audit and the test plan are all specified and consistent with the certified baseline, and every path
fails closed. Implementation is cleared **once ADR-017…020 are accepted** (D1–D4) and the open decisions in
§34 are settled within them. No Stage 1D code may be written before that acceptance. Stage 1C stays the
authoritative authentication baseline; governance items (PAT, visibility) remain standing but do not block
Stage 1D design.
