/**
 * RuleSetService — the authoring + versioning + lifecycle engine for decision rule sets (ADR-032). Every
 * mutating method enforces its permission server-side (default deny, the single choke point), runs inside
 * `db.withTenant`, records audit + (for publish/activate/retire) a rules.lifecycle outbox event in the SAME
 * transaction, and is optimistic-lock guarded. Validation runs at the VALIDATE step over the to-be-frozen
 * spec; publishing freezes the content hash and a published version's spec is NEVER edited — a change is a
 * new version. Lifecycle transitions go through the PURE `checkRuleSetTransition` choke point.
 */
import { createHash } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M07_PERMISSIONS } from './permissions.ts';
import { M07_AUDIT_CODES } from './audit-codes.ts';
import { validateRuleSet } from './domain/validator.ts';
import { checkRuleSetTransition, type RuleSetAction, type RuleSetStatus } from './domain/lifecycles.ts';
import type { RuleSetSpec } from './domain/ruleset.ts';
import {
  RulesRepository,
  type RuleSetRow,
  type RuleSetVersionRow,
  type RuleSetHistoryRow,
} from './repository.ts';
import type { M07Emitter } from './emit.ts';
import { badRequest, invalidRuleSet } from './errors.ts';

/** Canonical content hash of a frozen spec — the immutability evidence stored at publish. */
export function contentHashOf(spec: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(spec)).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

function specCode(spec: unknown): string | null {
  if (typeof spec === 'object' && spec !== null && 'code' in spec) {
    const code = spec.code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export class RuleSetService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M07Emitter;
  private readonly repo: RulesRepository;

  constructor(db: Db, authz: Authz, emitter: M07Emitter, repo: RulesRepository = new RulesRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  /** Create a rule set and its first DRAFT version from a supplied spec. */
  async create(
    ctx: RequestContext,
    actor: string | null,
    input: { key: string; name: string; description?: string | null; scope?: string; spec: unknown },
  ): Promise<{ ruleSet: RuleSetRow; version: RuleSetVersionRow }> {
    await this.authz.require(ctx, M07_PERMISSIONS.engineAuthor);
    if (specCode(input.spec) !== input.key) {
      throw badRequest('spec.code must equal the rule-set key', ctx.correlationId);
    }
    const scope = input.scope ?? 'tenant';
    if (scope !== 'tenant' && scope !== 'platform') {
      throw badRequest("scope must be 'tenant' or 'platform'", ctx.correlationId);
    }
    if (scope === 'platform') {
      // Platform-scoped rule sets are a privileged authoring act (ADR-037).
      await this.authz.require(ctx, M07_PERMISSIONS.platformAdminister);
    }
    return this.db.withTenant(ctx, async (tx) => {
      const ruleSet = await this.repo.insertRuleSet(tx, {
        tenantId: ctx.tenantId,
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        scope,
        createdBy: actor,
      });
      const version = await this.repo.insertVersion(tx, {
        tenantId: ctx.tenantId,
        ruleSetId: ruleSet.id,
        versionNumber: 1,
        spec: input.spec,
        notes: null,
        createdBy: actor,
      });
      await this.repo.appendHistory(tx, {
        tenantId: ctx.tenantId,
        ruleSetId: ruleSet.id,
        versionId: version.id,
        fromStatus: null,
        toStatus: 'DRAFT',
        action: 'create',
        reason: null,
        correlationId: ctx.correlationId,
        changedBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M07_AUDIT_CODES.setCreated,
        entityType: 'rule_set',
        entityId: ruleSet.id,
        detail: { key: input.key, scope },
      });
      await this.emitter.publish(tx, {
        type: 'RuleSetCreated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { ruleSetId: ruleSet.id, versionId: version.id, versionNumber: 1, code: input.key },
      });
      return { ruleSet, version };
    });
  }

  /** Rename / re-describe a rule set (metadata only; never touches version content). */
  async update(
    ctx: RequestContext,
    actor: string | null,
    ruleSetId: string,
    input: { expectedVersion: number; name: string; description?: string | null },
  ): Promise<RuleSetRow> {
    await this.authz.require(ctx, M07_PERMISSIONS.engineAuthor);
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await this.repo.findRuleSet(tx, ruleSetId);
      if (existing === null) throw ProblemError.notFound('Rule set not found.', ctx.correlationId);
      const updated = await this.repo.updateRuleSet(tx, {
        id: ruleSetId,
        expectedVersion: input.expectedVersion,
        name: input.name,
        description: input.description ?? null,
        updatedBy: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Rule set was modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M07_AUDIT_CODES.setUpdated,
        entityType: 'rule_set',
        entityId: ruleSetId,
        detail: { name: input.name },
      });
      return updated;
    });
  }

  /** Author a NEW DRAFT version of an existing rule set from a fresh spec (published ones stay frozen). */
  async newVersion(
    ctx: RequestContext,
    actor: string | null,
    ruleSetId: string,
    spec: unknown,
    notes: string | null = null,
  ): Promise<RuleSetVersionRow> {
    await this.authz.require(ctx, M07_PERMISSIONS.engineAuthor);
    return this.db.withTenant(ctx, async (tx) => {
      const ruleSet = await this.repo.findRuleSet(tx, ruleSetId);
      if (ruleSet === null) throw ProblemError.notFound('Rule set not found.', ctx.correlationId);
      if (specCode(spec) !== ruleSet.key) {
        throw badRequest('spec.code must equal the rule-set key', ctx.correlationId);
      }
      const nextNumber = await this.repo.nextVersionNumber(tx, ruleSetId);
      const version = await this.repo.insertVersion(tx, {
        tenantId: ctx.tenantId,
        ruleSetId,
        versionNumber: nextNumber,
        spec,
        notes,
        createdBy: actor,
      });
      await this.repo.appendHistory(tx, {
        tenantId: ctx.tenantId,
        ruleSetId,
        versionId: version.id,
        fromStatus: null,
        toStatus: 'DRAFT',
        action: 'revise',
        reason: null,
        correlationId: ctx.correlationId,
        changedBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M07_AUDIT_CODES.versionCreated,
        entityType: 'rule_set_version',
        entityId: version.id,
        detail: { versionNumber: nextNumber },
      });
      return version;
    });
  }

  private async transition(
    ctx: RequestContext,
    actor: string | null,
    versionId: string,
    expectedVersion: number,
    action: RuleSetAction,
    permission: string,
    auditCode: string,
    eventType: 'RuleSetValidated' | 'RuleSetPublished' | 'RuleSetActivated' | 'RuleSetRetired' | null,
    reason: string | null,
  ): Promise<RuleSetVersionRow> {
    await this.authz.require(ctx, permission);
    return this.db.withTenant(ctx, async (tx) => {
      const version = await this.repo.findVersion(tx, versionId);
      if (version === null) throw ProblemError.notFound('Rule set version not found.', ctx.correlationId);

      // Validation runs at the VALIDATE step over the frozen-to-be spec (fail closed on any problem).
      if (action === 'validate') {
        const result = validateRuleSet(version.spec);
        if (!result.ok) {
          await this.emitter.recordAudit(tx, ctx, {
            code: M07_AUDIT_CODES.setValidationFailed,
            entityType: 'rule_set_version',
            entityId: versionId,
            detail: { problems: result.errors.length },
          });
          throw invalidRuleSet(result.errors, ctx.correlationId);
        }
      }

      const check = checkRuleSetTransition(version.status as RuleSetStatus, action);
      if (!check.ok)
        throw ProblemError.conflict(`Invalid rule-set transition: ${check.reason}`, ctx.correlationId);

      const contentHash = action === 'publish' ? contentHashOf(version.spec) : null;

      const updated = await this.repo.updateVersionStatus(tx, {
        id: versionId,
        expectedVersion,
        toStatus: check.to,
        contentHash,
        publishedBy: action === 'publish' ? actor : null,
      });
      if (updated === null)
        throw ProblemError.conflict(
          'Rule set version was modified concurrently (stale version).',
          ctx.correlationId,
        );

      // Exactly one ACTIVE version per rule set — retire the prior active sibling in the same tx so the
      // partial unique index never sees two.
      if (action === 'activate') {
        await tx.query(
          `UPDATE rule_set_version SET status = 'RETIRED', version = version + 1
           WHERE rule_set_id = $1 AND status = 'ACTIVE' AND id <> $2`,
          [updated.rule_set_id, versionId],
        );
      }

      await this.repo.appendHistory(tx, {
        tenantId: ctx.tenantId,
        ruleSetId: updated.rule_set_id,
        versionId,
        fromStatus: version.status,
        toStatus: check.to,
        action,
        reason,
        correlationId: ctx.correlationId,
        changedBy: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: auditCode,
        entityType: 'rule_set_version',
        entityId: versionId,
        ...(reason !== null ? { reason } : {}),
        detail: { toStatus: check.to },
      });
      if (eventType !== null) {
        await this.emitter.publish(tx, {
          type: eventType,
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: {
            ruleSetId: updated.rule_set_id,
            versionId,
            versionNumber: updated.version_number,
            code: specCode(version.spec) ?? '',
            fromStatus: version.status,
            toStatus: check.to,
            ...(reason !== null ? { reason } : {}),
          },
        });
      }
      return updated;
    });
  }

  validate(ctx: RequestContext, actor: string | null, versionId: string, expectedVersion: number) {
    return this.transition(
      ctx,
      actor,
      versionId,
      expectedVersion,
      'validate',
      M07_PERMISSIONS.engineValidate,
      M07_AUDIT_CODES.setValidated,
      'RuleSetValidated',
      null,
    );
  }

  publish(ctx: RequestContext, actor: string | null, versionId: string, expectedVersion: number) {
    return this.transition(
      ctx,
      actor,
      versionId,
      expectedVersion,
      'publish',
      M07_PERMISSIONS.enginePublish,
      M07_AUDIT_CODES.versionPublished,
      'RuleSetPublished',
      null,
    );
  }

  activate(ctx: RequestContext, actor: string | null, versionId: string, expectedVersion: number) {
    return this.transition(
      ctx,
      actor,
      versionId,
      expectedVersion,
      'activate',
      M07_PERMISSIONS.engineActivate,
      M07_AUDIT_CODES.versionActivated,
      'RuleSetActivated',
      null,
    );
  }

  retire(
    ctx: RequestContext,
    actor: string | null,
    versionId: string,
    expectedVersion: number,
    reason: string | null = null,
  ) {
    return this.transition(
      ctx,
      actor,
      versionId,
      expectedVersion,
      'retire',
      M07_PERMISSIONS.engineRetire,
      M07_AUDIT_CODES.versionRetired,
      'RuleSetRetired',
      reason,
    );
  }

  // --- reads (view permission) ------------------------------------------------------------------
  async get(ctx: RequestContext, ruleSetId: string): Promise<RuleSetRow> {
    await this.authz.require(ctx, M07_PERMISSIONS.engineView);
    const row = await this.db.withTenant(ctx, (tx) => this.repo.findRuleSet(tx, ruleSetId));
    if (row === null) throw ProblemError.notFound('Rule set not found.', ctx.correlationId);
    return row;
  }

  async list(ctx: RequestContext): Promise<RuleSetRow[]> {
    await this.authz.require(ctx, M07_PERMISSIONS.engineView);
    return this.db.withTenant(ctx, (tx) => this.repo.listRuleSets(tx));
  }

  async getVersion(ctx: RequestContext, versionId: string): Promise<RuleSetVersionRow> {
    await this.authz.require(ctx, M07_PERMISSIONS.engineView);
    const row = await this.db.withTenant(ctx, (tx) => this.repo.findVersion(tx, versionId));
    if (row === null) throw ProblemError.notFound('Rule set version not found.', ctx.correlationId);
    return row;
  }

  async listVersions(ctx: RequestContext, ruleSetId: string): Promise<RuleSetVersionRow[]> {
    await this.authz.require(ctx, M07_PERMISSIONS.engineView);
    return this.db.withTenant(ctx, (tx) => this.repo.listVersions(tx, ruleSetId));
  }

  async history(ctx: RequestContext, ruleSetId: string): Promise<RuleSetHistoryRow[]> {
    await this.authz.require(ctx, M07_PERMISSIONS.engineView);
    return this.db.withTenant(ctx, (tx) => this.repo.listHistory(tx, ruleSetId));
  }
}

export type { RuleSetSpec };
