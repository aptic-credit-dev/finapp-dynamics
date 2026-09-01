/**
 * ProductService — the governed API PRODUCT catalog + gateway FACADE: define a product (over an internal API, an m33
 * connector or an m34 marketplace listing referenced by OPAQUE id), declare the ALLOW-LISTED operations it exposes (each
 * carrying the m02 permission it requires — the facade NEVER exposes an operation without its RBAC permission), validate
 * (fail closed), and PUBLISH it (a controlled action — maker-checker/SoD + a PUBLIC product needs the control-plane
 * permission + the source must be PUBLISHED upstream, checked through the fail-closed CatalogSourcePort; a published product
 * is immutable via DB trigger; publishing a new version deprecates the prior). Every mutation authorizes a `devportal.*`
 * permission (default deny) and is audited through m03 in the same transaction. m35 never reads an m33/m34 table.
 */
import { createHash } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M35_PERMISSIONS } from './permissions.ts';
import { M35_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden, versionConflict } from './errors.ts';
import {
  isScope,
  isPlatformScope,
  isCategory,
  isVisibility,
  isSourceKind,
  isPublicVisibility,
  isThreeSegmentPermission,
  validateProduct,
  evaluateSodGate,
  evaluatePublishGate,
  clampPage,
  REASON_CODES,
} from './domain.ts';
import {
  DevportalRepository,
  type ProductRow,
  type ProductScopeRow,
  type ProductReadRow,
} from './repository.ts';
import type { M35Emitter } from './emit.ts';
import type { CatalogSourcePort } from './ports.ts';

export function contentHashOf(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex')}`;
}

export class ProductService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M35Emitter;
  private readonly sources: CatalogSourcePort;
  private readonly repo: DevportalRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M35Emitter,
    sources: CatalogSourcePort,
    repo: DevportalRepository = new DevportalRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.sources = sources;
    this.repo = repo;
  }
  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M35_PERMISSIONS.administer);
  }

  async defineProduct(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      productKey: string;
      title: string;
      summary?: string | null;
      category?: string;
      visibility?: string;
      sourceKind?: string;
      sourceRef?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<ProductRow> {
    await this.authz.require(ctx, M35_PERMISSIONS.productAuthor);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    const category = input.category ?? 'custom';
    const visibility = input.visibility ?? 'tenant';
    const sourceKind = input.sourceKind ?? 'internal';
    if (!isCategory(category)) throw badRequest('unknown category.', ctx.correlationId);
    if (!isVisibility(visibility)) throw badRequest('unknown visibility.', ctx.correlationId);
    if (!isSourceKind(sourceKind)) throw badRequest('unknown source kind.', ctx.correlationId);
    if (input.productKey.trim() === '' || input.title.trim() === '')
      throw badRequest('a product key and title are required.', ctx.correlationId);
    if (sourceKind !== 'internal' && (input.sourceRef == null || input.sourceRef.trim() === ''))
      throw badRequest('a connector/marketplace product requires a source reference.', ctx.correlationId);
    const sourceRef = sourceKind === 'internal' ? null : (input.sourceRef ?? null);
    const contentHash = contentHashOf({
      productKey: input.productKey,
      category,
      visibility,
      sourceKind,
      sourceRef,
    });
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findProductByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const product = await this.repo.insertProduct(tx, {
        tenantId: ctx.tenantId,
        scope,
        productKey: input.productKey,
        title: input.title,
        summary: input.summary ?? null,
        category,
        visibility,
        sourceKind,
        sourceRef,
        contentHash,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'product',
        targetId: product.id,
        fromStatus: null,
        toStatus: 'draft',
        reason: null,
        reasonCode: REASON_CODES.productDefined,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M35_AUDIT_CODES.productDefined,
        entityType: 'devportal_api_product',
        entityId: product.id,
        detail: { productKey: input.productKey, category, scope, sourceKind },
      });
      return product;
    });
  }

  /** Declare an ALLOW-LISTED operation a product exposes + the m02 permission it REQUIRES (the facade rule). */
  async addScope(
    ctx: RequestContext,
    actor: string | null,
    productId: string,
    input: { operationRef: string; requiredPermission: string; description?: string | null },
  ): Promise<ProductScopeRow> {
    await this.authz.require(ctx, M35_PERMISSIONS.productAuthor);
    if (input.operationRef.trim() === '')
      throw badRequest('an operation reference is required.', ctx.correlationId);
    if (!isThreeSegmentPermission(input.requiredPermission))
      throw badRequest(
        'an exposed operation must carry a 3-segment m02 permission (the facade never bypasses RBAC).',
        ctx.correlationId,
      );
    return this.db.withTenant(ctx, async (tx) => {
      const product = await this.repo.getProduct(tx, productId);
      if (product === null) throw badRequest('unknown product.', ctx.correlationId);
      if (product.state !== 'draft')
        throw badRequest('operations can only be added while the product is a draft.', ctx.correlationId);
      const scope = await this.repo.insertProductScope(tx, {
        tenantId: ctx.tenantId,
        productId,
        operationRef: input.operationRef,
        requiredPermission: input.requiredPermission,
        description: input.description ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M35_AUDIT_CODES.scopeAdded,
        entityType: 'devportal_product_scope',
        entityId: scope.id,
        detail: { productId, operationRef: input.operationRef, requiredPermission: input.requiredPermission },
      });
      return scope;
    });
  }

  async validateProductById(
    ctx: RequestContext,
    actor: string | null,
    productId: string,
    expectedVersion: number,
  ): Promise<{ passed: boolean; findings: readonly { code: string; ref?: string }[] }> {
    await this.authz.require(ctx, M35_PERMISSIONS.productAuthor);
    return this.db.withTenant(ctx, async (tx) => {
      const product = await this.repo.getProduct(tx, productId);
      if (product === null) throw badRequest('unknown product.', ctx.correlationId);
      const scopes = await this.repo.listProductScopes(tx, productId);
      const outcome = validateProduct({
        productKey: product.product_key,
        category: product.category,
        visibility: product.visibility,
        sourceKind: product.source_kind,
        operations: scopes.map((s) => ({
          operationRef: s.operation_ref,
          requiredPermission: s.required_permission,
        })),
      });
      if (outcome.passed) {
        const moved = await this.repo.updateProductState(tx, productId, expectedVersion, {
          state: 'validated',
          validationPassed: true,
          by: actor,
        });
        if (moved === null) throw versionConflict(ctx.correlationId);
        await this.emitter.recordAudit(tx, ctx, {
          code: M35_AUDIT_CODES.productValidated,
          entityType: 'devportal_api_product',
          entityId: productId,
          detail: { productKey: product.product_key, operationCount: scopes.length },
        });
      } else {
        await this.emitter.recordAudit(tx, ctx, {
          code: M35_AUDIT_CODES.publishBlocked,
          entityType: 'devportal_api_product',
          entityId: productId,
          detail: { reasonCode: REASON_CODES.validationFailed },
        });
      }
      return outcome;
    });
  }

  async requestReview(
    ctx: RequestContext,
    actor: string | null,
    productId: string,
    expectedVersion: number,
  ): Promise<ProductRow> {
    await this.authz.require(ctx, M35_PERMISSIONS.productAuthor);
    if (actor === null || actor.trim() === '')
      throw badRequest('an identified requester is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const product = await this.repo.getProduct(tx, productId);
      if (product === null) throw badRequest('unknown product.', ctx.correlationId);
      if (product.state !== 'validated')
        throw badRequest('only a validated product can be sent for review.', ctx.correlationId);
      const moved = await this.repo.updateProductState(tx, productId, expectedVersion, {
        state: 'review_pending',
        validationPassed: true,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'product',
        targetId: productId,
        kind: 'requested',
        requestedBy: actor,
        decidedBy: null,
        reason: null,
        reasonCode: REASON_CODES.reviewRequested,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M35_AUDIT_CODES.reviewRequested,
        entityType: 'devportal_api_product',
        entityId: productId,
        detail: { productKey: product.product_key },
      });
      return moved;
    });
  }

  /** PUBLISH a product — a controlled action (maker-checker/SoD + a PUBLIC product needs the control-plane permission + the
   * source must be PUBLISHED upstream in m33/m34). Deprecates the prior published product of the same key. AI never approves. */
  async publishProduct(
    ctx: RequestContext,
    actor: string | null,
    productId: string,
    expectedVersion: number,
  ): Promise<ProductRow> {
    await this.authz.require(ctx, M35_PERMISSIONS.productPublish);
    // Phase 1 — load + gate (SoD/validation + public-exposure control-plane permission).
    const prepared = await this.db.withTenant(ctx, async (tx) => {
      const product = await this.repo.getProduct(tx, productId);
      if (product === null) throw badRequest('unknown product.', ctx.correlationId);
      await this.authorizeScope(ctx, product.scope);
      if (product.state !== 'review_pending')
        throw badRequest('only a product in review can be published.', ctx.correlationId);
      // PUBLIC exposure requires the cross-tenant control-plane permission (a tenant admin never holds it by default).
      if (isPublicVisibility(product.visibility)) {
        try {
          await this.authz.require(ctx, M35_PERMISSIONS.administer);
        } catch {
          await this.emitter.recordAudit(tx, ctx, {
            code: M35_AUDIT_CODES.exposureBlocked,
            entityType: 'devportal_api_product',
            entityId: productId,
            detail: { reasonCode: REASON_CODES.publicExposureForbidden },
          });
          throw governanceForbidden(REASON_CODES.publicExposureForbidden, ctx.correlationId);
        }
      }
      const request = await this.repo.findOpenReviewRequest(tx, 'product', productId);
      const gate = evaluatePublishGate({
        validationPassed: product.validation_passed,
        requestedBy: request?.requested_by ?? '',
        approver: actor,
      });
      if (!gate.allowed) {
        const code =
          gate.reasonCode === REASON_CODES.selfApproval || gate.reasonCode === REASON_CODES.notHumanApprover
            ? M35_AUDIT_CODES.sodBlocked
            : M35_AUDIT_CODES.publishBlocked;
        await this.emitter.recordAudit(tx, ctx, {
          code,
          entityType: 'devportal_api_product',
          entityId: productId,
          detail: { reasonCode: gate.reasonCode },
        });
        throw governanceForbidden(gate.reasonCode, ctx.correlationId);
      }
      return { product, requestedBy: request?.requested_by ?? '' };
    });

    // Phase 2 — the source must be PUBLISHED upstream in m33/m34 (fail closed; internal is intrinsically available).
    const avail = await this.sources.isSourcePublishable(
      ctx,
      prepared.product.source_kind,
      prepared.product.source_ref ?? '',
    );
    if (!avail.available) {
      await this.db.withTenant(ctx, (tx) =>
        this.emitter.recordAudit(tx, ctx, {
          code: M35_AUDIT_CODES.publishBlocked,
          entityType: 'devportal_api_product',
          entityId: productId,
          detail: { reasonCode: REASON_CODES.sourceUnavailable },
        }),
      );
      throw governanceForbidden(REASON_CODES.sourceUnavailable, ctx.correlationId);
    }

    // Phase 3 — deprecate prior + publish.
    return this.db.withTenant(ctx, async (tx) => {
      const prior = await this.repo.getPublishedProductByKey(
        tx,
        prepared.product.scope,
        prepared.product.product_key,
      );
      if (prior !== null && prior.id !== productId) {
        const dep = await this.repo.updateProductState(tx, prior.id, prior.version, {
          state: 'deprecated',
          validationPassed: prior.validation_passed,
          by: actor,
        });
        if (dep === null) throw versionConflict(ctx.correlationId);
        await this.emitter.recordAudit(tx, ctx, {
          code: M35_AUDIT_CODES.productDeprecated,
          entityType: 'devportal_api_product',
          entityId: prior.id,
          detail: { productKey: prepared.product.product_key },
        });
        await this.emitter.publishDevportal(tx, 'ProductDeprecated', {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: {
            recordId: prior.id,
            recordType: 'product',
            productKey: prepared.product.product_key,
            toStatus: 'deprecated',
            reasonCode: REASON_CODES.deprecated,
          },
        });
      }
      const published = await this.repo.updateProductState(tx, productId, expectedVersion, {
        state: 'published',
        validationPassed: true,
        by: actor,
      });
      if (published === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'product',
        targetId: productId,
        kind: 'approved',
        requestedBy: prepared.requestedBy,
        decidedBy: actor,
        reason: null,
        reasonCode: REASON_CODES.published,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'product',
        targetId: productId,
        fromStatus: 'review_pending',
        toStatus: 'published',
        reason: null,
        reasonCode: REASON_CODES.published,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M35_AUDIT_CODES.productPublished,
        entityType: 'devportal_api_product',
        entityId: productId,
        detail: {
          productKey: prepared.product.product_key,
          visibility: prepared.product.visibility,
          sourceKind: prepared.product.source_kind,
        },
      });
      await this.emitter.publishDevportal(tx, 'ProductPublished', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: productId,
          recordType: 'product',
          productKey: prepared.product.product_key,
          category: prepared.product.category,
          scope: prepared.product.scope,
          toStatus: 'published',
          reasonCode: REASON_CODES.published,
        },
      });
      return published;
    });
  }

  async rejectReview(
    ctx: RequestContext,
    actor: string | null,
    productId: string,
    expectedVersion: number,
    reason: string | null = null,
  ): Promise<ProductRow> {
    await this.authz.require(ctx, M35_PERMISSIONS.productPublish);
    return this.db.withTenant(ctx, async (tx) => {
      const product = await this.repo.getProduct(tx, productId);
      if (product === null) throw badRequest('unknown product.', ctx.correlationId);
      if (product.state !== 'review_pending')
        throw badRequest('only a product in review can be rejected.', ctx.correlationId);
      const request = await this.repo.findOpenReviewRequest(tx, 'product', productId);
      const sod = evaluateSodGate(request?.requested_by ?? '', actor);
      if (!sod.allowed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M35_AUDIT_CODES.sodBlocked,
          entityType: 'devportal_api_product',
          entityId: productId,
          detail: { reasonCode: sod.reasonCode },
        });
        throw governanceForbidden(sod.reasonCode, ctx.correlationId);
      }
      const moved = await this.repo.updateProductState(tx, productId, expectedVersion, {
        state: 'rejected',
        validationPassed: product.validation_passed,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'product',
        targetId: productId,
        kind: 'rejected',
        requestedBy: request?.requested_by ?? '',
        decidedBy: actor,
        reason,
        reasonCode: REASON_CODES.rejected,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M35_AUDIT_CODES.reviewRejected,
        entityType: 'devportal_api_product',
        entityId: productId,
        detail: {},
      });
      return moved;
    });
  }

  async getProduct(ctx: RequestContext, id: string): Promise<ProductRow | null> {
    await this.authz.require(ctx, M35_PERMISSIONS.productRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getProduct(tx, id));
  }
  async listProducts(ctx: RequestContext, page?: { limit?: number; offset?: number }): Promise<ProductRow[]> {
    await this.authz.require(ctx, M35_PERMISSIONS.productRead);
    const { limit, offset } = clampPage(page?.limit, page?.offset);
    return this.db.withTenant(ctx, (tx) => this.repo.listProducts(tx, limit, offset));
  }
  /** Read-model: the product + its safe descriptive/lifecycle metadata (developer-portal catalog detail). */
  async getProductRead(ctx: RequestContext, id: string): Promise<ProductReadRow | null> {
    await this.authz.require(ctx, M35_PERMISSIONS.productRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getProductRead(tx, id));
  }
  /** Read-model: the ALLOW-LISTED operations a product exposes + the m02 permission each requires (facade rule). */
  async listScopes(ctx: RequestContext, productId: string): Promise<ProductScopeRow[]> {
    await this.authz.require(ctx, M35_PERMISSIONS.productRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listProductScopes(tx, productId));
  }
}
