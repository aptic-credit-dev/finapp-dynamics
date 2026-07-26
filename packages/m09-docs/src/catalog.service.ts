/**
 * CatalogService — document-type + retention-policy authoring and lifecycle (ADR-045). Both are versioned,
 * immutable-after-publish `spec` documents walked DRAFT→VALIDATED→PUBLISHED→ACTIVE→RETIRED, frozen at publish
 * (content_hash), one ACTIVE per code. Every mutating method enforces its permission (default deny), runs in
 * `db.withTenant`, and records audit in the same transaction. Lifecycle goes through the PURE `checkSpecTransition`.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M09_PERMISSIONS } from './permissions.ts';
import { M09_AUDIT_CODES } from './audit-codes.ts';
import { checkSpecTransition, type SpecAction } from './domain/lifecycles.ts';
import { validateDocumentTypeSpec, validateRetentionPolicySpec } from './domain/doctype.ts';
import { contentHashOf } from './hash.ts';
import { DocsRepository, type SpecRow } from './repository.ts';
import type { M09Emitter } from './emit.ts';
import { badRequest, invalidSpec } from './errors.ts';

type Kind = 'type' | 'retention';

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
  private readonly emitter: M09Emitter;
  private readonly repo: DocsRepository;

  constructor(db: Db, authz: Authz, emitter: M09Emitter, repo: DocsRepository = new DocsRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  private async create(
    ctx: RequestContext,
    actor: string | null,
    kind: Kind,
    input: { code: string; name: string; scope?: string; spec: unknown },
  ): Promise<SpecRow> {
    await this.authz.require(
      ctx,
      kind === 'type' ? M09_PERMISSIONS.typeManage : M09_PERMISSIONS.retentionManage,
    );
    if (specCode(input.spec) !== input.code)
      throw badRequest('spec.code must equal the code', ctx.correlationId);
    const scope = input.scope ?? 'tenant';
    if (scope !== 'tenant' && scope !== 'platform')
      throw badRequest("scope must be 'tenant' or 'platform'", ctx.correlationId);
    if (scope === 'platform') await this.authz.require(ctx, M09_PERMISSIONS.platformAdminister);
    return this.db.withTenant(ctx, async (tx) => {
      const next =
        kind === 'type'
          ? await this.repo.nextTypeVersion(tx, input.code)
          : await this.repo.nextRetentionVersion(tx, input.code);
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
        kind === 'type' ? await this.repo.insertType(tx, args) : await this.repo.insertRetention(tx, args);
      await this.emitter.recordAudit(tx, ctx, {
        code: kind === 'type' ? M09_AUDIT_CODES.typeCreated : M09_AUDIT_CODES.retentionCreated,
        entityType: kind === 'type' ? 'document_type' : 'retention_policy',
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
      kind === 'type' ? M09_PERMISSIONS.typeManage : M09_PERMISSIONS.retentionManage,
    );
    return this.db.withTenant(ctx, async (tx) => {
      const row = kind === 'type' ? await this.repo.findType(tx, id) : await this.repo.findRetention(tx, id);
      if (row === null) throw ProblemError.notFound('Not found.', ctx.correlationId);
      if (action === 'validate') {
        const res =
          kind === 'type' ? validateDocumentTypeSpec(row.spec) : validateRetentionPolicySpec(row.spec);
        if (!res.ok)
          throw invalidSpec(
            kind === 'type' ? 'Invalid document type' : 'Invalid retention policy',
            res.errors,
            ctx.correlationId,
          );
      }
      const check = checkSpecTransition(row.status, action);
      if (!check.ok || check.to === undefined)
        throw ProblemError.conflict(`Invalid transition: ${check.reason ?? ''}`, ctx.correlationId);
      const contentHash = action === 'publish' ? contentHashOf(row.spec) : null;
      const upd =
        kind === 'type'
          ? await this.repo.updateTypeStatus(tx, {
              id,
              expectedVersion,
              toStatus: check.to,
              contentHash,
              publishedBy: action === 'publish' ? actor : null,
            })
          : await this.repo.updateRetentionStatus(tx, {
              id,
              expectedVersion,
              toStatus: check.to,
              contentHash,
              publishedBy: action === 'publish' ? actor : null,
            });
      if (upd === null)
        throw ProblemError.conflict('Modified concurrently (stale version).', ctx.correlationId);
      if (action === 'activate') {
        if (kind === 'type') await this.repo.retireActiveTypes(tx, upd.code, id);
        else await this.repo.retireActiveRetentions(tx, upd.code, id);
      }
      const auditCode =
        action === 'publish'
          ? kind === 'type'
            ? M09_AUDIT_CODES.typePublished
            : M09_AUDIT_CODES.retentionPublished
          : kind === 'type'
            ? M09_AUDIT_CODES.typeCreated
            : M09_AUDIT_CODES.retentionCreated;
      await this.emitter.recordAudit(tx, ctx, {
        code: auditCode,
        entityType: kind === 'type' ? 'document_type' : 'retention_policy',
        entityId: id,
        detail: { toStatus: check.to },
      });
      return upd;
    });
  }

  // document types
  createType(
    ctx: RequestContext,
    a: string | null,
    i: { code: string; name: string; scope?: string; spec: unknown },
  ) {
    return this.create(ctx, a, 'type', i);
  }
  validateType(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'type', id, v, 'validate');
  }
  publishType(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'type', id, v, 'publish');
  }
  activateType(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'type', id, v, 'activate');
  }
  retireType(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'type', id, v, 'retire');
  }
  async getType(ctx: RequestContext, id: string) {
    await this.authz.require(ctx, M09_PERMISSIONS.typeRead);
    const r = await this.db.withTenant(ctx, (tx) => this.repo.findType(tx, id));
    if (r === null) throw ProblemError.notFound('Type not found.', ctx.correlationId);
    return r;
  }
  async listTypes(ctx: RequestContext) {
    await this.authz.require(ctx, M09_PERMISSIONS.typeRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listTypes(tx));
  }

  // retention policies
  createRetention(
    ctx: RequestContext,
    a: string | null,
    i: { code: string; name: string; scope?: string; spec: unknown },
  ) {
    return this.create(ctx, a, 'retention', i);
  }
  validateRetention(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'retention', id, v, 'validate');
  }
  publishRetention(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'retention', id, v, 'publish');
  }
  activateRetention(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'retention', id, v, 'activate');
  }
  retireRetention(ctx: RequestContext, a: string | null, id: string, v: number) {
    return this.transition(ctx, a, 'retention', id, v, 'retire');
  }
  async getRetention(ctx: RequestContext, id: string) {
    await this.authz.require(ctx, M09_PERMISSIONS.retentionRead);
    const r = await this.db.withTenant(ctx, (tx) => this.repo.findRetention(tx, id));
    if (r === null) throw ProblemError.notFound('Retention policy not found.', ctx.correlationId);
    return r;
  }
  async listRetentions(ctx: RequestContext) {
    await this.authz.require(ctx, M09_PERMISSIONS.retentionRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listRetentions(tx));
  }
}
