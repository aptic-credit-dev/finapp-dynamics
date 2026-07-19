import type { Tx } from '@finapp/kernel';

/**
 * Persistence for m03-audit. All reads/writes run inside a caller-supplied transaction whose context (a
 * tenant, or the system escape) the SERVICE chooses so RLS admits exactly the right rows.
 *
 * The chain is appended under a per-scope advisory transaction lock: two concurrent writers to the same
 * scope (a tenant, or PLATFORM) serialise, so `seq` is gap-free and each event's `previous_event_hash`
 * genuinely names the row before it. The lock is held to end-of-transaction, which is the point — the audit
 * row commits with the business change it describes.
 */

export interface AuditEventRow {
  readonly id: string;
  readonly tenant_id: string | null;
  readonly scope_key: string;
  readonly seq: string; // bigint arrives as string from pg
  readonly actor_type: string;
  readonly actor_id: string | null;
  readonly actor_account_id: string | null;
  readonly impersonator_id: string | null;
  readonly module: string;
  readonly action: string;
  readonly category: string;
  readonly resource_type: string | null;
  readonly resource_id: string | null;
  readonly outcome: string;
  readonly reason_code: string | null;
  readonly summary: string | null;
  readonly before_snapshot: Record<string, unknown> | null;
  readonly after_snapshot: Record<string, unknown> | null;
  readonly changed_fields: string[] | null;
  readonly metadata: Record<string, unknown> | null;
  readonly request_id: string | null;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly session_id: string | null;
  readonly source_system: string | null;
  readonly occurred_at: Date;
  readonly recorded_at: Date;
  readonly integrity_version: number;
  readonly previous_event_hash: string;
  readonly event_hash: string;
}

export interface ChainLink {
  readonly seq: number;
  readonly previousHash: string;
}

const GENESIS_HASH = '0'.repeat(64);

export interface InsertAuditInput {
  id: string;
  tenantId: string | null;
  scopeKey: string;
  seq: number;
  actorType: string;
  actorId: string | null;
  actorAccountId: string | null;
  actorRoleSnapshot: Record<string, unknown> | null;
  impersonatorId: string | null;
  module: string;
  action: string;
  category: string;
  resourceType: string | null;
  resourceId: string | null;
  outcome: string;
  reasonCode: string | null;
  summary: string | null;
  beforeSnapshot: Record<string, unknown> | null;
  afterSnapshot: Record<string, unknown> | null;
  changedFields: string[] | null;
  metadata: Record<string, unknown> | null;
  requestId: string | null;
  correlationId: string;
  causationId: string | null;
  sessionId: string | null;
  authenticationMethod: string | null;
  sourceSystem: string | null;
  sourceIp: string | null;
  userAgent: string | null;
  occurredAt: Date;
  integrityVersion: number;
  previousHash: string;
  eventHash: string;
}

export interface AuditQueryFilter {
  tenantId?: string | null;
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  action?: string;
  module?: string;
  category?: string;
  outcome?: string;
  correlationId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
  platform?: boolean; // true → query PLATFORM-scoped events (system context)
}

export class AuditRepository {
  /**
   * Acquires the per-scope append lock and returns the next chain link. Under the lock, the max-seq read is
   * the true tail, so the returned `seq`/`previousHash` cannot be raced by a concurrent appender.
   */
  async nextChainLink(tx: Tx, scopeKey: string): Promise<ChainLink> {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [scopeKey]);
    const r = await tx.query<{ seq: string; event_hash: string }>(
      `SELECT seq, event_hash FROM audit_events WHERE scope_key = $1 ORDER BY seq DESC LIMIT 1`,
      [scopeKey],
    );
    const tail = r.rows[0];
    if (tail === undefined) return { seq: 1, previousHash: GENESIS_HASH };
    return { seq: Number(tail.seq) + 1, previousHash: tail.event_hash };
  }

  async insertEvent(tx: Tx, input: InsertAuditInput): Promise<void> {
    await tx.query(
      `INSERT INTO audit_events (
         id, tenant_id, scope_key, seq, actor_type, actor_id, actor_account_id, actor_role_snapshot,
         impersonator_id, module, action, category, resource_type, resource_id, outcome, reason_code,
         summary, before_snapshot, after_snapshot, changed_fields, metadata, request_id, correlation_id,
         causation_id, session_id, authentication_method, source_system, source_ip, user_agent,
         occurred_at, integrity_version, previous_event_hash, event_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,
               $20,$21::jsonb,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)`,
      [
        input.id, input.tenantId, input.scopeKey, input.seq, input.actorType, input.actorId,
        input.actorAccountId, jsonOrNull(input.actorRoleSnapshot), input.impersonatorId, input.module,
        input.action, input.category, input.resourceType, input.resourceId, input.outcome, input.reasonCode,
        input.summary, jsonOrNull(input.beforeSnapshot), jsonOrNull(input.afterSnapshot), input.changedFields,
        jsonOrNull(input.metadata), input.requestId, input.correlationId, input.causationId, input.sessionId,
        input.authenticationMethod, input.sourceSystem, input.sourceIp, input.userAgent, input.occurredAt,
        input.integrityVersion, input.previousHash, input.eventHash,
      ],
    );
  }

  async findById(tx: Tx, id: string): Promise<AuditEventRow | null> {
    const r = await tx.query<AuditEventRow>(`SELECT * FROM audit_events WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }

  async search(tx: Tx, f: AuditQueryFilter): Promise<AuditEventRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown): void => {
      params.push(value);
      where.push(clause.replace('?', `$${params.length}`));
    };
    // Platform queries read PLATFORM events; tenant queries are already RLS-bounded to the caller's tenant.
    if (f.platform === true) where.push(`scope_key = 'PLATFORM'`);
    if (f.actorId !== undefined) add('actor_id = ?', f.actorId);
    if (f.resourceType !== undefined) add('resource_type = ?', f.resourceType);
    if (f.resourceId !== undefined) add('resource_id = ?', f.resourceId);
    if (f.action !== undefined) add('action = ?', f.action);
    if (f.module !== undefined) add('module = ?', f.module);
    if (f.category !== undefined) add('category = ?', f.category);
    if (f.outcome !== undefined) add('outcome = ?', f.outcome);
    if (f.correlationId !== undefined) add('correlation_id = ?', f.correlationId);
    if (f.from !== undefined) add('occurred_at >= ?', f.from);
    if (f.to !== undefined) add('occurred_at <= ?', f.to);
    params.push(f.limit);
    const limitParam = `$${params.length}`;
    params.push(f.offset);
    const offsetParam = `$${params.length}`;
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const r = await tx.query<AuditEventRow>(
      `SELECT * FROM audit_events ${clause} ORDER BY occurred_at DESC, seq DESC LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params,
    );
    return r.rows;
  }

  /** The full chain for a scope in seq order — for integrity verification. */
  async scopeChain(
    tx: Tx,
    scopeKey: string,
  ): Promise<AuditEventRow[]> {
    const r = await tx.query<AuditEventRow>(
      `SELECT * FROM audit_events WHERE scope_key = $1 ORDER BY seq ASC`,
      [scopeKey],
    );
    return r.rows;
  }
}

function jsonOrNull(v: Record<string, unknown> | null): string | null {
  return v === null ? null : JSON.stringify(v);
}
