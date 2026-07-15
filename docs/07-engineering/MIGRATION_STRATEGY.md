# Migration Strategy

## Process (rehearse before executing)
Inventory → source profiling → cleansing → mapping → classification → tenant mapping → reference mapping → dry run
→ validation → reconciliation → defect resolution → cutover rehearsal → rollback rehearsal → production migration
→ post-migration validation.

## Validation (§40)
Compare source vs migrated: record counts, financial totals, opening/closing balances, journal totals, document
counts, user counts, role assignments, tenant ownership, status histories, date integrity, currency, external
references, audit continuity, event references, version references, classification, privilege, retention, hashes.
Any mismatch fails validation; a migration cannot complete without passing it.

## Sign-offs
Finance migration requires Finance sign-off; Legal migration requires Legal sign-off — both after validation.

## Cutover & rollback
Cutover completes only when every required checkpoint passes; each checkpoint records evidence + a go/no-go point.
Rollback is certified only with test evidence and a defined maximum window; rollback preserves audit, idempotency,
event consistency, financial integrity, legal records, and tenant boundaries.

## Idempotency
Migration runs are idempotent (keyed) and safe to retry after a partial failure without duplicating records. All
of the above is modelled and gated in the certification module (m42); the **execution** against real source
systems is a CONDITIONAL-GO condition.
