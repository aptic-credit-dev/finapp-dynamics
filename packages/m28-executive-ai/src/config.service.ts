/**
 * CopilotConfigurationService — the versioned copilot config (one active per scope; idempotency-keyed). READ-ONLY,
 * CITATIONS and human-reviewed export are always on (DB CHECKs) — the copilot is advisory only, evidence-backed and
 * never acts. Every mutation is authorized (default deny) and audited through m03 in the same transaction.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M28_PERMISSIONS } from './permissions.ts';
import { M28_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { isConfidenceBps, clampMaxSources, INTENT_CLASSES } from './domain.ts';
import { ExecutiveAiRepository, type ConfigRow } from './repository.ts';
import type { M28Emitter } from './emit.ts';

export class CopilotConfigurationService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M28Emitter;
  private readonly repo: ExecutiveAiRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M28Emitter,
    repo: ExecutiveAiRepository = new ExecutiveAiRepository(),
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
      maxSources?: number;
      idempotencyKey?: string | null;
    },
  ): Promise<ConfigRow> {
    await this.authz.require(ctx, M28_PERMISSIONS.copilotConfigure);
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
        maxSources: clampMaxSources(input.maxSources),
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
    await this.authz.require(ctx, M28_PERMISSIONS.copilotConfigure);
    return this.db.withTenant(ctx, async (tx) => {
      const updated = await this.repo.setConfigStatus(tx, {
        id,
        expectedVersion,
        status: 'active',
        by: actor,
      });
      if (updated === null) throw ProblemError.conflict('Config modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M28_AUDIT_CODES.configUpdated,
        entityType: 'copilot_config',
        entityId: id,
        detail: { scope: updated.scope, status: updated.status },
      });
      return updated;
    });
  }

  async listConfigs(ctx: RequestContext): Promise<ConfigRow[]> {
    await this.authz.require(ctx, M28_PERMISSIONS.copilotRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listConfigs(tx));
  }

  /**
   * The copilot capability + governance descriptor (read-only, cited, RLS-masked; the intent classes it supports; the
   * controlled actions it will NEVER take). Authorized read (default deny). Static, safe, tenant-independent metadata.
   */
  async describeCapabilities(ctx: RequestContext): Promise<Record<string, unknown>> {
    await this.authz.require(ctx, M28_PERMISSIONS.copilotRead);
    return {
      module: 'm28-executive-ai',
      capability: 'Executive Copilot (read-only, cited)',
      hardRules: ['read_only', 'cited', 'rls_masking'],
      readOnly: true,
      citationsRequired: true,
      intentClasses: [...INTENT_CLASSES],
      neverDoes: [
        'mutate a business record',
        'approve',
        'post a journal',
        'disburse or pay',
        'reconcile',
        'close a case',
        'file a matter',
        'send a notification',
        'change roles/rules/workflow',
        'execute any controlled action',
      ],
      consumes: {
        ai: 'm24-ai-foundation (by contract)',
        analytics: 'm32-analytics (deferred, read-only port)',
      },
    };
  }

  /** The effective active config for a scope, or platform defaults (read-only, citations on) when none is published. */
  async effectiveConfig(
    ctx: RequestContext,
    scope: string,
  ): Promise<{ minConfidenceBps: number; maxSources: number }> {
    return this.db.withTenant(ctx, async (tx) => {
      const active = await this.repo.findActiveConfig(tx, scope);
      return {
        minConfidenceBps: active?.min_confidence_bps ?? 0,
        maxSources: active?.max_sources ?? clampMaxSources(undefined),
      };
    });
  }
}
