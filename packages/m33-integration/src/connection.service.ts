/**
 * ConnectionService + RunService.
 *  - `ConnectionService` manages tenant connections. A connection config is screened for RAW SECRET VALUES (a secret-keyed
 *    field must be an opaque `secretref:` pointer — the m30 seam; a raw secret fails closed). Secrets are stored ONLY as
 *    opaque references in `connection_secret` (never a value). Managing a connection is privileged.
 *  - `RunService` executes a connector capability through the FRAMEWORK-ONLY `ConnectorRuntimePort` — a fail-closed
 *    abstraction with deterministic offline doubles (no production egress, no real provider call). A run against an
 *    unavailable runtime is durably BLOCKED, never guessed. Executing is privileged (external access).
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M33_PERMISSIONS } from './permissions.ts';
import { M33_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden, versionConflict } from './errors.ts';
import {
  isScope,
  isPlatformScope,
  isSecretReference,
  screenConnectionConfig,
  REASON_CODES,
} from './domain.ts';
import {
  IntegrationRepository,
  type ConnectionRow,
  type ConnectionSecretRow,
  type ConnectorRunRow,
} from './repository.ts';
import type { M33Emitter } from './emit.ts';
import type { ConnectorRuntimePort } from './ports.ts';

export class ConnectionService {
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

  async createConnection(
    ctx: RequestContext,
    actor: string | null,
    input: {
      connectorId: string;
      scope?: string;
      connectionKey: string;
      name: string;
      config?: unknown;
      idempotencyKey?: string | null;
    },
  ): Promise<ConnectionRow> {
    await this.authz.require(ctx, M33_PERMISSIONS.connectionManage);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    if (input.connectionKey.trim() === '')
      throw badRequest('a connection key is required.', ctx.correlationId);
    // SECRET SEAM: a connection config must carry NO raw secret value (secret-keyed fields must be secretref: pointers).
    const findings = screenConnectionConfig(input.config ?? {});
    if (findings.length > 0) {
      await this.db.withTenant(ctx, (tx) =>
        this.emitter.recordAudit(tx, ctx, {
          code: M33_AUDIT_CODES.publishBlocked,
          entityType: 'connection',
          entityId: input.connectorId,
          detail: { reasonCode: findings[0]?.code ?? REASON_CODES.secretValueForbidden },
        }),
      );
      throw governanceForbidden(findings[0]?.code ?? REASON_CODES.secretValueForbidden, ctx.correlationId);
    }
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findConnectionByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return existing;
      }
      const connector = await this.repo.getConnector(tx, input.connectorId);
      if (connector === null) throw badRequest('unknown connector.', ctx.correlationId);
      const connection = await this.repo.insertConnection(tx, {
        tenantId: ctx.tenantId,
        connectorId: input.connectorId,
        scope,
        connectionKey: input.connectionKey,
        name: input.name,
        config: input.config ?? {},
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'connection',
        targetId: connection.id,
        fromStatus: null,
        toStatus: 'draft',
        reason: null,
        reasonCode: REASON_CODES.connectionCreated,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M33_AUDIT_CODES.connectionCreated,
        entityType: 'connection',
        entityId: connection.id,
        detail: { connectorId: input.connectorId, connectionKey: input.connectionKey, scope },
      });
      await this.emitter.publishConnector(tx, 'ConnectionConfigured', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: connection.id,
          recordType: 'connection',
          toStatus: 'draft',
          reasonCode: REASON_CODES.connectionCreated,
        },
      });
      return connection;
    });
  }

  /** Attach an OPAQUE secret reference to a connection (the m30 seam). A raw secret value is refused — pointer only. */
  async setSecret(
    ctx: RequestContext,
    actor: string | null,
    connectionId: string,
    input: { purpose: string; secretRef: string; idempotencyKey?: string | null },
  ): Promise<ConnectionSecretRow> {
    await this.authz.require(ctx, M33_PERMISSIONS.connectionManage);
    if (!isSecretReference(input.secretRef)) {
      await this.db.withTenant(ctx, (tx) =>
        this.emitter.recordAudit(tx, ctx, {
          code: M33_AUDIT_CODES.publishBlocked,
          entityType: 'connection_secret',
          entityId: connectionId,
          detail: { reasonCode: REASON_CODES.secretValueForbidden },
        }),
      );
      throw governanceForbidden(REASON_CODES.secretValueForbidden, ctx.correlationId);
    }
    return this.db.withTenant(ctx, async (tx) => {
      const connection = await this.repo.getConnection(tx, connectionId);
      if (connection === null) throw badRequest('unknown connection.', ctx.correlationId);
      const secret = await this.repo.insertConnectionSecret(tx, {
        tenantId: ctx.tenantId,
        connectionId,
        purpose: input.purpose,
        secretRef: input.secretRef,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M33_AUDIT_CODES.connectionSecretSet,
        entityType: 'connection_secret',
        entityId: secret.id,
        detail: { connectionId, purpose: input.purpose },
      });
      return secret;
    });
  }

  async setStatus(
    ctx: RequestContext,
    actor: string | null,
    connectionId: string,
    expectedVersion: number,
    status: 'draft' | 'active' | 'disabled' | 'error',
  ): Promise<ConnectionRow> {
    await this.authz.require(ctx, M33_PERMISSIONS.connectionManage);
    return this.db.withTenant(ctx, async (tx) => {
      const current = await this.repo.getConnection(tx, connectionId);
      if (current === null) throw badRequest('unknown connection.', ctx.correlationId);
      const updated = await this.repo.updateConnection(tx, connectionId, expectedVersion, {
        name: current.name,
        config: current.config,
        status,
        by: actor,
      });
      if (updated === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'connection',
        targetId: connectionId,
        fromStatus: current.status,
        toStatus: status,
        reason: null,
        reasonCode: REASON_CODES.connectionUpdated,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M33_AUDIT_CODES.connectionUpdated,
        entityType: 'connection',
        entityId: connectionId,
        detail: { status },
      });
      return updated;
    });
  }

  async getConnection(ctx: RequestContext, id: string): Promise<ConnectionRow | null> {
    await this.authz.require(ctx, M33_PERMISSIONS.connectionRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getConnection(tx, id));
  }
  async listSecrets(ctx: RequestContext, connectionId: string): Promise<ConnectionSecretRow[]> {
    await this.authz.require(ctx, M33_PERMISSIONS.connectionManage);
    return this.db.withTenant(ctx, (tx) => this.repo.listConnectionSecrets(tx, connectionId));
  }
}

export class RunService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M33Emitter;
  private readonly runtime: ConnectorRuntimePort;
  private readonly repo: IntegrationRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M33Emitter,
    runtime: ConnectorRuntimePort,
    repo: IntegrationRepository = new IntegrationRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.runtime = runtime;
    this.repo = repo;
  }

  /** Execute a connector capability through the FRAMEWORK-ONLY runtime. A run against an unavailable runtime is durably
   * BLOCKED (fail closed) — never a production call. Privileged (external access). Idempotent. */
  async executeRun(
    ctx: RequestContext,
    actor: string | null,
    input: { connectionId: string; capabilityId: string; direction?: string; idempotencyKey?: string | null },
  ): Promise<ConnectorRunRow> {
    await this.authz.require(ctx, M33_PERMISSIONS.runExecute);
    const direction = input.direction ?? 'outbound';

    const idem = input.idempotencyKey;
    if (idem != null && idem !== '') {
      const existing = await this.db.withTenant(ctx, (tx) => this.repo.findRunByIdempotencyKey(tx, idem));
      if (existing !== null) return existing;
    }

    // Phase 1 — load + validate (connection active; capability belongs to a PUBLISHED connector).
    const prepared = await this.db.withTenant(ctx, async (tx) => {
      const connection = await this.repo.getConnection(tx, input.connectionId);
      if (connection === null) throw badRequest('unknown connection.', ctx.correlationId);
      const capability = await this.repo.getCapability(tx, input.capabilityId);
      if (capability === null) throw badRequest('unknown capability.', ctx.correlationId);
      const connector = await this.repo.getConnector(tx, capability.connector_id);
      if (connector?.state !== 'published')
        throw governanceForbidden(REASON_CODES.connectorNotPublished, ctx.correlationId);
      return { connection, capability, connector };
    });

    // Phase 2 — FRAMEWORK-ONLY runtime (deterministic double / fail-closed; NO production egress).
    const result = await this.runtime.execute(ctx, {
      connectorKey: prepared.connector.connector_key,
      capabilityKey: prepared.capability.capability_key,
      direction,
      connectionId: input.connectionId,
    });
    const blocked =
      this.runtime.kind === 'unavailable' || result.reasonCode === REASON_CODES.runtimeUnavailable;

    // Phase 3 — persist the run + attempt + audit + event atomically.
    return this.db.withTenant(ctx, async (tx) => {
      const run = await this.repo.insertRun(tx, {
        tenantId: ctx.tenantId,
        connectionId: input.connectionId,
        capabilityId: input.capabilityId,
        direction,
        runtimeKind: this.runtime.kind,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M33_AUDIT_CODES.runStarted,
        entityType: 'connector_run',
        entityId: run.id,
        detail: { capabilityKey: prepared.capability.capability_key, runtimeKind: this.runtime.kind },
      });
      await this.emitter.publishConnector(tx, 'RunStarted', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: run.id,
          recordType: 'run',
          capabilityKey: prepared.capability.capability_key,
          direction,
          toStatus: 'running',
          reasonCode: REASON_CODES.runStarted,
        },
      });

      const status = blocked ? 'blocked' : result.status;
      const reasonCode = blocked
        ? REASON_CODES.runBlocked
        : result.status === 'succeeded'
          ? REASON_CODES.runSucceeded
          : REASON_CODES.runFailed;
      await this.repo.insertRunAttempt(tx, {
        tenantId: ctx.tenantId,
        runId: run.id,
        attemptNo: 1,
        status,
        reasonCode,
        correlationId: ctx.correlationId,
        by: actor,
      });
      const completed = await this.repo.completeRun(tx, run.id, run.version, {
        status,
        rowCount: result.rowCount,
        reasonCode,
        by: actor,
      });
      if (completed === null) throw versionConflict(ctx.correlationId);

      if (blocked) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M33_AUDIT_CODES.runBlocked,
          entityType: 'connector_run',
          entityId: run.id,
          detail: { reasonCode: REASON_CODES.runtimeUnavailable },
        });
        await this.emitter.publishConnector(tx, 'RunBlocked', {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: {
            recordId: run.id,
            recordType: 'run',
            toStatus: 'blocked',
            reasonCode: REASON_CODES.runBlocked,
          },
        });
      } else {
        await this.emitter.recordAudit(tx, ctx, {
          code: M33_AUDIT_CODES.runCompleted,
          entityType: 'connector_run',
          entityId: run.id,
          detail: { status, rowCount: result.rowCount },
        });
        await this.emitter.publishConnector(tx, 'RunCompleted', {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: {
            recordId: run.id,
            recordType: 'run',
            rowCount: result.rowCount,
            toStatus: status,
            reasonCode,
          },
        });
      }
      return completed;
    });
  }
}
