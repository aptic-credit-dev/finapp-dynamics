/**
 * DecisionService — the high-risk certification controls: WAIVERS, the DERIVED GO/CONDITIONAL_GO/NO_GO DECISION (ADR-012), and
 * the STAGE CLOSURE artifact. THE LOAD-BEARING RULE: a verdict is DERIVED by `evaluateCertificationDecision` from governed
 * evidence (assessments, findings, readiness, sign-offs) — a caller can NEVER set GO. DENY-BY-DEFAULT: any blocker => NO_GO;
 * bounded approved residual conditions => CONDITIONAL_GO; otherwise GO. INDEPENDENCE (ADR-012): a waiver approval / decision
 * issuance is maker-checker/SoD (approver/certifier is a HUMAN != the requester; AI/system/automation refused); an absolute
 * control cannot be waived; an EXPIRED waiver stops satisfying the gate; an ISSUED decision + closure are IMMUTABLE (a
 * correction is a NEW decision). M42 RECORDS the decision + closure; it EXECUTES no release/deployment/migration.
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { M42_PERMISSIONS } from './permissions.ts';
import { M42_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden, notFound, versionConflict } from './errors.ts';
import {
  isPlatformScope,
  isHumanActor,
  evaluateSodGate,
  evaluateCertificationDecision,
  isWaiverActive,
  CERT_DOMAINS,
  CERT_ASPECTS,
  READINESS_KINDS,
  REQUIRED_SIGNOFF_ROLES,
  REASON_CODES,
  type CertificationVerdict,
} from './domain.ts';
import { CertificationRepository, type WaiverRow, type ProgrammeRow } from './repository.ts';
import type { M42Emitter } from './emit.ts';

export interface DecisionResult {
  readonly id: string;
  readonly decision: string;
  readonly decisionNo: number;
  readonly blockers: readonly string[];
}

export class DecisionService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M42Emitter;
  private readonly repo: CertificationRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M42Emitter,
    repo: CertificationRepository = new CertificationRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }
  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M42_PERMISSIONS.administer);
  }
  private async loadProgramme(tx: Tx, ctx: RequestContext, id: string): Promise<ProgrammeRow> {
    const p = await this.repo.getProgramme(tx, id);
    if (!p) throw notFound('programme not found.', ctx.correlationId);
    return p;
  }

  // ---- waivers --------------------------------------------------------------------------------
  async requestWaiver(
    ctx: RequestContext,
    input: { programmeId: string; findingId: string; scope: string; reason: string; isAbsolute?: boolean },
  ): Promise<WaiverRow> {
    await this.authz.require(ctx, M42_PERMISSIONS.waiverRequest);
    if (!input.scope || !input.reason)
      throw badRequest('a waiver scope and reason are required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const finding = await this.repo.getFinding(tx, input.findingId);
      if (!finding) throw notFound('finding not found.', ctx.correlationId);
      const w = await this.repo.insertWaiver(tx, {
        tenantId: ctx.tenantId,
        programmeId: input.programmeId,
        findingId: input.findingId,
        scope: input.scope,
        reason: input.reason,
        isAbsolute: input.isAbsolute ?? false,
        requestedBy: ctx.userId ?? '',
        correlationId: ctx.correlationId,
        by: ctx.userId ?? null,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M42_AUDIT_CODES.waiverRequested,
        entityType: 'certification_waiver',
        entityId: w.id,
        detail: { findingId: input.findingId },
      });
      return w;
    });
  }

  /** Approve/reject a waiver — maker-checker/SoD (approver human != requester). An ABSOLUTE control can never be waived. */
  async approveWaiver(
    ctx: RequestContext,
    approver: string,
    waiverId: string,
    expectedVersion: number,
    input: { validTo: Date; approve?: boolean },
  ): Promise<WaiverRow> {
    await this.authz.require(ctx, M42_PERMISSIONS.waiverApprove);
    return this.db.withTenant(ctx, async (tx) => {
      const w = await this.repo.getWaiver(tx, waiverId);
      if (!w) throw notFound('waiver not found.', ctx.correlationId);
      const gate = evaluateSodGate(w.requested_by, approver);
      if (!gate.allowed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M42_AUDIT_CODES.sodBlocked,
          entityType: 'certification_waiver',
          entityId: waiverId,
          detail: { reasonCode: gate.reasonCode },
        });
        throw governanceForbidden(gate.reasonCode, ctx.correlationId);
      }
      const approve = input.approve !== false;
      if (approve && w.is_absolute)
        throw governanceForbidden(REASON_CODES.absoluteNotWaivable, ctx.correlationId);
      if (approve && !(input.validTo instanceof Date))
        throw badRequest('an approved waiver needs an expiry (validTo).', ctx.correlationId);
      const nextState = approve ? 'approved' : 'rejected';
      const updated = await this.repo.updateWaiver(tx, waiverId, expectedVersion, {
        state: nextState,
        approvedBy: approver,
        validTo: approve ? input.validTo : null,
        by: ctx.userId ?? null,
      });
      if (!updated) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetKind: 'waiver',
        targetId: waiverId,
        decision: nextState,
        requestedBy: w.requested_by,
        decidedBy: approver,
        reasonCode: null,
        correlationId: ctx.correlationId,
      });
      // Reflect an approved waiver onto the finding (status -> waived); the gate still re-checks expiry at decision time.
      if (approve) {
        const finding = await this.repo.getFinding(tx, w.finding_id);
        if (finding)
          await this.repo.updateFindingStatus(tx, finding.id, finding.version, 'waived', ctx.userId ?? null);
      }
      await this.emitter.recordAudit(tx, ctx, {
        code: approve ? M42_AUDIT_CODES.waiverApproved : M42_AUDIT_CODES.waiverRejected,
        entityType: 'certification_waiver',
        entityId: waiverId,
        detail: { findingId: w.finding_id },
      });
      if (approve)
        await this.emitter.publishProgramme(tx, 'WaiverApproved', {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          actor: ctx.userId ?? undefined,
          payload: { recordId: waiverId, recordType: 'waiver' },
        });
      return updated;
    });
  }

  // ---- the derived decision -------------------------------------------------------------------
  /** Assemble the governed state and DERIVE the verdict. `residualConditions` = the bounded conditions the certifier attaches. */
  private async deriveVerdict(
    tx: Tx,
    programmeId: string,
    now: Date,
    residualConditions: number,
  ): Promise<CertificationVerdict> {
    // Queries run SEQUENTIALLY: a single pg connection cannot execute concurrent queries (no Promise.all on one tx).
    const assessments = await this.repo.listAssessments(tx, programmeId);
    const findingsRaw = await this.repo.listFindings(tx, programmeId);
    const readiness = await this.repo.listReadiness(tx, programmeId);
    const signoffs = await this.repo.listSignoffs(tx, programmeId);
    const findings: { severity: string; status: string; waiverActive: boolean }[] = [];
    for (const f of findingsRaw) {
      let waiverActive = false;
      if (f.status === 'waived') {
        const ws = await this.repo.listActiveWaiversForFinding(tx, f.id);
        waiverActive = ws.some((w) => isWaiverActive(w.state, w.valid_to, now));
      }
      findings.push({ severity: f.severity, status: f.status, waiverActive });
    }
    return evaluateCertificationDecision({
      requiredDomains: CERT_DOMAINS,
      requiredAspects: CERT_ASPECTS,
      requiredReadinessKinds: READINESS_KINDS,
      requiredSignoffRoles: REQUIRED_SIGNOFF_ROLES,
      assessments: assessments.map((a) => ({
        domainKey: a.domain_key,
        aspectKey: a.aspect_key,
        status: a.status,
      })),
      findings,
      readiness: readiness.map((r) => ({ kind: r.kind, result: r.result })),
      signoffs: signoffs.map((s) => ({ roleKey: s.role_key, disposition: s.disposition })),
      residualConditions,
    });
  }

  /**
   * ISSUE a certification decision. The verdict is DERIVED (never caller-set); the caller only supplies bounded residual
   * CONDITIONS (which turn an otherwise-GO into CONDITIONAL_GO — e.g. Stage-7 hardening). Maker-checker/SoD: the certifier is a
   * HUMAN != the requester (AI/system/automation refused). The decision row is append-only + immutable (a correction is a new
   * decision). `now` is injected so waiver-expiry is evaluated deterministically.
   */
  async issueDecision(
    ctx: RequestContext,
    certifier: string,
    input: {
      programmeId: string;
      requestedBy: string;
      idempotencyKey: string;
      now?: Date;
      conditions?: {
        conditionKey: string;
        description: string;
        ownerRef?: string | null;
        dueAt?: Date | null;
        evidenceRef?: string | null;
      }[];
    },
  ): Promise<DecisionResult> {
    await this.authz.require(ctx, M42_PERMISSIONS.decisionIssue);
    const gate = evaluateSodGate(input.requestedBy, certifier);
    if (!gate.allowed) throw governanceForbidden(gate.reasonCode, ctx.correlationId);
    if (!isHumanActor(certifier)) throw governanceForbidden(REASON_CODES.notHumanActor, ctx.correlationId);
    const now = input.now ?? new Date();
    const conditions = input.conditions ?? [];
    return this.db.withTenant(ctx, async (tx) => {
      const p = await this.loadProgramme(tx, ctx, input.programmeId);
      await this.authorizeScope(ctx, p.scope);
      // A CLOSED programme is terminal: its stage closure is immutable, so no further decision may be issued
      // against it (ADR-012 / §16). A correction before closure is a NEW decision (a higher decision_no), not an edit.
      if (p.state === 'closed') throw governanceForbidden(REASON_CODES.invalidTransition, ctx.correlationId);
      const fresh = await this.repo.claimIdempotency(
        tx,
        ctx.tenantId,
        'decision',
        input.idempotencyKey,
        ctx.correlationId,
      );
      if (!fresh)
        throw badRequest('a decision with this idempotency key was already issued.', ctx.correlationId);
      const verdict = await this.deriveVerdict(tx, input.programmeId, now, conditions.length);
      const decisionNo = (await this.repo.maxDecisionNo(tx, input.programmeId)) + 1;
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetKind: 'decision',
        targetId: input.programmeId,
        decision: verdict.decision,
        requestedBy: input.requestedBy,
        decidedBy: certifier,
        reasonCode: verdict.reasonCode,
        correlationId: ctx.correlationId,
      });
      const decision = await this.repo.insertDecision(tx, {
        tenantId: ctx.tenantId,
        programmeId: input.programmeId,
        decisionNo,
        decision: verdict.decision,
        requestedBy: input.requestedBy,
        issuedBy: certifier,
        evidenceRef: null,
        rationaleCode: verdict.reasonCode,
        correlationId: ctx.correlationId,
      });
      if (verdict.decision === 'conditional_go') {
        for (const c of conditions) {
          await this.repo.insertCondition(tx, {
            tenantId: ctx.tenantId,
            decisionId: decision.id,
            conditionKey: c.conditionKey,
            description: c.description,
            ownerRef: c.ownerRef ?? null,
            dueAt: c.dueAt ?? null,
            evidenceRef: c.evidenceRef ?? null,
            reasonCode: null,
            correlationId: ctx.correlationId,
          });
        }
      }
      const updated = await this.repo.updateProgramme(tx, input.programmeId, p.version, {
        state: 'decided',
        lastDecision: verdict.decision,
        currentDecisionNo: decisionNo,
        by: ctx.userId ?? null,
      });
      if (!updated) throw versionConflict(ctx.correlationId);
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        subjectKind: 'programme',
        subjectId: input.programmeId,
        fromState: p.state,
        toState: 'decided',
        actor: ctx.userId ?? null,
        reasonCode: verdict.decision,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: verdict.decision === 'no_go' ? M42_AUDIT_CODES.decisionBlocked : M42_AUDIT_CODES.decisionIssued,
        entityType: 'certification_decision',
        entityId: decision.id,
        detail: { decision: verdict.decision, blockers: verdict.blockers.length },
      });
      await this.emitter.publishProgramme(tx, 'DecisionIssued', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: { recordId: decision.id, recordType: 'decision', decision: verdict.decision },
      });
      return { id: decision.id, decision: verdict.decision, decisionNo, blockers: verdict.blockers };
    });
  }

  /** Preview the derived verdict WITHOUT issuing (read-only; no state change). */
  async previewDecision(ctx: RequestContext, programmeId: string, now?: Date): Promise<CertificationVerdict> {
    await this.authz.require(ctx, M42_PERMISSIONS.programmeRead);
    return this.db.withTenant(ctx, (tx) => this.deriveVerdict(tx, programmeId, now ?? new Date(), 0));
  }

  /** Read-only list of a programme's waivers (any state) for the evidence console. RLS-scoped; gated by finding.read. */
  async listWaivers(ctx: RequestContext, programmeId: string): Promise<WaiverRow[]> {
    await this.authz.require(ctx, M42_PERMISSIONS.findingRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listWaivers(tx, programmeId));
  }

  // ---- closure --------------------------------------------------------------------------------
  /** Issue the immutable STAGE CLOSURE artifact (after a decision is issued). Maker-checker/SoD; bounded metadata + opaque refs. */
  async closeStage(
    ctx: RequestContext,
    certifier: string,
    input: {
      programmeId: string;
      requestedBy: string;
      idempotencyKey: string;
      assessedModules: string;
      implCertRefs?: string | null;
      artifactRef?: string | null;
      findingsSummary?: string | null;
      signoffsSummary?: string | null;
      conditionsSummary?: string | null;
    },
  ): Promise<{ id: string; decision: string }> {
    await this.authz.require(ctx, M42_PERMISSIONS.decisionIssue);
    const gate = evaluateSodGate(input.requestedBy, certifier);
    if (!gate.allowed) throw governanceForbidden(gate.reasonCode, ctx.correlationId);
    if (!isHumanActor(certifier)) throw governanceForbidden(REASON_CODES.notHumanActor, ctx.correlationId);
    if (!input.assessedModules) throw badRequest('assessedModules is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const p = await this.loadProgramme(tx, ctx, input.programmeId);
      await this.authorizeScope(ctx, p.scope);
      if (p.state !== 'decided') throw governanceForbidden(REASON_CODES.invalidTransition, ctx.correlationId);
      const decision = await this.repo.getLatestDecision(tx, input.programmeId);
      if (!decision) throw governanceForbidden(REASON_CODES.invalidTransition, ctx.correlationId);
      const fresh = await this.repo.claimIdempotency(
        tx,
        ctx.tenantId,
        'closure',
        input.idempotencyKey,
        ctx.correlationId,
      );
      if (!fresh) throw badRequest('a closure with this idempotency key already exists.', ctx.correlationId);
      const closure = await this.repo.insertClosure(tx, {
        tenantId: ctx.tenantId,
        programmeId: input.programmeId,
        decisionId: decision.id,
        stageKey: p.stage_key,
        decision: decision.decision,
        assessedModules: input.assessedModules,
        findingsSummary: input.findingsSummary ?? null,
        signoffsSummary: input.signoffsSummary ?? null,
        conditionsSummary: input.conditionsSummary ?? null,
        implCertRefs: input.implCertRefs ?? null,
        artifactRef: input.artifactRef ?? null,
        issuedBy: certifier,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetKind: 'closure',
        targetId: closure.id,
        decision: decision.decision,
        requestedBy: input.requestedBy,
        decidedBy: certifier,
        reasonCode: null,
        correlationId: ctx.correlationId,
      });
      const updated = await this.repo.updateProgramme(tx, input.programmeId, p.version, {
        state: 'closed',
        lastDecision: p.last_decision,
        currentDecisionNo: p.current_decision_no,
        by: ctx.userId ?? null,
      });
      if (!updated) throw versionConflict(ctx.correlationId);
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        subjectKind: 'programme',
        subjectId: input.programmeId,
        fromState: p.state,
        toState: 'closed',
        actor: ctx.userId ?? null,
        reasonCode: decision.decision,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M42_AUDIT_CODES.closureIssued,
        entityType: 'certification_closure',
        entityId: closure.id,
        detail: { decision: decision.decision, stageKey: p.stage_key },
      });
      await this.emitter.publishProgramme(tx, 'ClosureIssued', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor: ctx.userId ?? undefined,
        payload: { recordId: closure.id, recordType: 'closure', decision: decision.decision },
      });
      return { id: closure.id, decision: decision.decision };
    });
  }
}
