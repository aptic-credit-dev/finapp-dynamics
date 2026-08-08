/**
 * PlatformMetadataService — the governed platform-metadata catalog (controlled categories only; NOT a tenant/identity
 * mirror, NOT an ungoverned key/value dump). Every mutation is authorized (default deny; a platform-scoped mutation
 * additionally requires the control-plane `platform.administer`) and audited. Values are bounded json; no secrets.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M30_PERMISSIONS } from './permissions.ts';
import { M30_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { clampPage, isMetadataCategory, isPlatformScope, isScope, REASON_CODES } from './domain.ts';
import { PlatformRepository, type MetadataRow } from './repository.ts';
import type { M30Emitter } from './emit.ts';

export class PlatformMetadataService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M30Emitter;
  private readonly repo: PlatformRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M30Emitter,
    repo: PlatformRepository = new PlatformRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M30_PERMISSIONS.administer);
  }

  async registerMetadata(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      category: string;
      metaKey: string;
      value?: unknown;
      idempotencyKey?: string | null;
    },
  ): Promise<MetadataRow> {
    await this.authz.require(ctx, M30_PERMISSIONS.metadataManage);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    if (!isMetadataCategory(input.category))
      throw badRequest('unknown metadata category.', ctx.correlationId);
    if (input.metaKey.trim() === '') throw badRequest('a metadata key is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findMetadataByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const meta = await this.repo.insertMetadata(tx, {
        tenantId: ctx.tenantId,
        scope,
        category: input.category,
        metaKey: input.metaKey,
        valueJson: input.value ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M30_AUDIT_CODES.metadataUpdated,
        entityType: 'platform_metadata',
        entityId: meta.id,
        detail: { scope, category: input.category, metaKey: input.metaKey },
      });
      await this.emitter.publishPlatform(tx, 'MetadataUpdated', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: meta.id,
          recordType: 'metadata',
          key: input.metaKey,
          scope,
          category: input.category,
          reasonCode: REASON_CODES.metadataUpdated,
        },
      });
      return meta;
    });
  }

  async updateMetadata(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    value: unknown,
  ): Promise<MetadataRow> {
    await this.authz.require(ctx, M30_PERMISSIONS.metadataManage);
    return this.db.withTenant(ctx, async (tx) => {
      const current = await this.repo.updateMetadata(tx, {
        id,
        expectedVersion,
        valueJson: value ?? null,
        by: actor,
      });
      if (current === null) throw ProblemError.conflict('Metadata modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M30_AUDIT_CODES.metadataUpdated,
        entityType: 'platform_metadata',
        entityId: id,
        detail: { metaKey: current.meta_key },
      });
      return current;
    });
  }

  async listMetadata(ctx: RequestContext, page: { limit?: number; offset?: number }): Promise<MetadataRow[]> {
    await this.authz.require(ctx, M30_PERMISSIONS.metadataRead);
    const p = clampPage(page.limit, page.offset);
    return this.db.withTenant(ctx, (tx) => this.repo.listMetadata(tx, p.limit, p.offset));
  }
}
