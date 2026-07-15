# m01-tenant — Tenancy Control Plane

**Status: implemented (Stage 1A).** The tenant registry, lifecycle, environments and organisational
scope. Every later module depends on the tenant context this module resolves.

|                      |                                           |
| -------------------- | ----------------------------------------- |
| Module code          | `m01-tenant`                              |
| Build stage          | 1 (docs/07-engineering/BUILD_SEQUENCE.md) |
| API prefix           | `/api/v1/tenants`                         |
| Permission namespace | `tenant.*`                                |
| Event family         | `tenant.lifecycle`                        |
| Audit prefix         | `TENANT_`                                 |

## What it owns

| Table                   | Scope                                    | Why                                                                                                                                                            |
| ----------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenant_type_catalogue` | **Global reference registry**, no RLS    | Reference data, identical for every tenant (ADR-001 enumerated exception). `tenants.tenant_type` is a FK to it, so the type list cannot drift from the code.     |
| `tenants`               | **Global control plane**, RLS FORCE + system escape | See ADR-014.                                                                                                                                        |
| `tenant_status_history` | Tenant-scoped, RLS FORCE, **append-only** | Lifecycle evidence. INSERT+SELECT only — the app role holds no UPDATE/DELETE privilege at all.                                                                 |
| `tenant_environments`   | Tenant-scoped, RLS FORCE                 | production / sandbox / uat / training / demonstration. At most one default per tenant (partial unique index).                                                   |
| `tenant_entities`       | Tenant-scoped, RLS FORCE                 | Subsidiaries / legal entities. Self-nesting via composite FK.                                                                                                   |
| `tenant_departments`    | Tenant-scoped, RLS FORCE                 | Belong to an entity; self-nesting.                                                                                                                             |
| `tenant_branches`       | Tenant-scoped, RLS FORCE                 | Belong to an entity; do not nest.                                                                                                                              |

## The lifecycle

```text
draft ──submit_review──> under_review ──approve──> approved ──activate──> active
                              │                        │                    │
                           reject                start_provisioning     restrict ──> restricted
                              ▼                        ▼                    │             │
                          rejected               provisioning           suspend ──> suspended
                                                  │        │                              │
                                complete_provisioning   fail_provisioning            reactivate
                                                  │        ▼                              │
                                              approved   provisioning_failed ──(retry)────┘

  any non-terminal state ──close (reason required)──────────────────────────────> closed
```

Rules the state machine enforces (`src/domain/tenant-status.ts` — pure, no I/O, smoke-tested):

- **Every adverse or terminal outcome requires a reason** — reject, restrict, suspend, close,
  fail_provisioning. A whitespace-only reason is not a reason.
- **`closed` is terminal. There is no reopen.** Resurrecting a closed tenant would silently reattach its
  users, audit trail and journals to a new commercial relationship that never consented to them.
- **Provisioning is retryable** from `provisioning_failed` without re-approval — the approval decision
  has not changed, only the machinery failed.
- **`restricted` is read-only, not blocked.** Restriction is a commercial or compliance measure; cutting
  off a tenant's ability to read its own records would turn a billing dispute into a data-availability
  incident.

## Tenant context — the rule

**A tenant id supplied by the client is a CLAIM, never a fact.** `TenantContextResolver` verifies it
(exists, and status permits the operation) before it becomes a `RequestContext`. Nothing else in the
platform may construct tenant context from a header.

Context reaches the database only through the kernel's ambient-transaction `Db`:

- `withTenant(ctx, fn)` sets `app.tenant_id` **transaction-locally** — so a pooled connection cannot
  carry one request's tenant into the next request that borrows it.
- `withSystem(ctx, fn)` binds no tenant and requires a stated reason.

**Lifecycle writes always bind the TARGET tenant's context**, even for a platform administrator arriving
in system context. That is not cosmetic: `tenant_status_history` has no system escape, so a transition
performed under `withSystem` updates `tenants` (which does have the escape) and then fails to write its
own history — a half-completed transition reported as a 500. Authorization has already happened against
the real caller, so narrowing the database context grants nothing.

## Consumed shared services

Through kernel tokens only — `DB`, `AUTHZ`, `AUDIT`, `OUTBOX`. M01 implements none of them.

⚠️ **Stage 1A stand-ins** (`src/adapters.ts`) bind `AUTHZ`/`AUDIT`/`OUTBOX` because m02/m03/m06 do not
exist yet. **Delete them when their owning module lands** — leaving one bound would be the duplicate
shared service CLAUDE.md calls the most common failure mode. Until then, honestly:

- Audit entries are **not** persisted to the append-only spine, and there is no tamper-evident chain.
- Events are **not** durably queued; nothing drains them. No second outbox table exists (ADR-004).
- Authorization reads permissions carried on the context. There is no role model and no SoD.
- **There is no authentication.** The API reads the actor and permissions from request headers, so
  anyone who can reach it can claim anything. M01 is not shippable on its own.

## Running it

```bash
npm run migrate      # applies packages/m01-tenant/migrations in dependency order
npm run test:smoke   # PURE suite — no database needed
npm run test:db      # DB integration spec — proves isolation (needs DATABASE_URL)
```

The API requires `DATABASE_URL` at boot and **must connect as a non-owner, NOBYPASSRLS role**
(`DATABASE_APP_ROLE`). A superuser bypasses RLS entirely, and a table owner is exempt unless FORCE is
set — connect as either and every isolation guarantee in this module silently evaporates.

## Before changing this module

- Read `docs/07-engineering/DATABASE_CONVENTIONS.md`. The `NULLIF(..., '')` in every `tenant_isolation`
  policy is not optional.
- Permissions are `tenant.<entity>.<action>`; audit codes are `TENANT_<ENTITY>_<ACTION>`. Three segments
  each. The obvious `tenant.view` is rejected by the kernel's `@Endpoint` validator, and
  `TENANT_CREATED` does not satisfy the audit registry's own `<PREFIX>_<ENTITY>_<ACTION>` format. See
  `src/permissions.ts` and `src/audit-codes.ts`.
- Adding a lifecycle action means adding it to `TENANT_ACTION_MAP` **and** `TENANT_ACTION_PERMISSIONS`.
  Both are total over `TenantAction`, so the compiler stops you if you forget one.
- New audit codes must be registered in `manifests/audit-code-registry.yaml` — the M01 smoke suite fails
  if the module uses an unregistered code (ADR-005).
