/**
 * ConfigService — versioned finance configuration per accounting entity + scope (default accounts, posting-rule
 * METADATA — never posting itself). The config is PUBLISHABLE + IMMUTABLE-after-publish through the ONE choke point
 * `checkConfigTransition` (draft → active → superseded → retired): a draft may be edited; a published (active)
 * version is frozen — its content_hash is sealed at publish (`contentHashOf`) and a change is a NEW version
 * (supersession, version_number+1) with the prior version moved to `superseded`. The partial unique index
 * `finance_config_one_active` guarantees exactly one active version per (entity, scope); `finance_config_idem_key`
 * makes create idempotent. Every mutating method enforces its permission (default deny), runs inside
 * `db.withTenant`, appends the append-only finance_config_history, and records audit + a `finance.lifecycle` event
 * in the SAME transaction. Settings are opaque config JSON — no monetary amounts, balances or float (ADR-007).
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import type { FinanceLifecycleEventType, FinanceLifecyclePayload } from '@finapp/contracts';
import { M19_PERMISSIONS } from './permissions.ts';
import { M19_AUDIT_CODES } from './audit-codes.ts';
import { checkConfigTransition } from './domain/lifecycles.ts';
import { contentHashOf } from './hash.ts';
import { FinanceRepository, type ConfigRow, type ConfigHistoryRow } from './repository.ts';
import type { M19Emitter } from './emit.ts';
import { badRequest } from './errors.ts';

export class ConfigService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M19Emitter;
  private readonly repo: FinanceRepository;
  constructor(db: Db, authz: Authz, emitter: M19Emitter, repo: FinanceRepository = new FinanceRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  private async publish(
    tx: Tx,
    ctx: RequestContext,
    actor: string | null,
    type: FinanceLifecycleEventType,
    payload: FinanceLifecyclePayload,
  ): Promise<void> {
    await this.emitter.publish(tx, {
      type,
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      ...(actor !== null ? { actor } : {}),
      payload,
    });
  }
  private async requireConfig(tx: Tx, id: string, correlationId: string): Promise<ConfigRow> {
    const c = await this.repo.findConfig(tx, id);
    if (c === null) throw ProblemError.notFound('Finance configuration not found.', correlationId);
    return c;
  }
  /** The immutable content projection sealed into content_hash at publish. */
  private projection(cfg: ConfigRow): unknown {
    return {
      entityId: cfg.entity_id,
      scope: cfg.scope,
      versionNumber: cfg.version_number,
      settings: cfg.settings,
    };
  }

  // --- create (draft) ---------------------------------------------------------------------------
  async createConfig(
    ctx: RequestContext,
    actor: string | null,
    input: {
      entityId: string;
      scope?: string;
      settings?: unknown;
      idempotencyKey?: string | null;
    },
  ): Promise<ConfigRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.configManage);
    const scope = input.scope ?? 'default';
    if (scope.trim() === '') throw badRequest('a scope is required', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findConfigByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const entity = await this.repo.findEntity(tx, input.entityId);
      if (entity === null) throw ProblemError.notFound('Accounting entity not found.', ctx.correlationId);
      const versionNumber = await this.repo.nextConfigVersion(tx, input.entityId, scope);
      const row = await this.repo.insertConfig(tx, {
        tenantId: ctx.tenantId,
        entityId: input.entityId,
        scope,
        versionNumber,
        settings: input.settings ?? {},
        supersedesId: null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertConfigHistory(tx, {
        tenantId: ctx.tenantId,
        configId: row.id,
        fromStatus: null,
        toStatus: row.status,
        reason: 'created',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.configCreated,
        entityType: 'finance_config',
        entityId: row.id,
        detail: { scope, versionNumber },
      });
      await this.publish(tx, ctx, actor, 'ConfigCreated', {
        recordId: row.id,
        recordType: 'config',
        entityRef: input.entityId,
        code: scope,
        versionNumber,
        toStatus: row.status,
      });
      return row;
    });
  }

  // --- edit a draft (published config is immutable) ---------------------------------------------
  async updateDraft(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: { expectedVersion: number; settings: unknown },
  ): Promise<ConfigRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.configManage);
    return this.db.withTenant(ctx, async (tx) => {
      const cfg = await this.requireConfig(tx, id, ctx.correlationId);
      if (cfg.status !== 'draft')
        throw ProblemError.conflict(
          `Published configuration is immutable — supersede to create a new version (status ${cfg.status}).`,
          ctx.correlationId,
        );
      const upd = await this.repo.updateConfigDraft(tx, {
        id,
        expectedVersion: input.expectedVersion,
        settings: input.settings,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Configuration not editable in this status or modified concurrently (stale version).',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.configCreated,
        entityType: 'finance_config',
        entityId: id,
        detail: { scope: cfg.scope, versionNumber: cfg.version_number },
      });
      return upd;
    });
  }

  // --- publish (draft -> active; freeze content_hash; one active per entity+scope) --------------
  async publishConfig(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<ConfigRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.configPublish);
    return this.db.withTenant(ctx, async (tx) => {
      const cfg = await this.requireConfig(tx, id, ctx.correlationId);
      const check = checkConfigTransition(cfg.status, 'active');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot publish configuration ${cfg.status} -> active: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      // The partial unique index `finance_config_one_active` is the hard guard; this surfaces a clean conflict.
      const active = await this.repo.findActiveConfig(tx, cfg.entity_id, cfg.scope);
      if (active !== null)
        throw ProblemError.conflict(
          'An active configuration already exists for this entity + scope — supersede it instead.',
          ctx.correlationId,
        );
      const upd = await this.repo.transitionConfig(tx, {
        id,
        expectedVersion,
        toStatus: 'active',
        contentHash: contentHashOf(this.projection(cfg)),
        submittedBy: actor,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Configuration modified concurrently (stale version).',
          ctx.correlationId,
        );
      await this.repo.insertConfigHistory(tx, {
        tenantId: ctx.tenantId,
        configId: id,
        fromStatus: cfg.status,
        toStatus: 'active',
        reason: 'published',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.configPublished,
        entityType: 'finance_config',
        entityId: id,
        detail: { scope: cfg.scope, versionNumber: cfg.version_number },
      });
      await this.publish(tx, ctx, actor, 'ConfigPublished', {
        recordId: id,
        recordType: 'config',
        entityRef: cfg.entity_id,
        code: cfg.scope,
        versionNumber: cfg.version_number,
        fromStatus: cfg.status,
        toStatus: 'active',
      });
      return upd;
    });
  }

  /**
   * Supersession — the only way to change published content. Moves the prior active version to `superseded`,
   * inserts a NEW active version (version_number+1, same entity+scope), seals its content_hash and links the prior
   * version to its successor, so the one-active index always holds exactly one live head.
   */
  async supersedeConfig(
    ctx: RequestContext,
    actor: string | null,
    priorId: string,
    input: { expectedVersion: number; settings?: unknown },
  ): Promise<{ prior: ConfigRow; successor: ConfigRow }> {
    await this.authz.require(ctx, M19_PERMISSIONS.configPublish);
    return this.db.withTenant(ctx, async (tx) => {
      const prior = await this.requireConfig(tx, priorId, ctx.correlationId);
      if (prior.status !== 'active')
        throw ProblemError.conflict('Only an active configuration can be superseded.', ctx.correlationId);
      // 1) Move the prior version off `active` first so the successor becomes the sole active head.
      const supersededPrior = await this.repo.transitionConfig(tx, {
        id: priorId,
        expectedVersion: input.expectedVersion,
        toStatus: 'superseded',
        by: actor,
      });
      if (supersededPrior === null)
        throw ProblemError.conflict(
          'Prior configuration modified concurrently (stale version).',
          ctx.correlationId,
        );
      const versionNumber = await this.repo.nextConfigVersion(tx, prior.entity_id, prior.scope);
      const successor = await this.repo.insertConfig(tx, {
        tenantId: ctx.tenantId,
        entityId: prior.entity_id,
        scope: prior.scope,
        versionNumber,
        settings: input.settings ?? prior.settings,
        supersedesId: prior.id,
        idempotencyKey: null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      // 2) Publish the successor: draft -> active, sealing its content_hash against its own projection.
      const activated = await this.repo.transitionConfig(tx, {
        id: successor.id,
        expectedVersion: successor.version,
        toStatus: 'active',
        contentHash: contentHashOf(this.projection(successor)),
        submittedBy: actor,
        by: actor,
      });
      // 3) Link the prior version to its successor.
      const linkedPrior = await this.repo.transitionConfig(tx, {
        id: priorId,
        expectedVersion: supersededPrior.version,
        toStatus: 'superseded',
        supersededById: successor.id,
        by: actor,
      });
      const finalSuccessor = activated ?? successor;
      const finalPrior = linkedPrior ?? supersededPrior;
      await this.repo.insertConfigHistory(tx, {
        tenantId: ctx.tenantId,
        configId: priorId,
        fromStatus: 'active',
        toStatus: 'superseded',
        reason: 'superseded',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertConfigHistory(tx, {
        tenantId: ctx.tenantId,
        configId: successor.id,
        fromStatus: null,
        toStatus: 'active',
        reason: 'versioned',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.configSuperseded,
        entityType: 'finance_config',
        entityId: priorId,
        detail: { supersededById: successor.id, versionNumber },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.configPublished,
        entityType: 'finance_config',
        entityId: successor.id,
        detail: { scope: prior.scope, versionNumber },
      });
      await this.publish(tx, ctx, actor, 'ConfigSuperseded', {
        recordId: priorId,
        recordType: 'config',
        entityRef: prior.entity_id,
        code: prior.scope,
        versionNumber,
        fromStatus: 'active',
        toStatus: 'superseded',
        reasonCode: 'superseded',
      });
      await this.publish(tx, ctx, actor, 'ConfigPublished', {
        recordId: successor.id,
        recordType: 'config',
        entityRef: prior.entity_id,
        code: prior.scope,
        versionNumber,
        toStatus: 'active',
      });
      return { prior: finalPrior, successor: finalSuccessor };
    });
  }

  // --- retire -----------------------------------------------------------------------------------
  async retireConfig(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<ConfigRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.configManage);
    return this.db.withTenant(ctx, async (tx) => {
      const cfg = await this.requireConfig(tx, id, ctx.correlationId);
      const check = checkConfigTransition(cfg.status, 'retired');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot retire configuration ${cfg.status} -> retired: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.transitionConfig(tx, {
        id,
        expectedVersion,
        toStatus: 'retired',
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Configuration modified concurrently (stale version).',
          ctx.correlationId,
        );
      await this.repo.insertConfigHistory(tx, {
        tenantId: ctx.tenantId,
        configId: id,
        fromStatus: cfg.status,
        toStatus: 'retired',
        reason: 'retired',
        by: actor,
        correlationId: ctx.correlationId,
      });
      // No dedicated FIN_CONFIG_RETIRED code — retirement audits under the superseded code (a config leaving service).
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.configSuperseded,
        entityType: 'finance_config',
        entityId: id,
        detail: { fromStatus: cfg.status, toStatus: 'retired' },
      });
      return upd;
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async getConfig(ctx: RequestContext, id: string): Promise<ConfigRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.configRead);
    const r = await this.db.withTenant(ctx, (tx) => this.repo.findConfig(tx, id));
    if (r === null) throw ProblemError.notFound('Finance configuration not found.', ctx.correlationId);
    return r;
  }
  async listConfigs(
    ctx: RequestContext,
    filters: { entityId: string; scope?: string },
  ): Promise<ConfigRow[]> {
    await this.authz.require(ctx, M19_PERMISSIONS.configRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listConfigs(tx, filters));
  }
  async listConfigHistory(ctx: RequestContext, configId: string): Promise<ConfigHistoryRow[]> {
    await this.authz.require(ctx, M19_PERMISSIONS.configRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listConfigHistory(tx, configId));
  }
}
