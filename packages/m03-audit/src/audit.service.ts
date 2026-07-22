import { randomUUID } from 'node:crypto';
import {
  isRequestContext,
  type Audit,
  type AuditEntry,
  type Db,
  type RequestContext,
  type SystemContext,
  type Tx,
} from '@finapp/kernel';
import { AuditRepository, type AuditEventRow, type InsertAuditInput } from './repository.ts';
import { redact } from './redaction.ts';
import {
  hashEvent,
  verifyChain,
  INTEGRITY_VERSION,
  type HashableEvent,
  type ChainVerification,
} from './integrity.ts';
import { categoryForCode, moduleForCode, type Category, type Outcome } from './domain/types.ts';

/**
 * THE persistent audit service (m03) — the single authoritative implementation of the kernel `AUDIT` port,
 * replacing the in-memory stand-in. It:
 *
 *   - keeps the UNCHANGED `Audit.write(tx, ctx, entry)` contract, so every existing call site records into
 *     the durable spine inside its own transaction (audit and business change commit together);
 *   - derives the actor, tenant, module and correlation from the TRUSTED context — never a client claim;
 *   - redacts the detail, generates all timestamps server-side, and hash-chains the row to the previous
 *     event in its scope;
 *   - adds independent-transaction recording for FAILED and DENIED actions, so a security event survives a
 *     rolled-back business transaction (it must never disappear silently).
 */
export class AuditService implements Audit {
  private readonly db: Db;
  private readonly repo: AuditRepository;

  constructor(db: Db, repo: AuditRepository = new AuditRepository()) {
    this.db = db;
    this.repo = repo;
  }

  /**
   * Records a SUCCESSFUL controlled action inside the caller's transaction. If this insert fails, the
   * caller's transaction fails with it — which is the contract: a controlled action whose audit could not
   * be written must not be treated as done.
   */
  async write(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.append(tx, ctx, {
      code: entry.code,
      outcome: 'success',
      resourceType: entry.entityType,
      resourceId: entry.entityId,
      reasonCode: entry.reason ?? null,
      after: entry.detail ?? null,
    });
  }

  /**
   * Records a SUCCESSFUL controlled action in its OWN transaction (not tied to a business change) — e.g. an
   * audit export or an integrity verification, where the act itself is the thing being recorded.
   */
  async recordSuccess(
    ctx: RequestContext | SystemContext,
    input: {
      code: string;
      resourceType: string;
      resourceId: string;
      category?: Category;
      reason?: string;
      detail?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.independent(ctx, {
      code: input.code,
      outcome: 'success',
      ...(input.category === undefined ? {} : { category: input.category }),
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      reasonCode: input.reason ?? null,
      after: input.detail ?? null,
    });
  }

  /**
   * Records a FAILED or ERRORED controlled action in its OWN transaction, so the evidence commits even
   * though the business transaction rolled back. Never let a persistence failure here be swallowed: it is
   * re-thrown after a best-effort marker, because a lost security event is the failure we most fear.
   */
  async recordFailure(
    ctx: RequestContext | SystemContext,
    input: {
      code: string;
      resourceType: string;
      resourceId: string;
      outcome?: 'failure' | 'error';
      reason?: string;
      detail?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.independent(ctx, {
      code: input.code,
      outcome: input.outcome ?? 'failure',
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      reasonCode: input.reason ?? null,
      after: input.detail ?? null,
    });
  }

  /**
   * Records an authorization DECISION — a denial or an indeterminate result — in its own transaction.
   * Security-significant denials are always recorded (never sampled away). The permission and reason are
   * captured; the resource is named but nothing about its contents.
   */
  async recordAuthorizationDecision(
    ctx: RequestContext | SystemContext,
    input: {
      code: string;
      permission: string;
      resourceType: string;
      resourceId: string;
      outcome?: 'denied' | 'indeterminate';
      reason?: string;
    },
  ): Promise<void> {
    await this.independent(ctx, {
      code: input.code,
      outcome: input.outcome ?? 'denied',
      category: 'authorization',
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      reasonCode: input.reason ?? null,
      after: { permission: input.permission },
    });
  }

  // --- internals ----------------------------------------------------------------------------------

  private async independent(ctx: RequestContext | SystemContext, params: AppendParams): Promise<void> {
    // A separate transaction, in the same scope as the (possibly rolled-back) action. A tenant action logs
    // in tenant context; a platform action under the system escape.
    if (isRequestContext(ctx)) {
      await this.db.withTenant(ctx, (tx) => this.append(tx, ctx, params));
    } else {
      await this.db.withSystem(ctx, (tx) => this.append(tx, ctx, params));
    }
  }

  private async append(tx: Tx, ctx: RequestContext | SystemContext, params: AppendParams): Promise<void> {
    // Scope is taken from the ACTUAL transaction session, not the passed ctx: the audit row commits in this
    // transaction, so its tenant scope must match what RLS will check. A service may legitimately write a
    // system-actor event inside a tenant transaction (e.g. an SoD conflict during a tenant grant) — that is
    // a TENANT-scoped event with a system actor, and reading the session is what gets that right.
    const scope = await this.sessionScope(tx);
    const actor = { ...scope, ...actorIdentity(ctx) };
    const meta = ctx as Partial<RequestMeta>;
    const occurredAt = new Date(); // server-generated, always

    const before = redact(params.before ?? null);
    const after = redact(params.after ?? null);
    const redactionFlags = mergeFlags(before, after);
    const metadata = redactionFlags === null ? null : { redaction: redactionFlags };

    const module = moduleForCode(params.code);
    const category: Category = params.category ?? categoryForCode(params.code);

    const link = await this.repo.nextChainLink(tx, actor.scopeKey);
    const id = randomUUID();

    const hashable: HashableEvent = {
      id,
      scopeKey: actor.scopeKey,
      seq: link.seq,
      tenantId: actor.tenantId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      module,
      action: params.code,
      category,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      outcome: params.outcome,
      correlationId: ctx.correlationId,
      causationId: meta.causationId ?? null,
      occurredAt: occurredAt.toISOString(),
      detail: hashDetail(
        params.reasonCode,
        before.value,
        after.value,
        params.changedFields ?? null,
        metadata,
      ),
    };
    const eventHash = hashEvent(link.previousHash, hashable);

    const row: InsertAuditInput = {
      id,
      tenantId: actor.tenantId,
      scopeKey: actor.scopeKey,
      seq: link.seq,
      actorType: actor.actorType,
      actorId: actor.actorId,
      actorAccountId: meta.actorAccountId ?? null,
      actorRoleSnapshot: null,
      impersonatorId: meta.impersonatorId ?? null,
      module,
      action: params.code,
      category,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      outcome: params.outcome,
      reasonCode: params.reasonCode,
      summary: params.summary ?? params.code,
      beforeSnapshot: before.value,
      afterSnapshot: after.value,
      changedFields: params.changedFields ?? null,
      metadata,
      requestId: meta.requestId ?? null,
      correlationId: ctx.correlationId,
      causationId: meta.causationId ?? null,
      sessionId: meta.sessionId ?? null,
      authenticationMethod: meta.authenticationMethod ?? null,
      sourceSystem: meta.sourceSystem ?? null,
      sourceIp: meta.sourceIp ?? null,
      userAgent: meta.userAgent ?? null,
      occurredAt,
      integrityVersion: INTEGRITY_VERSION,
      previousHash: link.previousHash,
      eventHash,
    };
    await this.repo.insertEvent(tx, row);
  }

  /** Reads the transaction's real scope from its GUCs — the authoritative tenant/platform binding RLS uses. */
  private async sessionScope(tx: Tx): Promise<{ scopeKey: string; tenantId: string | null }> {
    const r = await tx.query<{ tenant_id: string | null }>(
      `SELECT NULLIF(current_setting('app.tenant_id', true), '') AS tenant_id`,
    );
    const tenantId = r.rows[0]?.tenant_id ?? null;
    return tenantId === null ? { scopeKey: 'PLATFORM', tenantId: null } : { scopeKey: tenantId, tenantId };
  }

  /** Recomputes a stored row's hashable projection identically to how `append` built it. */
  static hashableOf(row: AuditEventRow): HashableEvent & { previousHash: string; eventHash: string } {
    return {
      id: row.id,
      scopeKey: row.scope_key,
      seq: Number(row.seq),
      tenantId: row.tenant_id,
      actorType: row.actor_type,
      actorId: row.actor_id,
      module: row.module,
      action: row.action,
      category: row.category,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      outcome: row.outcome,
      correlationId: row.correlation_id,
      causationId: row.causation_id,
      occurredAt: row.occurred_at.toISOString(),
      detail: hashDetail(
        row.reason_code,
        row.before_snapshot,
        row.after_snapshot,
        row.changed_fields,
        row.metadata,
      ),
      previousHash: row.previous_event_hash,
      eventHash: row.event_hash,
    };
  }
}

interface AppendParams {
  code: string;
  outcome: Outcome;
  category?: Category;
  resourceType: string;
  resourceId: string;
  reasonCode: string | null;
  summary?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  changedFields?: string[] | null;
}

/** Optional request metadata a future boundary may attach to the context; read structurally, all optional. */
interface RequestMeta {
  actorAccountId: string | null;
  impersonatorId: string | null;
  requestId: string | null;
  causationId: string | null;
  sessionId: string | null;
  authenticationMethod: string | null;
  sourceSystem: string | null;
  sourceIp: string | null;
  userAgent: string | null;
}

/** The acting principal, from the TRUSTED context. Scope (tenant/platform) is read from the session, not here. */
function actorIdentity(ctx: RequestContext | SystemContext): { actorType: string; actorId: string | null } {
  if (isRequestContext(ctx)) return { actorType: 'user', actorId: ctx.userId ?? null };
  return { actorType: 'system_process', actorId: null };
}

/** The composite detail projection covered by the hash — identical at write and at verification. */
function hashDetail(
  reasonCode: string | null,
  before: unknown,
  after: unknown,
  changedFields: string[] | null,
  metadata: unknown,
): unknown {
  return { reasonCode, before, after, changedFields, metadata };
}

function mergeFlags(
  a: { redactedKeys: readonly string[]; truncated: boolean; oversized: boolean; binaryRejected: boolean },
  b: { redactedKeys: readonly string[]; truncated: boolean; oversized: boolean; binaryRejected: boolean },
): Record<string, unknown> | null {
  const redactedKeys = [...a.redactedKeys, ...b.redactedKeys];
  const truncated = a.truncated || b.truncated;
  const oversized = a.oversized || b.oversized;
  const binaryRejected = a.binaryRejected || b.binaryRejected;
  if (redactedKeys.length === 0 && !truncated && !oversized && !binaryRejected) return null;
  return { redactedKeys, truncated, oversized, binaryRejected };
}

export type { ChainVerification };
export { verifyChain };
