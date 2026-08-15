import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { BackupDrService, M40_PERMISSIONS, M40_AUDIT_CODES } from '@finapp/m40-resilience';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { backupPolicyView, backupRunView, restoreRequestView, drPlanView } from './views.ts';

/**
 * BACKUP policies + runs, RESTORE/FAILOVER requests (maker-checker), and DR/BC plans + drill evidence under
 * `/api/v1/resilience`. Backup/restore/failover EXECUTION is framework-only (a fail-closed executor; no shell/dump/restore
 * command). A restore/failover is a controlled action: maker-checker/SoD approval (AI/system/automation refused), privileged.
 * No endpoint executes infrastructure directly. Reads carry no `@Endpoint` — the read permission is enforced in-service.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function optNum<K extends string>(v: unknown, k: K): Partial<Record<K, number>> {
  return typeof v === 'number' && Number.isInteger(v) ? ({ [k]: v } as Record<K, number>) : {};
}

@Controller('resilience')
export class ResilienceBackupController {
  private readonly svc: BackupDrService;
  private readonly actors: ActorContextFactory;
  constructor(svc: BackupDrService, actors: ActorContextFactory) {
    this.svc = svc;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M40_PERMISSIONS.backupManage,
    auditCode: M40_AUDIT_CODES.backupPolicySet,
    description: 'Set a backup policy (opaque schedule ref composes m06/m38; integer RTO/RPO).',
  })
  @Post('backup/policies')
  async setPolicy(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'set backup policy (m40)');
    const p = await this.svc.setPolicy(s.ctx, {
      policyKey: requireString(b['policyKey'], 'policyKey', s.correlationId),
      targetRef: requireString(b['targetRef'], 'targetRef', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      ...optStr(b['scheduleRef'], 'scheduleRef'),
      ...optStr(b['configSecretRef'], 'configSecretRef'),
      ...optNum(b['rtoSeconds'], 'rtoSeconds'),
      ...optNum(b['rpoSeconds'], 'rpoSeconds'),
      ...optNum(b['retentionDays'], 'retentionDays'),
    });
    return backupPolicyView(p);
  }

  @Endpoint({
    permission: M40_PERMISSIONS.backupManage,
    auditCode: M40_AUDIT_CODES.backupRunRecorded,
    description: 'Run a backup (framework-only; fail-closed executor).',
  })
  @Post('backup/policies/:id/runs')
  async runBackup(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'run backup (m40)');
    return backupRunView(
      await this.svc.runBackup(s.ctx, id, { runKey: requireString(b['runKey'], 'runKey', s.correlationId) }),
    );
  }

  @Endpoint({
    permission: M40_PERMISSIONS.restoreRequest,
    auditCode: M40_AUDIT_CODES.restoreRequested,
    description: 'Request a restore/failover (review pending; maker-checker to follow).',
  })
  @Post('restores')
  async requestRestore(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'request restore (m40)');
    const r = await this.svc.requestRestore(s.ctx, {
      requestKey: requireString(b['requestKey'], 'requestKey', s.correlationId),
      targetRef: requireString(b['targetRef'], 'targetRef', s.correlationId),
      ...optStr(b['kind'], 'kind'),
      ...optStr(b['backupRef'], 'backupRef'),
    });
    return restoreRequestView(r);
  }

  @Get('restores')
  async listRestores(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'browse restores (m40)');
    const rows = await this.svc.listRestores(s.ctx);
    return { restores: rows.map(restoreRequestView) };
  }

  @Endpoint({
    permission: M40_PERMISSIONS.restoreApprove,
    auditCode: M40_AUDIT_CODES.restoreApproved,
    description: 'Approve a restore/failover (privileged; maker-checker; independent human approver).',
  })
  @Post('restores/:id/approve')
  async approveRestore(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'approve restore (m40)');
    return restoreRequestView(
      await this.svc.approveRestore(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['version'], s.correlationId),
      ),
    );
  }

  @Endpoint({
    permission: M40_PERMISSIONS.restoreApprove,
    auditCode: M40_AUDIT_CODES.restoreRejected,
    description: 'Reject a restore/failover.',
  })
  @Post('restores/:id/reject')
  async rejectRestore(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'reject restore (m40)');
    return restoreRequestView(
      await this.svc.rejectRestore(
        s.ctx,
        id,
        requireVersion(b['version'], s.correlationId),
        requireString(b['reasonCode'], 'reasonCode', s.correlationId),
      ),
    );
  }

  @Endpoint({
    permission: M40_PERMISSIONS.restoreApprove,
    auditCode: M40_AUDIT_CODES.restoreExecuted,
    description: 'Execute an approved restore/failover (framework-only; fail-closed executor).',
  })
  @Post('restores/:id/execute')
  async executeRestore(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'execute restore (m40)');
    return restoreRequestView(
      await this.svc.executeRestore(s.ctx, id, requireVersion(b['version'], s.correlationId)),
    );
  }

  @Endpoint({
    permission: M40_PERMISSIONS.drManage,
    auditCode: M40_AUDIT_CODES.drPlanSet,
    description: 'Set a DR/BC plan (integer RTO/RPO).',
  })
  @Post('dr/plans')
  async setDrPlan(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'set dr plan (m40)');
    const p = await this.svc.setDrPlan(s.ctx, {
      planKey: requireString(b['planKey'], 'planKey', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      ...optNum(b['rtoSeconds'], 'rtoSeconds'),
      ...optNum(b['rpoSeconds'], 'rpoSeconds'),
    });
    return drPlanView(p);
  }

  @Endpoint({
    permission: M40_PERMISSIONS.drManage,
    auditCode: M40_AUDIT_CODES.drTestRecorded,
    description: 'Record a DR drill (append-only; SoD if a decision is attached).',
  })
  @Post('dr/plans/:id/tests')
  async recordDrTest(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'record dr test (m40)');
    return this.svc.recordDrTest(s.ctx, id, {
      testKey: requireString(b['testKey'], 'testKey', s.correlationId),
      outcome: requireString(b['outcome'], 'outcome', s.correlationId),
      ...optStr(b['scenario'], 'scenario'),
      ...optNum(b['measuredRecoverySeconds'], 'measuredRecoverySeconds'),
    });
  }
}
