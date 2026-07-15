import {
  ProblemError,
  isRequestContext,
  type Audit,
  type AuditEntry,
  type Authz,
  type Outbox,
  type RequestContext,
  type SystemContext,
  type Tx,
} from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';

/**
 * ============================================================================================
 * STAGE 1A STAND-IN ADAPTERS — TEMPORARY. REPLACE WITH THE OWNING MODULES.
 * ============================================================================================
 *
 * M01 is the first module, so the shared services it depends on do not exist yet:
 *   AUTHZ  -> m02-identity   (not built)
 *   AUDIT  -> m03-audit      (not built)
 *   OUTBOX -> m06-workflow   (not built)
 *
 * These bind the kernel's contracts so M01 is testable and runnable now. They are NOT implementations
 * of those shared services and must be deleted when the owning module lands — leaving one in place would
 * be exactly the "duplicate shared platform service" CLAUDE.md calls the most common failure mode.
 *
 * What is honestly missing until then:
 *   - Audit entries are NOT persisted to the append-only spine. There is no tamper-evident chain.
 *   - Events are NOT durably queued. Nothing drains them; a consumer would never see them.
 *   - Authorization reads permissions already on the context. There is no role model, no SoD.
 *
 * They are deliberately strict rather than permissive: each fails closed, so wiring the real service in
 * later tightens nothing and cannot surprise us with behaviour that only worked because the stand-in was
 * lenient.
 */

/**
 * Checks permissions carried on the context.
 *
 * Deny-by-default (ADR-009). Real RBAC — roles, grants, SoD, the posture engine — arrives with m02; this
 * only answers "does the caller hold this permission", which is the same question m02 will answer, just
 * with a trustworthy source for the answer.
 *
 * WHY IT READS PERMISSIONS OFF EITHER CONTEXT. Authorization is a property of the ACTOR, not of whether
 * a tenant happens to be bound. Platform-level actions — creating a tenant, listing across tenants — run
 * in system context precisely because no tenant exists yet to be in the context of, but they are still
 * performed by a human who must hold `tenant.registry.create`. Reading permissions only from a
 * RequestContext would make those actions permanently un-authorizable.
 *
 * `withSystem` is still NOT an authorization escape: a SystemContext carrying no permissions is denied
 * like anyone else. It relaxes which ROWS the database will show (ADR-014), never which ACTIONS are
 * allowed.
 */
export class ContextAuthz implements Authz {
  // eslint-disable-next-line @typescript-eslint/require-await -- the real m02 implementation is async
  async can(ctx: RequestContext | SystemContext, permission: string): Promise<boolean> {
    if (isRequestContext(ctx)) return ctx.permissions.includes(permission);
    // A SystemContext may carry permissions for a platform-level action. Absent or malformed => denied.
    const carried = (ctx as { permissions?: unknown }).permissions;
    return Array.isArray(carried) && carried.includes(permission);
  }

  async require(ctx: RequestContext | SystemContext, permission: string): Promise<void> {
    if (!(await this.can(ctx, permission))) {
      // Names the permission but nothing about the resource: a 403 that reveals whether a record exists
      // is an enumeration oracle.
      throw ProblemError.forbidden(`Missing required permission: ${permission}.`, ctx.correlationId);
    }
  }
}

export interface RecordedAudit extends AuditEntry {
  readonly correlationId: string;
  readonly at: Date;
}

/**
 * Collects audit intent in memory.
 *
 * Takes `tx` and ignores it — which is the entire limitation. The real m03 writes to the audit spine
 * inside this transaction so the entry and the change commit together. Here, a rollback discards the
 * change and KEEPS the recorded intent, so these records are evidence of an attempt, not of a fact.
 * Do not build anything on them.
 */
export class RecordingAudit implements Audit {
  readonly entries: RecordedAudit[] = [];

  // eslint-disable-next-line @typescript-eslint/require-await -- the real m03 implementation is async
  async write(_tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    this.entries.push({ ...entry, correlationId: ctx.correlationId, at: new Date() });
  }

  drain(): RecordedAudit[] {
    return this.entries.splice(0, this.entries.length);
  }
}

/**
 * Collects published events in memory.
 *
 * NOT a bus and NOT a second outbox (ADR-004 forbids both). No table is created, nothing is delivered.
 * When m06 lands, its outbox — the only one — replaces this, and because M01 already calls `publish(tx,
 * event)` inside the transaction, that swap changes no call site.
 */
export class RecordingOutbox implements Outbox<DomainEvent> {
  readonly events: DomainEvent[] = [];

  // eslint-disable-next-line @typescript-eslint/require-await -- the real m06 implementation is async
  async publish(_tx: Tx, event: DomainEvent): Promise<void> {
    this.events.push(event);
  }

  drain(): DomainEvent[] {
    return this.events.splice(0, this.events.length);
  }
}
