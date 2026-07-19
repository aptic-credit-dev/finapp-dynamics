import { ProblemError, type Authz, type Db, type RequestContext, type SystemContext, type Tx } from '@finapp/kernel';
import { RbacRepository, type SodRuleRow } from './repository.ts';
import { type RbacEmitter } from './emit.ts';
import { RBAC_AUDIT_CODES } from './audit-codes.ts';
import { RBAC_PERMISSIONS } from './permissions.ts';

/** The caller's proven context — tenant or platform — always carrying its resolved permissions. */
type AuthorizedContext = RequestContext | (SystemContext & { readonly permissions: readonly string[] });

/** A detected incompatibility. Structured internally; surfaced to callers only as a generic 409. */
export interface SodConflict {
  readonly ruleType: string;
  readonly codeA: string;
  readonly codeB: string;
}

/**
 * Segregation of Duties (ADR-019). Enforced at ASSIGNMENT time (reject a grant that would create an
 * incompatible pair) and available as a RUNTIME fail-safe. Global mandatory rules (tenant_id NULL) apply
 * everywhere; tenant rules apply within their tenant.
 */
export class SodService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: RbacEmitter;
  private readonly repo: RbacRepository;

  constructor(db: Db, authz: Authz, emitter: RbacEmitter, repo: RbacRepository = new RbacRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  /**
   * Would granting `newRoleId` (code `newRoleCode`) to `membershipId` create a conflict? Runs inside the
   * caller's tenant transaction so tenant SoD rules + the member's current tenant grants are all visible.
   */
  async firstConflict(
    tx: Tx,
    input: { membershipId: string; newRoleId: string; newRoleCode: string; currentRoleCodes: readonly string[] },
  ): Promise<SodConflict | null> {
    // permission_pair: does the combined permission set contain both sides of any rule?
    const permRules = await this.repo.sodRulesFor(tx, 'permission_pair');
    if (permRules.length > 0) {
      const current = await this.repo.currentMembershipPermissions(tx, input.membershipId);
      const incoming = await this.repo.permissionsOfRole(tx, input.newRoleId);
      const combined = new Set([...current, ...incoming]);
      const hit = permRules.find((r) => combined.has(r.code_a) && combined.has(r.code_b));
      if (hit !== undefined) return { ruleType: 'permission_pair', codeA: hit.code_a, codeB: hit.code_b };
    }
    // role_pair: does the member hold both role codes of any rule?
    const roleRules = await this.repo.sodRulesFor(tx, 'role_pair');
    if (roleRules.length > 0) {
      const roleCodes = new Set([...input.currentRoleCodes, input.newRoleCode]);
      const hit = roleRules.find((r) => roleCodes.has(r.code_a) && roleCodes.has(r.code_b));
      if (hit !== undefined) return { ruleType: 'role_pair', codeA: hit.code_a, codeB: hit.code_b };
    }
    return null;
  }

  /** Emits the conflict event/audit and throws a generic 409 — called by the assignment service on a hit. */
  async rejectConflict(
    tx: Tx,
    sys: SystemContext,
    input: { conflict: SodConflict; membershipId: string; correlationId: string; actor: string | null },
  ): Promise<never> {
    await this.emitter.recordAudit(tx, sys, {
      code: RBAC_AUDIT_CODES.sodConflictDetected,
      entityType: 'membership',
      entityId: input.membershipId,
      detail: { ruleType: input.conflict.ruleType, codeA: input.conflict.codeA, codeB: input.conflict.codeB },
    });
    await this.emitter.publish(tx, 'SodConflictDetected', null, input.correlationId, input.actor, {
      subjectId: input.membershipId,
      codeA: input.conflict.codeA,
      codeB: input.conflict.codeB,
    });
    throw ProblemError.conflict('This grant is blocked by a segregation-of-duties rule.', input.correlationId);
  }

  // --- administration -----------------------------------------------------------------------------
  async list(ctx: AuthorizedContext): Promise<SodRuleRow[]> {
    await this.authz.require(ctx, RBAC_PERMISSIONS.sodView);
    return this.db.withSystem(
      { reason: 'list sod rules (m02-rbac)', correlationId: ctx.correlationId },
      (tx) => this.repo.listSodRules(tx),
    );
  }

  async create(
    ctx: AuthorizedContext,
    input: { tenantId: string; ruleType: string; codeA: string; codeB: string; description: string | null; severity: string; actor: string | null },
  ): Promise<SodRuleRow> {
    await this.authz.require(ctx, RBAC_PERMISSIONS.sodManage);
    if (input.ruleType !== 'role_pair' && input.ruleType !== 'permission_pair') {
      throw badRequest('ruleType must be role_pair or permission_pair.', ctx.correlationId);
    }
    // Canonical order so (a,b) and (b,a) are the same rule (matches the DB CHECK code_a < code_b).
    const [codeA, codeB] = input.codeA < input.codeB ? [input.codeA, input.codeB] : [input.codeB, input.codeA];
    if (codeA === codeB) throw badRequest('An SoD rule needs two distinct codes.', ctx.correlationId);
    const sys: SystemContext = { reason: 'create sod rule (m02-rbac)', correlationId: ctx.correlationId };
    return this.db.withSystem(sys, async (tx) => {
      let row: SodRuleRow;
      try {
        row = await this.repo.insertSodRule(tx, {
          tenantId: input.tenantId, ruleType: input.ruleType, codeA, codeB,
          description: input.description, severity: input.severity, createdBy: input.actor,
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) throw ProblemError.conflict('That SoD rule already exists.', ctx.correlationId);
        throw error;
      }
      await this.emitter.recordAudit(tx, sys, { code: RBAC_AUDIT_CODES.sodRuleCreated, entityType: 'sod_rule', entityId: row.id });
      await this.emitter.publish(tx, 'SodRuleCreated', input.tenantId, ctx.correlationId, input.actor, {
        ruleId: row.id, codeA, codeB,
      });
      return row;
    });
  }

  async setStatus(ctx: AuthorizedContext, input: { id: string; expectedVersion: number; status: string; actor: string | null }): Promise<SodRuleRow> {
    await this.authz.require(ctx, RBAC_PERMISSIONS.sodManage);
    if (input.status !== 'active' && input.status !== 'retired') throw badRequest('status must be active or retired.', ctx.correlationId);
    const sys: SystemContext = { reason: 'update sod rule (m02-rbac)', correlationId: ctx.correlationId };
    return this.db.withSystem(sys, async (tx) => {
      const current = await this.repo.findSodRule(tx, input.id);
      if (current === null) throw ProblemError.notFound('SoD rule not found.', ctx.correlationId);
      const updated = await this.repo.updateSodRuleStatus(tx, input);
      if (updated === null) throw ProblemError.conflict('Version conflict.', ctx.correlationId);
      await this.emitter.recordAudit(tx, sys, { code: RBAC_AUDIT_CODES.sodRuleUpdated, entityType: 'sod_rule', entityId: input.id });
      return updated;
    });
  }
}

export function badRequest(detail: string, correlationId: string): ProblemError {
  return new ProblemError({ type: 'https://finapp.dynamics/problems/validation', title: 'Bad Request', status: 400, detail, correlationId });
}
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && (error as { code?: unknown } | null)?.code === '23505';
}
