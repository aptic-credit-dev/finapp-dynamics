/**
 * CatalogService — GL reconciliation accounts + versioned matching rulesets/rules. A ruleset is immutable after
 * publish (one active per code); a change is a new version via supersession. Every mutation runs inside
 * `db.withTenant` with audit (m03) + a glrecon.lifecycle event on the ONE m06 outbox, in the same transaction.
 * Money (amount tolerance) is INTEGER MINOR UNITS — never float (ADR-007).
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import type { GlreconLifecycleEventType, GlreconLifecyclePayload } from '@finapp/contracts';
import { M20_PERMISSIONS } from './permissions.ts';
import { M20_AUDIT_CODES } from './audit-codes.ts';
import { checkRulesetTransition, isRulesetFrozen } from './domain/lifecycles.ts';
import { isRuleKind } from './domain/limits.ts';
import { contentHashOf } from './hash.ts';
import { badRequest } from './errors.ts';
import {
  GlreconRepository,
  type GlAccountRow,
  type GlRulesetRow,
  type GlRuleRow,
  type GlRulesetHistoryRow,
} from './repository.ts';
import type { M20Emitter } from './emit.ts';

export class CatalogService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M20Emitter;
  private readonly repo: GlreconRepository;
  constructor(db: Db, authz: Authz, emitter: M20Emitter, repo: GlreconRepository = new GlreconRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }
  private async publish(
    tx: Tx,
    ctx: RequestContext,
    actor: string | null,
    type: GlreconLifecycleEventType,
    payload: GlreconLifecyclePayload,
  ): Promise<void> {
    await this.emitter.publish(tx, {
      type,
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      ...(actor !== null ? { actor } : {}),
      payload,
    });
  }

  // --- GL accounts ------------------------------------------------------------------------------
  async registerAccount(
    ctx: RequestContext,
    actor: string | null,
    input: {
      code: string;
      name: string;
      normalSide?: string;
      sourceSystem?: string;
      glAccountRef?: string | null;
      currencyRef?: string | null;
    },
  ): Promise<GlAccountRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.accountManage);
    const normalSide = input.normalSide ?? 'debit';
    if (normalSide !== 'debit' && normalSide !== 'credit')
      throw badRequest('normalSide must be debit or credit.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.insertAccount(tx, {
        tenantId: ctx.tenantId,
        glAccountRef: input.glAccountRef ?? null,
        currencyRef: input.currencyRef ?? null,
        sourceSystem: input.sourceSystem ?? 'ledger',
        code: input.code,
        name: input.name,
        normalSide,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.accountRegistered,
        entityType: 'gl_recon_account',
        entityId: row.id,
        detail: { code: input.code },
      });
      await this.publish(tx, ctx, actor, 'AccountRegistered', {
        recordId: row.id,
        recordType: 'account',
        glAccountRef: input.glAccountRef ?? row.id,
        toStatus: row.status,
      });
      return row;
    });
  }

  async updateAccount(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    patch: {
      name?: string;
      sourceSystem?: string;
      normalSide?: string;
      glAccountRef?: string | null;
      currencyRef?: string | null;
    },
  ): Promise<GlAccountRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.accountManage);
    return this.db.withTenant(ctx, async (tx) => {
      const updated = await this.repo.updateAccount(tx, {
        id,
        expectedVersion,
        name: patch.name ?? null,
        sourceSystem: patch.sourceSystem ?? null,
        normalSide: patch.normalSide ?? null,
        glAccountRef: patch.glAccountRef ?? null,
        currencyRef: patch.currencyRef ?? null,
        by: actor,
      });
      if (updated === null) {
        const exists = await this.repo.findAccount(tx, id);
        if (exists === null) throw ProblemError.notFound('GL account not found.', ctx.correlationId);
        throw ProblemError.conflict('GL account modified concurrently (stale version).', ctx.correlationId);
      }
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.accountUpdated,
        entityType: 'gl_recon_account',
        entityId: id,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'AccountUpdated', { recordId: id, recordType: 'account' });
      return updated;
    });
  }

  async deactivateAccount(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<GlAccountRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.accountDeactivate);
    return this.db.withTenant(ctx, async (tx) => {
      const updated = await this.repo.setAccountStatus(tx, {
        id,
        expectedVersion,
        toStatus: 'inactive',
        by: actor,
      });
      if (updated === null) {
        const exists = await this.repo.findAccount(tx, id);
        if (exists === null) throw ProblemError.notFound('GL account not found.', ctx.correlationId);
        throw ProblemError.conflict('GL account modified concurrently (stale version).', ctx.correlationId);
      }
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.accountDeactivated,
        entityType: 'gl_recon_account',
        entityId: id,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'AccountDeactivated', {
        recordId: id,
        recordType: 'account',
        toStatus: 'inactive',
      });
      return updated;
    });
  }

  async getAccount(ctx: RequestContext, id: string): Promise<GlAccountRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.accountRead);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.findAccount(tx, id);
      if (row === null) throw ProblemError.notFound('GL account not found.', ctx.correlationId);
      return row;
    });
  }

  async listAccounts(ctx: RequestContext, status?: string): Promise<GlAccountRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.accountRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listAccounts(tx, status));
  }

  // --- rulesets + rules -------------------------------------------------------------------------
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
  ): Promise<GlRulesetRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.rulesetManage);
    const tolerance = input.amountToleranceMinor ?? 0;
    if (!Number.isInteger(tolerance) || tolerance < 0)
      throw badRequest(
        'amountToleranceMinor must be a non-negative integer (minor units).',
        ctx.correlationId,
      );
    return this.db.withTenant(ctx, async (tx) => {
      const versionNumber = await this.repo.nextRulesetVersion(tx, input.code);
      const row = await this.repo.insertRuleset(tx, {
        tenantId: ctx.tenantId,
        code: input.code,
        versionNumber,
        name: input.name ?? null,
        dateWindowDays: input.dateWindowDays ?? 5,
        amountToleranceMinor: tolerance,
        requireOppositeDirection: input.requireOppositeDirection ?? true,
        supersedesId: null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertRulesetHistory(tx, {
        tenantId: ctx.tenantId,
        rulesetId: row.id,
        fromStatus: null,
        toStatus: 'draft',
        reason: 'ruleset created',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.rulesetCreated,
        entityType: 'gl_ruleset',
        entityId: row.id,
        detail: { code: input.code, versionNumber },
      });
      return row;
    });
  }

  async addRule(
    ctx: RequestContext,
    actor: string | null,
    rulesetId: string,
    input: { ruleCode: string; ruleKind: string; weight?: number; priority?: number },
  ): Promise<GlRuleRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.rulesetManage);
    if (!isRuleKind(input.ruleKind))
      throw badRequest(`Unknown rule kind "${input.ruleKind}".`, ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const ruleset = await this.repo.findRuleset(tx, rulesetId);
      if (ruleset === null) throw ProblemError.notFound('Ruleset not found.', ctx.correlationId);
      if (isRulesetFrozen(ruleset.status))
        throw ProblemError.conflict(
          'A published ruleset is immutable — create a new version.',
          ctx.correlationId,
        );
      const row = await this.repo.insertRule(tx, {
        tenantId: ctx.tenantId,
        rulesetId,
        ruleCode: input.ruleCode,
        ruleKind: input.ruleKind,
        weight: input.weight ?? 0,
        priority: input.priority ?? 0,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.ruleAdded,
        entityType: 'gl_rule',
        entityId: row.id,
        detail: { ruleKind: input.ruleKind },
      });
      return row;
    });
  }

  async publishRuleset(
    ctx: RequestContext,
    actor: string | null,
    rulesetId: string,
    expectedVersion: number,
  ): Promise<GlRulesetRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.rulesetPublish);
    return this.db.withTenant(ctx, async (tx) => {
      const ruleset = await this.repo.findRuleset(tx, rulesetId);
      if (ruleset === null) throw ProblemError.notFound('Ruleset not found.', ctx.correlationId);
      const check = checkRulesetTransition(ruleset.status, 'active');
      if (!check.ok)
        throw ProblemError.conflict(
          `Cannot publish from ${ruleset.status}: ${check.reason ?? ''}`,
          ctx.correlationId,
        );
      const rules = await this.repo.listRulesByRuleset(tx, rulesetId);
      const contentHash = contentHashOf({
        code: ruleset.code,
        versionNumber: ruleset.version_number,
        dateWindowDays: ruleset.date_window_days,
        amountToleranceMinor: ruleset.amount_tolerance_minor,
        requireOppositeDirection: ruleset.require_opposite_direction,
        rules: rules.map((r) => ({ code: r.rule_code, kind: r.rule_kind, weight: r.weight })),
      });
      // Supersede any currently-active version of the same code.
      const active = await this.repo.findActiveRuleset(tx, ruleset.code);
      if (active !== null && active.id !== ruleset.id) {
        await this.repo.transitionRuleset(tx, {
          id: active.id,
          expectedVersion: active.version,
          toStatus: 'superseded',
          supersededById: ruleset.id,
          by: actor,
        });
        await this.repo.insertRulesetHistory(tx, {
          tenantId: ctx.tenantId,
          rulesetId: active.id,
          fromStatus: 'active',
          toStatus: 'superseded',
          reason: `superseded by version ${String(ruleset.version_number)}`,
          by: actor,
          correlationId: ctx.correlationId,
        });
        await this.emitter.recordAudit(tx, ctx, {
          code: M20_AUDIT_CODES.rulesetSuperseded,
          entityType: 'gl_ruleset',
          entityId: active.id,
          detail: {},
        });
        await this.publish(tx, ctx, actor, 'RulesetSuperseded', {
          recordId: active.id,
          recordType: 'ruleset',
          toStatus: 'superseded',
        });
      }
      const published = await this.repo.transitionRuleset(tx, {
        id: rulesetId,
        expectedVersion,
        toStatus: 'active',
        contentHash,
        by: actor,
      });
      if (published === null)
        throw ProblemError.conflict('Ruleset modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertRulesetHistory(tx, {
        tenantId: ctx.tenantId,
        rulesetId,
        fromStatus: ruleset.status,
        toStatus: 'active',
        reason: 'ruleset published',
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.rulesetPublished,
        entityType: 'gl_ruleset',
        entityId: rulesetId,
        detail: { versionNumber: ruleset.version_number },
      });
      await this.publish(tx, ctx, actor, 'RulesetPublished', {
        recordId: rulesetId,
        recordType: 'ruleset',
        rulesetVersion: ruleset.version_number,
        toStatus: 'active',
      });
      return published;
    });
  }

  async getRuleset(ctx: RequestContext, id: string): Promise<GlRulesetRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.rulesetRead);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.findRuleset(tx, id);
      if (row === null) throw ProblemError.notFound('Ruleset not found.', ctx.correlationId);
      return row;
    });
  }
  async listRulesets(
    ctx: RequestContext,
    input: { code?: string; status?: string },
  ): Promise<GlRulesetRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.rulesetRead);
    return this.db.withTenant(ctx, (tx) =>
      this.repo.listRulesets(tx, {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      }),
    );
  }
  async listRules(ctx: RequestContext, rulesetId: string): Promise<GlRuleRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.rulesetRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listRulesByRuleset(tx, rulesetId));
  }
  async listRulesetHistory(ctx: RequestContext, rulesetId: string): Promise<GlRulesetHistoryRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.rulesetRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listRulesetHistory(tx, rulesetId));
  }
}
