/**
 * CatalogService — versioned, immutable-after-publish matter types + SLA policies (ADR-061, one ACTIVE per
 * code+scope, frozen at publish) and configurable jurisdictions/forums. Every mutating method enforces its
 * permission (default deny), runs in `db.withTenant`, and records audit in the same tx. Nothing here is hardcoded
 * — matter types, jurisdictions and courts are configured as declarative data; complex decisioning is delegated
 * to m07 (G1/G22).
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M14_PERMISSIONS } from './permissions.ts';
import { M14_AUDIT_CODES } from './audit-codes.ts';
import { checkSpecTransition, type SpecAction } from './domain/lifecycles.ts';
import { validateMatterTypeSpec } from './domain/mattertype.ts';
import { validateLegalSlaPolicySpec } from './domain/sla.ts';
import { contentHashOf } from './hash.ts';
import { LegalRepository, type SpecRow } from './repository.ts';
import type { M14Emitter } from './emit.ts';
import { badRequest, invalidSpec } from './errors.ts';

type Kind = 'matter_type' | 'sla_policy';
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
  private readonly emitter: M14Emitter;
  private readonly repo: LegalRepository;
  constructor(db: Db, authz: Authz, emitter: M14Emitter, repo: LegalRepository = new LegalRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  async setJurisdiction(
    ctx: RequestContext,
    actor: string | null,
    input: {
      code: string;
      name: string;
      kind?: string;
      country?: string | null;
      station?: string | null;
      active?: boolean;
    },
  ): Promise<void> {
    await this.authz.require(ctx, M14_PERMISSIONS.jurisdictionManage);
    const kind = input.kind ?? 'court';
    if (
      ![
        'jurisdiction',
        'court',
        'tribunal',
        'arbitration',
        'mediation',
        'regulatory',
        'internal_disciplinary',
      ].includes(kind)
    )
      throw badRequest('invalid jurisdiction kind', ctx.correlationId);
    await this.db.withTenant(ctx, async (tx) => {
      await this.repo.upsertJurisdiction(tx, {
        tenantId: ctx.tenantId,
        code: input.code,
        name: input.name,
        kind,
        country: input.country ?? null,
        station: input.station ?? null,
        active: input.active !== false,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.jurisdictionConfigured,
        entityType: 'legal_jurisdiction',
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
      kind === 'matter_type' ? M14_PERMISSIONS.matterTypeManage : M14_PERMISSIONS.slaPolicyManage,
    );
    if (specCode(input.spec) !== input.code)
      throw badRequest('spec.code must equal the code', ctx.correlationId);
    const scope = input.scope ?? 'tenant';
    if (scope !== 'tenant' && scope !== 'platform')
      throw badRequest("scope must be 'tenant' or 'platform'", ctx.correlationId);
    if (scope === 'platform') await this.authz.require(ctx, M14_PERMISSIONS.platformAdminister);
    return this.db.withTenant(ctx, async (tx) => {
      const next =
        kind === 'matter_type'
          ? await this.repo.nextMatterTypeVersion(tx, input.code, scope)
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
        kind === 'matter_type'
          ? await this.repo.insertMatterType(tx, args)
          : await this.repo.insertSlaPolicy(tx, args);
      await this.emitter.recordAudit(tx, ctx, {
        code: M14_AUDIT_CODES.matterTypeCreated,
        entityType: kind === 'matter_type' ? 'legal_matter_type' : 'legal_sla_policy',
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
      kind === 'matter_type' ? M14_PERMISSIONS.matterTypeManage : M14_PERMISSIONS.slaPolicyManage,
    );
    return this.db.withTenant(ctx, async (tx) => {
      const row =
        kind === 'matter_type'
          ? await this.repo.findMatterType(tx, id)
          : await this.repo.findSlaPolicy(tx, id);
      if (row === null) throw ProblemError.notFound('Not found.', ctx.correlationId);
      if (action === 'validate') {
        const res =
          kind === 'matter_type' ? validateMatterTypeSpec(row.spec) : validateLegalSlaPolicySpec(row.spec);
        if (!res.ok)
          throw invalidSpec(
            kind === 'matter_type' ? 'Invalid matter type' : 'Invalid SLA policy',
            res.errors,
            ctx.correlationId,
          );
      }
      const check = checkSpecTransition(row.status, action);
      if (!check.ok || check.to === undefined)
        throw ProblemError.conflict(`Invalid transition: ${check.reason ?? ''}`, ctx.correlationId);
      const contentHash = action === 'publish' ? contentHashOf(row.spec) : null;
      const upd =
        kind === 'matter_type'
          ? await this.repo.updateMatterTypeStatus(tx, {
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
        if (kind === 'matter_type') await this.repo.retireActiveMatterTypes(tx, upd.code, upd.scope, id);
        else await this.repo.retireActiveSlaPolicies(tx, upd.code, upd.scope, id);
      }
      const auditCode =
        action === 'publish'
          ? kind === 'matter_type'
            ? M14_AUDIT_CODES.matterTypePublished
            : M14_AUDIT_CODES.slaPolicyPublished
          : M14_AUDIT_CODES.matterTypeCreated;
      await this.emitter.recordAudit(tx, ctx, {
        code: auditCode,
        entityType: kind === 'matter_type' ? 'legal_matter_type' : 'legal_sla_policy',
        entityId: id,
        detail: { toStatus: check.to },
      });
      return upd;
    });
  }

  createMatterType(
    ctx: RequestContext,
    a: string | null,
    i: { code: string; name: string; scope?: string; spec: unknown },
  ) {
    return this.createSpec(ctx, a, 'matter_type', i);
  }
  validateMatterType(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'matter_type', id, v, 'validate');
  }
  publishMatterType(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'matter_type', id, v, 'publish');
  }
  activateMatterType(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'matter_type', id, v, 'activate');
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
  async getMatterType(ctx: RequestContext, id: string) {
    await this.authz.require(ctx, M14_PERMISSIONS.matterTypeRead);
    const r = await this.db.withTenant(ctx, (tx) => this.repo.findMatterType(tx, id));
    if (r === null) throw ProblemError.notFound('Matter type not found.', ctx.correlationId);
    return r;
  }
  async getSlaPolicy(ctx: RequestContext, id: string) {
    await this.authz.require(ctx, M14_PERMISSIONS.slaPolicyRead);
    const r = await this.db.withTenant(ctx, (tx) => this.repo.findSlaPolicy(tx, id));
    if (r === null) throw ProblemError.notFound('SLA policy not found.', ctx.correlationId);
    return r;
  }
}
