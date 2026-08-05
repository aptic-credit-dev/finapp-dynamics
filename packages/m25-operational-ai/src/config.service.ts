/**
 * ConfigService — the versioned operational-AI config (one active per scope; idempotency-keyed). `require_human_review`
 * is always on and `auto_apply` is always off (DB CHECKs) — M25 recommends only. Every mutation is authorized (default
 * deny) and audited through m03 in the same transaction.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M25_PERMISSIONS } from './permissions.ts';
import { M25_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { isConfidenceBps } from './domain.ts';
import { OperationalAiRepository, type ConfigRow } from './repository.ts';
import type { M25Emitter } from './emit.ts';

export class ConfigService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M25Emitter;
  private readonly repo: OperationalAiRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M25Emitter,
    repo: OperationalAiRepository = new OperationalAiRepository(),
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
    await this.authz.require(ctx, M25_PERMISSIONS.operationalConfigure);
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
    await this.authz.require(ctx, M25_PERMISSIONS.operationalConfigure);
    return this.db.withTenant(ctx, async (tx) => {
      const updated = await this.repo.setConfigStatus(tx, {
        id,
        expectedVersion,
        status: 'active',
        by: actor,
      });
      if (updated === null) throw ProblemError.conflict('Config modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M25_AUDIT_CODES.configPublished,
        entityType: 'ops_ai_config',
        entityId: id,
        detail: { scope: updated.scope },
      });
      return updated;
    });
  }

  async listConfigs(ctx: RequestContext): Promise<ConfigRow[]> {
    await this.authz.require(ctx, M25_PERMISSIONS.operationalRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listConfigs(tx));
  }
}
