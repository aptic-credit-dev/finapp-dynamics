/**
 * DlpService — the canonical DLP policy + evaluation. `evaluate` is the real implementation behind m24's `DlpPolicyEvaluator`
 * port (a composition-root adapter wraps it). It FAILS CLOSED: restricted data that looks secret, matches a block policy, or is
 * UNGOVERNED (no active policy for `restricted`) is BLOCKED — restricted data never flows to an unapproved provider. It records
 * a bounded finding (classification / action / reason / count) — NEVER the restricted content itself. m24 remains the AI
 * orchestration owner; m41 supplies only the policy decision + evidence.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M41_PERMISSIONS } from './permissions.ts';
import { M41_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import {
  isPlatformScope,
  evaluateDlp,
  CLASSIFICATIONS,
  DLP_ACTIONS,
  REASON_CODES,
  type DlpAction,
} from './domain.ts';
import { SecurityRepository, type DlpPolicyRow } from './repository.ts';
import type { M41Emitter } from './emit.ts';

const LOOKS_SECRET = /\b(secret|password|api[_-]?key|ssn|pan|private[_-]?key|token)\b/i;

export interface DlpDecision {
  readonly action: DlpAction;
  readonly reasonCode: string;
  readonly findingCount: number;
}

export class DlpService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M41Emitter;
  private readonly repo: SecurityRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M41Emitter,
    repo: SecurityRepository = new SecurityRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  async setPolicy(
    ctx: RequestContext,
    input: { scope?: string; policyKey: string; classification: string; action?: string },
  ): Promise<DlpPolicyRow> {
    await this.authz.require(ctx, M41_PERMISSIONS.dlpManage);
    const scope = input.scope ?? 'tenant';
    if (scope !== 'platform' && scope !== 'tenant') throw badRequest('unknown scope.', ctx.correlationId);
    if (isPlatformScope(scope)) await this.authz.require(ctx, M41_PERMISSIONS.administer);
    if (!(CLASSIFICATIONS as readonly string[]).includes(input.classification))
      throw badRequest('unknown classification.', ctx.correlationId);
    const action = input.action ?? 'block';
    if (!(DLP_ACTIONS as readonly string[]).includes(action))
      throw badRequest('unknown DLP action.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const policy = await this.repo.insertDlpPolicy(tx, {
        tenantId: ctx.tenantId,
        scope,
        policyKey: input.policyKey,
        classification: input.classification,
        action,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M41_AUDIT_CODES.dlpPolicySet,
        entityType: 'security_dlp_policy',
        entityId: policy.id,
        detail: { classification: input.classification, action },
      });
      return policy;
    });
  }

  /**
   * Evaluate DLP for a classification + text. FAILS CLOSED: restricted + looks-secret, or a block policy, or NO active policy
   * governing `restricted`, all BLOCK. Records a bounded finding (no restricted content). Returns the decision (m24 port shape).
   */
  async evaluate(
    ctx: RequestContext,
    input: { classification: string; text: string; sourceRef?: string | null },
  ): Promise<DlpDecision> {
    await this.authz.require(ctx, M41_PERMISSIONS.dlpRead);
    const looksSecret = LOOKS_SECRET.test(input.text);
    return this.db.withTenant(ctx, async (tx) => {
      const policy = await this.repo.findDlpPolicy(tx, input.classification);
      let decision = evaluateDlp({
        classification: input.classification,
        looksSecret,
        policyAction: policy?.action,
      });
      // FAIL CLOSED: restricted data with no governing active policy is blocked (never forwarded).
      if (input.classification === 'restricted' && !policy && decision.action !== 'block') {
        decision = { action: 'block', reasonCode: REASON_CODES.dlpBlocked };
      }
      const findingCount = decision.action === 'block' ? 1 : 0;
      const finding = await this.repo.insertDlpFinding(tx, {
        tenantId: ctx.tenantId,
        policyId: policy?.id ?? null,
        classification: input.classification,
        action: decision.action,
        reasonCode: decision.reasonCode,
        sourceRef: input.sourceRef ?? null,
        findingCount,
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M41_AUDIT_CODES.dlpDecision,
        entityType: 'security_dlp_finding',
        entityId: finding.id,
        detail: {
          classification: input.classification,
          action: decision.action,
          reasonCode: decision.reasonCode,
        },
      });
      await this.emitter.publishDlp(tx, decision.action === 'block' ? 'DlpBlocked' : 'DlpCleared', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: {
          recordId: finding.id,
          classification: input.classification,
          reasonCode: decision.reasonCode,
        },
      });
      return { action: decision.action, reasonCode: decision.reasonCode, findingCount };
    });
  }
}
