# m06-workflow — Enterprise workflow engine (status / workflow / SLA / timeline / outbox)

**Stage 2.2.** The generic, tenant-configurable workflow orchestration spine. A workflow is **data** — a
published, immutable, versioned definition — never hard-coded business logic. m06 provides orchestration,
task routing, per-entity state machines, SLA tracking, escalation, auditable transitions, and **the single
transactional outbox** every module publishes through (ADR-004/023).

See `docs/build/stages/STAGE_2_2_M06_WORKFLOW_ARCHITECTURE.md` (+ READINESS, IMPLEMENTATION_PLAN) and
ADR-021…ADR-026.

## Reuses (never duplicates)

- `DB` — `db.withTenant(ctx, tx => …)` / `withSystem`; all work in tenant context under RLS.
- `AUTHZ` — `authz.require(ctx, 'workflow.x.y')`, default deny, permissions resolved server-side.
- `AUDIT` — `audit.write(tx, ctx, entry)` in the SAME transaction as the mutation (m03 spine).
- `OUTBOX` — **m06 owns it**: the one `Outbox<DomainEvent>` implementation + the one outbox table.
- m02-rbac scope + `SodService` for role/permission incompatibility; m01 org nodes for scoping.

## Must not

Make autonomous approvals; bypass RBAC/human approval; post journals; disburse funds; send notifications
(m08); store documents (m09); duplicate the audit service (m03); add a second outbox; or hard-code
Feedback/Legal/Finance workflows into the engine.

## Layout

- `src/domain/` — PURE: node types, lifecycle state machines, token accounting, the safe condition
  expression interpreter, the definition validator. No I/O; exhaustively unit-tested.
- `src/repository.ts` — all SQL (parameterized; version-guarded).
- `src/*.service.ts` — definition / instance / task / sla / incident services (tenant-tx + audit + outbox).
- `src/outbox.ts` — `WorkflowOutbox` (the durable `OUTBOX` binding).
- `migrations/` — `0001_workflow.sql` (tables, RLS FORCE, constraints) + `0002_grant_application_role.sql`.
- `test/` — PURE smoke + DB integration spec (`DATABASE_APP_ROLE=finapp_app`).
