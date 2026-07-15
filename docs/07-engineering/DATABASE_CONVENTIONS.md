# Database & Migration Conventions

The rules every schema change follows. `tools/migrate/samples/rls_convention_sample.sql` is the worked
example and `tools/migrate/test/rls-convention.db-spec.ts` proves it against a real PostgreSQL 16 —
if the two ever disagree, the spec is right.

## Tenant-scoped tables (the default)

Every table is tenant-scoped unless it is on the global list below. Each one has:

| Requirement                                                                            | Why                                                                                                                                         |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenant_id uuid NOT NULL`                                                              | ADR-001: tenant-aware from day one. No `tenant_id NULL` rows (ADR-003).                                                                     |
| `PRIMARY KEY (tenant_id, id)`                                                          | Composite and tenant-first (ADR-003).                                                                                                       |
| `UNIQUE (tenant_id, id)`                                                               | So a child table can carry a composite FK to it.                                                                                            |
| Composite FKs — `FOREIGN KEY (tenant_id, parent_id) REFERENCES parent (tenant_id, id)` | A plain FK on `parent_id` alone lets tenant A's child reference tenant B's parent. RLS would then _hide_ the orphan rather than prevent it. |
| `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY`                         | ENABLE alone exempts the table owner. FORCE is what binds the owner too (ADR-003).                                                          |
| A policy named exactly `tenant_isolation`                                              | One name everywhere, so conformance can assert coverage structurally.                                                                       |
| `status` + `removed_at` + `removed_by` for removable records                           | ADR-010: soft delete, never `deleted_at`, never a hard delete.                                                                              |

The policy, verbatim — copy it exactly:

```sql
CREATE POLICY tenant_isolation ON <table>
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
```

Three details carry the whole thing:

- **`, true` means "missing is NULL, not an error".** Without it, a query with no tenant context raises
  instead of returning nothing.
- **`NULLIF(..., '')` is not optional.** `current_setting(..., true)` returns NULL only when the GUC was
  *never* set in the session. Once it has been set even once, a transaction-local `SET` reverts at
  COMMIT to the **empty string**, not to NULL. Every production connection is pooled, so the second
  transaction to reuse a connection sees `''`, and `''::uuid` raises
  `invalid input syntax for type uuid` instead of matching zero rows. NULLIF collapses both "never set"
  and "reset to empty" to NULL. This was found by `rls-convention.db-spec.ts` against a real
  PostgreSQL — it is invisible on a fresh connection, which is exactly why the proof runs on a pool.
- **`WITH CHECK` mirrors `USING`.** Otherwise a caller could read only its own tenant but still write a
  row into someone else's.

With the tenant resolved to NULL the comparison is NULL, which is not TRUE, so the policy matches
**nothing**. Forgetting to enter tenant context yields zero rows — never all rows, and never a 500.
That is the fail-closed default (CLAUDE.md).

## Tenant context

Application code never sets `app.tenant_id` itself. It enters context through the kernel's
ambient-transaction `Db` (`packages/kernel/src/db.ts`):

- `withTenant(ctx, fn)` — opens a transaction, sets `app.tenant_id` **transaction-locally**, runs `fn`,
  commits on return / rolls back on throw. Transaction-local is what stops the GUC leaking to the next
  user of a pooled connection.
- `withSystem(ctx, fn)` — no tenant bound. For the global tables only, and `ctx.reason` is mandatory.

There is no `query()` outside a transaction and no way to keep a `Tx` past the callback. That is what
makes a state change and the outbox row recording it atomic (ADR-004).

## Roles — the sharpest edge in the model

| Role | RLS applies? | Used for |
|---|---|---|
| **superuser** | **No — bypasses RLS entirely.** FORCE does not constrain it. | Nothing in the application. Cluster administration only. |
| **owner** (`finapp_owner`) | Only because of **FORCE**. Under ENABLE alone it would be exempt. | Owns tables; runs migrations. Non-superuser. |
| **app** (`finapp_app`) | Yes — neither superuser nor owner. | What the API connects as. |

Both roles are **NOBYPASSRLS**. A role with `BYPASSRLS` ignores every `tenant_isolation` policy, so
isolation "verified" through one is not verified at all.

The same trap applies to testing: proving isolation as a **superuser or owner proves almost nothing**,
because both pass even on a table whose FORCE was dropped. `rls-convention.db-spec.ts` proves isolation
through the app role, and separately asserts the superuser bypass so the exposure is recorded rather
than discovered later.

## The global tables

The complete list (ADR-001). **Adding to it needs an ADR.**

- The tenancy control plane (m01)
- The audit spine (m03)
- Pre-authentication login attempts (m02)
- Global reference registries (e.g. m06 entity types)
- `schema_migrations` — infrastructure, not business data; not part of the enumerated list and needs no
  policy

## Migrations

Live at `packages/<module>/migrations/NNNN_name.sql` — four-digit sequence, `snake_case`, `.sql`.

- **Order** is `tools/migrate/src/module-order.ts` (modules, in dependency order) then sequence within a
  module. Never reorder to fix a failure: a migration needing an earlier module's table means the
  dependency is wrong, not the order.
- **Applied migrations are immutable.** The runner checksums each file; editing a shipped migration is a
  hard failure. Add a new one. (Line endings are normalised, so a Windows checkout is not tampering.)
- **Idempotent** — applied migrations are skipped, so a retry after a partial failure is safe.
- **Atomic** — the DDL and its `schema_migrations` row commit together. The ledger cannot claim a
  migration that did not apply.
- **Serialised** — a session advisory lock means two deployers racing produce one applier and one
  waiter.
- **Duplicate sequence numbers are an error**, not a tie broken by filename. Two branches both adding
  `0007_*` must resolve it deliberately.

```bash
npm run migrate -- --dry-run   # print the ordered plan and checksums; no connection
npm run migrate                # apply. Fails loudly if DATABASE_URL is unset — it never guesses.
```

## Money

Integer minor units or exact `numeric`. **Never** `float`/`double precision`/`real` for money — not for
an amount, not for a rate, not for a rounding intermediate. Journals balance (debits == credits) before
posting (ADR-007).

## Time

`timestamptz`, stored UTC, rendered in the tenant's timezone. SLAs and escalations respect business
calendars.
