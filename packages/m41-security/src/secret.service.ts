/**
 * SecretService — the governed secret/key METADATA lifecycle + the m30-facing real RESOLVER + the security-posture gate. A
 * secret/key is defined (draft + a pending version whose material is provisioned through the fail-closed provider port),
 * ACTIVATED, ROTATED (race-safe: version CAS claims the rotation + a partial unique index enforces ONE active version),
 * REVOKED and DESTROYED — all CONTROLLED actions (maker-checker/SoD: a human approver != the requester; AI/system/automation
 * refused; privileged). A plaintext REVEAL is granted under maker-checker but NO material is ever returned into state (the
 * provider is unavailable). THE RESOLVER (`resolveSecretMetadata`) backs m30's SecretResolver: it returns availability METADATA
 * only, fails closed for a revoked/retired/destroyed/missing secret, and NEVER returns a value. POSTURE OVER RBAC
 * (`evaluateAccess`, ADR-009): security posture AUGMENTS m02 RBAC, never grants it. Every mutation authorizes a permission
 * (default deny) and is audited through m03 in the same transaction. NO secret value / ciphertext / token is ever handled.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M41_PERMISSIONS } from './permissions.ts';
import { M41_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden, notFound, versionConflict } from './errors.ts';
import {
  isPlatformScope,
  isHumanActor,
  evaluateSodGate,
  evaluateSecurityPosture,
  isSecretTransitionAllowed,
  validateSecret,
  clampPage,
  REASON_CODES,
  type GateResult,
  type SecretState,
} from './domain.ts';
import {
  SecurityRepository,
  type SecretRow,
  type SecretVersionRow,
  type SecretDetailRow,
  type SecretVersionListRow,
  type RevealListRow,
} from './repository.ts';
import type { M41Emitter } from './emit.ts';
import type { SecretProviderPort } from './ports.ts';

export interface SecretMetadata {
  readonly available: boolean;
  readonly reasonCode: string;
}

export class SecretService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M41Emitter;
  private readonly provider: SecretProviderPort;
  private readonly repo: SecurityRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M41Emitter,
    provider: SecretProviderPort,
    repo: SecurityRepository = new SecurityRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.provider = provider;
    this.repo = repo;
  }
  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M41_PERMISSIONS.administer);
  }

  /**
   * POSTURE OVER RBAC (ADR-009). Effective access = m02 RBAC (does ctx hold the permission) AND m41 security posture. Security
   * posture can never grant an action RBAC denies. Returns the pure decision; a denial is audited + emits a posture event.
   */
  async evaluateAccess(
    ctx: RequestContext,
    input: { requiredPermission: string; securityAllowed: boolean; ownerAllowed?: boolean },
  ): Promise<GateResult> {
    const gate = evaluateSecurityPosture({
      rbacAllowed: ctx.permissions.includes(input.requiredPermission),
      securityAllowed: input.securityAllowed,
      ownerAllowed: input.ownerAllowed,
    });
    if (!gate.allowed) {
      await this.db.withTenant(ctx, async (tx) => {
        await this.emitter.recordAudit(tx, ctx, {
          code: M41_AUDIT_CODES.accessBlocked,
          entityType: 'security_secret',
          entityId: ctx.tenantId,
          detail: { requiredPermission: input.requiredPermission, reasonCode: gate.reasonCode },
        });
        await this.emitter.publishIdentity(tx, 'SecurityPostureDenied', {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          actor: ctx.userId ?? undefined,
          payload: { recordId: ctx.tenantId, reasonCode: gate.reasonCode },
        });
      });
    }
    return gate;
  }

  /** The REAL secret resolver backing m30's SecretResolver — availability metadata ONLY; fail closed; never a value. */
  async resolveSecretMetadata(ctx: RequestContext, secretRef: string): Promise<SecretMetadata> {
    return this.db.withTenant(ctx, async (tx) => {
      const secret = await this.repo.getSecretByRef(tx, secretRef);
      if (!secret) return { available: false, reasonCode: REASON_CODES.secretUnavailable };
      if (secret.state !== 'active') return { available: false, reasonCode: REASON_CODES.secretUnavailable };
      const active = await this.repo.getActiveVersion(tx, secret.id);
      if (!active) return { available: false, reasonCode: REASON_CODES.secretUnavailable };
      // The material lives behind the provider; consult it (fail-closed) — never a value.
      const meta = await this.provider.resolveMetadata(ctx, active.provider_ref ?? '');
      return meta.available
        ? { available: true, reasonCode: REASON_CODES.secretResolvable }
        : { available: false, reasonCode: meta.reasonCode };
    });
  }

  async defineSecret(
    ctx: RequestContext,
    input: {
      materialKind?: string;
      scope?: string;
      secretKey: string;
      secretRef: string;
      algorithm?: string | null;
    },
  ): Promise<SecretRow> {
    await this.authz.require(ctx, M41_PERMISSIONS.secretManage);
    const scope = input.scope ?? 'tenant';
    if (scope !== 'platform' && scope !== 'tenant') throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    const materialKind = input.materialKind ?? 'secret';
    const check = validateSecret({
      materialKind,
      secretRef: input.secretRef,
      algorithm: input.algorithm ?? null,
    });
    if (!check.passed) throw badRequest(`invalid secret (${check.findings[0]?.ref}).`, ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const secret = await this.repo.insertSecret(tx, {
        tenantId: ctx.tenantId,
        materialKind,
        scope,
        secretKey: input.secretKey,
        secretRef: input.secretRef,
        algorithm: input.algorithm ?? null,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      // Provision material for version 1 through the fail-closed provider (framework-only; unavailable -> no provider ref).
      const outcome = await this.provider.provision(ctx, {
        secretRef: input.secretRef,
        algorithm: input.algorithm ?? null,
      });
      await this.repo.insertSecretVersion(tx, {
        tenantId: ctx.tenantId,
        secretId: secret.id,
        versionNo: 1,
        providerRef: outcome.providerRef ?? null,
        state: 'pending',
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M41_AUDIT_CODES.secretDefined,
        entityType: 'security_secret',
        entityId: secret.id,
        detail: { materialKind, scope, algorithm: input.algorithm ?? null },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M41_AUDIT_CODES.secretVersionAdded,
        entityType: 'security_secret_version',
        entityId: secret.id,
        detail: { versionNo: 1, providerAvailable: outcome.ok },
      });
      return secret;
    });
  }

  /** Activate a secret (draft/pending -> active). CONTROLLED: maker-checker/SoD (human approver != requester). */
  async activateSecret(
    ctx: RequestContext,
    approver: string | null,
    secretId: string,
    expectedVersion: number,
    input: { requestedBy: string },
  ): Promise<SecretRow> {
    await this.authz.require(ctx, M41_PERMISSIONS.secretRotate);
    return this.db.withTenant(ctx, async (tx) => {
      const secret = await this.repo.getSecret(tx, secretId);
      if (!secret) throw notFound('secret not found.', ctx.correlationId);
      const gate = evaluateSodGate(input.requestedBy, approver);
      if (!gate.allowed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M41_AUDIT_CODES.sodBlocked,
          entityType: 'security_secret',
          entityId: secretId,
          detail: { reasonCode: gate.reasonCode },
        });
        throw governanceForbidden(gate.reasonCode, ctx.correlationId);
      }
      if (!isHumanActor(approver))
        throw governanceForbidden(REASON_CODES.notHumanApprover, ctx.correlationId);
      if (!isSecretTransitionAllowed(secret.state as SecretState, 'active'))
        throw governanceForbidden(REASON_CODES.invalidTransition, ctx.correlationId);
      // Activate version 1 (pending). The one-active partial index guarantees at most one active version.
      const versions = await this.repo.countVersions(tx, secretId);
      const targetVersionNo = versions >= 1 ? 1 : 1;
      const active = await this.activateVersion(tx, ctx, secretId, targetVersionNo);
      const updated = await this.repo.updateSecret(tx, secretId, expectedVersion, {
        state: 'active',
        currentVersionNo: active.version_no,
        by: ctx.userId ?? null,
      });
      if (!updated) throw versionConflict(ctx.correlationId);
      await this.recordControlled(
        tx,
        ctx,
        secretId,
        input.requestedBy,
        approver,
        M41_AUDIT_CODES.secretActivated,
        'SecretActivated',
        secret.state,
        'active',
      );
      return updated;
    });
  }

  /**
   * Rotate a secret — RACE-SAFE. The secret aggregate version CAS claims the rotation (one winner; a stale version -> 409),
   * the current active version is retired, and a NEW active version is provisioned. The one-active partial unique index is the
   * DB backstop: two concurrent active inserts for the same secret cannot both succeed.
   */
  async rotateSecret(
    ctx: RequestContext,
    approver: string | null,
    secretId: string,
    expectedVersion: number,
    input: { requestedBy: string },
  ): Promise<SecretRow> {
    await this.authz.require(ctx, M41_PERMISSIONS.secretRotate);
    return this.db.withTenant(ctx, async (tx) => {
      const secret = await this.repo.getSecret(tx, secretId);
      if (!secret) throw notFound('secret not found.', ctx.correlationId);
      if (secret.state !== 'active')
        throw governanceForbidden(REASON_CODES.invalidTransition, ctx.correlationId);
      const gate = evaluateSodGate(input.requestedBy, approver);
      if (!gate.allowed) throw governanceForbidden(gate.reasonCode, ctx.correlationId);
      if (!isHumanActor(approver))
        throw governanceForbidden(REASON_CODES.notHumanApprover, ctx.correlationId);
      // 1) CAS-claim the rotation on the aggregate (one concurrent winner).
      const claimed = await this.repo.updateSecret(tx, secretId, expectedVersion, {
        state: 'rotating',
        currentVersionNo: secret.current_version_no,
        by: ctx.userId ?? null,
      });
      if (!claimed) throw versionConflict(ctx.correlationId);
      // 2) retire the current active version, 3) provision + activate a new one (one-active index backstops).
      const current = await this.repo.getActiveVersion(tx, secretId);
      if (current)
        await this.repo.updateVersionState(tx, current.id, current.version, 'retired', ctx.userId ?? null);
      const nextNo = (current?.version_no ?? secret.current_version_no) + 1;
      await this.activateVersion(tx, ctx, secretId, nextNo);
      const updated = await this.repo.updateSecret(tx, secretId, claimed.version, {
        state: 'active',
        currentVersionNo: nextNo,
        by: ctx.userId ?? null,
      });
      if (!updated) throw versionConflict(ctx.correlationId);
      await this.recordControlled(
        tx,
        ctx,
        secretId,
        input.requestedBy,
        approver,
        M41_AUDIT_CODES.secretRotated,
        'SecretRotated',
        'active',
        'active',
      );
      return updated;
    });
  }

  async revokeSecret(
    ctx: RequestContext,
    approver: string | null,
    secretId: string,
    expectedVersion: number,
    input: { requestedBy: string },
  ): Promise<SecretRow> {
    return this.terminal(
      ctx,
      approver,
      secretId,
      expectedVersion,
      input,
      'revoked',
      M41_AUDIT_CODES.secretRevoked,
      'SecretRevoked',
    );
  }

  /** Destroy a secret — material is cryptographically destroyed through the fail-closed provider (framework-only); metadata +
   *  audit are retained (never physically deleted). Maker-checker/SoD. */
  async destroySecret(
    ctx: RequestContext,
    approver: string | null,
    secretId: string,
    expectedVersion: number,
    input: { requestedBy: string },
  ): Promise<SecretRow> {
    await this.authz.require(ctx, M41_PERMISSIONS.secretDestroy);
    return this.db.withTenant(ctx, async (tx) => {
      const secret = await this.repo.getSecret(tx, secretId);
      if (!secret) throw notFound('secret not found.', ctx.correlationId);
      const gate = evaluateSodGate(input.requestedBy, approver);
      if (!gate.allowed) throw governanceForbidden(gate.reasonCode, ctx.correlationId);
      if (!isHumanActor(approver))
        throw governanceForbidden(REASON_CODES.notHumanApprover, ctx.correlationId);
      if (!isSecretTransitionAllowed(secret.state as SecretState, 'destroyed'))
        throw governanceForbidden(REASON_CODES.invalidTransition, ctx.correlationId);
      const active = await this.repo.getActiveVersion(tx, secretId);
      if (active) await this.provider.destroy(ctx, active.provider_ref ?? ''); // framework-only crypto-erase
      const updated = await this.repo.updateSecret(tx, secretId, expectedVersion, {
        state: 'destroyed',
        currentVersionNo: secret.current_version_no,
        by: ctx.userId ?? null,
      });
      if (!updated) throw versionConflict(ctx.correlationId);
      await this.recordControlled(
        tx,
        ctx,
        secretId,
        input.requestedBy,
        approver,
        M41_AUDIT_CODES.secretDestroyed,
        'SecretDestroyed',
        secret.state,
        'destroyed',
      );
      return updated;
    });
  }

  /** Grant a plaintext REVEAL — CONTROLLED (privileged + maker-checker). NO material is returned (provider unavailable). */
  async requestReveal(
    ctx: RequestContext,
    approver: string | null,
    secretId: string,
    input: { requestedBy: string; purpose: string; validTo?: Date | null },
  ): Promise<{ id: string; reasonCode: string }> {
    await this.authz.require(ctx, M41_PERMISSIONS.secretReveal);
    if (!input.purpose) throw badRequest('a purpose is required to reveal a secret.', ctx.correlationId);
    const gate = evaluateSodGate(input.requestedBy, approver);
    if (!gate.allowed) throw governanceForbidden(gate.reasonCode, ctx.correlationId);
    if (!isHumanActor(approver)) throw governanceForbidden(REASON_CODES.notHumanApprover, ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const secret = await this.repo.getSecret(tx, secretId);
      if (!secret) throw notFound('secret not found.', ctx.correlationId);
      const reveal = await this.repo.insertReveal(tx, {
        tenantId: ctx.tenantId,
        secretId,
        requestedBy: input.requestedBy,
        approvedBy: approver,
        purpose: input.purpose,
        reasonCode: 'reveal_granted',
        granted: true,
        validTo: input.validTo ?? null,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M41_AUDIT_CODES.revealRequested,
        entityType: 'security_reveal',
        entityId: reveal.id,
        detail: { secretId },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M41_AUDIT_CODES.revealGranted,
        entityType: 'security_reveal',
        entityId: reveal.id,
        detail: { secretId, purpose: input.purpose },
      });
      await this.emitter.publishPrivileged(tx, 'RevealGranted', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: { recordId: reveal.id, recordType: 'reveal' },
      });
      // NO material is returned — the provider is unavailable; a real provider would deliver it out-of-band under this grant.
      return { id: reveal.id, reasonCode: REASON_CODES.providerUnavailable };
    });
  }

  async getSecret(ctx: RequestContext, id: string): Promise<SecretRow | null> {
    await this.authz.require(ctx, M41_PERMISSIONS.secretRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getSecret(tx, id));
  }
  async listSecrets(ctx: RequestContext, page?: number, size?: number): Promise<SecretRow[]> {
    await this.authz.require(ctx, M41_PERMISSIONS.secretRead);
    const { limit, offset } = clampPage(page, size);
    return this.db.withTenant(ctx, (tx) => this.repo.listSecrets(tx, limit, offset));
  }

  // ---- READ MODEL (admin console: detail / version history / reveal-grant history / provider status) ----
  // All gated by security.secret.read (read-only; not audited; RLS-scoped). NONE returns any secret material — the
  // underlying tables have no value/ciphertext/token column and the resolver returns availability metadata only.
  async getSecretDetail(ctx: RequestContext, id: string): Promise<SecretDetailRow | null> {
    await this.authz.require(ctx, M41_PERMISSIONS.secretRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getSecretDetail(tx, id));
  }
  async listSecretVersions(ctx: RequestContext, secretId: string): Promise<SecretVersionListRow[]> {
    await this.authz.require(ctx, M41_PERMISSIONS.secretRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listSecretVersions(tx, secretId));
  }
  /** Reveal-GRANT history (maker-checker evidence: requester/approver/purpose/expiry) — never any material. */
  async listReveals(ctx: RequestContext, secretId: string): Promise<RevealListRow[]> {
    await this.authz.require(ctx, M41_PERMISSIONS.secretRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listReveals(tx, secretId));
  }
  /**
   * Provider health/status for a secret, keyed by id (the admin-console read counterpart of `resolveSecretMetadata`,
   * which m30 consults by secretRef). Availability METADATA only — never a value; fail-closed for a missing/inactive
   * secret or an unavailable provider. Gated by security.secret.read.
   */
  async getSecretProviderStatus(ctx: RequestContext, id: string): Promise<SecretMetadata> {
    await this.authz.require(ctx, M41_PERMISSIONS.secretRead);
    return this.db.withTenant(ctx, async (tx) => {
      const secret = await this.repo.getSecret(tx, id);
      if (!secret || secret.state !== 'active')
        return { available: false, reasonCode: REASON_CODES.secretUnavailable };
      const active = await this.repo.getActiveVersion(tx, secret.id);
      if (!active) return { available: false, reasonCode: REASON_CODES.secretUnavailable };
      const meta = await this.provider.resolveMetadata(ctx, active.provider_ref ?? '');
      return meta.available
        ? { available: true, reasonCode: REASON_CODES.secretResolvable }
        : { available: false, reasonCode: meta.reasonCode };
    });
  }

  // ---- helpers ----
  private async activateVersion(
    tx: Parameters<Parameters<Db['withTenant']>[1]>[0],
    ctx: RequestContext,
    secretId: string,
    versionNo: number,
  ): Promise<SecretVersionRow> {
    // Provision material for the new version through the fail-closed provider (framework-only).
    const secret = await this.repo.getSecret(tx, secretId);
    const outcome = await this.provider.provision(ctx, {
      secretRef: secret?.secret_ref ?? '',
      algorithm: secret?.algorithm ?? null,
    });
    // If version 1 already exists (defineSecret created it pending), activate it; else insert a new active version.
    if (versionNo === 1) {
      const existing = await tx.query<SecretVersionRow>(
        `SELECT tenant_id, id, secret_id, version_no, state, provider_ref, version FROM security_secret_version WHERE secret_id=$1 AND version_no=1 LIMIT 1`,
        [secretId],
      );
      const v = existing.rows[0];
      if (v?.state === 'pending') {
        const activated = await this.repo.updateVersionState(
          tx,
          v.id,
          v.version,
          'active',
          ctx.userId ?? null,
        );
        if (activated) return activated;
      }
    }
    return this.repo.insertSecretVersion(tx, {
      tenantId: ctx.tenantId,
      secretId,
      versionNo,
      providerRef: outcome.providerRef ?? null,
      state: 'active',
      correlationId: ctx.correlationId,
      by: ctx.userId ?? null,
    });
  }

  private async terminal(
    ctx: RequestContext,
    approver: string | null,
    secretId: string,
    expectedVersion: number,
    input: { requestedBy: string },
    to: SecretState,
    auditCode: string,
    eventType: string,
  ): Promise<SecretRow> {
    await this.authz.require(ctx, M41_PERMISSIONS.secretRotate);
    return this.db.withTenant(ctx, async (tx) => {
      const secret = await this.repo.getSecret(tx, secretId);
      if (!secret) throw notFound('secret not found.', ctx.correlationId);
      const gate = evaluateSodGate(input.requestedBy, approver);
      if (!gate.allowed) throw governanceForbidden(gate.reasonCode, ctx.correlationId);
      if (!isHumanActor(approver))
        throw governanceForbidden(REASON_CODES.notHumanApprover, ctx.correlationId);
      if (!isSecretTransitionAllowed(secret.state as SecretState, to))
        throw governanceForbidden(REASON_CODES.invalidTransition, ctx.correlationId);
      const active = await this.repo.getActiveVersion(tx, secretId);
      if (active)
        await this.repo.updateVersionState(tx, active.id, active.version, 'revoked', ctx.userId ?? null);
      const updated = await this.repo.updateSecret(tx, secretId, expectedVersion, {
        state: to,
        currentVersionNo: secret.current_version_no,
        by: ctx.userId ?? null,
      });
      if (!updated) throw versionConflict(ctx.correlationId);
      await this.recordControlled(
        tx,
        ctx,
        secretId,
        input.requestedBy,
        approver,
        auditCode,
        eventType,
        secret.state,
        to,
      );
      return updated;
    });
  }

  private async recordControlled(
    tx: Parameters<Parameters<Db['withTenant']>[1]>[0],
    ctx: RequestContext,
    secretId: string,
    requestedBy: string,
    approver: string,
    auditCode: string,
    eventType: string,
    fromState: string,
    toState: string,
  ): Promise<void> {
    await this.repo.insertReview(tx, {
      tenantId: ctx.tenantId,
      targetKind: 'secret',
      targetId: secretId,
      decision: 'approved',
      requestedBy,
      decidedBy: approver,
      reasonCode: null,
      correlationId: ctx.correlationId,
    });
    await this.repo.insertHistory(tx, {
      tenantId: ctx.tenantId,
      subjectKind: 'secret',
      subjectId: secretId,
      fromState,
      toState,
      reasonCode: null,
      actor: ctx.userId ?? null,
      correlationId: ctx.correlationId,
    });
    await this.emitter.recordAudit(tx, ctx, {
      code: auditCode,
      entityType: 'security_secret',
      entityId: secretId,
      detail: { fromState, toState },
    });
    await this.emitter.publishCrypto(tx, eventType, {
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      actor: ctx.userId ?? undefined,
      payload: { recordId: secretId, fromState, toState },
    });
  }
}
