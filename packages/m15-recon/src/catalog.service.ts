/**
 * CatalogService — the reconciliation reference data: bank accounts to reconcile and the versioned matching
 * RULESETS the deterministic engine (m15a) consumes. Every mutating method enforces its permission (default deny),
 * runs inside `db.withTenant`, and records audit + a `reconciliation.lifecycle` event in the SAME transaction. A
 * ruleset is PUBLISHABLE + IMMUTABLE-after-publish through the ONE choke point `checkRulesetTransition`
 * (draft → active → superseded → retired): a draft may be edited / gain rules; a published (active) ruleset is
 * frozen — its content_hash is sealed at publish (`contentHashOf` over the ruleset + its rules) and a change is a
 * NEW version (supersession, version_number+1) with the prior version moved to `superseded`. The partial unique index
 * `recon_matching_ruleset_one_active` guarantees exactly one active version per code. Money (amount tolerance) is
 * INTEGER MINOR UNITS — never float (ADR-007). m15 owns only `recon_*`; entity_ref/currency_ref are OPAQUE m19 ids.
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import type { ReconciliationLifecycleEventType, ReconciliationLifecyclePayload } from '@finapp/contracts';
import { M15_PERMISSIONS } from './permissions.ts';
import { M15_AUDIT_CODES } from './audit-codes.ts';
import { checkRulesetTransition, isRulesetFrozen } from './domain/lifecycles.ts';
import { RECON_LIMITS, isRuleKind } from './domain/limits.ts';
import { contentHashOf } from './hash.ts';
import {
  ReconRepository,
  type BankAccountRow,
  type MatchingRulesetRow,
  type MatchingRuleRow,
  type RulesetHistoryRow,
} from './repository.ts';
import type { M15Emitter } from './emit.ts';
import { badRequest } from './errors.ts';

function assertBounded(value: string, what: string, max: number, correlationId: string): void {
  if (value.trim() === '' || value.length > max)
    throw badRequest(`${what} is required and must be bounded`, correlationId);
}

export class CatalogService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M15Emitter;
  private readonly repo: ReconRepository;
  constructor(db: Db, authz: Authz, emitter: M15Emitter, repo: ReconRepository = new ReconRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  private async publish(
    tx: Tx,
    ctx: RequestContext,
    actor: string | null,
    type: ReconciliationLifecycleEventType,
    payload: ReconciliationLifecyclePayload,
  ): Promise<void> {
    await this.emitter.publish(tx, {
      type,
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      ...(actor !== null ? { actor } : {}),
      payload,
    });
  }
  private async requireBankAccount(tx: Tx, id: string, correlationId: string): Promise<BankAccountRow> {
    const a = await this.repo.findBankAccount(tx, id);
    if (a === null) throw ProblemError.notFound('Bank account not found.', correlationId);
    return a;
  }
  private async requireRuleset(tx: Tx, id: string, correlationId: string): Promise<MatchingRulesetRow> {
    const rs = await this.repo.findRuleset(tx, id);
    if (rs === null) throw ProblemError.notFound('Matching ruleset not found.', correlationId);
    return rs;
  }
  /** The immutable content projection sealed into content_hash at publish (ruleset params + its rules). */
  private projection(rs: MatchingRulesetRow, rules: readonly MatchingRuleRow[]): unknown {
    return {
      code: rs.code,
      versionNumber: rs.version_number,
      dateWindowDays: rs.date_window_days,
      amountToleranceMinor: rs.amount_tolerance_minor,
      requireOppositeDirection: rs.require_opposite_direction,
      rules: rules
        .map((r) => ({ code: r.rule_code, kind: r.rule_kind, weight: r.weight, priority: r.priority }))
        .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
    };
  }

  // --- bank account -----------------------------------------------------------------------------
  async registerBankAccount(
    ctx: RequestContext,
    actor: string | null,
    input: {
      bankName: string;
      accountLabel: string;
      entityRef?: string | null;
      currencyRef?: string | null;
      accountRefMasked?: string | null;
      branch?: string | null;
    },
  ): Promise<BankAccountRow> {
    await this.authz.require(ctx, M15_PERMISSIONS.bankAccountManage);
    assertBounded(input.bankName, 'a bank name', RECON_LIMITS.maxCodeChars * 4, ctx.correlationId);
    assertBounded(input.accountLabel, 'an account label', RECON_LIMITS.maxCodeChars * 4, ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.insertBankAccount(tx, {
        tenantId: ctx.tenantId,
        entityRef: input.entityRef ?? null,
        currencyRef: input.currencyRef ?? null,
        bankName: input.bankName,
        accountLabel: input.accountLabel,
        accountRefMasked: input.accountRefMasked ?? null,
        branch: input.branch ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M15_AUDIT_CODES.bankAccountRegistered,
        entityType: 'recon_bank_account',
        entityId: row.id,
        detail: { bankName: input.bankName },
      });
      await this.publish(tx, ctx, actor, 'BankAccountRegistered', {
        recordId: row.id,
        recordType: 'bank_account',
        bankAccountRef: row.id,
        toStatus: row.status,
      });
      return row;
    });
  }
  async updateBankAccount(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    input: {
      expectedVersion: number;
      bankName?: string | null;
      accountLabel?: string | null;
      accountRefMasked?: string | null;
      branch?: string | null;
      entityRef?: string | null;
      currencyRef?: string | null;
    },
  ): Promise<BankAccountRow> {
    await this.authz.require(ctx, M15_PERMISSIONS.bankAccountManage);
    return this.db.withTenant(ctx, async (tx) => {
      const upd = await this.repo.updateBankAccount(tx, {
        id,
        expectedVersion: input.expectedVersion,
        bankName: input.bankName ?? null,
        accountLabel: input.accountLabel ?? null,
        accountRefMasked: input.accountRefMasked ?? null,
        branch: input.branch ?? null,
        entityRef: input.entityRef ?? null,
        currencyRef: input.currencyRef ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Bank account archived or modified concurrently (stale version).',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M15_AUDIT_CODES.bankAccountUpdated,
        entityType: 'recon_bank_account',
        entityId: id,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'BankAccountUpdated', {
        recordId: id,
        recordType: 'bank_account',
        bankAccountRef: id,
        toStatus: upd.status,
      });
      return upd;
    });
  }
  async deactivateBankAccount(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<BankAccountRow> {
    await this.authz.require(ctx, M15_PERMISSIONS.bankAccountDeactivate);
    return this.db.withTenant(ctx, async (tx) => {
      const acct = await this.requireBankAccount(tx, id, ctx.correlationId);
      const upd = await this.repo.setBankAccountStatus(tx, {
        id,
        expectedVersion,
        toStatus: 'inactive',
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Bank account modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M15_AUDIT_CODES.bankAccountDeactivated,
        entityType: 'recon_bank_account',
        entityId: id,
        detail: { fromStatus: acct.status },
      });
      await this.publish(tx, ctx, actor, 'BankAccountDeactivated', {
        recordId: id,
        recordType: 'bank_account',
        bankAccountRef: id,
        fromStatus: acct.status,
        toStatus: 'inactive',
      });
      return upd;
    });
  }
  async getBankAccount(ctx: RequestContext, id: string): Promise<BankAccountRow> {
    await this.authz.require(ctx, M15_PERMISSIONS.bankAccountRead);
    const r = await this.db.withTenant(ctx, (tx) => this.repo.findBankAccount(tx, id));
    if (r === null) throw ProblemError.notFound('Bank account not found.', ctx.correlationId);
    return r;
  }
  async listBankAccounts(ctx: RequestContext, status?: string): Promise<BankAccountRow[]> {
    await this.authz.require(ctx, M15_PERMISSIONS.bankAccountRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listBankAccounts(tx, status));
  }

  // --- matching ruleset (draft) -----------------------------------------------------------------
  async createRuleset(
    ctx: RequestContext,
    actor: string | null,
    input: {
      code: string;
      name?: string | null;
      dateWindowDays?: number;
      amountToleranceMinor?: number;
      requireOppositeDirection?: boolean;
    },
  ): Promise<MatchingRulesetRow> {
    await this.authz.require(ctx, M15_PERMISSIONS.rulesetManage);
    assertBounded(input.code, 'a code', RECON_LIMITS.maxCodeChars, ctx.correlationId);
    const dateWindowDays = input.dateWindowDays ?? 5;
    const amountToleranceMinor = input.amountToleranceMinor ?? 0;
    if (!Number.isInteger(dateWindowDays) || dateWindowDays < 0)
      throw badRequest('date window (days) must be a non-negative integer', ctx.correlationId);
    if (!Number.isSafeInteger(amountToleranceMinor) || amountToleranceMinor < 0)
      throw badRequest('amount tolerance must be a non-negative integer (minor units)', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const versionNumber = await this.repo.nextRulesetVersion(tx, input.code);
      const row = await this.repo.insertRuleset(tx, {
        tenantId: ctx.tenantId,
        code: input.code,
        versionNumber,
        name: input.name ?? null,
        dateWindowDays,
        amountToleranceMinor,
        requireOppositeDirection: input.requireOppositeDirection ?? true,
        supersedesId: null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertRulesetHistory(tx, {
        tenantId: ctx.tenantId,
        rulesetId: row.id,
        fromStatus: null,
        toStatus: row.status,
        reason: 'created',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M15_AUDIT_CODES.rulesetCreated,
        entityType: 'recon_matching_ruleset',
        entityId: row.id,
        detail: { code: input.code, versionNumber, status: row.status },
      });
      return row;
    });
  }
  async addRule(
    ctx: RequestContext,
    actor: string | null,
    rulesetId: string,
    input: { ruleCode: string; ruleKind: string; weight?: number; priority?: number },
  ): Promise<MatchingRuleRow> {
    await this.authz.require(ctx, M15_PERMISSIONS.rulesetManage);
    assertBounded(input.ruleCode, 'a rule code', RECON_LIMITS.maxCodeChars, ctx.correlationId);
    if (!isRuleKind(input.ruleKind)) throw badRequest('invalid rule kind', ctx.correlationId);
    const weight = input.weight ?? 0;
    const priority = input.priority ?? 0;
    if (!Number.isInteger(weight) || weight < 0 || weight > 100)
      throw badRequest('weight must be an integer in 0..100', ctx.correlationId);
    if (!Number.isInteger(priority) || priority < 0)
      throw badRequest('priority must be a non-negative integer', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const rs = await this.requireRuleset(tx, rulesetId, ctx.correlationId);
      // A published (active or beyond) ruleset is frozen — a change is a new version (supersession).
      if (isRulesetFrozen(rs.status))
        throw ProblemError.conflict(
          `Ruleset is ${rs.status} and immutable — supersede it to change its rules.`,
          ctx.correlationId,
        );
      const row = await this.repo.insertRule(tx, {
        tenantId: ctx.tenantId,
        rulesetId,
        ruleCode: input.ruleCode,
        ruleKind: input.ruleKind,
        weight,
        priority,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M15_AUDIT_CODES.ruleAdded,
        entityType: 'recon_matching_rule',
        entityId: row.id,
        detail: { rulesetId, ruleCode: input.ruleCode, ruleKind: input.ruleKind },
      });
      return row;
    });
  }
  async publishRuleset(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<MatchingRulesetRow> {
    await this.authz.require(ctx, M15_PERMISSIONS.rulesetPublish);
    return this.db.withTenant(ctx, async (tx) => {
      const rs = await this.requireRuleset(tx, id, ctx.correlationId);
      const check = checkRulesetTransition(rs.status, 'active');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot publish ruleset ${rs.status} -> active: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      // The partial unique index `..._one_active` is the hard guard; this surfaces a clean conflict first.
      const active = await this.repo.findActiveRuleset(tx, rs.code);
      if (active !== null)
        throw ProblemError.conflict(
          'An active ruleset already exists for this code — supersede it instead.',
          ctx.correlationId,
        );
      const rules = await this.repo.listRulesByRuleset(tx, id);
      const upd = await this.repo.transitionRuleset(tx, {
        id,
        expectedVersion,
        toStatus: 'active',
        contentHash: contentHashOf(this.projection(rs, rules)),
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Ruleset modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertRulesetHistory(tx, {
        tenantId: ctx.tenantId,
        rulesetId: id,
        fromStatus: rs.status,
        toStatus: 'active',
        reason: 'published',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M15_AUDIT_CODES.rulesetPublished,
        entityType: 'recon_matching_ruleset',
        entityId: id,
        detail: { code: rs.code, versionNumber: rs.version_number },
      });
      await this.publish(tx, ctx, actor, 'RulesetPublished', {
        recordId: id,
        recordType: 'ruleset',
        rulesetVersion: rs.version_number,
        fromStatus: rs.status,
        toStatus: 'active',
      });
      return upd;
    });
  }
  /**
   * Supersession — the only way to change a published ruleset. Moves the prior active version to `superseded`,
   * inserts a NEW version (version_number+1, same code) COPYING the prior rules (plus any overrides), publishes it
   * to active with a freshly sealed content_hash, and links the prior version to its successor — so the one-active
   * index always holds exactly one live head.
   */
  async supersedeRuleset(
    ctx: RequestContext,
    actor: string | null,
    priorId: string,
    input: {
      expectedVersion: number;
      name?: string | null;
      dateWindowDays?: number;
      amountToleranceMinor?: number;
      requireOppositeDirection?: boolean;
    },
  ): Promise<{ prior: MatchingRulesetRow; successor: MatchingRulesetRow }> {
    await this.authz.require(ctx, M15_PERMISSIONS.rulesetPublish);
    return this.db.withTenant(ctx, async (tx) => {
      const prior = await this.requireRuleset(tx, priorId, ctx.correlationId);
      if (prior.status !== 'active')
        throw ProblemError.conflict('Only an active ruleset can be superseded.', ctx.correlationId);
      const priorRules = await this.repo.listRulesByRuleset(tx, priorId);
      // 1) Move the prior version off `active` so the successor can become the sole active head.
      const supersededPrior = await this.repo.transitionRuleset(tx, {
        id: priorId,
        expectedVersion: input.expectedVersion,
        toStatus: 'superseded',
        by: actor,
      });
      if (supersededPrior === null)
        throw ProblemError.conflict(
          'Prior ruleset modified concurrently (stale version).',
          ctx.correlationId,
        );
      // 2) Insert the successor draft (copy params + rules) and publish it.
      const versionNumber = await this.repo.nextRulesetVersion(tx, prior.code);
      const successorDraft = await this.repo.insertRuleset(tx, {
        tenantId: ctx.tenantId,
        code: prior.code,
        versionNumber,
        name: input.name ?? prior.name,
        dateWindowDays: input.dateWindowDays ?? prior.date_window_days,
        amountToleranceMinor: input.amountToleranceMinor ?? Number(prior.amount_tolerance_minor),
        requireOppositeDirection: input.requireOppositeDirection ?? prior.require_opposite_direction,
        supersedesId: prior.id,
        correlationId: ctx.correlationId,
        by: actor,
      });
      const copiedRules: MatchingRuleRow[] = [];
      for (const rule of priorRules) {
        copiedRules.push(
          await this.repo.insertRule(tx, {
            tenantId: ctx.tenantId,
            rulesetId: successorDraft.id,
            ruleCode: rule.rule_code,
            ruleKind: rule.rule_kind,
            weight: rule.weight,
            priority: rule.priority,
            correlationId: ctx.correlationId,
            by: actor,
          }),
        );
      }
      const activated = await this.repo.transitionRuleset(tx, {
        id: successorDraft.id,
        expectedVersion: successorDraft.version,
        toStatus: 'active',
        contentHash: contentHashOf(this.projection(successorDraft, copiedRules)),
        by: actor,
      });
      // 3) Link the prior version to its successor.
      const linkedPrior = await this.repo.transitionRuleset(tx, {
        id: priorId,
        expectedVersion: supersededPrior.version,
        toStatus: 'superseded',
        supersededById: successorDraft.id,
        by: actor,
      });
      const successor = activated ?? successorDraft;
      const finalPrior = linkedPrior ?? supersededPrior;
      await this.repo.insertRulesetHistory(tx, {
        tenantId: ctx.tenantId,
        rulesetId: priorId,
        fromStatus: 'active',
        toStatus: 'superseded',
        reason: 'superseded',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertRulesetHistory(tx, {
        tenantId: ctx.tenantId,
        rulesetId: successor.id,
        fromStatus: null,
        toStatus: 'active',
        reason: 'versioned',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M15_AUDIT_CODES.rulesetSuperseded,
        entityType: 'recon_matching_ruleset',
        entityId: priorId,
        detail: { supersededById: successor.id, versionNumber },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M15_AUDIT_CODES.rulesetPublished,
        entityType: 'recon_matching_ruleset',
        entityId: successor.id,
        detail: { code: prior.code, versionNumber },
      });
      await this.publish(tx, ctx, actor, 'RulesetSuperseded', {
        recordId: priorId,
        recordType: 'ruleset',
        rulesetVersion: prior.version_number,
        fromStatus: 'active',
        toStatus: 'superseded',
        reasonCode: 'superseded',
      });
      await this.publish(tx, ctx, actor, 'RulesetPublished', {
        recordId: successor.id,
        recordType: 'ruleset',
        rulesetVersion: versionNumber,
        toStatus: 'active',
      });
      return { prior: finalPrior, successor };
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async getRuleset(ctx: RequestContext, id: string): Promise<MatchingRulesetRow> {
    await this.authz.require(ctx, M15_PERMISSIONS.rulesetRead);
    const r = await this.db.withTenant(ctx, (tx) => this.repo.findRuleset(tx, id));
    if (r === null) throw ProblemError.notFound('Matching ruleset not found.', ctx.correlationId);
    return r;
  }
  async listRulesets(
    ctx: RequestContext,
    filters: { code?: string; status?: string },
  ): Promise<MatchingRulesetRow[]> {
    await this.authz.require(ctx, M15_PERMISSIONS.rulesetRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listRulesets(tx, filters));
  }
  async listRules(ctx: RequestContext, rulesetId: string): Promise<MatchingRuleRow[]> {
    await this.authz.require(ctx, M15_PERMISSIONS.rulesetRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listRulesByRuleset(tx, rulesetId));
  }
  async listRulesetHistory(ctx: RequestContext, rulesetId: string): Promise<RulesetHistoryRow[]> {
    await this.authz.require(ctx, M15_PERMISSIONS.rulesetRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listRulesetHistory(tx, rulesetId));
  }
}
