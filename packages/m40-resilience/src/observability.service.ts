/**
 * ObservabilityService — OPERATIONAL resilience observability ONLY (service health / latency / dependency / backup-freshness /
 * sync-health signals). This is NOT a second m32-analytics engine (no business reporting/KPIs/semantic query) and NOT the
 * m03-audit spine (no authoritative audit trail). Signals are BOUNDED metadata: a component key, a state, an integer latency,
 * a result code and an OPAQUE evidence reference — never a raw log body, a full payload, personal data or a secret. Append-only.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M40_PERMISSIONS } from './permissions.ts';
import { M40_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { SIGNAL_KINDS, SIGNAL_STATES } from './domain.ts';
import { ResilienceRepository } from './repository.ts';
import type { M40Emitter } from './emit.ts';

export class ObservabilityService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M40Emitter;
  private readonly repo: ResilienceRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M40Emitter,
    repo: ResilienceRepository = new ResilienceRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  async defineCheck(
    ctx: RequestContext,
    input: { checkKey: string; component: string; signalKind?: string },
  ): Promise<{ id: string }> {
    await this.authz.require(ctx, M40_PERMISSIONS.backupManage);
    const kind = input.signalKind ?? 'health';
    if (!(SIGNAL_KINDS as readonly string[]).includes(kind))
      throw badRequest('unknown signal kind.', ctx.correlationId);
    if (!input.checkKey || !input.component)
      throw badRequest('checkKey and component are required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.insertCheck(tx, {
        tenantId: ctx.tenantId,
        checkKey: input.checkKey,
        component: input.component,
        signalKind: kind,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M40_AUDIT_CODES.checkDefined,
        entityType: 'resilience_check',
        entityId: row.id,
        detail: { checkKey: input.checkKey, component: input.component },
      });
      return { id: row.id };
    });
  }

  /** Record a bounded operational signal (append-only). No raw log/payload/PII — an opaque evidence ref only. */
  async recordSignal(
    ctx: RequestContext,
    input: {
      component: string;
      state: string;
      signalKind?: string;
      latencyMs?: number | null;
      resultCode?: string | null;
      evidenceRef?: string | null;
      checkId?: string | null;
    },
  ): Promise<{ id: string }> {
    await this.authz.require(ctx, M40_PERMISSIONS.backupManage);
    if (!input.component) throw badRequest('component is required.', ctx.correlationId);
    if (!(SIGNAL_STATES as readonly string[]).includes(input.state))
      throw badRequest('unknown signal state.', ctx.correlationId);
    if (input.latencyMs != null && (!Number.isInteger(input.latencyMs) || input.latencyMs < 0))
      throw badRequest('latency must be a non-negative integer (ms).', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.insertHealthSignal(tx, {
        tenantId: ctx.tenantId,
        checkId: input.checkId ?? null,
        component: input.component,
        signalKind: input.signalKind ?? 'health',
        state: input.state,
        latencyMs: input.latencyMs ?? null,
        resultCode: input.resultCode ?? null,
        evidenceRef: input.evidenceRef ?? null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M40_AUDIT_CODES.healthRecorded,
        entityType: 'resilience_health_signal',
        entityId: row.id,
        detail: { component: input.component, state: input.state },
      });
      return { id: row.id };
    });
  }
}
