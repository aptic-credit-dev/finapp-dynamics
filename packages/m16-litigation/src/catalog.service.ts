/**
 * CatalogService — versioned, immutable-after-publish proceeding types + SLA policies (ADR-065, one ACTIVE per
 * code+scope, frozen at publish). Every mutating method enforces its permission (default deny), runs in
 * `db.withTenant`, and records audit in the same tx. Nothing here is hardcoded — proceeding types, jurisdictions,
 * forums/courts/tribunals are configured as declarative data; complex decisioning is delegated to m07.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M16_PERMISSIONS } from './permissions.ts';
import { M16_AUDIT_CODES } from './audit-codes.ts';
import { checkSpecTransition, type SpecAction } from './domain/lifecycles.ts';
import { validateProceedingTypeSpec } from './domain/proceedingtype.ts';
import { validateLitigationSlaPolicySpec } from './domain/sla.ts';
import { contentHashOf } from './hash.ts';
import { LitigationRepository, type SpecRow } from './repository.ts';
import type { M16Emitter } from './emit.ts';
import { badRequest, invalidSpec } from './errors.ts';

type Kind = 'proceeding_type' | 'sla_policy';
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
  private readonly emitter: M16Emitter;
  private readonly repo: LitigationRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M16Emitter,
    repo: LitigationRepository = new LitigationRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  private async createSpec(
    ctx: RequestContext,
    actor: string | null,
    kind: Kind,
    input: { code: string; name: string; scope?: string; spec: unknown },
  ): Promise<SpecRow> {
    await this.authz.require(
      ctx,
      kind === 'proceeding_type' ? M16_PERMISSIONS.proceedingTypeManage : M16_PERMISSIONS.slaPolicyManage,
    );
    if (specCode(input.spec) !== input.code)
      throw badRequest('spec.code must equal the code', ctx.correlationId);
    const scope = input.scope ?? 'tenant';
    if (scope !== 'tenant' && scope !== 'platform')
      throw badRequest("scope must be 'tenant' or 'platform'", ctx.correlationId);
    if (scope === 'platform') await this.authz.require(ctx, M16_PERMISSIONS.platformAdminister);
    return this.db.withTenant(ctx, async (tx) => {
      const next =
        kind === 'proceeding_type'
          ? await this.repo.nextProceedingTypeVersion(tx, input.code, scope)
          : await this.repo.nextSlaPolicyVersion(tx, input.code, scope);
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
        kind === 'proceeding_type'
          ? await this.repo.insertProceedingType(tx, args)
          : await this.repo.insertSlaPolicy(tx, args);
      await this.emitter.recordAudit(tx, ctx, {
        code: M16_AUDIT_CODES.proceedingTypeCreated,
        entityType: kind === 'proceeding_type' ? 'litigation_proceeding_type' : 'litigation_sla_policy',
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
      kind === 'proceeding_type' ? M16_PERMISSIONS.proceedingTypeManage : M16_PERMISSIONS.slaPolicyManage,
    );
    return this.db.withTenant(ctx, async (tx) => {
      const row =
        kind === 'proceeding_type'
          ? await this.repo.findProceedingType(tx, id)
          : await this.repo.findSlaPolicy(tx, id);
      if (row === null) throw ProblemError.notFound('Not found.', ctx.correlationId);
      if (action === 'validate') {
        const res =
          kind === 'proceeding_type'
            ? validateProceedingTypeSpec(row.spec)
            : validateLitigationSlaPolicySpec(row.spec);
        if (!res.ok)
          throw invalidSpec(
            kind === 'proceeding_type' ? 'Invalid proceeding type' : 'Invalid SLA policy',
            res.errors,
            ctx.correlationId,
          );
      }
      const check = checkSpecTransition(row.status, action);
      if (!check.ok || check.to === undefined)
        throw ProblemError.conflict(`Invalid transition: ${check.reason ?? ''}`, ctx.correlationId);
      const contentHash = action === 'publish' ? contentHashOf(row.spec) : null;
      const upd =
        kind === 'proceeding_type'
          ? await this.repo.updateProceedingTypeStatus(tx, {
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
        if (kind === 'proceeding_type')
          await this.repo.retireActiveProceedingTypes(tx, upd.code, upd.scope, id);
        else await this.repo.retireActiveSlaPolicies(tx, upd.code, upd.scope, id);
      }
      const auditCode =
        action === 'publish'
          ? kind === 'proceeding_type'
            ? M16_AUDIT_CODES.proceedingTypePublished
            : M16_AUDIT_CODES.slaPolicyPublished
          : M16_AUDIT_CODES.proceedingTypeCreated;
      await this.emitter.recordAudit(tx, ctx, {
        code: auditCode,
        entityType: kind === 'proceeding_type' ? 'litigation_proceeding_type' : 'litigation_sla_policy',
        entityId: id,
        detail: { toStatus: check.to },
      });
      return upd;
    });
  }

  createProceedingType(
    ctx: RequestContext,
    a: string | null,
    i: { code: string; name: string; scope?: string; spec: unknown },
  ) {
    return this.createSpec(ctx, a, 'proceeding_type', i);
  }
  validateProceedingType(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'proceeding_type', id, v, 'validate');
  }
  publishProceedingType(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'proceeding_type', id, v, 'publish');
  }
  activateProceedingType(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'proceeding_type', id, v, 'activate');
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
  async getProceedingType(ctx: RequestContext, id: string) {
    await this.authz.require(ctx, M16_PERMISSIONS.proceedingTypeRead);
    const r = await this.db.withTenant(ctx, (tx) => this.repo.findProceedingType(tx, id));
    if (r === null) throw ProblemError.notFound('Proceeding type not found.', ctx.correlationId);
    return r;
  }
  async getSlaPolicy(ctx: RequestContext, id: string) {
    await this.authz.require(ctx, M16_PERMISSIONS.slaPolicyRead);
    const r = await this.db.withTenant(ctx, (tx) => this.repo.findSlaPolicy(tx, id));
    if (r === null) throw ProblemError.notFound('SLA policy not found.', ctx.correlationId);
    return r;
  }
}
