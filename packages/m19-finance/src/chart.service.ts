/**
 * ChartService — the chart of accounts / ledger account and its lifecycle through the ONE choke point
 * `checkAccountTransition` (draft → active <-> inactive → archived; archived is terminal). Every mutating method
 * enforces its permission (default deny), runs inside `db.withTenant`, appends the append-only
 * finance_account_history, records audit + a `finance.lifecycle` event in the SAME transaction, and is
 * optimistic-lock/CAS guarded. `isAccountPostable` is true only while active — the flag downstream posting (m21)
 * reads before referencing an account on a journal line; m19 never posts. An account references its entity + type
 * by composite FK; the service pre-checks their existence to surface a clean not-found rather than a raw FK error.
 * No monetary amounts or balances anywhere — this is the account DEFINITION, not its ledger money (ADR-007).
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import type { FinanceLifecycleEventType, FinanceLifecyclePayload } from '@finapp/contracts';
import { M19_PERMISSIONS } from './permissions.ts';
import { M19_AUDIT_CODES } from './audit-codes.ts';
import { checkAccountTransition, isAccountPostable } from './domain/lifecycles.ts';
import { FINANCE_LIMITS } from './domain/limits.ts';
import { FinanceRepository, type AccountRow, type AccountHistoryRow } from './repository.ts';
import type { M19Emitter } from './emit.ts';
import { badRequest } from './errors.ts';

export class ChartService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M19Emitter;
  private readonly repo: FinanceRepository;
  constructor(db: Db, authz: Authz, emitter: M19Emitter, repo: FinanceRepository = new FinanceRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  private async publish(
    tx: Tx,
    ctx: RequestContext,
    actor: string | null,
    type: FinanceLifecycleEventType,
    payload: FinanceLifecyclePayload,
  ): Promise<void> {
    await this.emitter.publish(tx, {
      type,
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      ...(actor !== null ? { actor } : {}),
      payload,
    });
  }
  private async requireAccount(tx: Tx, id: string, correlationId: string): Promise<AccountRow> {
    const a = await this.repo.findAccount(tx, id);
    if (a === null) throw ProblemError.notFound('Ledger account not found.', correlationId);
    return a;
  }

  // --- create (draft) ---------------------------------------------------------------------------
  async createAccount(
    ctx: RequestContext,
    actor: string | null,
    input: {
      entityId: string;
      accountTypeId: string;
      code: string;
      name: string;
      parentAccountId?: string | null;
      currencyId?: string | null;
      description?: string | null;
      postable?: boolean;
    },
  ): Promise<AccountRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.accountCreate);
    if (input.code.trim() === '' || input.code.length > FINANCE_LIMITS.maxCodeChars)
      throw badRequest('a code is required and must be bounded', ctx.correlationId);
    if (input.name.trim() === '' || input.name.length > FINANCE_LIMITS.maxNameChars)
      throw badRequest('a name is required and must be bounded', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      // Pre-check the composite-FK targets so a missing entity/type surfaces as a clean not-found.
      const entity = await this.repo.findEntity(tx, input.entityId);
      if (entity === null) throw ProblemError.notFound('Accounting entity not found.', ctx.correlationId);
      const type = await this.repo.findAccountType(tx, input.accountTypeId);
      if (type === null) throw ProblemError.notFound('Account type not found.', ctx.correlationId);
      if (input.parentAccountId != null) {
        const parent = await this.repo.findAccount(tx, input.parentAccountId);
        if (parent === null) throw ProblemError.notFound('Parent account not found.', ctx.correlationId);
      }
      if (input.currencyId != null) {
        const currency = await this.repo.findCurrency(tx, input.currencyId);
        if (currency === null) throw ProblemError.notFound('Currency not found.', ctx.correlationId);
      }
      const row = await this.repo.insertAccount(tx, {
        tenantId: ctx.tenantId,
        entityId: input.entityId,
        accountTypeId: input.accountTypeId,
        parentAccountId: input.parentAccountId ?? null,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        currencyId: input.currencyId ?? null,
        postable: input.postable ?? true,
        status: 'draft',
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertAccountHistory(tx, {
        tenantId: ctx.tenantId,
        accountId: row.id,
        fromStatus: null,
        toStatus: row.status,
        reason: null,
        reasonCode: 'created',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.accountCreated,
        entityType: 'finance_account',
        entityId: row.id,
        detail: { code: input.code, accountClass: type.account_class },
      });
      await this.publish(tx, ctx, actor, 'AccountCreated', {
        recordId: row.id,
        recordType: 'account',
        entityRef: input.entityId,
        code: input.code,
        accountType: type.account_class,
        toStatus: row.status,
      });
      return row;
    });
  }

  // --- update (draft or active) -----------------------------------------------------------------
  async updateAccount(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      name?: string | null;
      description?: string | null;
      accountTypeId?: string | null;
      parentAccountId?: string | null;
      currencyId?: string | null;
      postable?: boolean | null;
    },
  ): Promise<AccountRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.accountUpdate);
    if (input.parentAccountId != null && input.parentAccountId === id)
      throw badRequest('an account cannot be its own parent', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      await this.requireAccount(tx, id, ctx.correlationId);
      if (input.accountTypeId != null) {
        const type = await this.repo.findAccountType(tx, input.accountTypeId);
        if (type === null) throw ProblemError.notFound('Account type not found.', ctx.correlationId);
      }
      const upd = await this.repo.updateAccount(tx, {
        id,
        expectedVersion: input.expectedVersion,
        name: input.name ?? null,
        description: input.description ?? null,
        accountTypeId: input.accountTypeId ?? null,
        parentAccountId: input.parentAccountId ?? null,
        currencyId: input.currencyId ?? null,
        postable: input.postable ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Account not editable in this status or modified concurrently (stale version).',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M19_AUDIT_CODES.accountUpdated,
        entityType: 'finance_account',
        entityId: id,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'AccountUpdated', {
        recordId: id,
        recordType: 'account',
        entityRef: upd.entity_id,
        code: upd.code,
        toStatus: upd.status,
      });
      return upd;
    });
  }

  // --- lifecycle (single choke point) -----------------------------------------------------------
  private async move(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    to: string,
    opts: {
      permission: string;
      auditCode: string;
      eventType: FinanceLifecycleEventType;
      reasonCode: string;
      expectedVersion: number;
    },
  ): Promise<AccountRow> {
    await this.authz.require(ctx, opts.permission);
    return this.db.withTenant(ctx, async (tx) => {
      const acct = await this.requireAccount(tx, id, ctx.correlationId);
      const check = checkAccountTransition(acct.status, to);
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot move account ${acct.status} -> ${to}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const upd = await this.repo.transitionAccount(tx, {
        id,
        expectedVersion: opts.expectedVersion,
        toStatus: to,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Account modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertAccountHistory(tx, {
        tenantId: ctx.tenantId,
        accountId: id,
        fromStatus: acct.status,
        toStatus: to,
        reason: null,
        reasonCode: opts.reasonCode,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: opts.auditCode,
        entityType: 'finance_account',
        entityId: id,
        detail: { fromStatus: acct.status, toStatus: to, postable: isAccountPostable(to) },
      });
      await this.publish(tx, ctx, actor, opts.eventType, {
        recordId: id,
        recordType: 'account',
        entityRef: acct.entity_id,
        code: acct.code,
        fromStatus: acct.status,
        toStatus: to,
        reasonCode: opts.reasonCode,
      });
      return upd;
    });
  }
  activateAccount(ctx: RequestContext, actor: string | null, id: string, expectedVersion: number) {
    return this.move(ctx, actor, id, 'active', {
      permission: M19_PERMISSIONS.accountActivate,
      auditCode: M19_AUDIT_CODES.accountActivated,
      eventType: 'AccountActivated',
      reasonCode: 'activated',
      expectedVersion,
    });
  }
  deactivateAccount(ctx: RequestContext, actor: string | null, id: string, expectedVersion: number) {
    return this.move(ctx, actor, id, 'inactive', {
      permission: M19_PERMISSIONS.accountDeactivate,
      auditCode: M19_AUDIT_CODES.accountDeactivated,
      eventType: 'AccountDeactivated',
      reasonCode: 'deactivated',
      expectedVersion,
    });
  }
  archiveAccount(ctx: RequestContext, actor: string | null, id: string, expectedVersion: number) {
    return this.move(ctx, actor, id, 'archived', {
      permission: M19_PERMISSIONS.accountArchive,
      auditCode: M19_AUDIT_CODES.accountArchived,
      eventType: 'AccountArchived',
      reasonCode: 'archived',
      expectedVersion,
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async getAccount(ctx: RequestContext, id: string): Promise<AccountRow> {
    await this.authz.require(ctx, M19_PERMISSIONS.accountRead);
    const r = await this.db.withTenant(ctx, (tx) => this.repo.findAccount(tx, id));
    if (r === null) throw ProblemError.notFound('Ledger account not found.', ctx.correlationId);
    return r;
  }
  async listAccounts(
    ctx: RequestContext,
    filters: { entityId?: string; status?: string },
  ): Promise<AccountRow[]> {
    await this.authz.require(ctx, M19_PERMISSIONS.accountRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listAccounts(tx, filters));
  }
  async listAccountHistory(ctx: RequestContext, accountId: string): Promise<AccountHistoryRow[]> {
    await this.authz.require(ctx, M19_PERMISSIONS.accountRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listAccountHistory(tx, accountId));
  }
}
