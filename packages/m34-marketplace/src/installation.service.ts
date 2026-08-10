/**
 * InstallationService — a tenant installs a published listing, CONSENTS (human) to its data-access scopes, attaches opaque
 * secret references, and UPGRADES. THE CONTROLS: an install config is screened for raw secret VALUES (fail closed); the
 * listing must be PUBLISHED and its connector available in m33 (fail-closed port); CONSENT is HUMAN-granted (AI never
 * consents) and revocable (revoking suspends the installation); an UPGRADE that widens access is maker-checker (the
 * approver must be a HUMAN who is NOT the install requester); secrets are opaque secretref: pointers only. Every mutation
 * authorizes a `marketplace.*` permission (default deny) and is audited through m03 in the same transaction. m34 never
 * executes a connector (that is m33's responsibility).
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M34_PERMISSIONS } from './permissions.ts';
import { M34_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden, versionConflict } from './errors.ts';
import {
  isScope,
  isPlatformScope,
  isConsentScope,
  isSecretReference,
  screenInstallConfig,
  isHumanActor,
  evaluateSodGate,
  REASON_CODES,
} from './domain.ts';
import {
  MarketplaceRepository,
  type InstallationRow,
  type ConsentRow,
  type InstallSecretRow,
  type UpgradeRow,
} from './repository.ts';
import type { M34Emitter } from './emit.ts';
import type { ConnectorRegistryPort } from './ports.ts';

export class InstallationService {
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

  /** Request an installation of a PUBLISHED listing (connector must be available in m33; config screened for raw secrets). */
  async requestInstall(
    ctx: RequestContext,
    actor: string | null,
    input: {
      listingId: string;
      scope?: string;
      installKey: string;
      config?: unknown;
      idempotencyKey?: string | null;
    },
  ): Promise<InstallationRow> {
    await this.authz.require(ctx, M34_PERMISSIONS.installManage);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    if (input.installKey.trim() === '') throw badRequest('an install key is required.', ctx.correlationId);
    const findings = screenInstallConfig(input.config ?? {});
    if (findings.length > 0) {
      await this.db.withTenant(ctx, (tx) =>
        this.emitter.recordAudit(tx, ctx, {
          code: M34_AUDIT_CODES.publishBlocked,
          entityType: 'marketplace_installation',
          entityId: input.listingId,
          detail: { reasonCode: findings[0]?.code ?? REASON_CODES.secretValueForbidden },
        }),
      );
      throw governanceForbidden(findings[0]?.code ?? REASON_CODES.secretValueForbidden, ctx.correlationId);
    }
    // idempotency + listing-published pre-check
    const prepared = await this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findInstallationByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return { existing };
      }
      const listing = await this.repo.getListing(tx, input.listingId);
      if (listing === null) throw badRequest('unknown listing.', ctx.correlationId);
      if (listing.state !== 'published')
        throw governanceForbidden(REASON_CODES.listingNotPublished, ctx.correlationId);
      return { listing };
    });
    if ('existing' in prepared) return prepared.existing;

    const avail = await this.registry.isConnectorAvailable(ctx, prepared.listing.connector_ref);
    if (!avail.available) throw governanceForbidden(REASON_CODES.connectorUnavailable, ctx.correlationId);

    return this.db.withTenant(ctx, async (tx) => {
      const install = await this.repo.insertInstallation(tx, {
        tenantId: ctx.tenantId,
        listingId: input.listingId,
        connectorRef: prepared.listing.connector_ref,
        scope,
        installKey: input.installKey,
        config: input.config ?? {},
        requestedBy: actor,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      // requested -> consent_pending (consent is required before activation).
      const pending = await this.repo.updateInstallation(tx, install.id, install.version, {
        status: 'consent_pending',
        installedVersion: install.installed_version,
        by: actor,
      });
      if (pending === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'installation',
        targetId: install.id,
        fromStatus: null,
        toStatus: 'consent_pending',
        reason: null,
        reasonCode: REASON_CODES.installRequested,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M34_AUDIT_CODES.installRequested,
        entityType: 'marketplace_installation',
        entityId: install.id,
        detail: { listingId: input.listingId, installKey: input.installKey },
      });
      return pending;
    });
  }

  /** Grant CONSENT (human) to an installation's scopes and activate it. AI never consents. */
  async grantConsent(
    ctx: RequestContext,
    actor: string | null,
    installationId: string,
    input: { scopes: readonly string[]; idempotencyKey?: string | null },
  ): Promise<ConsentRow> {
    await this.authz.require(ctx, M34_PERMISSIONS.consentManage);
    // CONSENT is human-governed: a null/system/ai/automation grantor is refused (AI never consents). Narrows `actor`.
    if (!isHumanActor(actor)) {
      await this.db.withTenant(ctx, (tx) =>
        this.emitter.recordAudit(tx, ctx, {
          code: M34_AUDIT_CODES.sodBlocked,
          entityType: 'marketplace_consent',
          entityId: installationId,
          detail: { reasonCode: REASON_CODES.notHumanConsent },
        }),
      );
      throw governanceForbidden(REASON_CODES.notHumanConsent, ctx.correlationId);
    }
    for (const s of input.scopes)
      if (!isConsentScope(s)) throw badRequest('unknown consent scope.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const install = await this.repo.getInstallation(tx, installationId);
      if (install === null) throw badRequest('unknown installation.', ctx.correlationId);
      const consent = await this.repo.insertConsent(tx, {
        tenantId: ctx.tenantId,
        installationId,
        scopes: input.scopes,
        grantedBy: actor,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      const activated = await this.repo.updateInstallation(tx, installationId, install.version, {
        status: 'active',
        installedVersion: install.installed_version,
        by: actor,
      });
      if (activated === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'installation',
        targetId: installationId,
        fromStatus: install.status,
        toStatus: 'active',
        reason: null,
        reasonCode: REASON_CODES.installActivated,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M34_AUDIT_CODES.consentGranted,
        entityType: 'marketplace_consent',
        entityId: consent.id,
        detail: { installationId, scopeCount: input.scopes.length },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M34_AUDIT_CODES.installActivated,
        entityType: 'marketplace_installation',
        entityId: installationId,
        detail: {},
      });
      await this.emitter.publishMarketplace(tx, 'ConsentGranted', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor,
        payload: {
          recordId: consent.id,
          recordType: 'consent',
          toStatus: 'granted',
          reasonCode: REASON_CODES.consentGranted,
        },
      });
      await this.emitter.publishMarketplace(tx, 'InstallationActivated', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor,
        payload: {
          recordId: installationId,
          recordType: 'installation',
          toStatus: 'active',
          reasonCode: REASON_CODES.installActivated,
        },
      });
      return consent;
    });
  }

  /** Revoke consent — this SUSPENDS the installation (data access withdrawn). */
  async revokeConsent(
    ctx: RequestContext,
    actor: string | null,
    installationId: string,
  ): Promise<InstallationRow> {
    await this.authz.require(ctx, M34_PERMISSIONS.consentManage);
    return this.db.withTenant(ctx, async (tx) => {
      const install = await this.repo.getInstallation(tx, installationId);
      if (install === null) throw badRequest('unknown installation.', ctx.correlationId);
      const consent = await this.repo.getActiveConsent(tx, installationId);
      if (consent === null) throw badRequest('no active consent to revoke.', ctx.correlationId);
      const revoked = await this.repo.revokeConsent(tx, consent.id, consent.version, actor);
      if (revoked === null) throw versionConflict(ctx.correlationId);
      const suspended = await this.repo.updateInstallation(tx, installationId, install.version, {
        status: 'suspended',
        installedVersion: install.installed_version,
        by: actor,
      });
      if (suspended === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'installation',
        targetId: installationId,
        fromStatus: install.status,
        toStatus: 'suspended',
        reason: null,
        reasonCode: REASON_CODES.consentRevoked,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M34_AUDIT_CODES.consentRevoked,
        entityType: 'marketplace_consent',
        entityId: consent.id,
        detail: { installationId },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M34_AUDIT_CODES.installSuspended,
        entityType: 'marketplace_installation',
        entityId: installationId,
        detail: {},
      });
      await this.emitter.publishMarketplace(tx, 'ConsentRevoked', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: consent.id,
          recordType: 'consent',
          toStatus: 'revoked',
          reasonCode: REASON_CODES.consentRevoked,
        },
      });
      await this.emitter.publishMarketplace(tx, 'InstallationSuspended', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: installationId,
          recordType: 'installation',
          toStatus: 'suspended',
          reasonCode: REASON_CODES.consentRevoked,
        },
      });
      return suspended;
    });
  }

  /** Attach an OPAQUE secret reference to an installation (m30 seam). A raw secret is refused — pointer only. */
  async setSecret(
    ctx: RequestContext,
    actor: string | null,
    installationId: string,
    input: { purpose: string; secretRef: string; idempotencyKey?: string | null },
  ): Promise<InstallSecretRow> {
    await this.authz.require(ctx, M34_PERMISSIONS.installManage);
    if (!isSecretReference(input.secretRef)) {
      await this.db.withTenant(ctx, (tx) =>
        this.emitter.recordAudit(tx, ctx, {
          code: M34_AUDIT_CODES.publishBlocked,
          entityType: 'marketplace_install_secret',
          entityId: installationId,
          detail: { reasonCode: REASON_CODES.secretValueForbidden },
        }),
      );
      throw governanceForbidden(REASON_CODES.secretValueForbidden, ctx.correlationId);
    }
    return this.db.withTenant(ctx, async (tx) => {
      const install = await this.repo.getInstallation(tx, installationId);
      if (install === null) throw badRequest('unknown installation.', ctx.correlationId);
      const secret = await this.repo.insertInstallSecret(tx, {
        tenantId: ctx.tenantId,
        installationId,
        purpose: input.purpose,
        secretRef: input.secretRef,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M34_AUDIT_CODES.installSecretSet,
        entityType: 'marketplace_install_secret',
        entityId: secret.id,
        detail: { installationId, purpose: input.purpose },
      });
      return secret;
    });
  }

  /** Apply an upgrade — a controlled action (the approver must be a HUMAN who is NOT the install requester; the
   * installation must be active + consented). */
  async applyUpgrade(
    ctx: RequestContext,
    actor: string | null,
    installationId: string,
    input: { toVersion: number },
  ): Promise<UpgradeRow> {
    await this.authz.require(ctx, M34_PERMISSIONS.upgradeApply);
    return this.db.withTenant(ctx, async (tx) => {
      const install = await this.repo.getInstallation(tx, installationId);
      if (install === null) throw badRequest('unknown installation.', ctx.correlationId);
      if (install.status !== 'active')
        throw badRequest('only an active installation can be upgraded.', ctx.correlationId);
      const consent = await this.repo.getActiveConsent(tx, installationId);
      if (consent === null) throw governanceForbidden(REASON_CODES.consentRequired, ctx.correlationId);
      if (input.toVersion <= install.installed_version)
        throw badRequest('the target version must be greater than the current version.', ctx.correlationId);
      // maker-checker: an upgrade that widens access needs a human approver who is NOT the install requester.
      const sod = evaluateSodGate(install.requested_by ?? '', actor);
      if (!sod.allowed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M34_AUDIT_CODES.sodBlocked,
          entityType: 'marketplace_installation',
          entityId: installationId,
          detail: { reasonCode: sod.reasonCode },
        });
        throw governanceForbidden(sod.reasonCode, ctx.correlationId);
      }
      const upgrade = await this.repo.insertUpgrade(tx, {
        tenantId: ctx.tenantId,
        installationId,
        fromVersion: install.installed_version,
        toVersion: input.toVersion,
        status: 'applied',
        requestedBy: install.requested_by,
        approvedBy: actor,
        reasonCode: REASON_CODES.upgradeApplied,
        correlationId: ctx.correlationId,
      });
      const upgraded = await this.repo.updateInstallation(tx, installationId, install.version, {
        status: 'active',
        installedVersion: input.toVersion,
        by: actor,
      });
      if (upgraded === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'upgrade',
        targetId: upgrade.id,
        kind: 'approved',
        requestedBy: install.requested_by ?? '',
        decidedBy: actor,
        reason: null,
        reasonCode: REASON_CODES.upgradeApplied,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M34_AUDIT_CODES.upgradeApplied,
        entityType: 'marketplace_upgrade',
        entityId: upgrade.id,
        detail: { installationId, fromVersion: install.installed_version, toVersion: input.toVersion },
      });
      await this.emitter.publishMarketplace(tx, 'UpgradeApplied', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: upgrade.id,
          recordType: 'upgrade',
          version: input.toVersion,
          toStatus: 'applied',
          reasonCode: REASON_CODES.upgradeApplied,
        },
      });
      return upgrade;
    });
  }

  async getInstallation(ctx: RequestContext, id: string): Promise<InstallationRow | null> {
    await this.authz.require(ctx, M34_PERMISSIONS.installRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getInstallation(tx, id));
  }
}
