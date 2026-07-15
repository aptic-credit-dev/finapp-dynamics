import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { Endpoint, ProblemError } from '@finapp/kernel';
import {
  TENANT_AUDIT_CODES,
  TENANT_PERMISSIONS,
  UUID_PATTERN,
  // VALUE imports, deliberately not `import type`. NestJS resolves constructor dependencies from the
  // design-time metadata that `emitDecoratorMetadata` writes, and a type-only import is erased before
  // that metadata is emitted — leaving Nest with `Function` and an UnknownDependenciesException at boot.
  TenantService,
  type TenantAction,
} from '@finapp/m01-tenant';
import { ActorContextFactory } from '@finapp/m02-identity';

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
 * The kernel deliberately never applies decorator syntax, so kernel source stays loadable under
 * `node --experimental-strip-types` for the PURE suites. Application happens here and in m02's
 * controllers, which tsc compiles.
 *
 * ============================================================================================
 * STAGE 1B — `x-actor-id` IS GONE.
 * ============================================================================================
 * Stage 1A read the actor from `x-actor-id` and believed it. Anyone who could reach this API could claim
 * to be anyone: the authorization checks were real, but their INPUT was not.
 *
 * That header is now meaningless. Every handler obtains its actor from `ActorContextFactory`, which
 * verifies a signed assertion and then puts the claimed account through m02's `ActorResolver` — account
 * active, identity active, membership of the named tenant active — before any context exists. Sending
 * `x-actor-id` today does exactly what sending any other unknown header does: nothing.
 *
 * WHAT IS STILL NOT FIXED, stated plainly rather than left to be discovered:
 *   - `x-permissions` still carries the caller's PRIVILEGES. Identity is proven; permission is claimed.
 *     Stage 1D replaces it with RBAC and deletes `ContextAuthz` (see m02's actor-context.ts).
 *   - The actor source is a development stopgap, not authentication. Stage 1C.
 * So M01 is multi-actor-safe now — it was not before — and is still not exposable to an untrusted
 * network. The completion report says so in those words.
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
  private readonly actors: ActorContextFactory;

  constructor(service: TenantService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }

  /**
   * Creates a tenant draft.
   *
   * Platform-level: it runs in system context because no tenant exists yet to be in the context of. The
   * ACTOR is still fully proven — `ActorContextFactory` resolves account and identity exactly as
   * strictly here as anywhere else; only the membership gate is absent, because there is no tenant to be
   * a member of yet. "No tenant context" has never meant "no actor", and in Stage 1A it accidentally did.
   */
  @Endpoint({
    permission: TENANT_PERMISSIONS.registryCreate,
    auditCode: TENANT_AUDIT_CODES.created,
    description: 'Create a tenant in draft status.',
  })
  @Post()
  async create(@Body() body: CreateTenantBody, @Headers() headers: Record<string, string>) {
    // Platform-level BY CONTRACT: `createDraft` takes a `SystemContext`, because the tenant being created
    // cannot be the tenant you are acting inside. The actor is proven; only the membership gate is moot.
    const scoped = await this.actors.forPlatformRequest(headers, 'create tenant draft');
    const ctx = scoped.ctx;
    return this.service.createDraft(ctx, scoped.actor.identityId, {
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
    const { ctx } = await this.actors.forRequest(headers, 'list tenants');
    return this.service.list(ctx, {
      ...(status === undefined ? {} : { status }),
      ...(limit === undefined ? {} : { limit: Number.parseInt(limit, 10) }),
    });
  }

  @Get(':tenantId')
  async get(@Param('tenantId') tenantId: string, @Headers() headers: Record<string, string>) {
    const { ctx } = await this.actors.forRequest(headers, 'read tenant');
    return this.service.get(ctx, requireUuid(tenantId, ctx.correlationId));
  }

  @Get(':tenantId/status-history')
  async history(@Param('tenantId') tenantId: string, @Headers() headers: Record<string, string>) {
    const { ctx } = await this.actors.forRequest(headers, 'read tenant status history');
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
    const scoped = await this.actors.forRequest(headers, 'update tenant');
    const ctx = scoped.ctx;
    return this.service.updateProfile(
      ctx,
      scoped.actor.identityId,
      requireUuid(tenantId, ctx.correlationId),
      {
        expectedVersion: requireVersion(body['expectedVersion'], ctx.correlationId),
        ...optionalString(body['legalName'], 'legalName'),
        ...optionalString(body['defaultTimezone'], 'defaultTimezone'),
        ...optionalString(body['defaultCurrency'], 'defaultCurrency'),
        ...optionalString(body['country'], 'country'),
        ...(isRecord(body['metadata']) ? { metadata: body['metadata'] } : {}),
        // tradingName is passed through even when null: "clear it" and "leave it" are different requests.
        ...('tradingName' in body ? { tradingName: body['tradingName'] as string | null } : {}),
      },
    );
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
    const scoped = await this.actors.forRequest(headers, `tenant action: ${action}`);
    const ctx = scoped.ctx;
    return this.service.applyAction(
      ctx,
      scoped.actor.identityId,
      requireUuid(tenantId, ctx.correlationId),
      action,
      {
        expectedVersion: requireVersion(body.expectedVersion, ctx.correlationId),
        ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
      },
    );
  }
}

/**
 * `contextFor`, `systemContext`, `actorOf`, `permissionsOf` and `correlationOf` USED TO LIVE HERE.
 *
 * They are gone, not moved, and this note is the only thing left of them. `actorOf` read `x-actor-id` and
 * returned it as the acting identity if it merely looked like a uuid — the single largest hole in Stage
 * 1A, and the reason Stage 1B exists. The rest built context around it.
 *
 * All five are now one call: `ActorContextFactory.forRequest()` in `@finapp/m02-identity`, which is the
 * only code in the platform allowed to turn a request into a context. There is deliberately no local
 * helper here that a future handler could reach for instead — the way to get a context is to ask the
 * thing that verifies one, or to not have one.
 *
 * The conformance suite asserts no live source reads `x-actor-id`, so this cannot come back quietly.
 */

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
