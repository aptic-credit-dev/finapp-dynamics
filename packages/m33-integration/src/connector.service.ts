/**
 * ConnectorService — the governed connector SDK/registry: define a connector, register its governed capabilities,
 * validate (fail closed), and PUBLISH it (a controlled action — maker-checker/SoD: a human approver who is NOT the
 * requester; a published connector is immutable via DB trigger, and publishing a new version deprecates the prior one). It
 * also answers m31's capability catalog: a capability reference is available iff it maps to a PUBLISHED connector's active
 * capability. Every mutation authorizes an `integration.*` permission (default deny) and is audited through m03 in the same
 * transaction. NO arbitrary code — capabilities are declarative descriptors.
 */
import { createHash } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M33_PERMISSIONS } from './permissions.ts';
import { M33_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden, versionConflict } from './errors.ts';
import {
  isScope,
  isPlatformScope,
  isAuthKind,
  isCategory,
  isDirection,
  isCapabilityKind,
  validateConnectorDefinition,
  evaluateSodGate,
  evaluatePublishGate,
  clampPage,
  REASON_CODES,
} from './domain.ts';
import {
  IntegrationRepository,
  type ConnectorDefinitionRow,
  type ConnectorCapabilityRow,
} from './repository.ts';
import type { M33Emitter } from './emit.ts';
import type { CapabilityAvailabilityProvider } from './ports.ts';
import type { IntegrationCapability } from '@finapp/m31-studio';

export function contentHashOf(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex')}`;
}

/** Parse an m31 capability reference. Accepts `connector:<connectorKey>/<capabilityKey>` or `<connectorKey>/<capabilityKey>`. */
function parseCapabilityRef(ref: string): { connectorKey: string; capabilityKey: string } | null {
  const body = ref.startsWith('connector:') ? ref.slice('connector:'.length) : ref;
  const slash = body.indexOf('/');
  if (slash <= 0 || slash === body.length - 1) return null;
  return { connectorKey: body.slice(0, slash), capabilityKey: body.slice(slash + 1) };
}

export class ConnectorService implements CapabilityAvailabilityProvider {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M33Emitter;
  private readonly repo: IntegrationRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M33Emitter,
    repo: IntegrationRepository = new IntegrationRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }
  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M33_PERMISSIONS.administer);
  }

  async defineConnector(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      connectorKey: string;
      name: string;
      vendor?: string | null;
      category?: string;
      authKind?: string;
      description?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<ConnectorDefinitionRow> {
    await this.authz.require(ctx, M33_PERMISSIONS.connectorAuthor);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    const category = input.category ?? 'custom';
    const authKind = input.authKind ?? 'none';
    if (!isCategory(category)) throw badRequest('unknown category.', ctx.correlationId);
    if (!isAuthKind(authKind)) throw badRequest('unknown auth kind.', ctx.correlationId);
    if (input.connectorKey.trim() === '') throw badRequest('a connector key is required.', ctx.correlationId);
    const contentHash = contentHashOf({ connectorKey: input.connectorKey, authKind, category });
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findConnectorByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const connector = await this.repo.insertConnector(tx, {
        tenantId: ctx.tenantId,
        scope,
        connectorKey: input.connectorKey,
        name: input.name,
        vendor: input.vendor ?? null,
        category,
        authKind,
        description: input.description ?? null,
        contentHash,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'connector',
        targetId: connector.id,
        fromStatus: null,
        toStatus: 'draft',
        reason: null,
        reasonCode: REASON_CODES.connectorDefined,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M33_AUDIT_CODES.connectorDefined,
        entityType: 'connector_definition',
        entityId: connector.id,
        detail: { connectorKey: input.connectorKey, category, authKind, scope },
      });
      return connector;
    });
  }

  /** Register a governed, declarative capability on a connector (no executable). */
  async registerCapability(
    ctx: RequestContext,
    actor: string | null,
    connectorId: string,
    input: {
      capabilityKey: string;
      name: string;
      direction?: string;
      kind?: string;
      inputSchema?: unknown;
      idempotencyKey?: string | null;
    },
  ): Promise<ConnectorCapabilityRow> {
    await this.authz.require(ctx, M33_PERMISSIONS.connectorAuthor);
    const direction = input.direction ?? 'outbound';
    const kind = input.kind ?? 'read';
    if (!isDirection(direction)) throw badRequest('unknown direction.', ctx.correlationId);
    if (!isCapabilityKind(kind)) throw badRequest('unknown capability kind.', ctx.correlationId);
    if (input.capabilityKey.trim() === '')
      throw badRequest('a capability key is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const connector = await this.repo.getConnector(tx, connectorId);
      if (connector === null) throw badRequest('unknown connector.', ctx.correlationId);
      const cap = await this.repo.insertCapability(tx, {
        tenantId: ctx.tenantId,
        connectorId,
        capabilityKey: input.capabilityKey,
        name: input.name,
        direction,
        kind,
        inputSchema: input.inputSchema ?? {},
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M33_AUDIT_CODES.capabilityRegistered,
        entityType: 'connector_capability',
        entityId: cap.id,
        detail: { connectorId, capabilityKey: input.capabilityKey, direction, kind },
      });
      return cap;
    });
  }

  async validateConnector(
    ctx: RequestContext,
    actor: string | null,
    connectorId: string,
    expectedVersion: number,
  ): Promise<{ passed: boolean; findings: readonly { code: string; ref?: string }[] }> {
    await this.authz.require(ctx, M33_PERMISSIONS.connectorAuthor);
    return this.db.withTenant(ctx, async (tx) => {
      const connector = await this.repo.getConnector(tx, connectorId);
      if (connector === null) throw badRequest('unknown connector.', ctx.correlationId);
      const outcome = validateConnectorDefinition({
        connectorKey: connector.connector_key,
        authKind: connector.auth_kind,
        category: connector.category,
      });
      if (outcome.passed) {
        const moved = await this.repo.updateConnectorState(tx, connectorId, expectedVersion, {
          state: 'validated',
          validationPassed: true,
          by: actor,
        });
        if (moved === null) throw versionConflict(ctx.correlationId);
        await this.emitter.recordAudit(tx, ctx, {
          code: M33_AUDIT_CODES.connectorValidated,
          entityType: 'connector_definition',
          entityId: connectorId,
          detail: { connectorKey: connector.connector_key },
        });
      } else {
        await this.emitter.recordAudit(tx, ctx, {
          code: M33_AUDIT_CODES.publishBlocked,
          entityType: 'connector_definition',
          entityId: connectorId,
          detail: { reasonCode: REASON_CODES.validationFailed },
        });
      }
      return outcome;
    });
  }

  async requestReview(
    ctx: RequestContext,
    actor: string | null,
    connectorId: string,
    expectedVersion: number,
  ): Promise<ConnectorDefinitionRow> {
    await this.authz.require(ctx, M33_PERMISSIONS.connectorAuthor);
    if (actor === null || actor.trim() === '')
      throw badRequest('an identified requester is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const connector = await this.repo.getConnector(tx, connectorId);
      if (connector === null) throw badRequest('unknown connector.', ctx.correlationId);
      if (connector.state !== 'validated')
        throw badRequest('only a validated connector can be sent for review.', ctx.correlationId);
      const moved = await this.repo.updateConnectorState(tx, connectorId, expectedVersion, {
        state: 'review_pending',
        validationPassed: true,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'connector',
        targetId: connectorId,
        kind: 'requested',
        requestedBy: actor,
        decidedBy: null,
        reason: null,
        reasonCode: REASON_CODES.reviewRequested,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M33_AUDIT_CODES.reviewRequested,
        entityType: 'connector_definition',
        entityId: connectorId,
        detail: { connectorKey: connector.connector_key },
      });
      return moved;
    });
  }

  /** PUBLISH a connector — a controlled action (maker-checker/SoD, human approver, validation passed). Deprecates the prior
   * published connector of the same key. AI never approves. */
  async publishConnector(
    ctx: RequestContext,
    actor: string | null,
    connectorId: string,
    expectedVersion: number,
  ): Promise<ConnectorDefinitionRow> {
    await this.authz.require(ctx, M33_PERMISSIONS.connectorPublish);
    return this.db.withTenant(ctx, async (tx) => {
      const connector = await this.repo.getConnector(tx, connectorId);
      if (connector === null) throw badRequest('unknown connector.', ctx.correlationId);
      await this.authorizeScope(ctx, connector.scope);
      if (connector.state !== 'review_pending')
        throw badRequest('only a connector in review can be published.', ctx.correlationId);
      const request = await this.repo.findOpenReviewRequest(tx, 'connector', connectorId);
      const gate = evaluatePublishGate({
        validationPassed: connector.validation_passed,
        requestedBy: request?.requested_by ?? '',
        approver: actor,
      });
      if (!gate.allowed) {
        const code =
          gate.reasonCode === REASON_CODES.selfApproval || gate.reasonCode === REASON_CODES.notHumanApprover
            ? M33_AUDIT_CODES.sodBlocked
            : M33_AUDIT_CODES.publishBlocked;
        await this.emitter.recordAudit(tx, ctx, {
          code,
          entityType: 'connector_definition',
          entityId: connectorId,
          detail: { reasonCode: gate.reasonCode },
        });
        throw governanceForbidden(gate.reasonCode, ctx.correlationId);
      }
      const prior = await this.repo.getPublishedConnectorByKey(tx, connector.scope, connector.connector_key);
      if (prior !== null && prior.id !== connectorId) {
        const deprecated = await this.repo.updateConnectorState(tx, prior.id, prior.version, {
          state: 'deprecated',
          validationPassed: prior.validation_passed,
          by: actor,
        });
        if (deprecated === null) throw versionConflict(ctx.correlationId);
        await this.emitter.recordAudit(tx, ctx, {
          code: M33_AUDIT_CODES.connectorDeprecated,
          entityType: 'connector_definition',
          entityId: prior.id,
          detail: { connectorKey: connector.connector_key },
        });
        await this.emitter.publishConnector(tx, 'ConnectorDeprecated', {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: {
            recordId: prior.id,
            recordType: 'connector',
            connectorKey: connector.connector_key,
            toStatus: 'deprecated',
            reasonCode: REASON_CODES.deprecated,
          },
        });
      }
      const published = await this.repo.updateConnectorState(tx, connectorId, expectedVersion, {
        state: 'published',
        validationPassed: true,
        by: actor,
      });
      if (published === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'connector',
        targetId: connectorId,
        kind: 'approved',
        requestedBy: request?.requested_by ?? '',
        decidedBy: actor,
        reason: null,
        reasonCode: REASON_CODES.published,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'connector',
        targetId: connectorId,
        fromStatus: 'review_pending',
        toStatus: 'published',
        reason: null,
        reasonCode: REASON_CODES.published,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M33_AUDIT_CODES.connectorPublished,
        entityType: 'connector_definition',
        entityId: connectorId,
        detail: { connectorKey: connector.connector_key, category: connector.category },
      });
      await this.emitter.publishConnector(tx, 'ConnectorPublished', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: connectorId,
          recordType: 'connector',
          connectorKey: connector.connector_key,
          category: connector.category,
          scope: connector.scope,
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
    connectorId: string,
    expectedVersion: number,
    reason: string | null = null,
  ): Promise<ConnectorDefinitionRow> {
    await this.authz.require(ctx, M33_PERMISSIONS.connectorPublish);
    return this.db.withTenant(ctx, async (tx) => {
      const connector = await this.repo.getConnector(tx, connectorId);
      if (connector === null) throw badRequest('unknown connector.', ctx.correlationId);
      if (connector.state !== 'review_pending')
        throw badRequest('only a connector in review can be rejected.', ctx.correlationId);
      const request = await this.repo.findOpenReviewRequest(tx, 'connector', connectorId);
      const sod = evaluateSodGate(request?.requested_by ?? '', actor);
      if (!sod.allowed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M33_AUDIT_CODES.sodBlocked,
          entityType: 'connector_definition',
          entityId: connectorId,
          detail: { reasonCode: sod.reasonCode },
        });
        throw governanceForbidden(sod.reasonCode, ctx.correlationId);
      }
      const moved = await this.repo.updateConnectorState(tx, connectorId, expectedVersion, {
        state: 'rejected',
        validationPassed: connector.validation_passed,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'connector',
        targetId: connectorId,
        kind: 'rejected',
        requestedBy: request?.requested_by ?? '',
        decidedBy: actor,
        reason,
        reasonCode: REASON_CODES.rejected,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M33_AUDIT_CODES.reviewRejected,
        entityType: 'connector_definition',
        entityId: connectorId,
        detail: {},
      });
      return moved;
    });
  }

  /** m31 catalog: a capability reference is available iff it maps to a PUBLISHED connector's active capability. Fail closed. */
  async isCapabilityAvailable(ctx: RequestContext, capabilityRef: string): Promise<IntegrationCapability> {
    const parsed = parseCapabilityRef(capabilityRef);
    if (parsed === null) return { available: false, reasonCode: REASON_CODES.unregisteredCapability };
    return this.db.withTenant(ctx, async (tx) => {
      const cap = await this.repo.findAvailableCapability(tx, parsed.connectorKey, parsed.capabilityKey);
      return cap !== null
        ? { available: true, reasonCode: 'capability_available' }
        : { available: false, reasonCode: REASON_CODES.unregisteredCapability };
    });
  }

  async getConnector(ctx: RequestContext, id: string): Promise<ConnectorDefinitionRow | null> {
    await this.authz.require(ctx, M33_PERMISSIONS.connectorRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getConnector(tx, id));
  }
  async listConnectors(
    ctx: RequestContext,
    page?: { limit?: number; offset?: number },
  ): Promise<ConnectorDefinitionRow[]> {
    await this.authz.require(ctx, M33_PERMISSIONS.connectorRead);
    const { limit, offset } = clampPage(page?.limit, page?.offset);
    return this.db.withTenant(ctx, (tx) => this.repo.listConnectors(tx, limit, offset));
  }
  async listCapabilities(ctx: RequestContext, connectorId: string): Promise<ConnectorCapabilityRow[]> {
    await this.authz.require(ctx, M33_PERMISSIONS.capabilityRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listCapabilities(tx, connectorId));
  }
}
