/**
 * AppService — developer APPLICATIONS + their API CREDENTIALS. A credential is HUMAN-governed (AI/system/automation never
 * issue/rotate/revoke — `evaluateCredentialActorGate`) and persists NO plaintext: the service generates a secret, returns
 * the plaintext to the caller ONCE, and stores only a one-way `sha256:` hash — OR the caller supplies an opaque `secretref:`
 * pointer (the m30 seam). Rotation revokes the prior credential and issues a fresh one. Every mutation authorizes a
 * `devportal.*` permission (default deny) and is audited through m03 in the same transaction. Audit/event payloads never
 * carry the secret.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M35_PERMISSIONS } from './permissions.ts';
import { M35_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden, versionConflict } from './errors.ts';
import {
  isScope,
  isPlatformScope,
  evaluateCredentialActorGate,
  validateCredentialSecret,
  REASON_CODES,
  clampPage,
} from './domain.ts';
import {
  DevportalRepository,
  type AppRow,
  type CredentialRow,
  type AppReadRow,
  type CredentialMetaRow,
} from './repository.ts';
import type { M35Emitter } from './emit.ts';

/** The result of issuing/rotating a credential: the stored row + the plaintext secret returned to the caller ONCE (only
 * when the service generated it; never when an opaque secretref was supplied, and never persisted). */
export interface IssuedCredential {
  readonly credential: CredentialRow;
  readonly plaintextSecret: string | null;
}

function hashSecret(plaintext: string): string {
  return `sha256:${createHash('sha256').update(plaintext).digest('hex')}`;
}
function generateSecret(): string {
  return `dps_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;
}

export class AppService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M35Emitter;
  private readonly repo: DevportalRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M35Emitter,
    repo: DevportalRepository = new DevportalRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }
  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M35_PERMISSIONS.administer);
  }

  async registerApp(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      appKey: string;
      name: string;
      description?: string | null;
      homepageUrl?: string | null;
      ownerRef?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<AppRow> {
    await this.authz.require(ctx, M35_PERMISSIONS.appManage);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    if (input.appKey.trim() === '' || input.name.trim() === '')
      throw badRequest('an app key and name are required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findAppByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const app = await this.repo.insertApp(tx, {
        tenantId: ctx.tenantId,
        scope,
        appKey: input.appKey,
        name: input.name,
        description: input.description ?? null,
        homepageUrl: input.homepageUrl ?? null,
        ownerRef: input.ownerRef ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'app',
        targetId: app.id,
        fromStatus: null,
        toStatus: 'active',
        reason: null,
        reasonCode: REASON_CODES.appRegistered,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M35_AUDIT_CODES.appRegistered,
        entityType: 'devportal_app',
        entityId: app.id,
        detail: { appKey: input.appKey, scope },
      });
      return app;
    });
  }

  async suspendApp(ctx: RequestContext, actor: string | null, appId: string): Promise<AppRow> {
    await this.authz.require(ctx, M35_PERMISSIONS.appManage);
    return this.db.withTenant(ctx, async (tx) => {
      const app = await this.repo.getApp(tx, appId);
      if (app === null) throw badRequest('unknown app.', ctx.correlationId);
      const moved = await this.repo.updateAppStatus(tx, appId, app.version, {
        status: 'suspended',
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'app',
        targetId: appId,
        fromStatus: app.status,
        toStatus: 'suspended',
        reason: null,
        reasonCode: REASON_CODES.appSuspended,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M35_AUDIT_CODES.appSuspended,
        entityType: 'devportal_app',
        entityId: appId,
        detail: {},
      });
      await this.emitter.publishDevportal(tx, 'AppSuspended', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: appId,
          recordType: 'app',
          toStatus: 'suspended',
          reasonCode: REASON_CODES.appSuspended,
        },
      });
      return moved;
    });
  }

  /** Issue an API credential for an app. HUMAN-only (AI never issues). If `secretRef` is supplied it is an opaque m30
   * pointer (stored as-is); otherwise the service GENERATES a secret, stores only its one-way hash, and returns the
   * plaintext to the caller ONCE (never persisted, never audited/evented). */
  async issueCredential(
    ctx: RequestContext,
    actor: string | null,
    appId: string,
    input: { purpose?: string; secretRef?: string | null; idempotencyKey?: string | null },
  ): Promise<IssuedCredential> {
    await this.authz.require(ctx, M35_PERMISSIONS.credentialManage);
    const gate = evaluateCredentialActorGate(actor);
    if (!gate.allowed) {
      await this.db.withTenant(ctx, (tx) =>
        this.emitter.recordAudit(tx, ctx, {
          code: M35_AUDIT_CODES.sodBlocked,
          entityType: 'devportal_credential',
          entityId: appId,
          detail: { reasonCode: gate.reasonCode },
        }),
      );
      throw governanceForbidden(gate.reasonCode, ctx.correlationId);
    }
    const purpose = input.purpose ?? 'api';
    // Determine the material: an opaque secretref (caller-supplied), or a generated secret stored as a one-way hash.
    let secretHash: string | null = null;
    let secretRef: string | null = null;
    let plaintextSecret: string | null = null;
    if (input.secretRef != null && input.secretRef !== '') {
      secretRef = input.secretRef;
    } else {
      plaintextSecret = generateSecret();
      secretHash = hashSecret(plaintextSecret);
    }
    const findings = validateCredentialSecret({ secretHash, secretRef });
    if (findings.length > 0)
      throw governanceForbidden(findings[0]?.code ?? REASON_CODES.secretValueForbidden, ctx.correlationId);
    const keyId = `dpk_${randomUUID()}`;
    const credential = await this.db.withTenant(ctx, async (tx) => {
      const app = await this.repo.getApp(tx, appId);
      if (app === null) throw badRequest('unknown app.', ctx.correlationId);
      if (app.status !== 'active')
        throw badRequest('only an active app can hold credentials.', ctx.correlationId);
      const cred = await this.repo.insertCredential(tx, {
        tenantId: ctx.tenantId,
        appId,
        keyId,
        purpose,
        secretHash,
        secretRef,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertCredentialEvent(tx, {
        tenantId: ctx.tenantId,
        credentialId: cred.id,
        event: 'issued',
        by: actor,
        reasonCode: REASON_CODES.credentialIssued,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M35_AUDIT_CODES.credentialIssued,
        entityType: 'devportal_credential',
        entityId: cred.id,
        detail: { appId, keyId, purpose },
      });
      await this.emitter.publishDevportal(tx, 'CredentialIssued', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: cred.id,
          recordType: 'credential',
          toStatus: 'active',
          reasonCode: REASON_CODES.credentialIssued,
        },
      });
      return cred;
    });
    return { credential, plaintextSecret };
  }

  /** Rotate a credential — revoke the prior and issue a fresh one (HUMAN-only). Returns the new plaintext secret ONCE. */
  async rotateCredential(
    ctx: RequestContext,
    actor: string | null,
    credentialId: string,
  ): Promise<IssuedCredential> {
    await this.authz.require(ctx, M35_PERMISSIONS.credentialManage);
    const gate = evaluateCredentialActorGate(actor);
    if (!gate.allowed) throw governanceForbidden(gate.reasonCode, ctx.correlationId);
    const prepared = await this.db.withTenant(ctx, async (tx) => {
      const prior = await this.repo.getCredential(tx, credentialId);
      if (prior === null) throw badRequest('unknown credential.', ctx.correlationId);
      if (prior.status !== 'active')
        throw badRequest('only an active credential can be rotated.', ctx.correlationId);
      const rotated = await this.repo.updateCredentialStatus(tx, credentialId, prior.version, {
        status: 'rotated',
        by: actor,
      });
      if (rotated === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertCredentialEvent(tx, {
        tenantId: ctx.tenantId,
        credentialId,
        event: 'rotated',
        by: actor,
        reasonCode: REASON_CODES.credentialRotated,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M35_AUDIT_CODES.credentialRotated,
        entityType: 'devportal_credential',
        entityId: credentialId,
        detail: { appId: prior.app_id },
      });
      return prior;
    });
    return this.issueCredential(ctx, actor, prepared.app_id, { purpose: prepared.purpose });
  }

  /** Revoke a credential (HUMAN-only). */
  async revokeCredential(
    ctx: RequestContext,
    actor: string | null,
    credentialId: string,
  ): Promise<CredentialRow> {
    await this.authz.require(ctx, M35_PERMISSIONS.credentialManage);
    const gate = evaluateCredentialActorGate(actor);
    if (!gate.allowed) throw governanceForbidden(gate.reasonCode, ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const cred = await this.repo.getCredential(tx, credentialId);
      if (cred === null) throw badRequest('unknown credential.', ctx.correlationId);
      if (cred.status === 'revoked')
        throw badRequest('the credential is already revoked.', ctx.correlationId);
      const revoked = await this.repo.updateCredentialStatus(tx, credentialId, cred.version, {
        status: 'revoked',
        by: actor,
      });
      if (revoked === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertCredentialEvent(tx, {
        tenantId: ctx.tenantId,
        credentialId,
        event: 'revoked',
        by: actor,
        reasonCode: REASON_CODES.credentialRevoked,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M35_AUDIT_CODES.credentialRevoked,
        entityType: 'devportal_credential',
        entityId: credentialId,
        detail: { appId: cred.app_id },
      });
      await this.emitter.publishDevportal(tx, 'CredentialRevoked', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: credentialId,
          recordType: 'credential',
          toStatus: 'revoked',
          reasonCode: REASON_CODES.credentialRevoked,
        },
      });
      return revoked;
    });
  }

  async getApp(ctx: RequestContext, id: string): Promise<AppRow | null> {
    await this.authz.require(ctx, M35_PERMISSIONS.appRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getApp(tx, id));
  }
  async getCredential(ctx: RequestContext, id: string): Promise<CredentialRow | null> {
    await this.authz.require(ctx, M35_PERMISSIONS.appRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getCredential(tx, id));
  }
  async listApps(ctx: RequestContext, page?: { limit?: number; offset?: number }): Promise<AppRow[]> {
    await this.authz.require(ctx, M35_PERMISSIONS.appRead);
    const { limit, offset } = clampPage(page?.limit, page?.offset);
    return this.db.withTenant(ctx, (tx) => this.repo.listApps(tx, limit, offset));
  }
  /** Read-model: the app + its safe descriptive/lifecycle metadata (developer-portal detail). */
  async getAppRead(ctx: RequestContext, id: string): Promise<AppReadRow | null> {
    await this.authz.require(ctx, M35_PERMISSIONS.appRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getAppRead(tx, id));
  }
  /** Read-model: an app's API-credential METADATA (never any secret material). Gated on app.read (a credential is
   * a facet of the app the caller may already read — mirrors getCredential, which also authorizes app.read). */
  async listCredentialsByApp(ctx: RequestContext, appId: string): Promise<CredentialMetaRow[]> {
    await this.authz.require(ctx, M35_PERMISSIONS.appRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listCredentialsByApp(tx, appId));
  }
}
