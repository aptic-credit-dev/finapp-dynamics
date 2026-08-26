/**
 * CatalogService — configurable source systems + categories (mutable config) and versioned, immutable-after-
 * publish questionnaires + SLA policies (ADR-053/054, one ACTIVE per code, frozen at publish). Every mutating
 * method enforces its permission (default deny), runs in `db.withTenant`, and records audit in the same tx.
 * Nothing here is Aptic-specific — sources/products/types are all configurable (F-C).
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M12_PERMISSIONS } from './permissions.ts';
import { M12_AUDIT_CODES } from './audit-codes.ts';
import { checkSpecTransition, type SpecAction } from './domain/lifecycles.ts';
import { validateQuestionnaireSpec } from './domain/questionnaire.ts';
import { validateSlaPolicySpec } from './domain/sla.ts';
import { contentHashOf } from './hash.ts';
import { FeedbackRepository, type SpecRow } from './repository.ts';
import type { M12Emitter } from './emit.ts';
import { badRequest, invalidSpec } from './errors.ts';

type Kind = 'questionnaire' | 'sla_policy';
function specCode(spec: unknown): string | null {
  if (typeof spec === 'object' && spec !== null && 'code' in spec) {
    const c = (spec as Record<string, unknown>)['code'];
    return typeof c === 'string' ? c : null;
  }
  return null;
}

export class CatalogService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M12Emitter;
  private readonly repo: FeedbackRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M12Emitter,
    repo: FeedbackRepository = new FeedbackRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  async setSourceSystem(
    ctx: RequestContext,
    actor: string | null,
    input: { code: string; name: string; active?: boolean },
  ): Promise<void> {
    await this.authz.require(ctx, M12_PERMISSIONS.sourceManage);
    await this.db.withTenant(ctx, async (tx) => {
      await this.repo.upsertSourceSystem(tx, {
        tenantId: ctx.tenantId,
        code: input.code,
        name: input.name,
        active: input.active !== false,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.sourceConfigured,
        entityType: 'feedback_source_system',
        entityId: input.code,
        detail: { code: input.code },
      });
    });
  }
  async setCategory(
    ctx: RequestContext,
    actor: string | null,
    input: { code: string; name: string; defaultSentiment?: string | null; active?: boolean },
  ): Promise<void> {
    await this.authz.require(ctx, M12_PERMISSIONS.categoryManage);
    await this.db.withTenant(ctx, async (tx) => {
      await this.repo.upsertCategory(tx, {
        tenantId: ctx.tenantId,
        code: input.code,
        name: input.name,
        defaultSentiment: input.defaultSentiment ?? null,
        active: input.active !== false,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.categoryConfigured,
        entityType: 'feedback_category',
        entityId: input.code,
        detail: { code: input.code },
      });
    });
  }

  private async createSpec(
    ctx: RequestContext,
    actor: string | null,
    kind: Kind,
    input: { code: string; name: string; scope?: string; spec: unknown },
  ): Promise<SpecRow> {
    await this.authz.require(
      ctx,
      kind === 'questionnaire' ? M12_PERMISSIONS.questionnaireManage : M12_PERMISSIONS.slaPolicyManage,
    );
    if (specCode(input.spec) !== input.code)
      throw badRequest('spec.code must equal the code', ctx.correlationId);
    const scope = input.scope ?? 'tenant';
    if (scope !== 'tenant' && scope !== 'platform')
      throw badRequest("scope must be 'tenant' or 'platform'", ctx.correlationId);
    if (scope === 'platform') await this.authz.require(ctx, M12_PERMISSIONS.platformAdminister);
    return this.db.withTenant(ctx, async (tx) => {
      const next =
        kind === 'questionnaire'
          ? await this.repo.nextQuestionnaireVersion(tx, input.code)
          : await this.repo.nextSlaPolicyVersion(tx, input.code);
      const args = {
        tenantId: ctx.tenantId,
        code: input.code,
        versionNumber: next,
        name: input.name,
        scope,
        spec: input.spec,
        createdBy: actor,
      };
      const row =
        kind === 'questionnaire'
          ? await this.repo.insertQuestionnaire(tx, args)
          : await this.repo.insertSlaPolicy(tx, args);
      await this.emitter.recordAudit(tx, ctx, {
        code: M12_AUDIT_CODES.questionnaireCreated,
        entityType: kind === 'questionnaire' ? 'feedback_questionnaire' : 'feedback_sla_policy',
        entityId: row.id,
        detail: { code: input.code, versionNumber: next },
      });
      return row;
    });
  }

  private async transition(
    ctx: RequestContext,
    actor: string | null,
    kind: Kind,
    id: string,
    expectedVersion: number,
    action: SpecAction,
  ): Promise<SpecRow> {
    await this.authz.require(
      ctx,
      kind === 'questionnaire' ? M12_PERMISSIONS.questionnaireManage : M12_PERMISSIONS.slaPolicyManage,
    );
    return this.db.withTenant(ctx, async (tx) => {
      const row =
        kind === 'questionnaire'
          ? await this.repo.findQuestionnaire(tx, id)
          : await this.repo.findSlaPolicy(tx, id);
      if (row === null) throw ProblemError.notFound('Not found.', ctx.correlationId);
      if (action === 'validate') {
        const res =
          kind === 'questionnaire' ? validateQuestionnaireSpec(row.spec) : validateSlaPolicySpec(row.spec);
        if (!res.ok)
          throw invalidSpec(
            kind === 'questionnaire' ? 'Invalid questionnaire' : 'Invalid SLA policy',
            res.errors,
            ctx.correlationId,
          );
      }
      const check = checkSpecTransition(row.status, action);
      if (!check.ok || check.to === undefined)
        throw ProblemError.conflict(`Invalid transition: ${check.reason ?? ''}`, ctx.correlationId);
      const contentHash = action === 'publish' ? contentHashOf(row.spec) : null;
      const upd =
        kind === 'questionnaire'
          ? await this.repo.updateQuestionnaireStatus(tx, {
              id,
              expectedVersion,
              toStatus: check.to,
              contentHash,
              publishedBy: action === 'publish' ? actor : null,
            })
          : await this.repo.updateSlaPolicyStatus(tx, {
              id,
              expectedVersion,
              toStatus: check.to,
              contentHash,
              publishedBy: action === 'publish' ? actor : null,
            });
      if (upd === null)
        throw ProblemError.conflict('Modified concurrently (stale version).', ctx.correlationId);
      if (action === 'activate') {
        if (kind === 'questionnaire') await this.repo.retireActiveQuestionnaires(tx, upd.code, id);
        else await this.repo.retireActiveSlaPolicies(tx, upd.code, id);
      }
      const auditCode =
        action === 'publish'
          ? kind === 'questionnaire'
            ? M12_AUDIT_CODES.questionnairePublished
            : M12_AUDIT_CODES.slaPolicyPublished
          : M12_AUDIT_CODES.questionnaireCreated;
      await this.emitter.recordAudit(tx, ctx, {
        code: auditCode,
        entityType: kind === 'questionnaire' ? 'feedback_questionnaire' : 'feedback_sla_policy',
        entityId: id,
        detail: { toStatus: check.to },
      });
      return upd;
    });
  }

  createQuestionnaire(
    ctx: RequestContext,
    a: string | null,
    i: { code: string; name: string; scope?: string; spec: unknown },
  ) {
    return this.createSpec(ctx, a, 'questionnaire', i);
  }
  validateQuestionnaire(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'questionnaire', id, v, 'validate');
  }
  publishQuestionnaire(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'questionnaire', id, v, 'publish');
  }
  activateQuestionnaire(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'questionnaire', id, v, 'activate');
  }
  createSlaPolicy(
    ctx: RequestContext,
    a: string | null,
    i: { code: string; name: string; scope?: string; spec: unknown },
  ) {
    return this.createSpec(ctx, a, 'sla_policy', i);
  }
  validateSlaPolicy(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'sla_policy', id, v, 'validate');
  }
  publishSlaPolicy(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'sla_policy', id, v, 'publish');
  }
  activateSlaPolicy(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'sla_policy', id, v, 'activate');
  }
  async getQuestionnaire(ctx: RequestContext, id: string) {
    await this.authz.require(ctx, M12_PERMISSIONS.questionnaireRead);
    const r = await this.db.withTenant(ctx, (tx) => this.repo.findQuestionnaire(tx, id));
    if (r === null) throw ProblemError.notFound('Questionnaire not found.', ctx.correlationId);
    return r;
  }
  async getSlaPolicy(ctx: RequestContext, id: string) {
    await this.authz.require(ctx, M12_PERMISSIONS.slaRead);
    const r = await this.db.withTenant(ctx, (tx) => this.repo.findSlaPolicy(tx, id));
    if (r === null) throw ProblemError.notFound('SLA policy not found.', ctx.correlationId);
    return r;
  }

  // --- canonical read-only list surfaces (Feedback Setup workspace) ------------------------------
  // Each is RLS-scoped (db.withTenant) and gated by the entity's read permission — never a `.manage`
  // (write) grant. Categories/source systems gained dedicated read codes in migration 0003.
  async listQuestionnaires(ctx: RequestContext): Promise<SpecRow[]> {
    await this.authz.require(ctx, M12_PERMISSIONS.questionnaireRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listQuestionnaires(tx));
  }
  async listSlaPolicies(ctx: RequestContext): Promise<SpecRow[]> {
    await this.authz.require(ctx, M12_PERMISSIONS.slaRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listSlaPolicies(tx));
  }
  async listCategories(ctx: RequestContext) {
    await this.authz.require(ctx, M12_PERMISSIONS.categoryRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listCategories(tx));
  }
  async listSourceSystems(ctx: RequestContext) {
    await this.authz.require(ctx, M12_PERMISSIONS.sourceRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listSourceSystems(tx));
  }
}
