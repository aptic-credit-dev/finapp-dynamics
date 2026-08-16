/**
 * M42 repository — ALL SQL across its 13 certification_ tables. Every query is parameterized; every mutating UPDATE on a mutable
 * aggregate is optimistic-lock guarded (`WHERE id=$ AND version=$expected`). Queries carry NO tenant_id predicate: RLS FORCE is
 * the isolation guarantee. All methods take the caller's `Tx`. Sign-offs, decisions, conditions, evidence, reviews, history,
 * closure + the idempotency ledger are append-only. An issued decision + a closure artifact are additionally trigger-immutable.
 * Evidence columns hold OPAQUE references only — never a secret, credential, full log or raw report/evidence body.
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m42 repository: expected a row from ${what}`);
  return row;
}

export interface ProgrammeRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly programme_key: string;
  readonly stage_key: string;
  readonly title: string;
  readonly state: string;
  readonly last_decision: string | null;
  readonly current_decision_no: number;
  readonly version: number;
}
export interface AssessmentRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly programme_id: string;
  readonly domain_key: string;
  readonly aspect_key: string;
  readonly status: string;
  readonly evidence_ref: string | null;
  readonly assessed_by: string | null;
  readonly version: number;
}
export interface FindingRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly programme_id: string;
  readonly domain_key: string;
  readonly aspect_key: string | null;
  readonly severity: string;
  readonly status: string;
  readonly title: string;
  readonly version: number;
}
export interface WaiverRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly programme_id: string;
  readonly finding_id: string;
  readonly is_absolute: boolean;
  readonly requested_by: string;
  readonly approved_by: string | null;
  readonly state: string;
  readonly valid_to: Date | null;
  readonly version: number;
}
export interface ReadinessRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly programme_id: string;
  readonly kind: string;
  readonly ref_key: string;
  readonly result: string;
  readonly signed_off_by: string | null;
  readonly version: number;
}
export interface DecisionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly programme_id: string;
  readonly decision_no: number;
  readonly decision: string;
  readonly derived: boolean;
}
export interface ClosureRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly programme_id: string;
  readonly decision: string;
}

export class CertificationRepository {
  // ---- programme (mutable aggregate) ----
  async insertProgramme(
    tx: Tx,
    p: {
      tenantId: string;
      scope: string;
      programmeKey: string;
      stageKey: string;
      title: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ProgrammeRow> {
    const { rows } = await tx.query<ProgrammeRow>(
      `INSERT INTO certification_programme (tenant_id, scope, programme_key, stage_key, title, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       RETURNING tenant_id, id, scope, programme_key, stage_key, title, state, last_decision, current_decision_no, version`,
      [p.tenantId, p.scope, p.programmeKey, p.stageKey, p.title, p.correlationId, p.by],
    );
    return firstRow(rows, 'insertProgramme');
  }
  async getProgramme(tx: Tx, id: string): Promise<ProgrammeRow | null> {
    const { rows } = await tx.query<ProgrammeRow>(
      `SELECT tenant_id, id, scope, programme_key, stage_key, title, state, last_decision, current_decision_no, version FROM certification_programme WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async updateProgramme(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { state: string; lastDecision: string | null; currentDecisionNo: number; by: string | null },
  ): Promise<ProgrammeRow | null> {
    const { rows } = await tx.query<ProgrammeRow>(
      `UPDATE certification_programme SET state=$3, last_decision=$4, current_decision_no=$5, version=version+1, updated_at=now(), updated_by=$6
       WHERE id=$1 AND version=$2 RETURNING tenant_id, id, scope, programme_key, stage_key, title, state, last_decision, current_decision_no, version`,
      [id, expectedVersion, patch.state, patch.lastDecision, patch.currentDecisionNo, patch.by],
    );
    return rows[0] ?? null;
  }
  async listProgrammes(tx: Tx, limit: number, offset: number): Promise<ProgrammeRow[]> {
    const { rows } = await tx.query<ProgrammeRow>(
      `SELECT tenant_id, id, scope, programme_key, stage_key, title, state, last_decision, current_decision_no, version FROM certification_programme ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  }

  // ---- assessment (mutable; upsert per cell) ----
  async upsertAssessment(
    tx: Tx,
    a: {
      tenantId: string;
      programmeId: string;
      domainKey: string;
      aspectKey: string;
      status: string;
      evidenceRef: string | null;
      reasonCode: string | null;
      assessedBy: string | null;
      correlationId: string;
    },
  ): Promise<AssessmentRow> {
    const { rows } = await tx.query<AssessmentRow>(
      `INSERT INTO certification_assessment (tenant_id, programme_id, domain_key, aspect_key, status, evidence_ref, reason_code, assessed_by, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$8)
       ON CONFLICT (tenant_id, programme_id, domain_key, aspect_key)
       DO UPDATE SET status=EXCLUDED.status, evidence_ref=EXCLUDED.evidence_ref, reason_code=EXCLUDED.reason_code,
                     assessed_by=EXCLUDED.assessed_by, version=certification_assessment.version+1, updated_at=now(), updated_by=EXCLUDED.updated_by
       RETURNING tenant_id, id, programme_id, domain_key, aspect_key, status, evidence_ref, assessed_by, version`,
      [
        a.tenantId,
        a.programmeId,
        a.domainKey,
        a.aspectKey,
        a.status,
        a.evidenceRef,
        a.reasonCode,
        a.assessedBy,
        a.correlationId,
      ],
    );
    return firstRow(rows, 'upsertAssessment');
  }
  async listAssessments(tx: Tx, programmeId: string): Promise<AssessmentRow[]> {
    const { rows } = await tx.query<AssessmentRow>(
      `SELECT tenant_id, id, programme_id, domain_key, aspect_key, status, evidence_ref, assessed_by, version FROM certification_assessment WHERE programme_id=$1`,
      [programmeId],
    );
    return rows;
  }

  // ---- finding (mutable aggregate) ----
  async insertFinding(
    tx: Tx,
    f: {
      tenantId: string;
      programmeId: string;
      domainKey: string;
      aspectKey: string | null;
      severity: string;
      title: string;
      evidenceRef: string | null;
      ownerRef: string | null;
      reasonCode: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<FindingRow> {
    const { rows } = await tx.query<FindingRow>(
      `INSERT INTO certification_finding (tenant_id, programme_id, domain_key, aspect_key, severity, title, evidence_ref, owner_ref, reason_code, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       RETURNING tenant_id, id, programme_id, domain_key, aspect_key, severity, status, title, version`,
      [
        f.tenantId,
        f.programmeId,
        f.domainKey,
        f.aspectKey,
        f.severity,
        f.title,
        f.evidenceRef,
        f.ownerRef,
        f.reasonCode,
        f.correlationId,
        f.by,
      ],
    );
    return firstRow(rows, 'insertFinding');
  }
  async getFinding(tx: Tx, id: string): Promise<FindingRow | null> {
    const { rows } = await tx.query<FindingRow>(
      `SELECT tenant_id, id, programme_id, domain_key, aspect_key, severity, status, title, version FROM certification_finding WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async updateFindingStatus(
    tx: Tx,
    id: string,
    expectedVersion: number,
    status: string,
    by: string | null,
  ): Promise<FindingRow | null> {
    const { rows } = await tx.query<FindingRow>(
      `UPDATE certification_finding SET status=$3, version=version+1, updated_at=now(), updated_by=$4
       WHERE id=$1 AND version=$2 RETURNING tenant_id, id, programme_id, domain_key, aspect_key, severity, status, title, version`,
      [id, expectedVersion, status, by],
    );
    return rows[0] ?? null;
  }
  async listFindings(tx: Tx, programmeId: string): Promise<FindingRow[]> {
    const { rows } = await tx.query<FindingRow>(
      `SELECT tenant_id, id, programme_id, domain_key, aspect_key, severity, status, title, version FROM certification_finding WHERE programme_id=$1`,
      [programmeId],
    );
    return rows;
  }

  // ---- waiver (mutable aggregate) ----
  async insertWaiver(
    tx: Tx,
    w: {
      tenantId: string;
      programmeId: string;
      findingId: string;
      scope: string;
      reason: string;
      isAbsolute: boolean;
      requestedBy: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<WaiverRow> {
    const { rows } = await tx.query<WaiverRow>(
      `INSERT INTO certification_waiver (tenant_id, programme_id, finding_id, scope, reason, is_absolute, requested_by, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
       RETURNING tenant_id, id, programme_id, finding_id, is_absolute, requested_by, approved_by, state, valid_to, version`,
      [
        w.tenantId,
        w.programmeId,
        w.findingId,
        w.scope,
        w.reason,
        w.isAbsolute,
        w.requestedBy,
        w.correlationId,
        w.by,
      ],
    );
    return firstRow(rows, 'insertWaiver');
  }
  async getWaiver(tx: Tx, id: string): Promise<WaiverRow | null> {
    const { rows } = await tx.query<WaiverRow>(
      `SELECT tenant_id, id, programme_id, finding_id, is_absolute, requested_by, approved_by, state, valid_to, version FROM certification_waiver WHERE id=$1`,
      [id],
    );
    return rows[0] ?? null;
  }
  async updateWaiver(
    tx: Tx,
    id: string,
    expectedVersion: number,
    patch: { state: string; approvedBy: string | null; validTo: Date | null; by: string | null },
  ): Promise<WaiverRow | null> {
    const { rows } = await tx.query<WaiverRow>(
      `UPDATE certification_waiver SET state=$3, approved_by=$4, valid_to=$5, version=version+1, updated_at=now(), updated_by=$6
       WHERE id=$1 AND version=$2 RETURNING tenant_id, id, programme_id, finding_id, is_absolute, requested_by, approved_by, state, valid_to, version`,
      [id, expectedVersion, patch.state, patch.approvedBy, patch.validTo, patch.by],
    );
    return rows[0] ?? null;
  }
  async listActiveWaiversForFinding(tx: Tx, findingId: string): Promise<WaiverRow[]> {
    const { rows } = await tx.query<WaiverRow>(
      `SELECT tenant_id, id, programme_id, finding_id, is_absolute, requested_by, approved_by, state, valid_to, version FROM certification_waiver WHERE finding_id=$1 AND state='approved'`,
      [findingId],
    );
    return rows;
  }

  // ---- readiness (mutable; upsert per kind+ref) ----
  async upsertReadiness(
    tx: Tx,
    r: {
      tenantId: string;
      programmeId: string;
      kind: string;
      refKey: string;
      planRef: string | null;
      evidenceRef: string | null;
      rollbackRef: string | null;
      result: string;
      signedOffBy: string | null;
      reasonCode: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ReadinessRow> {
    const { rows } = await tx.query<ReadinessRow>(
      `INSERT INTO certification_readiness (tenant_id, programme_id, kind, ref_key, plan_ref, evidence_ref, rollback_ref, result, signed_off_by, reason_code, correlation_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
       ON CONFLICT (tenant_id, programme_id, kind, ref_key)
       DO UPDATE SET plan_ref=EXCLUDED.plan_ref, evidence_ref=EXCLUDED.evidence_ref, rollback_ref=EXCLUDED.rollback_ref, result=EXCLUDED.result,
                     signed_off_by=EXCLUDED.signed_off_by, reason_code=EXCLUDED.reason_code, version=certification_readiness.version+1, updated_at=now(), updated_by=EXCLUDED.updated_by
       RETURNING tenant_id, id, programme_id, kind, ref_key, result, signed_off_by, version`,
      [
        r.tenantId,
        r.programmeId,
        r.kind,
        r.refKey,
        r.planRef,
        r.evidenceRef,
        r.rollbackRef,
        r.result,
        r.signedOffBy,
        r.reasonCode,
        r.correlationId,
        r.by,
      ],
    );
    return firstRow(rows, 'upsertReadiness');
  }
  async listReadiness(tx: Tx, programmeId: string): Promise<ReadinessRow[]> {
    const { rows } = await tx.query<ReadinessRow>(
      `SELECT tenant_id, id, programme_id, kind, ref_key, result, signed_off_by, version FROM certification_readiness WHERE programme_id=$1`,
      [programmeId],
    );
    return rows;
  }

  // ---- signoff (append-only) ----
  async insertSignoff(
    tx: Tx,
    s: {
      tenantId: string;
      programmeId: string;
      roleKey: string;
      domainKey: string | null;
      signedBy: string;
      disposition: string;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<{ id: string }> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO certification_signoff (tenant_id, programme_id, role_key, domain_key, signed_by, disposition, reason_code, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        s.tenantId,
        s.programmeId,
        s.roleKey,
        s.domainKey,
        s.signedBy,
        s.disposition,
        s.reasonCode,
        s.correlationId,
      ],
    );
    return firstRow(rows, 'insertSignoff');
  }
  async listSignoffs(
    tx: Tx,
    programmeId: string,
  ): Promise<{ role_key: string; domain_key: string | null; signed_by: string; disposition: string }[]> {
    const { rows } = await tx.query<{
      role_key: string;
      domain_key: string | null;
      signed_by: string;
      disposition: string;
    }>(
      `SELECT role_key, domain_key, signed_by, disposition FROM certification_signoff WHERE programme_id=$1`,
      [programmeId],
    );
    return rows;
  }

  // ---- decision (append-only + immutable) ----
  async maxDecisionNo(tx: Tx, programmeId: string): Promise<number> {
    const { rows } = await tx.query<{ n: string | null }>(
      `SELECT max(decision_no)::text AS n FROM certification_decision WHERE programme_id=$1`,
      [programmeId],
    );
    return Number(rows[0]?.n ?? '0');
  }
  async insertDecision(
    tx: Tx,
    d: {
      tenantId: string;
      programmeId: string;
      decisionNo: number;
      decision: string;
      requestedBy: string;
      issuedBy: string;
      evidenceRef: string | null;
      rationaleCode: string | null;
      correlationId: string;
    },
  ): Promise<DecisionRow> {
    const { rows } = await tx.query<DecisionRow>(
      `INSERT INTO certification_decision (tenant_id, programme_id, decision_no, decision, requested_by, issued_by, evidence_ref, rationale_code, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING tenant_id, id, programme_id, decision_no, decision, derived`,
      [
        d.tenantId,
        d.programmeId,
        d.decisionNo,
        d.decision,
        d.requestedBy,
        d.issuedBy,
        d.evidenceRef,
        d.rationaleCode,
        d.correlationId,
      ],
    );
    return firstRow(rows, 'insertDecision');
  }

  async getLatestDecision(
    tx: Tx,
    programmeId: string,
  ): Promise<(DecisionRow & { decision_no: number }) | null> {
    const { rows } = await tx.query<DecisionRow>(
      `SELECT tenant_id, id, programme_id, decision_no, decision, derived FROM certification_decision WHERE programme_id=$1 ORDER BY decision_no DESC LIMIT 1`,
      [programmeId],
    );
    return rows[0] ?? null;
  }

  // ---- condition (append-only) ----
  async insertCondition(
    tx: Tx,
    c: {
      tenantId: string;
      decisionId: string;
      conditionKey: string;
      description: string;
      ownerRef: string | null;
      dueAt: Date | null;
      evidenceRef: string | null;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<{ id: string }> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO certification_condition (tenant_id, decision_id, condition_key, description, owner_ref, due_at, evidence_ref, reason_code, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        c.tenantId,
        c.decisionId,
        c.conditionKey,
        c.description,
        c.ownerRef,
        c.dueAt,
        c.evidenceRef,
        c.reasonCode,
        c.correlationId,
      ],
    );
    return firstRow(rows, 'insertCondition');
  }

  // ---- evidence (append-only) ----
  async insertEvidence(
    tx: Tx,
    e: {
      tenantId: string;
      programmeId: string;
      subjectKind: string;
      subjectId: string | null;
      evidenceKind: string;
      evidenceRef: string;
      shaRef: string | null;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<{ id: string }> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO certification_evidence (tenant_id, programme_id, subject_kind, subject_id, evidence_kind, evidence_ref, sha_ref, reason_code, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        e.tenantId,
        e.programmeId,
        e.subjectKind,
        e.subjectId,
        e.evidenceKind,
        e.evidenceRef,
        e.shaRef,
        e.reasonCode,
        e.correlationId,
      ],
    );
    return firstRow(rows, 'insertEvidence');
  }

  // ---- review (append-only, SoD) ----
  async insertReview(
    tx: Tx,
    r: {
      tenantId: string;
      targetKind: string;
      targetId: string;
      decision: string;
      requestedBy: string;
      decidedBy: string;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<{ id: string }> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO certification_review (tenant_id, target_kind, target_id, decision, requested_by, decided_by, reason_code, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        r.tenantId,
        r.targetKind,
        r.targetId,
        r.decision,
        r.requestedBy,
        r.decidedBy,
        r.reasonCode,
        r.correlationId,
      ],
    );
    return firstRow(rows, 'insertReview');
  }

  // ---- history (append-only) ----
  async insertHistory(
    tx: Tx,
    h: {
      tenantId: string;
      subjectKind: string;
      subjectId: string;
      fromState: string | null;
      toState: string;
      actor: string | null;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO certification_history (tenant_id, subject_kind, subject_id, from_state, to_state, actor, reason_code, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        h.tenantId,
        h.subjectKind,
        h.subjectId,
        h.fromState,
        h.toState,
        h.actor,
        h.reasonCode,
        h.correlationId,
      ],
    );
  }

  // ---- closure (append-only + immutable) ----
  async insertClosure(
    tx: Tx,
    c: {
      tenantId: string;
      programmeId: string;
      decisionId: string;
      stageKey: string;
      decision: string;
      assessedModules: string;
      findingsSummary: string | null;
      signoffsSummary: string | null;
      conditionsSummary: string | null;
      implCertRefs: string | null;
      artifactRef: string | null;
      issuedBy: string;
      correlationId: string;
    },
  ): Promise<ClosureRow> {
    const { rows } = await tx.query<ClosureRow>(
      `INSERT INTO certification_closure (tenant_id, programme_id, decision_id, stage_key, decision, assessed_modules, findings_summary, signoffs_summary, conditions_summary, impl_cert_refs, artifact_ref, issued_by, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING tenant_id, id, programme_id, decision`,
      [
        c.tenantId,
        c.programmeId,
        c.decisionId,
        c.stageKey,
        c.decision,
        c.assessedModules,
        c.findingsSummary,
        c.signoffsSummary,
        c.conditionsSummary,
        c.implCertRefs,
        c.artifactRef,
        c.issuedBy,
        c.correlationId,
      ],
    );
    return firstRow(rows, 'insertClosure');
  }
  async getClosure(tx: Tx, programmeId: string): Promise<ClosureRow | null> {
    const { rows } = await tx.query<ClosureRow>(
      `SELECT tenant_id, id, programme_id, decision FROM certification_closure WHERE programme_id=$1`,
      [programmeId],
    );
    return rows[0] ?? null;
  }

  // ---- idempotency (append-only) ----
  async claimIdempotency(
    tx: Tx,
    tenantId: string,
    purpose: string,
    key: string,
    correlationId: string,
  ): Promise<boolean> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO certification_idempotency (tenant_id, purpose, idempotency_key, correlation_id)
       VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, purpose, idempotency_key) DO NOTHING RETURNING id`,
      [tenantId, purpose, key, correlationId],
    );
    return rows.length > 0;
  }
}
