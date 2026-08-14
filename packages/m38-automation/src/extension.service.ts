/**
 * ExtensionService — the governed extension registry. Register an extension (trust tier + isolation level), declare its
 * registered EXTENSION POINTS (each an opaque capability + the m02 permission it requires — the facade rule; no raw code),
 * validate, send for review, and PUBLISH it (a controlled action — maker-checker/SoD over a passing validation; a published
 * extension is immutable via DB trigger). A tenant INSTALLS/enables a published extension. Every mutation authorizes an
 * `extensions.*` permission (default deny) and is audited through m03 in the same transaction. AI never approves; there is no
 * arbitrary code loading — an extension point is a registered capability reference, executed (if ever) through the owning
 * module's contract behind a fail-closed port with trust-tier + isolation metadata.
 */
import { createHash } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M38_PERMISSIONS } from './permissions.ts';
import { M38_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden, versionConflict } from './errors.ts';
import {
  isScope,
  isPlatformScope,
  isTrustTier,
  isIsolationLevel,
  isThreeSegmentPermission,
  evaluateActivationGate,
  clampPage,
  REASON_CODES,
} from './domain.ts';
import { AutomationRepository, type ExtensionRow, type InstallationRow } from './repository.ts';
import type { M38Emitter } from './emit.ts';

function contentHashOf(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex')}`;
}

export class ExtensionService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M38Emitter;
  private readonly repo: AutomationRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M38Emitter,
    repo: AutomationRepository = new AutomationRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }
  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M38_PERMISSIONS.administer);
  }

  async defineExtension(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      extensionKey: string;
      name: string;
      publisher?: string | null;
      trustTier?: string;
      isolationLevel?: string;
      idempotencyKey?: string | null;
    },
  ): Promise<ExtensionRow> {
    await this.authz.require(ctx, M38_PERMISSIONS.extensionManage);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    const trustTier = input.trustTier ?? 'untrusted';
    const isolationLevel = input.isolationLevel ?? 'sandboxed';
    if (!isTrustTier(trustTier)) throw badRequest('unknown trust tier.', ctx.correlationId);
    if (!isIsolationLevel(isolationLevel)) throw badRequest('unknown isolation level.', ctx.correlationId);
    if (input.extensionKey.trim() === '' || input.name.trim() === '')
      throw badRequest('an extension key and name are required.', ctx.correlationId);
    const contentHash = contentHashOf({ extensionKey: input.extensionKey, trustTier, isolationLevel });
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findExtensionByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const extension = await this.repo.insertExtension(tx, {
        tenantId: ctx.tenantId,
        scope,
        extensionKey: input.extensionKey,
        name: input.name,
        publisher: input.publisher ?? null,
        trustTier,
        isolationLevel,
        contentHash,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'extension',
        targetId: extension.id,
        fromStatus: null,
        toStatus: 'draft',
        reason: null,
        reasonCode: REASON_CODES.extensionDefined,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M38_AUDIT_CODES.extensionDefined,
        entityType: 'extension_definition',
        entityId: extension.id,
        detail: { extensionKey: input.extensionKey, trustTier, isolationLevel, scope },
      });
      return extension;
    });
  }

  /** Declare a registered extension point + the m02 permission it requires (facade rule; no raw code). */
  async addPoint(
    ctx: RequestContext,
    actor: string | null,
    extensionId: string,
    input: {
      pointKey: string;
      capabilityRef: string;
      requiredPermission: string;
      description?: string | null;
    },
  ): Promise<{ id: string }> {
    await this.authz.require(ctx, M38_PERMISSIONS.extensionManage);
    if (input.pointKey.trim() === '' || input.capabilityRef.trim() === '')
      throw badRequest('a point key and capability reference are required.', ctx.correlationId);
    if (!isThreeSegmentPermission(input.requiredPermission))
      throw badRequest(
        'an extension point must carry a 3-segment m02 permission (never bypasses RBAC).',
        ctx.correlationId,
      );
    return this.db.withTenant(ctx, async (tx) => {
      const extension = await this.repo.getExtension(tx, extensionId);
      if (extension === null) throw badRequest('unknown extension.', ctx.correlationId);
      if (extension.state !== 'draft')
        throw badRequest('points can only be added while the extension is a draft.', ctx.correlationId);
      const point = await this.repo.insertPoint(tx, {
        tenantId: ctx.tenantId,
        extensionId,
        pointKey: input.pointKey,
        capabilityRef: input.capabilityRef,
        requiredPermission: input.requiredPermission,
        description: input.description ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M38_AUDIT_CODES.extensionPointAdded,
        entityType: 'extension_point',
        entityId: point.id,
        detail: { extensionId, pointKey: input.pointKey, requiredPermission: input.requiredPermission },
      });
      return point;
    });
  }

  async validateExtensionById(
    ctx: RequestContext,
    actor: string | null,
    extensionId: string,
    expectedVersion: number,
  ): Promise<{ passed: boolean; reasonCode: string }> {
    await this.authz.require(ctx, M38_PERMISSIONS.extensionManage);
    return this.db.withTenant(ctx, async (tx) => {
      const extension = await this.repo.getExtension(tx, extensionId);
      if (extension === null) throw badRequest('unknown extension.', ctx.correlationId);
      const points = await this.repo.listPoints(tx, extensionId);
      const passed =
        points.length > 0 && points.every((p) => isThreeSegmentPermission(p.required_permission));
      if (passed) {
        const moved = await this.repo.updateExtensionState(tx, extensionId, expectedVersion, {
          state: 'review_pending',
          validationPassed: true,
          by: actor,
        });
        if (moved === null) throw versionConflict(ctx.correlationId);
        await this.repo.insertReview(tx, {
          tenantId: ctx.tenantId,
          targetType: 'extension',
          targetId: extensionId,
          kind: 'requested',
          requestedBy: actor ?? '',
          decidedBy: null,
          reason: null,
          reasonCode: REASON_CODES.reviewRequested,
          correlationId: ctx.correlationId,
        });
        await this.emitter.recordAudit(tx, ctx, {
          code: M38_AUDIT_CODES.extensionReviewRequested,
          entityType: 'extension_definition',
          entityId: extensionId,
          detail: { pointCount: points.length },
        });
      } else {
        await this.emitter.recordAudit(tx, ctx, {
          code: M38_AUDIT_CODES.extensionSodBlocked,
          entityType: 'extension_definition',
          entityId: extensionId,
          detail: { reasonCode: REASON_CODES.structuralInvalid },
        });
      }
      return { passed, reasonCode: passed ? REASON_CODES.reviewRequested : REASON_CODES.structuralInvalid };
    });
  }

  /** Publish an extension — a controlled action (maker-checker/SoD over a passing validation). AI never approves. */
  async publishExtension(
    ctx: RequestContext,
    actor: string | null,
    extensionId: string,
    expectedVersion: number,
  ): Promise<ExtensionRow> {
    await this.authz.require(ctx, M38_PERMISSIONS.extensionPublish);
    return this.db.withTenant(ctx, async (tx) => {
      const extension = await this.repo.getExtension(tx, extensionId);
      if (extension === null) throw badRequest('unknown extension.', ctx.correlationId);
      await this.authorizeScope(ctx, extension.scope);
      if (extension.state !== 'review_pending')
        throw badRequest('only an extension in review can be published.', ctx.correlationId);
      const request = await this.repo.findOpenReviewRequest(tx, 'extension', extensionId);
      const gate = evaluateActivationGate({
        validationPassed: extension.validation_passed,
        requestedBy: request?.requested_by ?? '',
        approver: actor,
      });
      if (!gate.allowed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M38_AUDIT_CODES.extensionSodBlocked,
          entityType: 'extension_definition',
          entityId: extensionId,
          detail: { reasonCode: gate.reasonCode },
        });
        throw governanceForbidden(gate.reasonCode, ctx.correlationId);
      }
      const moved = await this.repo.updateExtensionState(tx, extensionId, expectedVersion, {
        state: 'published',
        validationPassed: true,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'extension',
        targetId: extensionId,
        kind: 'approved',
        requestedBy: request?.requested_by ?? '',
        decidedBy: actor,
        reason: null,
        reasonCode: REASON_CODES.published,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'extension',
        targetId: extensionId,
        fromStatus: 'review_pending',
        toStatus: 'published',
        reason: null,
        reasonCode: REASON_CODES.published,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M38_AUDIT_CODES.extensionPublished,
        entityType: 'extension_definition',
        entityId: extensionId,
        detail: { extensionKey: extension.extension_key, trustTier: extension.trust_tier },
      });
      await this.emitter.publishExtension(tx, 'ExtensionPublished', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: extensionId,
          recordType: 'extension',
          trustTier: extension.trust_tier,
          toStatus: 'published',
          reasonCode: REASON_CODES.published,
        },
      });
      return moved;
    });
  }

  /** Install/enable a PUBLISHED extension for the tenant. */
  async installExtension(
    ctx: RequestContext,
    actor: string | null,
    extensionId: string,
    input: { installKey: string; idempotencyKey?: string | null },
  ): Promise<InstallationRow> {
    await this.authz.require(ctx, M38_PERMISSIONS.extensionInstall);
    if (input.installKey.trim() === '') throw badRequest('an install key is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const extension = await this.repo.getExtension(tx, extensionId);
      if (extension === null) throw badRequest('unknown extension.', ctx.correlationId);
      if (extension.state !== 'published')
        throw governanceForbidden(REASON_CODES.structuralInvalid, ctx.correlationId);
      const installation = await this.repo.insertInstallation(tx, {
        tenantId: ctx.tenantId,
        extensionId,
        installKey: input.installKey,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M38_AUDIT_CODES.extensionInstalled,
        entityType: 'extension_installation',
        entityId: installation.id,
        detail: { extensionId, installKey: input.installKey },
      });
      await this.emitter.publishExtension(tx, 'ExtensionInstalled', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: installation.id,
          recordType: 'installation',
          toStatus: 'enabled',
          reasonCode: REASON_CODES.installed,
        },
      });
      return installation;
    });
  }

  async disableInstallation(
    ctx: RequestContext,
    actor: string | null,
    installationId: string,
  ): Promise<InstallationRow> {
    await this.authz.require(ctx, M38_PERMISSIONS.extensionInstall);
    return this.db.withTenant(ctx, async (tx) => {
      const installation = await this.repo.getInstallation(tx, installationId);
      if (installation === null) throw badRequest('unknown installation.', ctx.correlationId);
      if (installation.status !== 'enabled')
        throw badRequest('only an enabled installation can be disabled.', ctx.correlationId);
      const moved = await this.repo.updateInstallationStatus(tx, installationId, installation.version, {
        status: 'disabled',
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'installation',
        targetId: installationId,
        fromStatus: 'enabled',
        toStatus: 'disabled',
        reason: null,
        reasonCode: REASON_CODES.disabled,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M38_AUDIT_CODES.extensionDisabled,
        entityType: 'extension_installation',
        entityId: installationId,
        detail: {},
      });
      await this.emitter.publishExtension(tx, 'ExtensionDisabled', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: installationId,
          recordType: 'installation',
          toStatus: 'disabled',
          reasonCode: REASON_CODES.disabled,
        },
      });
      return moved;
    });
  }

  async getExtension(ctx: RequestContext, id: string): Promise<ExtensionRow | null> {
    await this.authz.require(ctx, M38_PERMISSIONS.extensionRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getExtension(tx, id));
  }
  async listExtensions(
    ctx: RequestContext,
    page?: { limit?: number; offset?: number },
  ): Promise<ExtensionRow[]> {
    await this.authz.require(ctx, M38_PERMISSIONS.extensionRead);
    const { limit, offset } = clampPage(page?.limit, page?.offset);
    return this.db.withTenant(ctx, (tx) => this.repo.listExtensions(tx, limit, offset));
  }
}
