/**
 * CatalogService — versioned, immutable-after-publish case types + SLA policies (ADR-057, one ACTIVE per
 * code+scope, frozen at publish). Every mutating method enforces its permission (default deny), runs in
 * `db.withTenant`, and records audit in the same tx. Nothing here is hardcoded — case types (including legal
 * ones) are configured as declarative data; complex decisioning is delegated to m07 (F1/F21).
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M13_PERMISSIONS } from './permissions.ts';
import { M13_AUDIT_CODES } from './audit-codes.ts';
import { checkSpecTransition, type SpecAction } from './domain/lifecycles.ts';
import { validateCaseTypeSpec } from './domain/casetype.ts';
import { validateCaseSlaPolicySpec } from './domain/sla.ts';
import { contentHashOf } from './hash.ts';
import { CaseRepository, type SpecRow } from './repository.ts';
import type { M13Emitter } from './emit.ts';
import { badRequest, invalidSpec } from './errors.ts';

type Kind = 'case_type' | 'sla_policy';
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
  private readonly emitter: M13Emitter;
  private readonly repo: CaseRepository;
  constructor(db: Db, authz: Authz, emitter: M13Emitter, repo: CaseRepository = new CaseRepository()) {
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
      kind === 'case_type' ? M13_PERMISSIONS.typeManage : M13_PERMISSIONS.slaPolicyManage,
    );
    if (specCode(input.spec) !== input.code)
      throw badRequest('spec.code must equal the code', ctx.correlationId);
    const scope = input.scope ?? 'tenant';
    if (scope !== 'tenant' && scope !== 'platform')
      throw badRequest("scope must be 'tenant' or 'platform'", ctx.correlationId);
    if (scope === 'platform') await this.authz.require(ctx, M13_PERMISSIONS.platformAdminister);
    return this.db.withTenant(ctx, async (tx) => {
      const next =
        kind === 'case_type'
          ? await this.repo.nextCaseTypeVersion(tx, input.code, scope)
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
        kind === 'case_type'
          ? await this.repo.insertCaseType(tx, args)
          : await this.repo.insertSlaPolicy(tx, args);
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.typeCreated,
        entityType: kind === 'case_type' ? 'case_type' : 'case_sla_policy',
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
      kind === 'case_type' ? M13_PERMISSIONS.typeManage : M13_PERMISSIONS.slaPolicyManage,
    );
    return this.db.withTenant(ctx, async (tx) => {
      const row =
        kind === 'case_type' ? await this.repo.findCaseType(tx, id) : await this.repo.findSlaPolicy(tx, id);
      if (row === null) throw ProblemError.notFound('Not found.', ctx.correlationId);
      if (action === 'validate') {
        const res =
          kind === 'case_type' ? validateCaseTypeSpec(row.spec) : validateCaseSlaPolicySpec(row.spec);
        if (!res.ok)
          throw invalidSpec(
            kind === 'case_type' ? 'Invalid case type' : 'Invalid SLA policy',
            res.errors,
            ctx.correlationId,
          );
      }
      const check = checkSpecTransition(row.status, action);
      if (!check.ok || check.to === undefined)
        throw ProblemError.conflict(`Invalid transition: ${check.reason ?? ''}`, ctx.correlationId);
      const contentHash = action === 'publish' ? contentHashOf(row.spec) : null;
      const upd =
        kind === 'case_type'
          ? await this.repo.updateCaseTypeStatus(tx, {
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
        if (kind === 'case_type') await this.repo.retireActiveCaseTypes(tx, upd.code, upd.scope, id);
        else await this.repo.retireActiveSlaPolicies(tx, upd.code, upd.scope, id);
      }
      const auditCode =
        action === 'publish'
          ? kind === 'case_type'
            ? M13_AUDIT_CODES.typePublished
            : M13_AUDIT_CODES.slaPolicyPublished
          : M13_AUDIT_CODES.typeCreated;
      await this.emitter.recordAudit(tx, ctx, {
        code: auditCode,
        entityType: kind === 'case_type' ? 'case_type' : 'case_sla_policy',
        entityId: id,
        detail: { toStatus: check.to },
      });
      return upd;
    });
  }

  createCaseType(
    ctx: RequestContext,
    a: string | null,
    i: { code: string; name: string; scope?: string; spec: unknown },
  ) {
    return this.createSpec(ctx, a, 'case_type', i);
  }
  validateCaseType(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'case_type', id, v, 'validate');
  }
  publishCaseType(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'case_type', id, v, 'publish');
  }
  activateCaseType(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'case_type', id, v, 'activate');
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
  async getCaseType(ctx: RequestContext, id: string) {
    await this.authz.require(ctx, M13_PERMISSIONS.typeRead);
    const r = await this.db.withTenant(ctx, (tx) => this.repo.findCaseType(tx, id));
    if (r === null) throw ProblemError.notFound('Case type not found.', ctx.correlationId);
    return r;
  }
  async getSlaPolicy(ctx: RequestContext, id: string) {
    await this.authz.require(ctx, M13_PERMISSIONS.slaPolicyRead);
    const r = await this.db.withTenant(ctx, (tx) => this.repo.findSlaPolicy(tx, id));
    if (r === null) throw ProblemError.notFound('SLA policy not found.', ctx.correlationId);
    return r;
  }
}
