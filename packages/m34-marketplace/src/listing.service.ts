/**
 * ListingService — the governed marketplace catalog: define a listing over an m33 connector, add the opaque capabilities
 * it exposes, validate (fail closed), and PUBLISH it (a controlled action — maker-checker/SoD + the connector must be
 * available/PUBLISHED in m33, checked through the fail-closed ConnectorRegistryPort; a published listing is immutable via
 * DB trigger; publishing a new version deprecates the prior one). Every mutation authorizes a `marketplace.*` permission
 * (default deny) and is audited through m03 in the same transaction. m34 never reads m33 tables (opaque refs only).
 */
import { createHash } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M34_PERMISSIONS } from './permissions.ts';
import { M34_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden, versionConflict } from './errors.ts';
import {
  isScope,
  isPlatformScope,
  isCategory,
  isVisibility,
  isConsentScope,
  validateListing,
  evaluateSodGate,
  evaluatePublishGate,
  clampPage,
  REASON_CODES,
} from './domain.ts';
import { MarketplaceRepository, type ListingRow, type ListingCapabilityRow } from './repository.ts';
import type { M34Emitter } from './emit.ts';
import type { ConnectorRegistryPort } from './ports.ts';

export function contentHashOf(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex')}`;
}

export class ListingService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M34Emitter;
  private readonly registry: ConnectorRegistryPort;
  private readonly repo: MarketplaceRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M34Emitter,
    registry: ConnectorRegistryPort,
    repo: MarketplaceRepository = new MarketplaceRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.registry = registry;
    this.repo = repo;
  }
  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M34_PERMISSIONS.administer);
  }

  async defineListing(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      listingKey: string;
      connectorRef: string;
      title: string;
      summary?: string | null;
      category?: string;
      publisher?: string | null;
      visibility?: string;
      idempotencyKey?: string | null;
    },
  ): Promise<ListingRow> {
    await this.authz.require(ctx, M34_PERMISSIONS.listingAuthor);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    const category = input.category ?? 'custom';
    const visibility = input.visibility ?? 'tenant';
    if (!isCategory(category)) throw badRequest('unknown category.', ctx.correlationId);
    if (!isVisibility(visibility)) throw badRequest('unknown visibility.', ctx.correlationId);
    if (input.listingKey.trim() === '' || input.connectorRef.trim() === '')
      throw badRequest('a listing key and connector reference are required.', ctx.correlationId);
    const contentHash = contentHashOf({
      listingKey: input.listingKey,
      connectorRef: input.connectorRef,
      category,
      visibility,
    });
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findListingByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const listing = await this.repo.insertListing(tx, {
        tenantId: ctx.tenantId,
        scope,
        listingKey: input.listingKey,
        connectorRef: input.connectorRef,
        title: input.title,
        summary: input.summary ?? null,
        category,
        publisher: input.publisher ?? null,
        visibility,
        contentHash,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'listing',
        targetId: listing.id,
        fromStatus: null,
        toStatus: 'draft',
        reason: null,
        reasonCode: REASON_CODES.listingDefined,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M34_AUDIT_CODES.listingDefined,
        entityType: 'marketplace_listing',
        entityId: listing.id,
        detail: { listingKey: input.listingKey, connectorRef: input.connectorRef, category, scope },
      });
      return listing;
    });
  }

  /** Add an opaque m33 capability a listing exposes + the consent scope it requires (declarative reference only). */
  async addCapability(
    ctx: RequestContext,
    actor: string | null,
    listingId: string,
    input: { capabilityRef: string; requiredScope?: string; description?: string | null },
  ): Promise<ListingCapabilityRow> {
    await this.authz.require(ctx, M34_PERMISSIONS.listingAuthor);
    const requiredScope = input.requiredScope ?? 'read';
    if (!isConsentScope(requiredScope)) throw badRequest('unknown required scope.', ctx.correlationId);
    if (input.capabilityRef.trim() === '')
      throw badRequest('a capability reference is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const listing = await this.repo.getListing(tx, listingId);
      if (listing === null) throw badRequest('unknown listing.', ctx.correlationId);
      const cap = await this.repo.insertListingCapability(tx, {
        tenantId: ctx.tenantId,
        listingId,
        capabilityRef: input.capabilityRef,
        requiredScope,
        description: input.description ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M34_AUDIT_CODES.capabilityAdded,
        entityType: 'marketplace_listing_capability',
        entityId: cap.id,
        detail: { listingId, capabilityRef: input.capabilityRef, requiredScope },
      });
      return cap;
    });
  }

  async validateListing(
    ctx: RequestContext,
    actor: string | null,
    listingId: string,
    expectedVersion: number,
  ): Promise<{ passed: boolean; findings: readonly { code: string; ref?: string }[] }> {
    await this.authz.require(ctx, M34_PERMISSIONS.listingAuthor);
    return this.db.withTenant(ctx, async (tx) => {
      const listing = await this.repo.getListing(tx, listingId);
      if (listing === null) throw badRequest('unknown listing.', ctx.correlationId);
      const outcome = validateListing({
        listingKey: listing.listing_key,
        connectorRef: listing.connector_ref,
        category: listing.category,
        visibility: listing.visibility,
      });
      if (outcome.passed) {
        const moved = await this.repo.updateListingState(tx, listingId, expectedVersion, {
          state: 'validated',
          validationPassed: true,
          by: actor,
        });
        if (moved === null) throw versionConflict(ctx.correlationId);
        await this.emitter.recordAudit(tx, ctx, {
          code: M34_AUDIT_CODES.listingValidated,
          entityType: 'marketplace_listing',
          entityId: listingId,
          detail: { listingKey: listing.listing_key },
        });
      } else {
        await this.emitter.recordAudit(tx, ctx, {
          code: M34_AUDIT_CODES.publishBlocked,
          entityType: 'marketplace_listing',
          entityId: listingId,
          detail: { reasonCode: REASON_CODES.validationFailed },
        });
      }
      return outcome;
    });
  }

  async requestReview(
    ctx: RequestContext,
    actor: string | null,
    listingId: string,
    expectedVersion: number,
  ): Promise<ListingRow> {
    await this.authz.require(ctx, M34_PERMISSIONS.listingAuthor);
    if (actor === null || actor.trim() === '')
      throw badRequest('an identified requester is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const listing = await this.repo.getListing(tx, listingId);
      if (listing === null) throw badRequest('unknown listing.', ctx.correlationId);
      if (listing.state !== 'validated')
        throw badRequest('only a validated listing can be sent for review.', ctx.correlationId);
      const moved = await this.repo.updateListingState(tx, listingId, expectedVersion, {
        state: 'review_pending',
        validationPassed: true,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'listing',
        targetId: listingId,
        kind: 'requested',
        requestedBy: actor,
        decidedBy: null,
        reason: null,
        reasonCode: REASON_CODES.reviewRequested,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M34_AUDIT_CODES.reviewRequested,
        entityType: 'marketplace_listing',
        entityId: listingId,
        detail: { listingKey: listing.listing_key },
      });
      return moved;
    });
  }

  /** PUBLISH a listing — a controlled action (maker-checker/SoD + the connector must be PUBLISHED in m33). Deprecates the
   * prior published listing of the same key. AI never approves. */
  async publishListing(
    ctx: RequestContext,
    actor: string | null,
    listingId: string,
    expectedVersion: number,
  ): Promise<ListingRow> {
    await this.authz.require(ctx, M34_PERMISSIONS.listingPublish);
    // Phase 1 — load + gate (SoD/validation).
    const prepared = await this.db.withTenant(ctx, async (tx) => {
      const listing = await this.repo.getListing(tx, listingId);
      if (listing === null) throw badRequest('unknown listing.', ctx.correlationId);
      await this.authorizeScope(ctx, listing.scope);
      if (listing.state !== 'review_pending')
        throw badRequest('only a listing in review can be published.', ctx.correlationId);
      const request = await this.repo.findOpenReviewRequest(tx, 'listing', listingId);
      const gate = evaluatePublishGate({
        validationPassed: listing.validation_passed,
        requestedBy: request?.requested_by ?? '',
        approver: actor,
      });
      if (!gate.allowed) {
        const code =
          gate.reasonCode === REASON_CODES.selfApproval || gate.reasonCode === REASON_CODES.notHumanApprover
            ? M34_AUDIT_CODES.sodBlocked
            : M34_AUDIT_CODES.publishBlocked;
        await this.emitter.recordAudit(tx, ctx, {
          code,
          entityType: 'marketplace_listing',
          entityId: listingId,
          detail: { reasonCode: gate.reasonCode },
        });
        throw governanceForbidden(gate.reasonCode, ctx.correlationId);
      }
      return { listing, requestedBy: request?.requested_by ?? '' };
    });

    // Phase 2 — the connector must be available (PUBLISHED) in m33 (fail closed).
    const avail = await this.registry.isConnectorAvailable(ctx, prepared.listing.connector_ref);
    if (!avail.available) {
      await this.db.withTenant(ctx, (tx) =>
        this.emitter.recordAudit(tx, ctx, {
          code: M34_AUDIT_CODES.publishBlocked,
          entityType: 'marketplace_listing',
          entityId: listingId,
          detail: { reasonCode: REASON_CODES.connectorUnavailable },
        }),
      );
      throw governanceForbidden(REASON_CODES.connectorUnavailable, ctx.correlationId);
    }

    // Phase 3 — deprecate prior + publish.
    return this.db.withTenant(ctx, async (tx) => {
      const prior = await this.repo.getPublishedListingByKey(
        tx,
        prepared.listing.scope,
        prepared.listing.listing_key,
      );
      if (prior !== null && prior.id !== listingId) {
        const dep = await this.repo.updateListingState(tx, prior.id, prior.version, {
          state: 'deprecated',
          validationPassed: prior.validation_passed,
          by: actor,
        });
        if (dep === null) throw versionConflict(ctx.correlationId);
        await this.emitter.recordAudit(tx, ctx, {
          code: M34_AUDIT_CODES.listingDeprecated,
          entityType: 'marketplace_listing',
          entityId: prior.id,
          detail: { listingKey: prepared.listing.listing_key },
        });
        await this.emitter.publishMarketplace(tx, 'ListingDeprecated', {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: {
            recordId: prior.id,
            recordType: 'listing',
            listingKey: prepared.listing.listing_key,
            toStatus: 'deprecated',
            reasonCode: REASON_CODES.deprecated,
          },
        });
      }
      const published = await this.repo.updateListingState(tx, listingId, expectedVersion, {
        state: 'published',
        validationPassed: true,
        by: actor,
      });
      if (published === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'listing',
        targetId: listingId,
        kind: 'approved',
        requestedBy: prepared.requestedBy,
        decidedBy: actor,
        reason: null,
        reasonCode: REASON_CODES.published,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'listing',
        targetId: listingId,
        fromStatus: 'review_pending',
        toStatus: 'published',
        reason: null,
        reasonCode: REASON_CODES.published,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M34_AUDIT_CODES.listingPublished,
        entityType: 'marketplace_listing',
        entityId: listingId,
        detail: { listingKey: prepared.listing.listing_key, connectorRef: prepared.listing.connector_ref },
      });
      await this.emitter.publishMarketplace(tx, 'ListingPublished', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: listingId,
          recordType: 'listing',
          listingKey: prepared.listing.listing_key,
          connectorRef: prepared.listing.connector_ref,
          category: prepared.listing.category,
          scope: prepared.listing.scope,
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
    listingId: string,
    expectedVersion: number,
    reason: string | null = null,
  ): Promise<ListingRow> {
    await this.authz.require(ctx, M34_PERMISSIONS.listingPublish);
    return this.db.withTenant(ctx, async (tx) => {
      const listing = await this.repo.getListing(tx, listingId);
      if (listing === null) throw badRequest('unknown listing.', ctx.correlationId);
      if (listing.state !== 'review_pending')
        throw badRequest('only a listing in review can be rejected.', ctx.correlationId);
      const request = await this.repo.findOpenReviewRequest(tx, 'listing', listingId);
      const sod = evaluateSodGate(request?.requested_by ?? '', actor);
      if (!sod.allowed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M34_AUDIT_CODES.sodBlocked,
          entityType: 'marketplace_listing',
          entityId: listingId,
          detail: { reasonCode: sod.reasonCode },
        });
        throw governanceForbidden(sod.reasonCode, ctx.correlationId);
      }
      const moved = await this.repo.updateListingState(tx, listingId, expectedVersion, {
        state: 'rejected',
        validationPassed: listing.validation_passed,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'listing',
        targetId: listingId,
        kind: 'rejected',
        requestedBy: request?.requested_by ?? '',
        decidedBy: actor,
        reason,
        reasonCode: REASON_CODES.rejected,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M34_AUDIT_CODES.reviewRejected,
        entityType: 'marketplace_listing',
        entityId: listingId,
        detail: {},
      });
      return moved;
    });
  }

  async getListing(ctx: RequestContext, id: string): Promise<ListingRow | null> {
    await this.authz.require(ctx, M34_PERMISSIONS.listingRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getListing(tx, id));
  }
  async listListings(ctx: RequestContext, page?: { limit?: number; offset?: number }): Promise<ListingRow[]> {
    await this.authz.require(ctx, M34_PERMISSIONS.listingRead);
    const { limit, offset } = clampPage(page?.limit, page?.offset);
    return this.db.withTenant(ctx, (tx) => this.repo.listListings(tx, limit, offset));
  }
}
