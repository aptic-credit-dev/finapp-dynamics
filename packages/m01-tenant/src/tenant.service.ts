import { randomUUID } from 'node:crypto';
import {
  ProblemError,
  type Audit,
  type Authz,
  type Db,
  type Outbox,
  type RequestContext,
  type SystemContext,
  type Tx,
} from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import { TenantRepository, type TenantRow } from './repository.ts';
import { tenantLifecycleEvent } from './events.ts';
import { TENANT_ACTION_MAP, TENANT_ACTION_PERMISSIONS, TENANT_AUDIT_CODES } from './audit-codes.ts';
import { TENANT_PERMISSIONS } from './permissions.ts';
import { checkTransition, type TenantAction } from './domain/tenant-status.ts';
import { isTenantType } from './domain/tenant-type.ts';
import {
  validateCountry,
  validateCurrency,
  validateTenantCode,
  validateTimezone,
} from './domain/tenant-code.ts';

export interface CreateTenantInput {
  readonly code: string;
  readonly legalName: string;
  readonly tradingName?: string | null;
  readonly tenantType: string;
  readonly defaultTimezone?: string;
  readonly defaultCurrency?: string;
  readonly country?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface UpdateTenantInput {
  readonly expectedVersion: number;
  readonly legalName?: string;
  readonly tradingName?: string | null;
  readonly defaultTimezone?: string;
  readonly defaultCurrency?: string;
  readonly country?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Tenant registry and lifecycle.
 *
 * Every mutation follows the same shape, and the order is not incidental:
 *   permission → validate input → read current state → check the transition →
 *   write (optimistic) → append history → audit → publish — all inside ONE transaction.
 *
 * Audit and the outbox take the same `tx` as the write. That is what makes the three agree: a tenant
 * cannot be activated without the activation being recorded, and an event announcing the activation
 * cannot escape if the activation rolls back.
 */
export class TenantService {
  // Explicit fields, not constructor parameter properties: `node --experimental-strip-types` cannot
  // compile a parameter property, and the PURE smoke suites load this package straight from source.
  // See docs/07-engineering/TEST_STRATEGY.md.
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;
  private readonly repo: TenantRepository;

  constructor(
    db: Db,
    authz: Authz,
    audit: Audit,
    outbox: Outbox<DomainEvent>,
    repo: TenantRepository = new TenantRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.audit = audit;
    this.outbox = outbox;
    this.repo = repo;
  }

  /**
   * Creates a tenant in `draft`.
   *
   * Runs in the NEW tenant's own context rather than system context, even though no such tenant exists
   * yet. The id is minted first, `Db.withTenant` binds `app.tenant_id` to it, and both the `tenants`
   * row and its first history row then satisfy their WITH CHECK by matching the bound tenant. The
   * alternative — creating in system context — would mean the very first write to the control plane runs
   * with the cross-tenant escape open, which is exactly the path that should stay rare and deliberate.
   */
  async createDraft(ctx: SystemContext, actor: string | null, input: CreateTenantInput): Promise<TenantRow> {
    const problems = validateCreate(input);
    if (problems.length > 0) throw badRequest(problems, ctx.correlationId);

    const id = randomUUID();
    const tenantCtx: RequestContext = {
      tenantId: id,
      correlationId: ctx.correlationId,
      permissions: [],
      ...(actor === null ? {} : { userId: actor }),
    };

    // Authorised against the ORIGINAL caller context: the synthetic tenant context above exists to bind
    // the GUC, not to grant anything. Checking against it would be checking our own homework.
    await this.authz.require(ctx, TENANT_PERMISSIONS.registryCreate);

    return this.db.withTenant(tenantCtx, async (tx) => {
      // Pre-check for a friendly 409. The UNIQUE constraint is still the authority — two concurrent
      // creates both pass this check, and one of them then loses to the index. Both outcomes are a 409.
      const existing = await this.findByCodeAcrossTenants(input.code, ctx);
      if (existing) {
        throw ProblemError.conflict(`Tenant code "${input.code}" is already in use.`, ctx.correlationId);
      }

      let row: TenantRow;
      try {
        row = await this.repo.insert(tx, {
          id,
          code: input.code,
          legalName: input.legalName,
          tradingName: input.tradingName ?? null,
          tenantType: input.tenantType,
          defaultTimezone: input.defaultTimezone ?? 'Africa/Nairobi',
          defaultCurrency: input.defaultCurrency ?? 'KES',
          country: input.country ?? 'KE',
          metadata: input.metadata ?? {},
          createdBy: actor,
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          throw ProblemError.conflict(`Tenant code "${input.code}" is already in use.`, ctx.correlationId);
        }
        throw error;
      }

      const occurredAt = new Date();

      await this.repo.appendStatusHistory(tx, {
        tenantId: id,
        fromStatus: null,
        toStatus: 'draft',
        action: 'create',
        reason: null,
        correlationId: ctx.correlationId,
        changedBy: actor,
      });

      await this.audit.write(tx, tenantCtx, {
        code: TENANT_AUDIT_CODES.created,
        entityType: 'tenant',
        entityId: id,
        detail: { code: row.code, tenantType: row.tenant_type },
      });

      await this.outbox.publish(
        tx,
        tenantLifecycleEvent({
          type: 'TenantCreated',
          tenantId: id,
          correlationId: ctx.correlationId,
          ...(actor === null ? {} : { actor }),
          occurredAt,
          payload: { tenantId: id, tenantCode: row.code, fromStatus: null, toStatus: 'draft' },
        }),
      );

      return row;
    });
  }

  /** Reads a tenant. RLS decides visibility; a tenant invisible to the caller is a 404, never a 403. */
  async get(ctx: RequestContext | SystemContext, tenantId: string): Promise<TenantRow> {
    await this.authz.require(ctx, TENANT_PERMISSIONS.registryView);
    const row = await this.read(ctx, (tx) => this.repo.findById(tx, tenantId));
    if (row === null) throw ProblemError.notFound('Tenant not found.', ctx.correlationId);
    return row;
  }

  /**
   * Lists tenants the caller may see.
   *
   * A caller in tenant context sees at most their own tenant — the policy, not this code, guarantees it.
   * A platform administrator lists across tenants only by entering system context, which requires a
   * stated reason.
   */
  async list(
    ctx: RequestContext | SystemContext,
    opts: { status?: string; limit?: number; offset?: number } = {},
  ): Promise<{ items: TenantRow[]; total: number }> {
    await this.authz.require(ctx, TENANT_PERMISSIONS.registryView);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);

    return this.read(ctx, async (tx) => ({
      items: await this.repo.list(tx, {
        ...(opts.status === undefined ? {} : { status: opts.status }),
        limit,
        offset,
      }),
      total: await this.repo.count(tx, opts.status === undefined ? {} : { status: opts.status }),
    }));
  }

  async updateProfile(
    ctx: RequestContext | SystemContext,
    actor: string | null,
    tenantId: string,
    input: UpdateTenantInput,
  ): Promise<TenantRow> {
    await this.authz.require(ctx, TENANT_PERMISSIONS.registryEdit);

    const problems = validateProfile(input);
    if (problems.length > 0) throw badRequest(problems, ctx.correlationId);

    return this.write(ctx, tenantId, async (tx) => {
      const current = await this.repo.findById(tx, tenantId);
      if (current === null) throw ProblemError.notFound('Tenant not found.', ctx.correlationId);

      // A closed tenant is a historical record. Editing it would rewrite what the platform said about a
      // relationship that has already ended.
      if (current.status === 'closed') {
        throw ProblemError.conflict('A closed tenant cannot be modified.', ctx.correlationId);
      }

      const updated = await this.repo.updateProfile(tx, {
        id: tenantId,
        expectedVersion: input.expectedVersion,
        ...(input.legalName === undefined ? {} : { legalName: input.legalName }),
        ...(input.tradingName === undefined ? {} : { tradingName: input.tradingName }),
        ...(input.defaultTimezone === undefined ? {} : { defaultTimezone: input.defaultTimezone }),
        ...(input.defaultCurrency === undefined ? {} : { defaultCurrency: input.defaultCurrency }),
        ...(input.country === undefined ? {} : { country: input.country }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        updatedBy: actor,
      });
      if (updated === null) throw versionConflict(current.version, input.expectedVersion, ctx.correlationId);

      const changedFields = profileFieldNames(input);
      const occurredAt = new Date();

      await this.audit.write(tx, ctx, {
        code: TENANT_AUDIT_CODES.updated,
        entityType: 'tenant',
        entityId: tenantId,
        // Field NAMES only. The values are the tenant's business, and the audit spine is append-only —
        // anything written here is retained forever, so it records that a change happened, not the data.
        detail: { changedFields },
      });

      await this.outbox.publish(
        tx,
        tenantLifecycleEvent({
          type: 'TenantUpdated',
          tenantId,
          correlationId: ctx.correlationId,
          ...(actor === null ? {} : { actor }),
          occurredAt,
          payload: { tenantId, tenantCode: updated.code, changedFields },
        }),
      );

      return updated;
    });
  }

  /**
   * Applies a lifecycle action. The single path for every transition.
   *
   * One method rather than eleven near-identical ones: the permission, the audit code and the event type
   * all come from the action tables, so adding an action cannot leave one of the three axes behind.
   */
  async applyAction(
    ctx: RequestContext | SystemContext,
    actor: string | null,
    tenantId: string,
    action: TenantAction,
    opts: { reason?: string; expectedVersion: number },
  ): Promise<TenantRow> {
    const permission = TENANT_ACTION_PERMISSIONS[action];
    await this.authz.require(ctx, permission);

    const mapping = TENANT_ACTION_MAP[action];

    return this.write(ctx, tenantId, async (tx) => {
      const current = await this.repo.findById(tx, tenantId);
      if (current === null) throw ProblemError.notFound('Tenant not found.', ctx.correlationId);

      const check = checkTransition(current.status, action, { reason: opts.reason });
      if (!check.allowed || check.to === undefined) {
        throw ProblemError.conflict(check.reason ?? 'Transition not allowed.', ctx.correlationId);
      }

      const updated = await this.repo.applyStatus(tx, {
        id: tenantId,
        expectedVersion: opts.expectedVersion,
        toStatus: check.to,
        updatedBy: actor,
      });
      if (updated === null) throw versionConflict(current.version, opts.expectedVersion, ctx.correlationId);

      const occurredAt = new Date();

      await this.repo.appendStatusHistory(tx, {
        tenantId,
        fromStatus: current.status,
        toStatus: check.to,
        action,
        reason: opts.reason ?? null,
        correlationId: ctx.correlationId,
        changedBy: actor,
      });

      await this.audit.write(tx, ctx, {
        code: mapping.auditCode,
        entityType: 'tenant',
        entityId: tenantId,
        ...(opts.reason === undefined ? {} : { reason: opts.reason }),
        detail: { fromStatus: current.status, toStatus: check.to },
      });

      await this.outbox.publish(
        tx,
        tenantLifecycleEvent({
          type: mapping.eventType,
          tenantId,
          correlationId: ctx.correlationId,
          ...(actor === null ? {} : { actor }),
          occurredAt,
          payload: {
            tenantId,
            tenantCode: updated.code,
            fromStatus: current.status,
            toStatus: check.to,
            ...(opts.reason === undefined ? {} : { reason: opts.reason }),
          },
        }),
      );

      return updated;
    });
  }

  /**
   * The tenant's lifecycle history.
   *
   * Bound to the TARGET tenant, not read through the system escape: `tenant_status_history` is
   * tenant-scoped with no escape, so a system-context read returns an empty list — which reads as "this
   * tenant has no history" rather than "you asked the wrong way". Silently empty is worse than wrong.
   */
  async statusHistory(
    ctx: RequestContext | SystemContext,
    tenantId: string,
  ): Promise<Record<string, unknown>[]> {
    await this.authz.require(ctx, TENANT_PERMISSIONS.registryView);
    return this.readTenantScoped(ctx, tenantId, (tx) => this.repo.statusHistory(tx, tenantId));
  }

  // --- context plumbing ---------------------------------------------------------------------------

  /**
   * Runs `fn` in the caller's context — tenant if they have one, system otherwise.
   *
   * A `SystemContext` reaching here has already been through `Db.withSystem`'s mandatory reason, so the
   * cross-tenant read is deliberate and explainable rather than incidental.
   */
  private async read<T>(ctx: RequestContext | SystemContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return 'tenantId' in ctx ? this.db.withTenant(ctx, fn) : this.db.withSystem(ctx, fn);
  }

  /**
   * Runs a write against `tenantId`, always bound to THAT TENANT's context.
   *
   * A tenant-context caller may only ever act on their OWN tenant: if the path names a different tenant,
   * that is a cross-tenant write attempt and it is refused here — before the query — rather than left to
   * RLS to silently match zero rows and report a confusing 404.
   *
   * A platform administrator arrives in system context, and this binds the TARGET tenant's context for
   * them rather than running the write with the system escape open. That is not a formality:
   * `tenant_status_history` is tenant-scoped and its policy has NO system escape, so a lifecycle action
   * performed under `withSystem` updates `tenants` (which does have the escape) and then fails to write
   * its own history — a transition that half-happens and reports a 500. Binding the target tenant makes
   * the tenants row, the history row and the audit entry all satisfy the same policy, in one transaction.
   *
   * Authorization has already happened against the ORIGINAL caller's context, so narrowing the database
   * context here grants nothing — it only stops the escape being open wider than the work requires.
   */
  private async write<T>(
    ctx: RequestContext | SystemContext,
    tenantId: string,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    return this.db.withTenant(this.tenantContextFor(ctx, tenantId), fn);
  }

  /** Reads a tenant-scoped table, bound to the target tenant for the same reason as `write`. */
  private async readTenantScoped<T>(
    ctx: RequestContext | SystemContext,
    tenantId: string,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    return this.db.withTenant(this.tenantContextFor(ctx, tenantId), fn);
  }

  private tenantContextFor(ctx: RequestContext | SystemContext, tenantId: string): RequestContext {
    if ('tenantId' in ctx) {
      if (ctx.tenantId !== tenantId) {
        throw ProblemError.forbidden('Cannot act on another tenant.', ctx.correlationId);
      }
      return ctx;
    }
    // Synthetic context for a platform administrator. Carries no permissions: it exists to bind the GUC,
    // and the authorization decision was already made above against the real caller.
    return { tenantId, correlationId: ctx.correlationId, permissions: [] };
  }

  /** Code uniqueness spans every tenant, so the check must see across them. */
  private async findByCodeAcrossTenants(
    code: string,
    ctx: RequestContext | SystemContext,
  ): Promise<TenantRow | null> {
    return this.db.withSystem(
      { reason: 'tenant code uniqueness check (m01)', correlationId: ctx.correlationId },
      (tx) => this.repo.findByCode(tx, code),
    );
  }
}

// --- validation -----------------------------------------------------------------------------------

function validateCreate(input: CreateTenantInput): string[] {
  const problems: string[] = [];

  const codeProblem = validateTenantCode(input.code);
  if (codeProblem !== null) problems.push(codeProblem);

  if (input.legalName.trim() === '') problems.push('legalName is required.');
  else if (input.legalName.length > 300) problems.push('legalName must be 300 characters or fewer.');

  if (!isTenantType(input.tenantType)) {
    problems.push(`tenantType must be a registered type from the tenant type catalogue.`);
  }

  if (input.defaultTimezone !== undefined) {
    const p = validateTimezone(input.defaultTimezone);
    if (p !== null) problems.push(p);
  }
  if (input.defaultCurrency !== undefined) {
    const p = validateCurrency(input.defaultCurrency);
    if (p !== null) problems.push(p);
  }
  if (input.country !== undefined) {
    const p = validateCountry(input.country);
    if (p !== null) problems.push(p);
  }

  return problems;
}

function validateProfile(input: UpdateTenantInput): string[] {
  const problems: string[] = [];

  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    problems.push('expectedVersion is required and must be a positive integer.');
  }
  if (input.legalName?.trim() === '') problems.push('legalName cannot be blank.');
  if (input.defaultTimezone !== undefined) {
    const p = validateTimezone(input.defaultTimezone);
    if (p !== null) problems.push(p);
  }
  if (input.defaultCurrency !== undefined) {
    const p = validateCurrency(input.defaultCurrency);
    if (p !== null) problems.push(p);
  }
  if (input.country !== undefined) {
    const p = validateCountry(input.country);
    if (p !== null) problems.push(p);
  }

  return problems;
}

function profileFieldNames(input: UpdateTenantInput): string[] {
  const names: string[] = [];
  if (input.legalName !== undefined) names.push('legalName');
  if (input.tradingName !== undefined) names.push('tradingName');
  if (input.defaultTimezone !== undefined) names.push('defaultTimezone');
  if (input.defaultCurrency !== undefined) names.push('defaultCurrency');
  if (input.country !== undefined) names.push('country');
  if (input.metadata !== undefined) names.push('metadata');
  return names;
}

function badRequest(problems: readonly string[], correlationId: string): ProblemError {
  return new ProblemError({
    type: 'https://finapp.dynamics/problems/validation',
    title: 'Bad Request',
    status: 400,
    detail: problems.join(' '),
    correlationId,
  });
}

function versionConflict(actual: number, expected: number, correlationId: string): ProblemError {
  return ProblemError.conflict(
    `Version conflict: the tenant is at version ${actual}, you supplied ${expected}. Re-read and retry.`,
    correlationId,
  );
}

/** PostgreSQL 23505 — unique_violation. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && (error as { code?: unknown } | null)?.code === '23505';
}
