import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { AccessService, M09_AUDIT_CODES, M09_PERMISSIONS } from '@finapp/m09-docs';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { grantView, checkoutView, relationshipView } from './views.ts';

/**
 * Document ACL grants, checkouts, and relationships, under `/api/v1/documents`. Grants supplement RBAC; checkout
 * is a single-winner lease; relationships are acyclic where required. Permission enforced in `AccessService`.
 */
interface GrantBody {
  granteeKind?: unknown;
  granteeRef?: unknown;
  accessLevel?: unknown;
}
interface ActionBody {
  expectedVersion?: unknown;
  force?: unknown;
}
interface RelBody {
  fromDocumentId?: unknown;
  toDocumentId?: unknown;
  relationshipType?: unknown;
}

@Controller('documents')
export class DocumentAccessController {
  private readonly service: AccessService;
  private readonly actors: ActorContextFactory;
  constructor(service: AccessService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M09_PERMISSIONS.accessGrant,
    auditCode: M09_AUDIT_CODES.accessGranted,
    description: 'Grant document-scoped access.',
  })
  @Post('documents/:id/grants')
  async grant(@Param('id') id: string, @Body() b: GrantBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'grant document access (m09)');
    return grantView(
      await this.service.grant(s.ctx, s.actor.identityId, id, {
        granteeKind: requireString(b.granteeKind, 'granteeKind', s.correlationId),
        granteeRef: requireString(b.granteeRef, 'granteeRef', s.correlationId),
        accessLevel: requireString(b.accessLevel, 'accessLevel', s.correlationId),
      }),
    );
  }
  @Endpoint({
    permission: M09_PERMISSIONS.accessRevoke,
    auditCode: M09_AUDIT_CODES.accessRevoked,
    description: 'Revoke a document access grant.',
  })
  @Post('grants/:id/revoke')
  async revoke(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'revoke document access (m09)');
    return grantView(
      await this.service.revoke(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('documents/:id/grants')
  async listGrants(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list document grants (m09)');
    return { grants: (await this.service.listGrants(s.ctx, id)).map(grantView) };
  }

  @Endpoint({
    permission: M09_PERMISSIONS.checkoutAcquire,
    auditCode: M09_AUDIT_CODES.checkoutAcquired,
    description: 'Check out a document for editing.',
  })
  @Post('documents/:id/checkout')
  async checkout(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'checkout document (m09)');
    return checkoutView(
      await this.service.checkout(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M09_PERMISSIONS.checkoutRelease,
    auditCode: M09_AUDIT_CODES.checkoutReleased,
    description: 'Release a document checkout.',
  })
  @Post('documents/:id/checkin')
  async checkin(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'release checkout (m09)');
    return checkoutView(await this.service.releaseCheckout(s.ctx, s.actor.identityId, id, b.force === true));
  }

  @Endpoint({
    permission: M09_PERMISSIONS.relationshipManage,
    auditCode: M09_AUDIT_CODES.relationshipCreated,
    description: 'Create a document relationship.',
  })
  @Post('relationships')
  async addRelationship(@Body() b: RelBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'add document relationship (m09)');
    return relationshipView(
      await this.service.addRelationship(s.ctx, s.actor.identityId, {
        fromDocumentId: requireString(b.fromDocumentId, 'fromDocumentId', s.correlationId),
        toDocumentId: requireString(b.toDocumentId, 'toDocumentId', s.correlationId),
        relationshipType: requireString(b.relationshipType, 'relationshipType', s.correlationId),
      }),
    );
  }
  @Endpoint({
    permission: M09_PERMISSIONS.relationshipManage,
    auditCode: M09_AUDIT_CODES.relationshipRemoved,
    description: 'Remove a document relationship.',
  })
  @Post('relationships/:id/remove')
  async removeRelationship(
    @Param('id') id: string,
    @Body() b: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'remove document relationship (m09)');
    return relationshipView(
      await this.service.removeRelationship(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Get('documents/:id/relationships')
  async listRelationships(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list document relationships (m09)');
    return { relationships: (await this.service.listRelationships(s.ctx, id)).map(relationshipView) };
  }
}
