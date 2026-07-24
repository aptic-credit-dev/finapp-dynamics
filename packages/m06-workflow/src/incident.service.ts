/**
 * IncidentService — recoverable execution failures (ADR-023). The drive raises incidents for unknown system
 * handlers, loop-limit hits, and poison steps. This service lists and resolves them, and RETRIES the affected
 * instance by re-driving its active tokens (the drive is idempotent for parked tasks, so a retry is safe).
 * Every action enforces its permission server-side and audits through the AUDIT port.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M06_PERMISSIONS } from './permissions.ts';
import { M06_AUDIT_CODES } from './audit-codes.ts';
import { WorkflowRepository, type IncidentRow } from './repository.ts';
import { type M06Emitter } from './emit.ts';
import { type InstanceService } from './instance.service.ts';

export class IncidentService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M06Emitter;
  private readonly instances: InstanceService;
  private readonly repo: WorkflowRepository;

  constructor(
    db: Db,
    authz: Authz,
    emitter: M06Emitter,
    instances: InstanceService,
    repo: WorkflowRepository = new WorkflowRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.instances = instances;
    this.repo = repo;
  }

  async list(
    ctx: RequestContext,
    opts: { status?: string; limit?: number; offset?: number } = {},
  ): Promise<IncidentRow[]> {
    await this.authz.require(ctx, M06_PERMISSIONS.incidentView);
    return this.db.withTenant(ctx, (tx) =>
      this.repo.listIncidents(tx, {
        ...(opts.status !== undefined ? { status: opts.status } : {}),
        limit: Math.min(opts.limit ?? 50, 200),
        offset: opts.offset ?? 0,
      }),
    );
  }

  async resolve(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    toStatus: 'resolved' | 'wont_fix',
    reason: string,
  ): Promise<IncidentRow> {
    await this.authz.require(ctx, M06_PERMISSIONS.incidentResolve);
    return this.db.withTenant(ctx, async (tx) => {
      const incident = await this.repo.findIncident(tx, id);
      if (incident === null) throw ProblemError.notFound('Workflow incident not found.', ctx.correlationId);
      const ok = await this.repo.resolveIncident(tx, { id, expectedVersion, toStatus, resolvedBy: actor });
      if (!ok)
        throw ProblemError.conflict(
          'Incident cannot be resolved (already resolved or stale version).',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M06_AUDIT_CODES.incidentResolved,
        entityType: 'workflow_incident',
        entityId: id,
        reason,
      });
      await this.emitter.publish(tx, {
        type: 'WorkflowIncidentResolved',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          incidentId: id,
          ...(incident.instance_id !== null ? { instanceId: incident.instance_id } : {}),
          errorCode: incident.error_code,
        },
      });
      const after = await this.repo.findIncident(tx, id);
      return after ?? incident;
    });
  }

  /** Retry the instance behind an incident by re-driving its active tokens. */
  async retry(ctx: RequestContext, actor: string | null, id: string): Promise<void> {
    await this.authz.require(ctx, M06_PERMISSIONS.instanceRetry);
    const incident = await this.db.withTenant(ctx, (tx) => this.repo.findIncident(tx, id));
    if (incident === null) throw ProblemError.notFound('Workflow incident not found.', ctx.correlationId);
    if (incident.instance_id === null)
      throw ProblemError.conflict('This incident is not attached to an instance.', ctx.correlationId);
    await this.db.withTenant(ctx, (tx) => this.repo.bumpIncidentRetry(tx, id, incident.version));
    await this.instances.retry(ctx, actor, incident.instance_id);
  }
}
