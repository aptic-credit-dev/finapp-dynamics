/**
 * CatalogService — the configurable, VERSIONED AI registries: providers (approve for data classifications; secret
 * REFERENCE only), models, prompt templates (immutable-after-publish), DLP policies and engine config. Every mutation is
 * authorized (default deny), audited through m03 in the same transaction, and — for provider approval — emits an
 * `ai.governance_lifecycle` event. Providers hold a secret reference only; a real provider adapter is prohibited.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M24_PERMISSIONS } from './permissions.ts';
import { M24_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { isDataClassification, isSpecFrozen, isSecretReference } from './domain.ts';
import {
  AiRepository,
  type ProviderRow,
  type ModelRow,
  type PromptRow,
  type DlpPolicyRow,
  type ConfigRow,
} from './repository.ts';
import type { M24Emitter } from './emit.ts';

export class CatalogService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M24Emitter;
  private readonly repo: AiRepository;
  constructor(db: Db, authz: Authz, emitter: M24Emitter, repo: AiRepository = new AiRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  async registerProvider(
    ctx: RequestContext,
    actor: string | null,
    input: {
      code: string;
      name?: string | null;
      kind?: string;
      classifications?: string[];
      secretReference?: string | null;
    },
  ): Promise<ProviderRow> {
    await this.authz.require(ctx, M24_PERMISSIONS.providerManage);
    if (input.code.trim() === '') throw badRequest('a provider code is required.', ctx.correlationId);
    if (
      input.secretReference != null &&
      input.secretReference !== '' &&
      !isSecretReference(input.secretReference)
    )
      throw badRequest(
        'a provider secret must be a secretref: reference, never an inline secret.',
        ctx.correlationId,
      );
    const classifications = input.classifications ?? [];
    for (const c of classifications)
      if (!isDataClassification(c)) throw badRequest('unknown data classification.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const provider = await this.repo.insertProvider(tx, {
        tenantId: ctx.tenantId,
        code: input.code,
        name: input.name ?? null,
        kind: input.kind ?? 'local',
        approved: false,
        classifications,
        secretReference: input.secretReference ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertProviderHistory(tx, {
        tenantId: ctx.tenantId,
        providerId: provider.id,
        fromStatus: null,
        toStatus: 'draft',
        reason: null,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M24_AUDIT_CODES.providerRegistered,
        entityType: 'ai_provider',
        entityId: provider.id,
        detail: { code: provider.code, kind: provider.kind },
      });
      return provider;
    });
  }

  /** Approve + activate a provider for specific data classifications. The approved-provider routing gate depends on this. */
  async approveProvider(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<ProviderRow> {
    await this.authz.require(ctx, M24_PERMISSIONS.providerApprove);
    return this.db.withTenant(ctx, async (tx) => {
      const provider = await this.repo.findProvider(tx, id);
      if (provider === null) throw ProblemError.notFound('Provider not found.', ctx.correlationId);
      const updated = await this.repo.setProviderStatus(tx, {
        id,
        expectedVersion,
        status: 'active',
        approved: true,
        by: actor,
      });
      if (updated === null) throw ProblemError.conflict('Provider modified concurrently.', ctx.correlationId);
      await this.repo.insertProviderHistory(tx, {
        tenantId: ctx.tenantId,
        providerId: id,
        fromStatus: provider.status,
        toStatus: 'active',
        reason: null,
        reasonCode: 'provider_approved',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M24_AUDIT_CODES.providerApproved,
        entityType: 'ai_provider',
        entityId: id,
        detail: { classifications: updated.classifications },
      });
      await this.emitter.publishGovernance(tx, {
        type: 'ProviderApproved',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: id,
          recordType: 'provider',
          providerRef: id,
          reasonCode: 'provider_approved',
          isAssistive: true,
        },
      });
      return updated;
    });
  }
  async listProviders(ctx: RequestContext): Promise<ProviderRow[]> {
    await this.authz.require(ctx, M24_PERMISSIONS.providerRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listProviders(tx));
  }

  async registerModel(
    ctx: RequestContext,
    actor: string | null,
    input: {
      providerId?: string | null;
      code: string;
      name?: string | null;
      capability?: string;
      ratePer1kMinor?: number;
    },
  ): Promise<ModelRow> {
    await this.authz.require(ctx, M24_PERMISSIONS.modelManage);
    if (input.code.trim() === '') throw badRequest('a model code is required.', ctx.correlationId);
    const rate = input.ratePer1kMinor ?? 0;
    if (!Number.isInteger(rate) || rate < 0)
      throw badRequest('rate must be a non-negative integer (minor units).', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const model = await this.repo.insertModel(tx, {
        tenantId: ctx.tenantId,
        providerId: input.providerId ?? null,
        code: input.code,
        name: input.name ?? null,
        capability: input.capability ?? 'text',
        ratePer1kMinor: rate,
        correlationId: ctx.correlationId,
        by: actor,
      });
      const activated = await this.repo.setModelStatus(tx, {
        id: model.id,
        expectedVersion: model.version,
        status: 'active',
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M24_AUDIT_CODES.modelRegistered,
        entityType: 'ai_model',
        entityId: model.id,
        detail: { code: model.code },
      });
      return activated ?? model;
    });
  }
  async listModels(ctx: RequestContext): Promise<ModelRow[]> {
    await this.authz.require(ctx, M24_PERMISSIONS.modelRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listModels(tx));
  }

  async createPrompt(
    ctx: RequestContext,
    actor: string | null,
    input: { code: string; name?: string | null; template: string; contentHash?: string | null },
  ): Promise<PromptRow> {
    await this.authz.require(ctx, M24_PERMISSIONS.promptManage);
    if (input.code.trim() === '') throw badRequest('a prompt code is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const prompt = await this.repo.insertPrompt(tx, {
        tenantId: ctx.tenantId,
        code: input.code,
        name: input.name ?? null,
        template: input.template,
        contentHash: input.contentHash ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertPromptHistory(tx, {
        tenantId: ctx.tenantId,
        promptId: prompt.id,
        fromStatus: null,
        toStatus: 'draft',
        reason: null,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      return prompt;
    });
  }
  async publishPrompt(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<PromptRow> {
    await this.authz.require(ctx, M24_PERMISSIONS.promptPublish);
    return this.db.withTenant(ctx, async (tx) => {
      const prompt = await this.repo.findPrompt(tx, id);
      if (prompt === null) throw ProblemError.notFound('Prompt not found.', ctx.correlationId);
      if (isSpecFrozen(prompt.status))
        throw badRequest(`a ${prompt.status} prompt cannot be published.`, ctx.correlationId);
      const updated = await this.repo.setPromptStatus(tx, {
        id,
        expectedVersion,
        status: 'active',
        by: actor,
      });
      if (updated === null) throw ProblemError.conflict('Prompt modified concurrently.', ctx.correlationId);
      await this.repo.insertPromptHistory(tx, {
        tenantId: ctx.tenantId,
        promptId: id,
        fromStatus: prompt.status,
        toStatus: 'active',
        reason: null,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M24_AUDIT_CODES.promptPublished,
        entityType: 'ai_prompt',
        entityId: id,
        detail: { code: updated.code },
      });
      return updated;
    });
  }
  async listPrompts(ctx: RequestContext): Promise<PromptRow[]> {
    await this.authz.require(ctx, M24_PERMISSIONS.promptRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listPrompts(tx));
  }

  async createDlpPolicy(
    ctx: RequestContext,
    actor: string | null,
    input: { scope?: string; name?: string | null },
  ): Promise<DlpPolicyRow> {
    await this.authz.require(ctx, M24_PERMISSIONS.dlpManage);
    return this.db.withTenant(ctx, async (tx) => {
      const policy = await this.repo.insertDlpPolicy(tx, {
        tenantId: ctx.tenantId,
        scope: input.scope ?? 'default',
        name: input.name ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      return policy;
    });
  }
  async publishDlpPolicy(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<DlpPolicyRow> {
    await this.authz.require(ctx, M24_PERMISSIONS.dlpManage);
    return this.db.withTenant(ctx, async (tx) => {
      const policy = await this.repo.findDlpPolicy(tx, id);
      if (policy === null) throw ProblemError.notFound('DLP policy not found.', ctx.correlationId);
      const updated = await this.repo.setDlpPolicyStatus(tx, {
        id,
        expectedVersion,
        status: 'active',
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('DLP policy modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M24_AUDIT_CODES.dlpPolicyPublished,
        entityType: 'ai_dlp_policy',
        entityId: id,
        detail: { scope: updated.scope },
      });
      return updated;
    });
  }
  async listDlpPolicies(ctx: RequestContext): Promise<DlpPolicyRow[]> {
    await this.authz.require(ctx, M24_PERMISSIONS.dlpRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listDlpPolicies(tx));
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
    await this.authz.require(ctx, M24_PERMISSIONS.configManage);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findConfigByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const cfg = await this.repo.insertConfig(tx, {
        tenantId: ctx.tenantId,
        scope: input.scope ?? 'default',
        name: input.name ?? null,
        minConfidenceBps: input.minConfidenceBps ?? 0,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      return cfg;
    });
  }
  async publishConfig(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<ConfigRow> {
    await this.authz.require(ctx, M24_PERMISSIONS.configManage);
    return this.db.withTenant(ctx, async (tx) => {
      const updated = await this.repo.setConfigStatus(tx, {
        id,
        expectedVersion,
        status: 'active',
        by: actor,
      });
      if (updated === null) throw ProblemError.conflict('Config modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M24_AUDIT_CODES.configPublished,
        entityType: 'ai_config',
        entityId: id,
        detail: { scope: updated.scope },
      });
      return updated;
    });
  }
  async listConfigs(ctx: RequestContext): Promise<ConfigRow[]> {
    await this.authz.require(ctx, M24_PERMISSIONS.configRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listConfigs(tx));
  }
}
