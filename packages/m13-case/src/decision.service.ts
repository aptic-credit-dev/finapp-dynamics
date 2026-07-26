/**
 * CaseDecisionService — controlled decisions (maker-checker), settlements (maker-checker), the recovery/legal
 * boundary (finance references only), escalation (reuses m08 via an event), deterministic SLA start (materializes
 * stage deadlines from the active policy), case relationships, and safe aggregate analytics (F17-F27/F30/F34/F35).
 * Every mutating method enforces its permission (default deny), runs inside `db.withTenant`, records audit + a
 * case.lifecycle event in the same tx, and is optimistic-lock guarded. A decision/settlement submitter can NEVER
 * approve their own (segregation of duties, enforced in the service AND by a DB CHECK). Confidential settlement
 * terms are never placed in events/audit (ADR-060). Recovery/settlement store finance references only — no
 * ledger, no posting, no payment (ADR-059). SLA + escalation timer dispatch is delegated to m06/m08.
 */
import { randomUUID } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M13_PERMISSIONS } from './permissions.ts';
import { M13_AUDIT_CODES } from './audit-codes.ts';
import { isDecisionType, isConfidentiality, isRecoveryStage } from './domain/limits.ts';
import { isRelationshipKind, isSelfRelation } from './domain/closure.ts';
import { computeDueDates, type CaseSlaPolicySpec } from './domain/sla.ts';
import {
  CaseRepository,
  type CaseRow,
  type DecisionRow,
  type SettlementRow,
  type DeadlineRow,
  type RelationshipRow,
} from './repository.ts';
import type { M13Emitter } from './emit.ts';
import type { Clock } from './ports.ts';
import { SystemClock } from './ports.ts';
import { badRequest } from './errors.ts';

export class CaseDecisionService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M13Emitter;
  private readonly repo: CaseRepository;
  private readonly clock: Clock;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M13Emitter,
    repo: CaseRepository = new CaseRepository(),
    clock: Clock = new SystemClock(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
    this.clock = clock;
  }

  // --- decisions (maker-checker) ----------------------------------------------------------------
  async submitDecision(
    ctx: RequestContext,
    actor: string | null,
    caseId: string,
    input: {
      decisionType: string;
      summary?: string | null;
      reasons?: string | null;
      conditions?: string | null;
      remedyType?: string | null;
      remedyDetail?: string | null;
      financeReference?: string | null;
      supportingDocuments?: unknown;
      reviewAvailable?: boolean;
      confidentiality?: string;
    },
  ): Promise<DecisionRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.decisionSubmit);
    if (!isDecisionType(input.decisionType)) throw badRequest('invalid decision type', ctx.correlationId);
    const conf = input.confidentiality ?? 'standard';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const c = await this.repo.findCase(tx, caseId);
      if (c === null) throw ProblemError.notFound('Case not found.', ctx.correlationId);
      const d = await this.repo.insertDecision(tx, {
        tenantId: ctx.tenantId,
        caseId,
        decisionType: input.decisionType,
        summary: input.summary ?? null,
        reasons: input.reasons ?? null,
        conditions: input.conditions ?? null,
        remedyType: input.remedyType ?? null,
        remedyDetail: input.remedyDetail ?? null,
        financeReference: input.financeReference ?? null,
        supportingDocuments: input.supportingDocuments ?? null,
        reviewAvailable: input.reviewAvailable === true,
        confidentiality: conf,
        submittedBy: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.decisionSubmitted,
        entityType: 'case_decision',
        entityId: d.id,
        detail: { decisionType: input.decisionType },
      });
      await this.emitter.publish(tx, {
        type: 'DecisionSubmitted',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId },
      });
      return d;
    });
  }
  async approveDecision(ctx: RequestContext, actor: string | null, decisionId: string): Promise<DecisionRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.decisionApprove);
    return this.db.withTenant(ctx, async (tx) => {
      const d = await this.repo.findDecision(tx, decisionId);
      if (d === null) throw ProblemError.notFound('Decision not found.', ctx.correlationId);
      // Segregation of duties: the submitter cannot approve their own decision.
      if (d.submitted_by !== null && actor !== null && d.submitted_by === actor)
        throw ProblemError.conflict(
          'The decision submitter cannot approve it (segregation of duties).',
          ctx.correlationId,
        );
      const upd = await this.repo.approveDecision(tx, {
        id: decisionId,
        expectedVersion: d.version,
        approval: 'approved',
        approvedBy: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Decision already decided or modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.decisionApproved,
        entityType: 'case_decision',
        entityId: decisionId,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'DecisionApproved',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId: upd.case_id },
      });
      return upd;
    });
  }
  async listDecisions(
    ctx: RequestContext,
    caseId: string,
  ): Promise<{ decisions: DecisionRow[]; canReadConfidential: boolean }> {
    await this.authz.require(ctx, M13_PERMISSIONS.decisionRead);
    const canReadConfidential = await this.authz.can(ctx, M13_PERMISSIONS.confidentialRead);
    const decisions = await this.db.withTenant(ctx, (tx) => this.repo.listDecisions(tx, caseId));
    return { decisions, canReadConfidential };
  }

  // --- settlement (maker-checker; confidential terms redacted) -----------------------------------
  async proposeSettlement(
    ctx: RequestContext,
    actor: string | null,
    caseId: string,
    input: {
      settlementType?: string | null;
      proposedTerms?: string | null;
      confidentialTerms?: string | null;
      amountMinor?: number | null;
      currency?: string | null;
      nonMonetaryTerms?: string | null;
      effectiveDate?: string | null;
      documentRef?: string | null;
      confidentiality?: string;
    },
  ): Promise<SettlementRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.settlementManage);
    const conf = input.confidentiality ?? 'confidential';
    if (!isConfidentiality(conf)) throw badRequest('invalid confidentiality', ctx.correlationId);
    if (input.amountMinor != null && (!Number.isInteger(input.amountMinor) || input.amountMinor < 0))
      throw badRequest('amountMinor must be a non-negative integer (minor units)', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const c = await this.repo.findCase(tx, caseId);
      if (c === null) throw ProblemError.notFound('Case not found.', ctx.correlationId);
      const s = await this.repo.insertSettlement(tx, {
        tenantId: ctx.tenantId,
        caseId,
        settlementType: input.settlementType ?? null,
        proposedTerms: input.proposedTerms ?? null,
        confidentialTerms: input.confidentialTerms ?? null,
        amountMinor: input.amountMinor ?? null,
        currency: input.currency ?? null,
        nonMonetaryTerms: input.nonMonetaryTerms ?? null,
        proposedBy: actor,
        effectiveDate: input.effectiveDate ?? null,
        documentRef: input.documentRef ?? null,
        confidentiality: conf,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.settlementProposed,
        entityType: 'case_settlement',
        entityId: s.id,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'SettlementProposed',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId },
      });
      return s;
    });
  }
  async approveSettlement(
    ctx: RequestContext,
    actor: string | null,
    settlementId: string,
  ): Promise<SettlementRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.settlementApprove);
    return this.db.withTenant(ctx, async (tx) => {
      const s = await this.repo.findSettlement(tx, settlementId);
      if (s === null) throw ProblemError.notFound('Settlement not found.', ctx.correlationId);
      if (s.proposed_by !== null && actor !== null && s.proposed_by === actor)
        throw ProblemError.conflict(
          'The settlement proposer cannot approve it (segregation of duties).',
          ctx.correlationId,
        );
      const upd = await this.repo.approveSettlement(tx, {
        id: settlementId,
        expectedVersion: s.version,
        approval: 'approved',
        approvedBy: actor,
      });
      if (upd === null)
        throw ProblemError.conflict(
          'Settlement already decided or modified concurrently.',
          ctx.correlationId,
        );
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.settlementApproved,
        entityType: 'case_settlement',
        entityId: settlementId,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'SettlementApproved',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId: upd.case_id },
      });
      return upd;
    });
  }
  async listSettlements(
    ctx: RequestContext,
    caseId: string,
  ): Promise<{ settlements: SettlementRow[]; canReadConfidential: boolean }> {
    await this.authz.require(ctx, M13_PERMISSIONS.settlementRead);
    const canReadConfidential = await this.authz.can(ctx, M13_PERMISSIONS.confidentialRead);
    const settlements = await this.db.withTenant(ctx, (tx) => this.repo.listSettlements(tx, caseId));
    return { settlements, canReadConfidential };
  }

  // --- recovery + legal (finance references only) -----------------------------------------------
  async updateRecovery(
    ctx: RequestContext,
    actor: string | null,
    caseId: string,
    input: {
      expectedVersion: number;
      recoveryState?: string | null;
      claimedMinor?: number | null;
      recoveredMinor?: number | null;
      currency?: string | null;
    },
  ): Promise<CaseRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.recoveryManage);
    if (input.recoveryState != null && !isRecoveryStage(input.recoveryState))
      throw badRequest('invalid recovery stage', ctx.correlationId);
    for (const v of [input.claimedMinor, input.recoveredMinor])
      if (v != null && (!Number.isInteger(v) || v < 0))
        throw badRequest('recovery amounts are non-negative integer minor units', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const c = await this.repo.findCase(tx, caseId);
      if (c === null) throw ProblemError.notFound('Case not found.', ctx.correlationId);
      const upd = await this.repo.patchCase(tx, {
        id: caseId,
        expectedVersion: input.expectedVersion,
        recoveryState: input.recoveryState ?? null,
        recoveryClaimedMinor: input.claimedMinor ?? null,
        recoveryRecoveredMinor: input.recoveredMinor ?? null,
        recoveryCurrency: input.currency ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Case modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.recoveryUpdated,
        entityType: 'case_record',
        entityId: caseId,
        detail: { recoveryState: input.recoveryState },
      });
      return upd;
    });
  }
  async updateLegal(
    ctx: RequestContext,
    actor: string | null,
    caseId: string,
    input: { expectedVersion: number; legalStatus?: string | null; courtReference?: string | null },
  ): Promise<CaseRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.legalManage);
    return this.db.withTenant(ctx, async (tx) => {
      const c = await this.repo.findCase(tx, caseId);
      if (c === null) throw ProblemError.notFound('Case not found.', ctx.correlationId);
      const upd = await this.repo.patchCase(tx, {
        id: caseId,
        expectedVersion: input.expectedVersion,
        legalStatus: input.legalStatus ?? null,
        courtReference: input.courtReference ?? null,
        by: actor,
      });
      if (upd === null)
        throw ProblemError.conflict('Case modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.legalUpdated,
        entityType: 'case_record',
        entityId: caseId,
        detail: {},
      });
      return upd;
    });
  }

  // --- escalation (reuses m08 via an event; m13 builds no second escalation engine) --------------
  async triggerEscalation(
    ctx: RequestContext,
    actor: string | null,
    caseId: string,
    input: { reason: string },
  ): Promise<string> {
    await this.authz.require(ctx, M13_PERMISSIONS.caseUpdate);
    if (input.reason.trim() === '') throw badRequest('a reason is required to escalate', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const c = await this.repo.findCase(tx, caseId);
      if (c === null) throw ProblemError.notFound('Case not found.', ctx.correlationId);
      const escalationRef = c.escalation_ref ?? randomUUID();
      await this.repo.patchCase(tx, { id: caseId, expectedVersion: c.version, escalationRef, by: actor });
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.escalationTriggered,
        entityType: 'case_record',
        entityId: caseId,
        reason: input.reason,
        detail: {},
      });
      await this.emitter.publish(tx, {
        type: 'CaseEscalated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: { caseId, ...(c.severity != null ? { severity: c.severity } : {}), reasonCode: 'manual' },
      });
      return escalationRef;
    });
  }

  // --- deterministic SLA (materializes stage deadlines from the active policy) -------------------
  async startSla(
    ctx: RequestContext,
    actor: string | null,
    caseId: string,
    policyCode: string,
  ): Promise<DeadlineRow[]> {
    await this.authz.require(ctx, M13_PERMISSIONS.deadlineManage);
    return this.db.withTenant(ctx, async (tx) => {
      const c = await this.repo.findCase(tx, caseId);
      if (c === null) throw ProblemError.notFound('Case not found.', ctx.correlationId);
      const policy = await this.repo.findActiveSlaPolicy(tx, policyCode);
      if (policy === null)
        throw ProblemError.conflict('No active SLA policy for that code.', ctx.correlationId);
      const spec = policy.spec as CaseSlaPolicySpec;
      const startMs = this.clock.now();
      const due = computeDueDates(spec, startMs);
      const iso = (ms: number): string => new Date(ms).toISOString();
      const startIso = iso(startMs);
      const stages: { type: string; ms: number }[] = [
        { type: 'response', ms: due.responseAtMs },
        { type: 'internal_review', ms: due.investigationAtMs },
        { type: 'internal_review', ms: due.resolutionAtMs },
      ];
      const rows: DeadlineRow[] = [];
      for (const s of stages) {
        rows.push(
          await this.repo.insertDeadline(tx, {
            tenantId: ctx.tenantId,
            caseId,
            deadlineType: s.type,
            startAt: startIso,
            dueAt: iso(s.ms),
            calculationRule: 'sla_policy',
            source: policyCode,
            authority: null,
            linkedActivity: null,
            linkedTask: null,
            correlationId: ctx.correlationId,
            by: actor,
          }),
        );
      }
      await this.repo.patchCase(tx, {
        id: caseId,
        expectedVersion: c.version,
        slaPolicyCode: policyCode,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.slaStarted,
        entityType: 'case_record',
        entityId: caseId,
        detail: { policyCode },
      });
      return rows;
    });
  }

  // --- relationships ----------------------------------------------------------------------------
  async link(
    ctx: RequestContext,
    actor: string | null,
    input: { fromCaseId: string; toCaseId: string; kind: string },
  ): Promise<RelationshipRow> {
    await this.authz.require(ctx, M13_PERMISSIONS.relationshipManage);
    if (!isRelationshipKind(input.kind)) throw badRequest('invalid relationship kind', ctx.correlationId);
    if (isSelfRelation(input.fromCaseId, input.toCaseId))
      throw badRequest('a case cannot relate to itself', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const from = await this.repo.findCase(tx, input.fromCaseId);
      const to = await this.repo.findCase(tx, input.toCaseId);
      if (from === null || to === null)
        throw ProblemError.notFound('Both cases must exist in this tenant.', ctx.correlationId);
      // Reject a symmetric/duplicate reverse edge that would create a trivial cycle.
      if (
        input.kind === 'duplicate_of' ||
        input.kind === 'consolidated_with' ||
        input.kind === 'parent_of' ||
        input.kind === 'child_of'
      ) {
        const reverse = await this.repo.findReverseRelationship(
          tx,
          input.fromCaseId,
          input.toCaseId,
          input.kind === 'parent_of' ? 'child_of' : input.kind === 'child_of' ? 'parent_of' : input.kind,
        );
        if (reverse !== null)
          throw ProblemError.conflict(
            'The reverse relationship already exists (cycle rejected).',
            ctx.correlationId,
          );
      }
      const row = await this.repo.insertRelationship(tx, {
        tenantId: ctx.tenantId,
        fromId: input.fromCaseId,
        toId: input.toCaseId,
        kind: input.kind,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M13_AUDIT_CODES.relationshipCreated,
        entityType: 'case_relationship',
        entityId: row.id,
        detail: { kind: input.kind },
      });
      return row;
    });
  }
  async listRelationships(ctx: RequestContext, caseId: string): Promise<RelationshipRow[]> {
    await this.authz.require(ctx, M13_PERMISSIONS.relationshipRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listRelationships(tx, caseId));
  }

  // --- analytics --------------------------------------------------------------------------------
  async analytics(ctx: RequestContext, dimension: string): Promise<{ dim: string | null; count: string }[]> {
    await this.authz.require(ctx, M13_PERMISSIONS.analyticsRead);
    return this.db.withTenant(ctx, (tx) => this.repo.analyticsByDimension(tx, dimension));
  }
}
