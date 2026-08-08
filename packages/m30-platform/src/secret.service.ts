/**
 * PlatformSecretReferenceService — the SECRET-REFERENCE SEAM (ADR-116). It governs OPAQUE `secretref:` pointers only —
 * register / rotate / revoke — and NEVER stores or returns a secret VALUE. Registration validates the reference shape
 * (fail closed on an invalid reference). Reading a reference's resolvability goes through the fail-closed `SecretResolver`
 * port (deterministic double; no production adapter, no network) and returns AVAILABILITY metadata only, audited as a
 * sensitive access (`PLATFORM_SECRET_REFERENCE_ACCESSED`). Real secret/key management is m41-security. Mutations require
 * `platform.secret.manage`; the sensitive read requires `platform.secret.read`; platform scope needs `platform.administer`.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M30_PERMISSIONS } from './permissions.ts';
import { M30_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden } from './errors.ts';
import { isScope, isPlatformScope, isSecretReference, REASON_CODES } from './domain.ts';
import { PlatformRepository, type SecretReferenceRow } from './repository.ts';
import { DeterministicSecretResolver, type SecretResolver } from './ports.ts';
import type { M30Emitter } from './emit.ts';

export class PlatformSecretReferenceService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M30Emitter;
  private readonly repo: PlatformRepository;
  private readonly resolver: SecretResolver;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M30Emitter,
    repo: PlatformRepository = new PlatformRepository(),
    resolver: SecretResolver = new DeterministicSecretResolver(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
    this.resolver = resolver;
  }

  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M30_PERMISSIONS.administer);
  }

  async registerSecretReference(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      refKey: string;
      secretRef: string;
      purpose?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<SecretReferenceRow> {
    await this.authz.require(ctx, M30_PERMISSIONS.secretManage);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    if (input.refKey.trim() === '') throw badRequest('a reference key is required.', ctx.correlationId);
    // OPAQUE POINTER ONLY: refuse anything that is not a well-formed secretref: (a raw secret is never accepted).
    if (!isSecretReference(input.secretRef))
      throw governanceForbidden(REASON_CODES.invalidSecretReference, ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findSecretReferenceByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const ref = await this.repo.insertSecretReference(tx, {
        tenantId: ctx.tenantId,
        scope,
        refKey: input.refKey,
        secretRef: input.secretRef,
        purpose: input.purpose ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertSecretReferenceHistory(tx, {
        tenantId: ctx.tenantId,
        referenceId: ref.id,
        targetType: 'secret_reference',
        targetId: ref.id,
        fromStatus: null,
        toStatus: 'active',
        reason: null,
        reasonCode: REASON_CODES.secretReferenceRegistered,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M30_AUDIT_CODES.secretReferenceRegistered,
        entityType: 'platform_secret_reference',
        entityId: ref.id,
        detail: { scope, refKey: input.refKey },
      });
      await this.emitter.publishPlatform(tx, 'SecretReferenceRegistered', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: ref.id,
          recordType: 'secret_reference',
          key: input.refKey,
          scope,
          toStatus: 'active',
          reasonCode: REASON_CODES.secretReferenceRegistered,
        },
      });
      return ref;
    });
  }

  private async transition(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    to: 'rotated' | 'revoked',
    reasonCode: string,
    auditCode: string,
    eventType: 'SecretReferenceRotated' | 'SecretReferenceRevoked',
  ): Promise<SecretReferenceRow> {
    await this.authz.require(ctx, M30_PERMISSIONS.secretManage);
    return this.db.withTenant(ctx, async (tx) => {
      const current = await this.repo.findSecretReference(tx, id);
      if (current === null) throw ProblemError.notFound('Secret reference not found.', ctx.correlationId);
      await this.authorizeScope(ctx, current.scope);
      const updated = await this.repo.setSecretReferenceStatus(tx, {
        id,
        expectedVersion,
        status: to,
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Secret reference modified concurrently.', ctx.correlationId);
      await this.repo.insertSecretReferenceHistory(tx, {
        tenantId: ctx.tenantId,
        referenceId: id,
        targetType: 'secret_reference',
        targetId: id,
        fromStatus: current.status,
        toStatus: to,
        reason: null,
        reasonCode,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: auditCode,
        entityType: 'platform_secret_reference',
        entityId: id,
        detail: { refKey: updated.ref_key, toStatus: to },
      });
      await this.emitter.publishPlatform(tx, eventType, {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: id,
          recordType: 'secret_reference',
          key: updated.ref_key,
          scope: updated.scope,
          toStatus: to,
          reasonCode,
        },
      });
      return updated;
    });
  }

  async rotateSecretReference(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<SecretReferenceRow> {
    return this.transition(
      ctx,
      actor,
      id,
      expectedVersion,
      'rotated',
      REASON_CODES.secretReferenceRotated,
      M30_AUDIT_CODES.secretReferenceRotated,
      'SecretReferenceRotated',
    );
  }
  async revokeSecretReference(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<SecretReferenceRow> {
    return this.transition(
      ctx,
      actor,
      id,
      expectedVersion,
      'revoked',
      REASON_CODES.secretReferenceRevoked,
      M30_AUDIT_CODES.secretReferenceRevoked,
      'SecretReferenceRevoked',
    );
  }

  /**
   * Sensitive read: returns the reference's AVAILABILITY metadata (via the fail-closed resolver port) — NEVER a secret
   * value. A revoked reference is unavailable. Audited as a sensitive access. Requires platform.secret.read (privileged).
   */
  async getReferenceAvailability(
    ctx: RequestContext,
    id: string,
  ): Promise<{ refKey: string; status: string; available: boolean; reasonCode: string }> {
    await this.authz.require(ctx, M30_PERMISSIONS.secretRead);
    return this.db.withTenant(ctx, async (tx) => {
      const ref = await this.repo.findSecretReference(tx, id);
      if (ref === null) throw ProblemError.notFound('Secret reference not found.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M30_AUDIT_CODES.secretReferenceAccessed,
        entityType: 'platform_secret_reference',
        entityId: id,
        detail: { refKey: ref.ref_key, status: ref.status },
      });
      if (ref.status === 'revoked')
        return {
          refKey: ref.ref_key,
          status: ref.status,
          available: false,
          reasonCode: REASON_CODES.secretUnavailable,
        };
      const meta = await this.resolver.resolveMetadata(ctx, ref.secret_ref);
      return {
        refKey: ref.ref_key,
        status: ref.status,
        available: meta.available,
        reasonCode: meta.reasonCode,
      };
    });
  }
}
