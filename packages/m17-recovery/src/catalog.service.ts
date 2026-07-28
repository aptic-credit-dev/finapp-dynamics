/**
 * CatalogService — versioned, immutable-after-publish recovery types + SLA policies (ADR-069, one ACTIVE per
 * code+scope, frozen at publish). Every mutating method enforces its permission (default deny), runs in
 * `db.withTenant`, and records audit in the same tx. Nothing here is hardcoded — recovery types, jurisdictions,
 * courts, auctioneers, statutes and enforcement methods are configured as declarative data; complex decisioning
 * (strategy/risk/SLA/write-off/closure) is delegated to m07.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M17_PERMISSIONS } from './permissions.ts';
import { M17_AUDIT_CODES } from './audit-codes.ts';
import { checkSpecTransition, type SpecAction } from './domain/lifecycles.ts';
import { validateRecoveryTypeSpec } from './domain/recoverytype.ts';
import { validateRecoverySlaPolicySpec } from './domain/sla.ts';
import { contentHashOf } from './hash.ts';
import { RecoveryRepository, type SpecRow } from './repository.ts';
import type { M17Emitter } from './emit.ts';
import { badRequest, invalidSpec } from './errors.ts';

type Kind = 'recovery_type' | 'sla_policy';
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
  private readonly emitter: M17Emitter;
  private readonly repo: RecoveryRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M17Emitter,
    repo: RecoveryRepository = new RecoveryRepository(),
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
      kind === 'recovery_type' ? M17_PERMISSIONS.recoveryTypeManage : M17_PERMISSIONS.slaPolicyManage,
    );
    if (specCode(input.spec) !== input.code)
      throw badRequest('spec.code must equal the code', ctx.correlationId);
    const scope = input.scope ?? 'tenant';
    if (scope !== 'tenant' && scope !== 'platform')
      throw badRequest("scope must be 'tenant' or 'platform'", ctx.correlationId);
    if (scope === 'platform') await this.authz.require(ctx, M17_PERMISSIONS.platformAdminister);
    return this.db.withTenant(ctx, async (tx) => {
      const next =
        kind === 'recovery_type'
          ? await this.repo.nextRecoveryTypeVersion(tx, input.code, scope)
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
        kind === 'recovery_type'
          ? await this.repo.insertRecoveryType(tx, args)
          : await this.repo.insertSlaPolicy(tx, args);
      await this.emitter.recordAudit(tx, ctx, {
        code: M17_AUDIT_CODES.recoveryTypeCreated,
        entityType: kind === 'recovery_type' ? 'recovery_type' : 'recovery_sla_policy',
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
      kind === 'recovery_type' ? M17_PERMISSIONS.recoveryTypeManage : M17_PERMISSIONS.slaPolicyManage,
    );
    return this.db.withTenant(ctx, async (tx) => {
      const row =
        kind === 'recovery_type'
          ? await this.repo.findRecoveryType(tx, id)
          : await this.repo.findSlaPolicy(tx, id);
      if (row === null) throw ProblemError.notFound('Not found.', ctx.correlationId);
      if (action === 'validate') {
        const res =
          kind === 'recovery_type'
            ? validateRecoveryTypeSpec(row.spec)
            : validateRecoverySlaPolicySpec(row.spec);
        if (!res.ok)
          throw invalidSpec(
            kind === 'recovery_type' ? 'Invalid recovery type' : 'Invalid SLA policy',
            res.errors,
            ctx.correlationId,
          );
      }
      const check = checkSpecTransition(row.status, action);
      if (!check.ok || check.to === undefined)
        throw ProblemError.conflict(`Invalid transition: ${check.reason ?? ''}`, ctx.correlationId);
      const contentHash = action === 'publish' ? contentHashOf(row.spec) : null;
      const upd =
        kind === 'recovery_type'
          ? await this.repo.updateRecoveryTypeStatus(tx, {
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
        if (kind === 'recovery_type') await this.repo.retireActiveRecoveryTypes(tx, upd.code, upd.scope, id);
        else await this.repo.retireActiveSlaPolicies(tx, upd.code, upd.scope, id);
      }
      const auditCode =
        action === 'publish'
          ? kind === 'recovery_type'
            ? M17_AUDIT_CODES.recoveryTypePublished
            : M17_AUDIT_CODES.slaPolicyPublished
          : M17_AUDIT_CODES.recoveryTypeCreated;
      await this.emitter.recordAudit(tx, ctx, {
        code: auditCode,
        entityType: kind === 'recovery_type' ? 'recovery_type' : 'recovery_sla_policy',
        entityId: id,
        detail: { toStatus: check.to },
      });
      return upd;
    });
  }

  createRecoveryType(
    ctx: RequestContext,
    a: string | null,
    i: { code: string; name: string; scope?: string; spec: unknown },
  ) {
    return this.createSpec(ctx, a, 'recovery_type', i);
  }
  validateRecoveryType(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'recovery_type', id, v, 'validate');
  }
  publishRecoveryType(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'recovery_type', id, v, 'publish');
  }
  activateRecoveryType(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'recovery_type', id, v, 'activate');
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
  async getRecoveryType(ctx: RequestContext, id: string) {
    await this.authz.require(ctx, M17_PERMISSIONS.recoveryTypeRead);
    const r = await this.db.withTenant(ctx, (tx) => this.repo.findRecoveryType(tx, id));
    if (r === null) throw ProblemError.notFound('Recovery type not found.', ctx.correlationId);
    return r;
  }
  async getSlaPolicy(ctx: RequestContext, id: string) {
    await this.authz.require(ctx, M17_PERMISSIONS.slaPolicyRead);
    const r = await this.db.withTenant(ctx, (tx) => this.repo.findSlaPolicy(tx, id));
    if (r === null) throw ProblemError.notFound('SLA policy not found.', ctx.correlationId);
    return r;
  }
}
