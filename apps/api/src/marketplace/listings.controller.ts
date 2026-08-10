import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { ListingService, M34_PERMISSIONS, M34_AUDIT_CODES } from '@finapp/m34-marketplace';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { listingView, capabilityView } from './views.ts';

/**
 * Marketplace LISTINGS under `/api/v1/connectors` — the connector catalog over m33 connectors. Authoring + capability
 * declaration are unprivileged; listing PUBLICATION (a controlled maker-checker action, requires the connector to be
 * published in m33) is privileged and audited. Reads carry no `@Endpoint` — the read permission is enforced in-service.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('connectors')
export class MarketplaceListingsController {
  private readonly listings: ListingService;
  private readonly actors: ActorContextFactory;
  constructor(listings: ListingService, actors: ActorContextFactory) {
    this.listings = listings;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M34_PERMISSIONS.listingAuthor,
    auditCode: M34_AUDIT_CODES.listingDefined,
    description: 'Define a marketplace listing over an m33 connector (draft).',
  })
  @Post('listings')
  async defineListing(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'define marketplace listing (m34)');
    const l = await this.listings.defineListing(s.ctx, s.actor.identityId, {
      listingKey: requireString(b['listingKey'], 'listingKey', s.correlationId),
      connectorRef: requireString(b['connectorRef'], 'connectorRef', s.correlationId),
      title: requireString(b['title'], 'title', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      ...optStr(b['category'], 'category'),
      ...optStr(b['visibility'], 'visibility'),
      ...optStr(b['publisher'], 'publisher'),
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return listingView(l);
  }

  @Get('listings')
  async listListings(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'browse marketplace listings (m34)');
    const rows = await this.listings.listListings(s.ctx, {});
    return { listings: rows.map(listingView) };
  }

  @Endpoint({
    permission: M34_PERMISSIONS.listingAuthor,
    auditCode: M34_AUDIT_CODES.capabilityAdded,
    description: 'Declare an opaque m33 capability a listing exposes.',
  })
  @Post('listings/:id/capabilities')
  async addCapability(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add listing capability (m34)');
    const cap = await this.listings.addCapability(s.ctx, s.actor.identityId, id, {
      capabilityRef: requireString(b['capabilityRef'], 'capabilityRef', s.correlationId),
      ...optStr(b['requiredScope'], 'requiredScope'),
    });
    return capabilityView(cap);
  }

  @Endpoint({
    permission: M34_PERMISSIONS.listingAuthor,
    auditCode: M34_AUDIT_CODES.listingValidated,
    description: 'Validate a listing.',
  })
  @Post('listings/:id/validate')
  async validateListing(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'validate marketplace listing (m34)');
    const out = await this.listings.validateListing(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return { passed: out.passed, findings: out.findings };
  }

  @Endpoint({
    permission: M34_PERMISSIONS.listingAuthor,
    auditCode: M34_AUDIT_CODES.reviewRequested,
    description: 'Send a validated listing for review.',
  })
  @Post('listings/:id/review')
  async reviewListing(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'request listing review (m34)');
    const l = await this.listings.requestReview(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return listingView(l);
  }

  @Endpoint({
    permission: M34_PERMISSIONS.listingPublish,
    auditCode: M34_AUDIT_CODES.listingPublished,
    description: 'Publish a listing (maker-checker; connector must be published in m33).',
  })
  @Post('listings/:id/publish')
  async publishListing(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'publish marketplace listing (m34)');
    const l = await this.listings.publishListing(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return listingView(l);
  }
}
