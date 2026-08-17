# Stage 7 — Tier-1 Synthetic Migration Rehearsal Evidence

> **`TIER-1 SYNTHETIC MIGRATION REHEARSAL — NOT REAL-DATA MIGRATION / NOT CFO OR LEGAL SIGN-OFF.`**
> Under ADR-131 (ACCEPTED). Tier-1 automated execution against **synthetic/reference fixtures only**. It does NOT
> satisfy an approved real source inventory, a real production-tenant migration, or CFO/Legal/business sign-off
> (OQ#14). `real_data_migration_execution` remains `requires_review`; production readiness remains `CONDITIONAL_GO`.

## Safety model

The framework writes **only** to a dedicated sandbox schema **`stage7_migration`** (landing tables
`mig_tenant` / `mig_identity` / `mig_ledger`) — it **never** touches a governed/certified table, so rollback is
inherently safe. Every row is tagged with a `migration_run_id`; rollback is **run-scoped and tenant-safe**. Refuses
`NODE_ENV=production`; identifiers come from the fixed MAPPING (no injection/eval); values parameterized; money is
integer **minor units** (`bigint`, no float).

## Source inventory & mapping (synthetic)

- Source inventory `SYN-SRC-1` — `authoritative=false`, `pii_classification=synthetic_non_personal`. **The real
  first-tenant migration sources remain `TBD` (OQ#14).** Integration connectors (Imarisha etc.) are NOT reclassified
  as migration sources.
- Mapping **v1.0.0**, checksum `ce464757af14bf87…` (deterministic; tamper-detected in self-test). Transforms are a
  fixed allowlist (trim/lower); validators: `ident_like`/`email`/`integer`/`currency`.

## Rehearsal (11-step procedure) — executed against a real PostgreSQL

`critical_failures=0`, exit 0, and **repeatable** (a second full run also passed):

| Step | Result |
| --- | --- |
| source validation + inventory | PASS — 1 synthetic source; real TBD |
| mapping validation + checksum | PASS — 0 errors; `ce464757af14bf87` |
| dry-run | PASS — accepted `{tenant:2, identity:2, ledger:3}`, rejected 2, duplicate 1 |
| rehearsal insert | PASS — inserted `{tenant:2, identity:2, ledger:3}` |
| exception register | PASS — `I4` invalid email, `L4` non-integer money; 1 duplicate (`I2`) |
| destination counts | PASS — `{tenant:2, identity:2, ledger:3}` |
| control-total reconciliation | PASS — dest ledger A=152599, B=999999 (**match**) |
| money exactness | PASS — integer minor units (bigint); A=152599, B=999999 |
| idempotent rerun | PASS — re-inserted `{0,0,0}` |
| rollback | PASS — deleted `{tenant:2, identity:2, ledger:3}` |
| post-rollback reconciliation | PASS — `{0,0,0}` |
| reapply (repeatability) | PASS — re-applied `{2,2,3}` |

## Control totals

| Category | Value |
| --- | --- |
| source records | tenants 2, identities 4, ledger 4 |
| accepted | tenant 2, identity 2, ledger 3 |
| rejected (exceptions) | 2 (`I4` invalid email; `L4` non-integer money) |
| duplicates | 1 (`I2` same tenant+email_norm) |
| destination (this run) | tenant 2, identity 2, ledger 3 |
| ledger minor-unit totals | `stg_mig_a`=152599, `stg_mig_b`=999999 (**bigint, exact, no float**) |

## Rollback & isolation (self-test — DB-backed)

- `rollback_scoped_to_run`: rolling back run A left run B intact (`A={0,0,0}`, `B={2,2,3}`) — **rollback cannot cross
  migration-run or tenant boundaries**.
- `rollback_idempotent`: a second rollback of the same run deleted `{0,0,0}`.
- `mismatch_detected`: reconciling against a tampered source correctly returned `match=false` (the rehearsal fails
  non-zero on an unexplained control-total mismatch).

## Self-test

`migration-selftest.mjs`: 11 pure checks (production refusal, mapping checksum + tamper, invalid-mapping rejection,
transform determinism, duplicate handling, exception capture, money exactness) + 3 DB-backed checks (rollback
scoping, rollback idempotency, mismatch failure) — **all PASS**.

## Evidence metadata

- Assessed commit `26e75d8` (merged main; branch adds only `deploy/staging/migration-*` + this evidence).
- Environment: local **PostgreSQL 15.2** (`finapp_mig`), sandbox schema `stage7_migration`.
- No raw credentials/customer data committed; recorded as an **opaque reference** for M42 — never real-data
  migration or a sign-off.

## Known limitations (honest)

- **Synthetic/reference fixtures only** — the real first-tenant sources are **TBD (OQ#14)** and were not invented.
- Ran against **local PG 15.2**, not the Docker PG16 staging stack (Docker daemon down).
- The rehearsal writes to a **sandbox schema**, not the governed application tables — it proves the migration
  procedure (validate/dry-run/rehearse/reconcile/idempotency/rollback), not a production cutover.

## Remaining Tier-2 gates (unchanged)
Approved real source inventory (OQ#14) · real production-tenant migration · **CFO sign-off** · **Legal sign-off** ·
business-owner acceptance · governed production GO (M42).
