/**
 * AccessService — document ACL grants (supplement to RBAC, ADR-048), edit-reservation checkouts (lease
 * semantics, single-winner), and typed document relationships (acyclic where required). Every mutation is
 * permissioned, audited, and (for grants + relationships) emits document.lifecycle. A document grant NEVER
 * replaces the M02 RBAC permission check — it narrows access to a specific document on top of it.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M09_PERMISSIONS } from './permissions.ts';
import { M09_AUDIT_CODES } from './audit-codes.ts';
import {
  isGranteeKind,
  isAccessLevel,
  isRelationshipType,
  assertAcyclic,
  ACYCLIC_TYPES,
} from './domain/relationships.ts';
import { DocError } from './domain/limits.ts';
import { DocsRepository, type AccessGrantRow, type CheckoutRow, type RelationshipRow } from './repository.ts';
import type { M09Emitter } from './emit.ts';
import { badRequest } from './errors.ts';

const PG_UNIQUE_VIOLATION = '23505';
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === PG_UNIQUE_VIOLATION;
}

export class AccessService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M09Emitter;
  private readonly repo: DocsRepository;
  private readonly leaseSeconds: number;

  constructor(
    db: Db,
    authz: Authz,
    emitter: M09Emitter,
    repo: DocsRepository = new DocsRepository(),
    leaseSeconds = 900,
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
    this.leaseSeconds = leaseSeconds;
  }

  // --- ACL grants -------------------------------------------------------------------------------
  async grant(
    ctx: RequestContext,
    actor: string | null,
    documentId: string,
    input: { granteeKind: string; granteeRef: string; accessLevel: string },
  ): Promise<AccessGrantRow> {
    await this.authz.require(ctx, M09_PERMISSIONS.accessGrant);
    if (!isGranteeKind(input.granteeKind)) throw badRequest('invalid grantee kind', ctx.correlationId);
    if (!isAccessLevel(input.accessLevel)) throw badRequest('invalid access level', ctx.correlationId);
    if (input.granteeRef.trim() === '') throw badRequest('grantee ref is required', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const doc = await this.repo.findDocument(tx, documentId);
      if (doc === null) throw ProblemError.notFound('Document not found.', ctx.correlationId);
      let row: AccessGrantRow;
      try {
        row = await this.repo.insertGrant(tx, {
          tenantId: ctx.tenantId,
          documentId,
          granteeKind: input.granteeKind,
          granteeRef: input.granteeRef,
          accessLevel: input.accessLevel,
          grantedBy: actor,
        });
      } catch (e) {
        if (isUniqueViolation(e))
          throw ProblemError.conflict('An identical active grant already exists.', ctx.correlationId);
        throw e;
      }
      await this.emitter.recordAudit(tx, ctx, {
        code: M09_AUDIT_CODES.accessGranted,
        entityType: 'document_access_grant',
        entityId: row.id,
        detail: { documentId, granteeKind: input.granteeKind, accessLevel: input.accessLevel },
      });
      await this.emitter.publish(tx, {
        type: 'DocumentAccessGranted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { documentId, grantId: row.id, granteeKind: input.granteeKind, action: 'granted' },
      });
      return row;
    });
  }

  async revoke(
    ctx: RequestContext,
    actor: string | null,
    grantId: string,
    expectedVersion: number,
  ): Promise<AccessGrantRow> {
    await this.authz.require(ctx, M09_PERMISSIONS.accessRevoke);
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await this.repo.findGrant(tx, grantId);
      if (existing === null) throw ProblemError.notFound('Grant not found.', ctx.correlationId);
      const upd = await this.repo.revokeGrant(tx, { id: grantId, expectedVersion, revokedBy: actor });
      if (upd === null)
        throw ProblemError.conflict('Grant already revoked or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M09_AUDIT_CODES.accessRevoked,
        entityType: 'document_access_grant',
        entityId: grantId,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'DocumentAccessRevoked',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          documentId: existing.document_id,
          grantId,
          granteeKind: existing.grantee_kind,
          action: 'revoked',
        },
      });
      return upd;
    });
  }

  async listGrants(ctx: RequestContext, documentId: string): Promise<AccessGrantRow[]> {
    await this.authz.require(ctx, M09_PERMISSIONS.accessRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listGrants(tx, documentId));
  }

  // --- checkout (lease, single-winner) ----------------------------------------------------------
  async checkout(
    ctx: RequestContext,
    actor: string | null,
    documentId: string,
    expectedVersion: number,
  ): Promise<CheckoutRow> {
    await this.authz.require(ctx, M09_PERMISSIONS.checkoutAcquire);
    if (actor === null) throw badRequest('an actor is required to check out', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const doc = await this.repo.findDocument(tx, documentId);
      if (doc === null) throw ProblemError.notFound('Document not found.', ctx.correlationId);
      await this.repo.releaseExpiredCheckouts(tx, documentId); // reclaim a stale lease first
      let row: CheckoutRow;
      try {
        row = await this.repo.insertCheckout(tx, {
          tenantId: ctx.tenantId,
          documentId,
          checkedOutBy: actor,
          expectedVersion,
          leaseSeconds: this.leaseSeconds,
        });
      } catch (e) {
        if (isUniqueViolation(e))
          throw ProblemError.conflict('Document is already checked out.', ctx.correlationId);
        throw e;
      }
      await this.emitter.recordAudit(tx, ctx, {
        code: M09_AUDIT_CODES.checkoutAcquired,
        entityType: 'document_checkout',
        entityId: row.id,
        detail: { documentId },
      });
      await this.emitter.publish(tx, {
        type: 'DocumentCheckoutAcquired',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { documentId, toStatus: 'checked_out' },
      });
      return row;
    });
  }

  async releaseCheckout(
    ctx: RequestContext,
    actor: string | null,
    documentId: string,
    force = false,
  ): Promise<CheckoutRow> {
    await this.authz.require(
      ctx,
      force ? M09_PERMISSIONS.checkoutForceRelease : M09_PERMISSIONS.checkoutRelease,
    );
    return this.db.withTenant(ctx, async (tx) => {
      const open = await this.repo.findOpenCheckout(tx, documentId);
      if (open === null)
        throw ProblemError.notFound('No open checkout for this document.', ctx.correlationId);
      if (!force && open.checked_out_by !== actor)
        throw ProblemError.forbidden(
          'Only the holder may release; a forced release needs privilege.',
          ctx.correlationId,
        );
      const upd = await this.repo.releaseCheckout(tx, {
        id: open.id,
        expectedVersion: open.version,
        releasedBy: actor ?? open.checked_out_by,
        forced: force,
      });
      if (upd === null)
        throw ProblemError.conflict('Checkout already released or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M09_AUDIT_CODES.checkoutReleased,
        entityType: 'document_checkout',
        entityId: open.id,
        detail: { documentId, forced: force },
      });
      await this.emitter.publish(tx, {
        type: 'DocumentCheckoutReleased',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { documentId, toStatus: 'released' },
      });
      return upd;
    });
  }

  // --- relationships ----------------------------------------------------------------------------
  async addRelationship(
    ctx: RequestContext,
    actor: string | null,
    input: { fromDocumentId: string; toDocumentId: string; relationshipType: string },
  ): Promise<RelationshipRow> {
    await this.authz.require(ctx, M09_PERMISSIONS.relationshipManage);
    if (!isRelationshipType(input.relationshipType))
      throw badRequest('invalid relationship type', ctx.correlationId);
    if (input.fromDocumentId === input.toDocumentId)
      throw badRequest('a document cannot relate to itself', ctx.correlationId);
    const type = input.relationshipType;
    return this.db.withTenant(ctx, async (tx) => {
      const from = await this.repo.findDocument(tx, input.fromDocumentId);
      const to = await this.repo.findDocument(tx, input.toDocumentId);
      if (from === null || to === null)
        throw ProblemError.notFound('Both documents must exist in this tenant.', ctx.correlationId);
      if (ACYCLIC_TYPES.includes(type)) {
        const edges = await this.repo.listActiveEdgesOfType(tx, type);
        try {
          assertAcyclic(type, input.fromDocumentId, input.toDocumentId, edges);
        } catch (e) {
          throw ProblemError.conflict(
            e instanceof DocError ? e.message : 'relationship would create a cycle',
            ctx.correlationId,
          );
        }
      }
      let row: RelationshipRow;
      try {
        row = await this.repo.insertRelationship(tx, {
          tenantId: ctx.tenantId,
          fromId: input.fromDocumentId,
          toId: input.toDocumentId,
          type,
          createdBy: actor,
        });
      } catch (e) {
        if (isUniqueViolation(e))
          throw ProblemError.conflict('An identical active relationship already exists.', ctx.correlationId);
        throw e;
      }
      await this.emitter.recordAudit(tx, ctx, {
        code: M09_AUDIT_CODES.relationshipCreated,
        entityType: 'document_relationship',
        entityId: row.id,
        detail: { relationshipType: type },
      });
      await this.emitter.publish(tx, {
        type: 'DocumentRelationshipCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          documentId: input.fromDocumentId,
          relationshipId: row.id,
          toDocumentId: input.toDocumentId,
          relationshipType: type,
        },
      });
      return row;
    });
  }

  async removeRelationship(
    ctx: RequestContext,
    actor: string | null,
    relationshipId: string,
    expectedVersion: number,
  ): Promise<RelationshipRow> {
    await this.authz.require(ctx, M09_PERMISSIONS.relationshipManage);
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await this.repo.findRelationship(tx, relationshipId);
      if (existing === null) throw ProblemError.notFound('Relationship not found.', ctx.correlationId);
      const upd = await this.repo.removeRelationship(tx, {
        id: relationshipId,
        expectedVersion,
        removedBy: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Relationship already removed or modified concurrently.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M09_AUDIT_CODES.relationshipRemoved,
        entityType: 'document_relationship',
        entityId: relationshipId,
        detail: {},
      });
      return upd;
    });
  }

  async listRelationships(ctx: RequestContext, documentId: string): Promise<RelationshipRow[]> {
    await this.authz.require(ctx, M09_PERMISSIONS.documentRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listRelationships(tx, documentId));
  }
}
