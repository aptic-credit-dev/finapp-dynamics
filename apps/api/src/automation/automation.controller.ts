import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { AutomationService, M38_PERMISSIONS, M38_AUDIT_CODES } from '@finapp/m38-automation';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { automationView, stepView, scheduleView, runView } from './views.ts';

/**
 * Automation DEFINITIONS + STEPS + SCHEDULES + RUNS under `/api/v1/automation`. Authoring is unprivileged; ACTIVATION (a
 * controlled maker-checker action) and manual RUN (framework-only execution of registered capabilities) are privileged and
 * audited. No endpoint accepts executable code — steps reference registered capabilities by opaque id + required permission.
 * Reads carry no `@Endpoint` — the read permission is enforced in-service.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function reqNum(v: unknown, name: string, cid: string): number {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  throw new Error(`${name} is required (correlation ${cid})`);
}

@Controller('automation')
export class AutomationController {
  private readonly automations: AutomationService;
  private readonly actors: ActorContextFactory;
  constructor(automations: AutomationService, actors: ActorContextFactory) {
    this.automations = automations;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M38_PERMISSIONS.jobManage,
    auditCode: M38_AUDIT_CODES.automationDefined,
    description: 'Define an automation (draft).',
  })
  @Post('automations')
  async defineAutomation(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'define automation (m38)');
    const a = await this.automations.defineAutomation(s.ctx, s.actor.identityId, {
      automationKey: requireString(b['automationKey'], 'automationKey', s.correlationId),
      name: requireString(b['name'], 'name', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      ...optStr(b['triggerKind'], 'triggerKind'),
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return automationView(a);
  }

  @Get('automations')
  async listAutomations(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'browse automations (m38)');
    const rows = await this.automations.listAutomations(s.ctx, {});
    return { automations: rows.map(automationView) };
  }

  @Endpoint({
    permission: M38_PERMISSIONS.jobManage,
    auditCode: M38_AUDIT_CODES.automationStepAdded,
    description: 'Add a step referencing a registered capability + the m02 permission it requires.',
  })
  @Post('automations/:id/steps')
  async addStep(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add automation step (m38)');
    const step = await this.automations.addStep(s.ctx, s.actor.identityId, id, {
      stepNo: reqNum(b['stepNo'], 'stepNo', s.correlationId),
      capabilityRef: requireString(b['capabilityRef'], 'capabilityRef', s.correlationId),
      requiredPermission: requireString(b['requiredPermission'], 'requiredPermission', s.correlationId),
      ...optStr(b['configSecretRef'], 'configSecretRef'),
    });
    return stepView(step);
  }

  @Endpoint({
    permission: M38_PERMISSIONS.jobManage,
    auditCode: M38_AUDIT_CODES.automationScheduleSet,
    description: 'Set a governed recurring schedule (bounded frequency; composes m06 timer).',
  })
  @Post('automations/:id/schedule')
  async setSchedule(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'set automation schedule (m38)');
    const schedule = await this.automations.setSchedule(s.ctx, s.actor.identityId, id, {
      scheduleKey: requireString(b['scheduleKey'], 'scheduleKey', s.correlationId),
      recurrence: requireString(b['recurrence'], 'recurrence', s.correlationId),
      ...optStr(b['concurrencyPolicy'], 'concurrencyPolicy'),
      ...optStr(b['missedRunPolicy'], 'missedRunPolicy'),
    });
    return scheduleView(schedule);
  }

  @Endpoint({
    permission: M38_PERMISSIONS.jobManage,
    auditCode: M38_AUDIT_CODES.automationReviewRequested,
    description: 'Validate an automation (the facade rule: every step carries a permission).',
  })
  @Post('automations/:id/validate')
  async validateAutomation(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'validate automation (m38)');
    const out = await this.automations.validateAutomationById(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return { passed: out.passed, findings: out.findings };
  }

  @Endpoint({
    permission: M38_PERMISSIONS.jobManage,
    auditCode: M38_AUDIT_CODES.automationReviewRequested,
    description: 'Send a validated automation for review.',
  })
  @Post('automations/:id/review')
  async reviewAutomation(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'request automation review (m38)');
    const a = await this.automations.requestReview(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return automationView(a);
  }

  @Endpoint({
    permission: M38_PERMISSIONS.jobActivate,
    auditCode: M38_AUDIT_CODES.automationActivated,
    description: 'Activate an automation (maker-checker; approver != requester, human).',
  })
  @Post('automations/:id/activate')
  async activateAutomation(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'activate automation (m38)');
    const a = await this.automations.activateAutomation(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return automationView(a);
  }

  @Endpoint({
    permission: M38_PERMISSIONS.jobManage,
    auditCode: M38_AUDIT_CODES.automationSuspended,
    description: 'Suspend an active automation.',
  })
  @Post('automations/:id/suspend')
  async suspendAutomation(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'suspend automation (m38)');
    const a = await this.automations.suspendAutomation(s.ctx, s.actor.identityId, id);
    return automationView(a);
  }

  @Endpoint({
    permission: M38_PERMISSIONS.jobActivate,
    auditCode: M38_AUDIT_CODES.runRecorded,
    description:
      'Run an active automation (framework-only; invokes registered capabilities via their owning contracts).',
  })
  @Post('automations/:id/runs')
  async runAutomation(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'run automation (m38)');
    const run = await this.automations.runAutomation(s.ctx, s.actor.identityId, id, {
      runKey: requireString(b['runKey'], 'runKey', s.correlationId),
    });
    return runView(run);
  }
}
