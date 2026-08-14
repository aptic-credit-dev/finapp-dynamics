import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { PlanService, M39_PERMISSIONS, M39_AUDIT_CODES } from '@finapp/m39-saas';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { planView, planVersionView } from './views.ts';

/**
 * Commercial CATALOGUE under `/api/v1/saas` — plans, versioned pricing/entitlements/quota policies, and the maker-checker
 * PUBLISH of a plan version. Authoring is unprivileged; PUBLISH is privileged + maker-checker (an independent human approver;
 * AI/system/automation refused). A published plan version is immutable (DB trigger). Money is bigint minor units (no float).
 * Reads carry no `@Endpoint` — the read permission is enforced in-service.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function reqNum(v: unknown, name: string, cid: string): number {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  throw new Error(`${name} is required (correlation ${cid})`);
}

@Controller('saas')
export class SaasCatalogController {
  private readonly plans: PlanService;
  private readonly actors: ActorContextFactory;
  constructor(plans: PlanService, actors: ActorContextFactory) {
    this.plans = plans;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M39_PERMISSIONS.planManage,
    auditCode: M39_AUDIT_CODES.planDefined,
    description: 'Define a commercial plan (draft).',
  })
  @Post('plans')
  async definePlan(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'define plan (m39)');
    const p = await this.plans.definePlan(s.ctx, {
      planKey: requireString(b['planKey'], 'planKey', s.correlationId),
      name: requireString(b['name'], 'name', s.correlationId),
      ...optStr(b['scope'], 'scope'),
    });
    return planView(p);
  }

  @Get('plans')
  async listPlans(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'browse plans (m39)');
    const rows = await this.plans.listPlans(s.ctx);
    return { plans: rows.map(planView) };
  }

  @Get('plans/:id')
  async getPlan(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'read plan (m39)');
    const p = await this.plans.getPlan(s.ctx, id);
    return p ? planView(p) : { plan: null };
  }

  @Endpoint({
    permission: M39_PERMISSIONS.planManage,
    auditCode: M39_AUDIT_CODES.planVersionDefined,
    description: 'Define a plan version (draft pricing/entitlement snapshot).',
  })
  @Post('plans/:id/versions')
  async defineVersion(
    @Param('id') planId: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'define plan version (m39)');
    const v = await this.plans.defineVersion(s.ctx, planId, {
      versionNo: reqNum(b['versionNo'], 'versionNo', s.correlationId),
      ...optStr(b['currency'], 'currency'),
      ...(typeof b['baseAmountMinor'] === 'number' ? { baseAmountMinor: b['baseAmountMinor'] } : {}),
      ...optStr(b['billingInterval'], 'billingInterval'),
    });
    return planVersionView(v);
  }

  @Endpoint({
    permission: M39_PERMISSIONS.planManage,
    auditCode: M39_AUDIT_CODES.planEntitlementAdded,
    description: 'Add an entitlement to a draft plan version.',
  })
  @Post('versions/:id/entitlements')
  async addEntitlement(
    @Param('id') planVersionId: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add plan entitlement (m39)');
    const r = await this.plans.addEntitlement(s.ctx, planVersionId, {
      capabilityKey: requireString(b['capabilityKey'], 'capabilityKey', s.correlationId),
      ...optStr(b['allowance'], 'allowance'),
    });
    return { id: r.id };
  }

  @Endpoint({
    permission: M39_PERMISSIONS.quotaManage,
    auditCode: M39_AUDIT_CODES.quotaPolicySet,
    description: 'Set a quota policy (hard limit) on a draft plan version.',
  })
  @Post('versions/:id/quota-policies')
  async addQuotaPolicy(
    @Param('id') planVersionId: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'set quota policy (m39)');
    const r = await this.plans.addQuotaPolicy(s.ctx, planVersionId, {
      capabilityKey: requireString(b['capabilityKey'], 'capabilityKey', s.correlationId),
      meterKey: requireString(b['meterKey'], 'meterKey', s.correlationId),
      limitHard: reqNum(b['limitHard'], 'limitHard', s.correlationId),
      ...optStr(b['period'], 'period'),
    });
    return { id: r.id };
  }

  @Endpoint({
    permission: M39_PERMISSIONS.planManage,
    auditCode: M39_AUDIT_CODES.planVersionDefined,
    description: 'Validate a draft plan version.',
  })
  @Post('versions/:id/validate')
  async validateVersion(@Param('id') planVersionId: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'validate plan version (m39)');
    return this.plans.validateVersion(s.ctx, planVersionId);
  }

  @Endpoint({
    permission: M39_PERMISSIONS.planPublish,
    auditCode: M39_AUDIT_CODES.planVersionPublished,
    description: 'Publish a plan version (maker-checker; an independent human approver).',
  })
  @Post('versions/:id/publish')
  async publishVersion(
    @Param('id') planVersionId: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'publish plan version (m39)');
    const v = await this.plans.publishVersion(
      s.ctx,
      s.actor.identityId,
      planVersionId,
      requireVersion(b['version'], s.correlationId),
      {
        requestedBy: requireString(b['requestedBy'], 'requestedBy', s.correlationId),
      },
    );
    return planVersionView(v);
  }
}
