import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { Endpoint, ProblemError, type SystemContext } from '@finapp/kernel';
import {
  TENANT_AUDIT_CODES,
  TENANT_PERMISSIONS,
  UUID_PATTERN,
  // VALUE imports, deliberately not `import type`. NestJS resolves constructor dependencies from the
  // design-time metadata that `emitDecoratorMetadata` writes, and a type-only import is erased before
  // that metadata is emitted — leaving Nest with `Function` and an UnknownDependenciesException at boot.
  TenantService,
  TenantContextResolver,
  type TenantAction,
} from '@finapp/m01-tenant';
import { randomUUID } from 'node:crypto';

/**
 * The tenant administration API, under `/api/v1/tenants` (ADR-008).
 *
 * ROUTE PREFIX: `manifests/naming-map.yaml` registers m01's prefix as `/api/v1/tenants`. The kernel
 * validates at boot that a route's prefix belongs to the declaring module, so `/api/v1/admin/tenants`
 * would be rejected as a prefix m01 does not own.
 *
 * Every mutating route carries `@Endpoint({ permission, auditCode })`. The decorator validates the shape
 * at class-definition time and registers the route, which is what lets CI assert structurally that no
 * mutating route ships without a permission and a registered audit code — rather than trusting review to
 * notice every time.
 *
 * This is the one place in the repo that applies decorator syntax. The kernel deliberately never does,
 * so kernel source stays loadable under `node --experimental-strip-types` for the PURE suites.
 */

interface CreateTenantBody {
  code?: unknown;
  legalName?: unknown;
  tradingName?: unknown;
  tenantType?: unknown;
  defaultTimezone?: unknown;
  defaultCurrency?: unknown;
  country?: unknown;
  metadata?: unknown;
}

interface ActionBody {
  reason?: unknown;
  expectedVersion?: unknown;
}

@Controller('tenants')
export class TenantController {
  private readonly service: TenantService;
  private readonly resolver: TenantContextResolver;

  constructor(service: TenantService, resolver: TenantContextResolver) {
    this.service = service;
    this.resolver = resolver;
  }

  /**
   * Creates a tenant draft.
   *
   * Platform-level: it runs in system context because no tenant exists yet to be in the context of.
   * The permissions come from the caller's headers, which is honest only until m02 — see systemContext().
   */
  @Endpoint({
    permission: TENANT_PERMISSIONS.registryCreate,
    auditCode: TENANT_AUDIT_CODES.created,
    description: 'Create a tenant in draft status.',
  })
  @Post()
  async create(@Body() body: CreateTenantBody, @Headers() headers: Record<string, string>) {
    const ctx = systemContext(headers, 'create tenant draft');
    return this.service.createDraft(ctx, actorOf(headers), {
      code: requireString(body.code, 'code', ctx),
      legalName: requireString(body.legalName, 'legalName', ctx),
      tenantType: requireString(body.tenantType, 'tenantType', ctx),
      ...optionalString(body.tradingName, 'tradingName'),
      ...optionalString(body.defaultTimezone, 'defaultTimezone'),
      ...optionalString(body.defaultCurrency, 'defaultCurrency'),
      ...optionalString(body.country, 'country'),
      ...(isRecord(body.metadata) ? { metadata: body.metadata } : {}),
    });
  }

  @Get()
  async list(
    @Query('status') status: string | undefined,
    @Query('limit') limit: string | undefined,
    @Headers() headers: Record<string, string>,
  ) {
    const ctx = await this.contextFor(headers, 'list tenants');
    return this.service.list(ctx, {
      ...(status === undefined ? {} : { status }),
      ...(limit === undefined ? {} : { limit: Number.parseInt(limit, 10) }),
    });
  }

  @Get(':tenantId')
  async get(@Param('tenantId') tenantId: string, @Headers() headers: Record<string, string>) {
    const ctx = await this.contextFor(headers, 'read tenant');
    return this.service.get(ctx, requireUuid(tenantId, ctx.correlationId));
  }

  @Get(':tenantId/status-history')
  async history(@Param('tenantId') tenantId: string, @Headers() headers: Record<string, string>) {
    const ctx = await this.contextFor(headers, 'read tenant status history');
    return this.service.statusHistory(ctx, requireUuid(tenantId, ctx.correlationId));
  }

  @Endpoint({
    permission: TENANT_PERMISSIONS.registryEdit,
    auditCode: TENANT_AUDIT_CODES.updated,
    description: 'Update a tenant profile. Requires expectedVersion.',
  })
  @Patch(':tenantId')
  async update(
    @Param('tenantId') tenantId: string,
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string>,
  ) {
    const ctx = await this.contextFor(headers, 'update tenant');
    return this.service.updateProfile(ctx, actorOf(headers), requireUuid(tenantId, ctx.correlationId), {
      expectedVersion: requireVersion(body['expectedVersion'], ctx.correlationId),
      ...optionalString(body['legalName'], 'legalName'),
      ...optionalString(body['defaultTimezone'], 'defaultTimezone'),
      ...optionalString(body['defaultCurrency'], 'defaultCurrency'),
      ...optionalString(body['country'], 'country'),
      ...(isRecord(body['metadata']) ? { metadata: body['metadata'] } : {}),
      // tradingName is passed through even when null: "clear it" and "leave it" are different requests.
      ...('tradingName' in body ? { tradingName: body['tradingName'] as string | null } : {}),
    });
  }

  // --- lifecycle -----------------------------------------------------------------------------------
  //
  // One route per action, each with its own permission and audit code, all delegating to the same
  // server-side state machine. The route cannot decide the transition; it can only ask for one.

  @Endpoint({
    permission: TENANT_PERMISSIONS.registryReview,
    auditCode: TENANT_AUDIT_CODES.submittedForReview,
  })
  @Post(':tenantId/submit-review')
  async submitReview(
    @Param('tenantId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('submit_review', id, body, h);
  }

  @Endpoint({ permission: TENANT_PERMISSIONS.registryApprove, auditCode: TENANT_AUDIT_CODES.approved })
  @Post(':tenantId/approve')
  async approve(
    @Param('tenantId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('approve', id, body, h);
  }

  @Endpoint({ permission: TENANT_PERMISSIONS.registryApprove, auditCode: TENANT_AUDIT_CODES.rejected })
  @Post(':tenantId/reject')
  async reject(
    @Param('tenantId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('reject', id, body, h);
  }

  @Endpoint({
    permission: TENANT_PERMISSIONS.registryProvision,
    auditCode: TENANT_AUDIT_CODES.provisioningStarted,
  })
  @Post(':tenantId/start-provisioning')
  async startProvisioning(
    @Param('tenantId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('start_provisioning', id, body, h);
  }

  @Endpoint({ permission: TENANT_PERMISSIONS.registryProvision, auditCode: TENANT_AUDIT_CODES.provisioned })
  @Post(':tenantId/complete-provisioning')
  async completeProvisioning(
    @Param('tenantId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('complete_provisioning', id, body, h);
  }

  @Endpoint({
    permission: TENANT_PERMISSIONS.registryProvision,
    auditCode: TENANT_AUDIT_CODES.provisioningFailed,
  })
  @Post(':tenantId/fail-provisioning')
  async failProvisioning(
    @Param('tenantId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('fail_provisioning', id, body, h);
  }

  @Endpoint({ permission: TENANT_PERMISSIONS.registryActivate, auditCode: TENANT_AUDIT_CODES.activated })
  @Post(':tenantId/activate')
  async activate(
    @Param('tenantId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('activate', id, body, h);
  }

  @Endpoint({ permission: TENANT_PERMISSIONS.registryRestrict, auditCode: TENANT_AUDIT_CODES.restricted })
  @Post(':tenantId/restrict')
  async restrict(
    @Param('tenantId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('restrict', id, body, h);
  }

  @Endpoint({ permission: TENANT_PERMISSIONS.registrySuspend, auditCode: TENANT_AUDIT_CODES.suspended })
  @Post(':tenantId/suspend')
  async suspend(
    @Param('tenantId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('suspend', id, body, h);
  }

  @Endpoint({ permission: TENANT_PERMISSIONS.registryReactivate, auditCode: TENANT_AUDIT_CODES.reactivated })
  @Post(':tenantId/reactivate')
  async reactivate(
    @Param('tenantId') id: string,
    @Body() body: ActionBody,
    @Headers() h: Record<string, string>,
  ) {
    return this.act('reactivate', id, body, h);
  }

  @Endpoint({ permission: TENANT_PERMISSIONS.registryClose, auditCode: TENANT_AUDIT_CODES.closed })
  @Post(':tenantId/close')
  async close(@Param('tenantId') id: string, @Body() body: ActionBody, @Headers() h: Record<string, string>) {
    return this.act('close', id, body, h);
  }

  private async act(
    action: TenantAction,
    tenantId: string,
    body: ActionBody,
    headers: Record<string, string>,
  ) {
    const ctx = await this.contextFor(headers, `tenant action: ${action}`);
    return this.service.applyAction(ctx, actorOf(headers), requireUuid(tenantId, ctx.correlationId), action, {
      expectedVersion: requireVersion(body.expectedVersion, ctx.correlationId),
      ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
    });
  }

  /**
   * Resolves the request's context.
   *
   * With `x-tenant-id`, the claim is VALIDATED server-side by the resolver before it becomes context.
   * Without one, the request is treated as platform-level and runs in system context.
   */
  private async contextFor(headers: Record<string, string>, reason: string) {
    const claimed = headers['x-tenant-id'];
    if (claimed === undefined) return systemContext(headers, reason);
    const actor = actorOf(headers);
    return this.resolver.resolve({
      claimedTenantId: claimed,
      correlationId: correlationOf(headers),
      permissions: permissionsOf(headers),
      ...(actor === null ? {} : { actor }),
    });
  }
}

/**
 * ============================================================================================
 * STAGE 1A ONLY — HEADER-DERIVED IDENTITY. NOT SHIPPABLE.
 * ============================================================================================
 * `x-actor-id` and `x-permissions` are read straight from the request. There is no authentication in
 * M01 (§4 excludes it), so anyone who can reach this API can claim any actor and any permission — the
 * authorization checks below them are real, but their INPUT is not trustworthy.
 *
 * m02-identity replaces this with an authenticated session: the actor and their permissions come from a
 * verified token, and the tenant claim is additionally checked against that actor's membership. Until
 * then the API must not be exposed outside a trusted network. Stated plainly in the completion report.
 */
function permissionsOf(headers: Record<string, string>): string[] {
  const raw = headers['x-permissions'];
  return raw === undefined || raw.trim() === '' ? [] : raw.split(',').map((p) => p.trim());
}

function actorOf(headers: Record<string, string>): string | null {
  const raw = headers['x-actor-id'];
  return raw !== undefined && UUID_PATTERN.test(raw) ? raw : null;
}

function correlationOf(headers: Record<string, string>): string {
  // Minted when absent so that every audit entry and event has one — a request with no correlation id
  // is a request that cannot be traced afterwards.
  return headers['x-correlation-id'] ?? randomUUID();
}

function systemContext(
  headers: Record<string, string>,
  reason: string,
): SystemContext & { permissions: string[] } {
  return { reason, correlationId: correlationOf(headers), permissions: permissionsOf(headers) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string, ctx: { correlationId: string }): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw badRequest(`${field} is required.`, ctx.correlationId);
  return value;
}

function optionalString<K extends string>(value: unknown, field: K): Partial<Record<K, string>> {
  return typeof value === 'string' ? ({ [field]: value } as Record<K, string>) : {};
}

function requireUuid(value: string, correlationId: string): string {
  if (!UUID_PATTERN.test(value)) throw badRequest('Invalid tenant identifier.', correlationId);
  return value;
}

/**
 * `expectedVersion` is mandatory on every mutation.
 *
 * Optimistic concurrency only works if the client is forced to state what it thinks it is changing. Let
 * it omit the version and the last writer silently wins, which for a lifecycle transition means one
 * administrator's suspension quietly undoing another's.
 */
function requireVersion(value: unknown, correlationId: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw badRequest('expectedVersion is required and must be a positive integer.', correlationId);
  }
  return value;
}

function badRequest(detail: string, correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/validation',
    title: 'Bad Request',
    status: 400,
    detail,
    correlationId,
  });
}
