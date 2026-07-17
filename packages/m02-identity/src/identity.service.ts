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
import {
  IDENTITY_LIFECYCLE_FAMILY,
  IDENTITY_LIFECYCLE_VERSION,
  PLATFORM_TENANT,
  type DomainEvent,
  type IdentityLifecycleEventType,
  type IdentityLifecyclePayload,
} from '@finapp/contracts';
import { IdentityRepository, type AccountRow, type IdentityRow } from './repository.ts';
import { IDENTITY_ACTION_MAP, ACCOUNT_ACTION_MAP, IDENTITY_AUDIT_CODES } from './audit-codes.ts';
import { IDENTITY_PERMISSIONS } from './permissions.ts';
import {
  checkAccountTransition,
  checkIdentityTransition,
  type AccountAction,
  type AccountStatus,
  type IdentityAction,
  type IdentityStatus,
} from './domain/lifecycles.ts';
import {
  accountTypeAllowsIdentityType,
  isAccountType,
  isIdentityType,
  type AccountType,
  type IdentityType,
} from './domain/types.ts';
import {
  normalizeEmail,
  normalizeUsername,
  validateEmail,
  validateServiceAccountName,
  validateSystemAccountName,
  validateUsername,
} from './domain/normalization.ts';

/**
 * Identity and account services.
 *
 * Identities and accounts are GLOBAL control-plane records with no tenant column, so every operation runs
 * in system context — the only way past their RLS policy. That escape is narrow by construction:
 * `Db.withSystem` demands a stated reason, and the tenant-scoped tables (memberships, their history) have
 * no escape at all, so nothing here can reach another tenant's business data.
 *
 * Every mutation is one shape, in ONE transaction:
 *   permission -> validate -> read state -> check transition -> write (optimistic) -> history -> audit ->
 *   publish.
 */
export class IdentityService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;
  private readonly repo: IdentityRepository;

  constructor(
    db: Db,
    authz: Authz,
    audit: Audit,
    outbox: Outbox<DomainEvent>,
    repo: IdentityRepository = new IdentityRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.audit = audit;
    this.outbox = outbox;
    this.repo = repo;
  }

  // --- identities ---------------------------------------------------------------------------------

  async createIdentity(
    ctx: SystemContext | RequestContext,
    actor: string | null,
    input: {
      identityType: string;
      displayName: string;
      givenName?: string | null;
      familyName?: string | null;
      primaryEmail?: string | null;
      organizationRef?: string | null;
      externalRef?: string | null;
    },
  ): Promise<IdentityRow> {
    await this.authz.require(ctx, IDENTITY_PERMISSIONS.registryCreate);

    const problems = validateIdentityInput(input);
    if (problems.length > 0) throw badRequest(problems, ctx.correlationId);

    const identityType = input.identityType as IdentityType;
    const email = input.primaryEmail ?? null;
    const emailNorm = email === null ? null : normalizeEmail(email);

    return this.system(ctx, 'create identity (m02)', async (tx) => {
      if (emailNorm !== null) {
        const existing = await this.repo.findIdentityByEmailNorm(tx, emailNorm);
        if (existing !== null) {
          throw ProblemError.conflict('An identity with that email already exists.', ctx.correlationId);
        }
      }

      let row: IdentityRow;
      try {
        row = await this.repo.insertIdentity(tx, {
          identityType,
          displayName: input.displayName,
          givenName: input.givenName ?? null,
          familyName: input.familyName ?? null,
          primaryEmail: email,
          primaryEmailNorm: emailNorm,
          organizationRef: input.organizationRef ?? null,
          externalRef: input.externalRef ?? null,
          // Personal data by default (Kenya DPA). A machine identity is merely `internal`.
          classification: isMachine(identityType) ? 'internal' : 'confidential',
          createdBy: actor,
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          throw ProblemError.conflict('An identity with that email already exists.', ctx.correlationId);
        }
        throw error;
      }

      await this.repo.appendIdentityHistory(tx, {
        identityId: row.id,
        fromStatus: null,
        toStatus: 'draft',
        action: 'create',
        reason: null,
        correlationId: ctx.correlationId,
        changedBy: actor,
      });

      await this.audit.write(tx, ctx, {
        code: IDENTITY_AUDIT_CODES.identityCreated,
        entityType: 'identity',
        entityId: row.id,
        // Type and status only. No name, no email — the audit spine is append-only, so anything written
        // here is retained about a natural person forever.
        detail: { identityType: row.identity_type },
      });

      await this.publish(tx, 'IdentityCreated', PLATFORM_TENANT, ctx.correlationId, actor, {
        identityId: row.id,
        identityType: row.identity_type,
        fromStatus: null,
        toStatus: 'draft',
      });

      return row;
    });
  }

  async getIdentity(ctx: SystemContext | RequestContext, id: string): Promise<IdentityRow> {
    await this.authz.require(ctx, IDENTITY_PERMISSIONS.registryView);
    const row = await this.system(ctx, 'read identity (m02)', (tx) => this.repo.findIdentity(tx, id));
    if (row === null) throw ProblemError.notFound('Identity not found.', ctx.correlationId);
    return row;
  }

  async listIdentities(
    ctx: SystemContext | RequestContext,
    opts: { status?: string; limit?: number; offset?: number } = {},
  ): Promise<IdentityRow[]> {
    await this.authz.require(ctx, IDENTITY_PERMISSIONS.registryView);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    return this.system(ctx, 'list identities (m02)', (tx) =>
      this.repo.listIdentities(tx, {
        ...(opts.status === undefined ? {} : { status: opts.status }),
        limit,
        offset: Math.max(opts.offset ?? 0, 0),
      }),
    );
  }

  async updateIdentity(
    ctx: SystemContext | RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      displayName?: string;
      givenName?: string | null;
      familyName?: string | null;
      organizationRef?: string | null;
    },
  ): Promise<IdentityRow> {
    await this.authz.require(ctx, IDENTITY_PERMISSIONS.registryEdit);
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw badRequest(['expectedVersion is required and must be a positive integer.'], ctx.correlationId);
    }

    return this.system(ctx, 'update identity (m02)', async (tx) => {
      const current = await this.repo.findIdentity(tx, id);
      if (current === null) throw ProblemError.notFound('Identity not found.', ctx.correlationId);
      if (current.status === 'closed') {
        throw ProblemError.conflict('A closed identity cannot be modified.', ctx.correlationId);
      }

      const updated = await this.repo.updateIdentityProfile(tx, {
        id,
        expectedVersion: input.expectedVersion,
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
        ...(input.givenName === undefined ? {} : { givenName: input.givenName }),
        ...(input.familyName === undefined ? {} : { familyName: input.familyName }),
        ...(input.organizationRef === undefined ? {} : { organizationRef: input.organizationRef }),
        updatedBy: actor,
      });
      if (updated === null) throw versionConflict(current.version, input.expectedVersion, ctx.correlationId);

      const changedFields = Object.keys(input).filter((k) => k !== 'expectedVersion');

      await this.audit.write(tx, ctx, {
        code: IDENTITY_AUDIT_CODES.identityUpdated,
        entityType: 'identity',
        entityId: id,
        detail: { changedFields },
      });
      await this.publish(tx, 'IdentityUpdated', PLATFORM_TENANT, ctx.correlationId, actor, {
        identityId: id,
        changedFields,
      });

      return updated;
    });
  }

  /** The single path for every identity transition — permission, audit code and event all come from the map. */
  async applyIdentityAction(
    ctx: SystemContext | RequestContext,
    actor: string | null,
    id: string,
    action: IdentityAction,
    opts: { reason?: string; expectedVersion: number },
  ): Promise<IdentityRow> {
    const mapping = IDENTITY_ACTION_MAP[action];
    await this.authz.require(ctx, mapping.permission);

    return this.system(ctx, `identity action: ${action} (m02)`, async (tx) => {
      const current = await this.repo.findIdentity(tx, id);
      if (current === null) throw ProblemError.notFound('Identity not found.', ctx.correlationId);

      const check = checkIdentityTransition(current.status as IdentityStatus, action, {
        reason: opts.reason,
      });
      if (!check.allowed || check.to === undefined) {
        throw ProblemError.conflict(check.reason ?? 'Transition not allowed.', ctx.correlationId);
      }

      const updated = await this.repo.applyIdentityStatus(tx, {
        id,
        expectedVersion: opts.expectedVersion,
        toStatus: check.to,
        updatedBy: actor,
      });
      if (updated === null) throw versionConflict(current.version, opts.expectedVersion, ctx.correlationId);

      await this.repo.appendIdentityHistory(tx, {
        identityId: id,
        fromStatus: current.status,
        toStatus: check.to,
        action,
        reason: opts.reason ?? null,
        correlationId: ctx.correlationId,
        changedBy: actor,
      });
      await this.audit.write(tx, ctx, {
        code: mapping.auditCode,
        entityType: 'identity',
        entityId: id,
        ...(opts.reason === undefined ? {} : { reason: opts.reason }),
        detail: { fromStatus: current.status, toStatus: check.to },
      });
      await this.publish(tx, mapping.eventType, PLATFORM_TENANT, ctx.correlationId, actor, {
        identityId: id,
        identityType: current.identity_type,
        fromStatus: current.status,
        toStatus: check.to,
        ...(opts.reason === undefined ? {} : { reason: opts.reason }),
      });

      return updated;
    });
  }

  // --- accounts -----------------------------------------------------------------------------------

  async createAccount(
    ctx: SystemContext | RequestContext,
    actor: string | null,
    input: { identityId: string; accountType: string; loginIdentifier: string },
  ): Promise<AccountRow> {
    await this.authz.require(ctx, IDENTITY_PERMISSIONS.accountCreate);

    if (!isAccountType(input.accountType)) {
      throw badRequest(
        ['accountType must be one of: human, service, system, integration.'],
        ctx.correlationId,
      );
    }
    const accountType: AccountType = input.accountType;

    const nameProblem = validateLoginIdentifier(accountType, input.loginIdentifier);
    if (nameProblem !== null) throw badRequest([nameProblem], ctx.correlationId);

    return this.system(ctx, 'create account (m02)', async (tx) => {
      const identity = await this.repo.findIdentity(tx, input.identityId);
      if (identity === null) throw badRequest(['identityId does not exist.'], ctx.correlationId);

      // A human account may not be bound to a system identity, and vice versa. Without this, "log in as
      // the scheduler" is possible, and every audit row it produced would name a machine for a human act.
      if (!accountTypeAllowsIdentityType(accountType, identity.identity_type as IdentityType)) {
        throw badRequest(
          [
            `An account of type "${accountType}" cannot be bound to an identity of type "${identity.identity_type}".`,
          ],
          ctx.correlationId,
        );
      }
      // A closed or rejected person must not gain a new way in.
      if (identity.status === 'closed' || identity.status === 'rejected' || identity.status === 'archived') {
        throw ProblemError.conflict(
          `Cannot create an account for an identity that is ${identity.status}.`,
          ctx.correlationId,
        );
      }

      const norm = normalizeUsername(input.loginIdentifier);
      let row: AccountRow;
      try {
        row = await this.repo.insertAccount(tx, {
          identityId: input.identityId,
          accountType,
          loginIdentifier: input.loginIdentifier,
          loginIdentifierNorm: norm,
          createdBy: actor,
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          throw ProblemError.conflict('That login identifier is already in use.', ctx.correlationId);
        }
        throw error;
      }

      await this.repo.appendAccountHistory(tx, {
        accountId: row.id,
        fromStatus: null,
        toStatus: 'pending_activation',
        action: 'create',
        reason: null,
        correlationId: ctx.correlationId,
        changedBy: actor,
      });
      await this.audit.write(tx, ctx, {
        code: IDENTITY_AUDIT_CODES.accountCreated,
        entityType: 'user_account',
        entityId: row.id,
        detail: { accountType: row.account_type, identityId: row.identity_id },
      });
      await this.publish(tx, 'AccountCreated', PLATFORM_TENANT, ctx.correlationId, actor, {
        accountId: row.id,
        identityId: row.identity_id,
        accountType: row.account_type,
        fromStatus: null,
        toStatus: 'pending_activation',
      });

      return row;
    });
  }

  async getAccount(ctx: SystemContext | RequestContext, id: string): Promise<AccountRow> {
    await this.authz.require(ctx, IDENTITY_PERMISSIONS.accountView);
    const row = await this.system(ctx, 'read account (m02)', (tx) => this.repo.findAccount(tx, id));
    if (row === null) throw ProblemError.notFound('Account not found.', ctx.correlationId);
    return row;
  }

  async listAccounts(
    ctx: SystemContext | RequestContext,
    opts: { identityId?: string; limit?: number; offset?: number } = {},
  ): Promise<AccountRow[]> {
    await this.authz.require(ctx, IDENTITY_PERMISSIONS.accountView);
    return this.system(ctx, 'list accounts (m02)', (tx) =>
      this.repo.listAccounts(tx, {
        ...(opts.identityId === undefined ? {} : { identityId: opts.identityId }),
        limit: Math.min(Math.max(opts.limit ?? 50, 1), 200),
        offset: Math.max(opts.offset ?? 0, 0),
      }),
    );
  }

  async applyAccountAction(
    ctx: SystemContext | RequestContext,
    actor: string | null,
    id: string,
    action: AccountAction,
    opts: { reason?: string; expectedVersion: number },
  ): Promise<AccountRow> {
    const mapping = ACCOUNT_ACTION_MAP[action];
    await this.authz.require(ctx, mapping.permission);

    return this.system(ctx, `account action: ${action} (m02)`, async (tx) => {
      const current = await this.repo.findAccount(tx, id);
      if (current === null) throw ProblemError.notFound('Account not found.', ctx.correlationId);

      const check = checkAccountTransition(current.status as AccountStatus, action, { reason: opts.reason });
      if (!check.allowed || check.to === undefined) {
        throw ProblemError.conflict(check.reason ?? 'Transition not allowed.', ctx.correlationId);
      }

      // Activating a login for a person who is not active would defeat the identity gate: the account
      // would resolve on its own terms while the person is suspended.
      if (check.to === 'active') {
        const identity = await this.repo.findIdentity(tx, current.identity_id);
        if (identity?.status !== 'active') {
          throw ProblemError.conflict(
            `Cannot activate an account whose identity is ${identity?.status ?? 'missing'}.`,
            ctx.correlationId,
          );
        }
      }

      const updated = await this.repo.applyAccountStatus(tx, {
        id,
        expectedVersion: opts.expectedVersion,
        toStatus: check.to,
        updatedBy: actor,
      });
      if (updated === null) throw versionConflict(current.version, opts.expectedVersion, ctx.correlationId);

      await this.repo.appendAccountHistory(tx, {
        accountId: id,
        fromStatus: current.status,
        toStatus: check.to,
        action,
        reason: opts.reason ?? null,
        correlationId: ctx.correlationId,
        changedBy: actor,
      });
      await this.audit.write(tx, ctx, {
        code: mapping.auditCode,
        entityType: 'user_account',
        entityId: id,
        ...(opts.reason === undefined ? {} : { reason: opts.reason }),
        detail: { fromStatus: current.status, toStatus: check.to },
      });
      await this.publish(tx, mapping.eventType, PLATFORM_TENANT, ctx.correlationId, actor, {
        accountId: id,
        identityId: current.identity_id,
        accountType: current.account_type,
        fromStatus: current.status,
        toStatus: check.to,
        ...(opts.reason === undefined ? {} : { reason: opts.reason }),
      });

      return updated;
    });
  }

  // --- shared -------------------------------------------------------------------------------------

  /**
   * Runs `fn` in system context.
   *
   * Identities and accounts are global with no tenant column, so this is the only way past their policy.
   * The reason is mandatory and specific, so every cross-tenant read of the identity plane is explainable
   * in review rather than incidental.
   */
  private async system<T>(
    ctx: SystemContext | RequestContext,
    reason: string,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    return this.db.withSystem({ reason, correlationId: ctx.correlationId }, fn);
  }

  private async publish(
    tx: Tx,
    type: IdentityLifecycleEventType,
    tenantId: string,
    correlationId: string,
    actor: string | null,
    payload: IdentityLifecyclePayload,
  ): Promise<void> {
    await this.outbox.publish(tx, {
      eventId: randomUUID(),
      family: IDENTITY_LIFECYCLE_FAMILY,
      type,
      version: IDENTITY_LIFECYCLE_VERSION,
      occurredAt: new Date(),
      tenantId,
      correlationId,
      ...(actor === null ? {} : { actor }),
      // Personal data — never `internal` for a person's lifecycle (ADR-006 gates it from AI providers).
      classification: 'confidential',
      payload,
    });
  }
}

// --- validation -------------------------------------------------------------------------------------

function isMachine(type: IdentityType): boolean {
  return type === 'service_identity' || type === 'system_identity';
}

function validateIdentityInput(input: {
  identityType: string;
  displayName: string;
  primaryEmail?: string | null;
}): string[] {
  const problems: string[] = [];

  if (!isIdentityType(input.identityType)) {
    problems.push('identityType must be a registered type from the identity type catalogue.');
  }
  if (input.displayName.trim() === '') problems.push('displayName is required.');
  else if (input.displayName.length > 200) problems.push('displayName must be 200 characters or fewer.');

  const machine = isIdentityType(input.identityType) && isMachine(input.identityType);
  const email = input.primaryEmail ?? null;

  if (!machine) {
    if (email === null) problems.push('primaryEmail is required for a person.');
    else {
      const p = validateEmail(email);
      if (p !== null) problems.push(p);
    }
  } else if (email !== null) {
    // A machine principal with a mailbox is a person in disguise — and the email column is what makes an
    // identity findable as a human.
    problems.push('A service or system identity must not have an email address.');
  }

  return problems;
}

function validateLoginIdentifier(accountType: AccountType, login: string): string | null {
  switch (accountType) {
    case 'service':
    case 'integration':
      return validateServiceAccountName(login);
    case 'system':
      return validateSystemAccountName(login);
    case 'human':
      return validateUsername(login);
  }
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
    `Version conflict: the record is at version ${actual}, you supplied ${expected}. Re-read and retry.`,
    correlationId,
  );
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && (error as { code?: unknown } | null)?.code === '23505';
}

export { badRequest, versionConflict, isUniqueViolation };
