/**
 * FinanceAiConfigurationService — the versioned finance-AI config (one active per scope; idempotency-keyed). Human
 * review is always on and auto-post + auto-match are always off (DB CHECKs) — finance AI is advisory only, NO auto-post.
 * Every mutation is authorized (default deny) and audited through m03 in the same transaction.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M27_PERMISSIONS } from './permissions.ts';
import { M27_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { isConfidenceBps } from './domain.ts';
import { FinanceAiRepository, type ConfigRow } from './repository.ts';
import type { M27Emitter } from './emit.ts';

export class FinanceAiConfigurationService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M27Emitter;
  private readonly repo: FinanceAiRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M27Emitter,
    repo: FinanceAiRepository = new FinanceAiRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  async createConfig(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      name?: string | null;
      minConfidenceBps?: number;
      idempotencyKey?: string | null;
    },
  ): Promise<ConfigRow> {
    await this.authz.require(ctx, M27_PERMISSIONS.financeConfigure);
    const minConf = input.minConfidenceBps ?? 0;
    if (!isConfidenceBps(minConf))
      throw badRequest('min confidence must be an integer 0..10000 basis points.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findConfigByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      return this.repo.insertConfig(tx, {
        tenantId: ctx.tenantId,
        scope: input.scope ?? 'default',
        name: input.name ?? null,
        minConfidenceBps: minConf,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
    });
  }

  async publishConfig(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<ConfigRow> {
    await this.authz.require(ctx, M27_PERMISSIONS.financeConfigure);
    return this.db.withTenant(ctx, async (tx) => {
      const updated = await this.repo.setConfigStatus(tx, {
        id,
        expectedVersion,
        status: 'active',
        by: actor,
      });
      if (updated === null) throw ProblemError.conflict('Config modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M27_AUDIT_CODES.configUpdated,
        entityType: 'finance_ai_config',
        entityId: id,
        detail: { scope: updated.scope },
      });
      return updated;
    });
  }

  async listConfigs(ctx: RequestContext): Promise<ConfigRow[]> {
    await this.authz.require(ctx, M27_PERMISSIONS.financeRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listConfigs(tx));
  }
}
