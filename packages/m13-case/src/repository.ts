/**
 * M13 repository — ALL SQL for case management. Every query is parameterized; every mutating UPDATE is
 * optimistic-lock guarded (`WHERE ... AND version = $expected`) or a compare-and-set claim, so a stale/losing
 * command changes zero rows and the caller reacts. Queries carry NO tenant_id predicate: RLS is the isolation
 * guarantee. All methods take the caller's `Tx` so state, evidence, audit and outbox commit atomically. Status
 * history, assignment history, findings, notes and handoff-intake are append-only (INSERT + SELECT by grant).
 */
import type { Tx } from '@finapp/kernel';

export interface SpecRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly code: string;
  readonly version_number: number;
  readonly name: string;
  readonly scope: string;
  readonly status: string;
  readonly spec: unknown;
  readonly content_hash: string | null;
  readonly version: number;
}

export interface CaseRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly case_number: string;
  readonly case_type_code: string;
  readonly case_type_version: number | null;
  readonly title: string;
  readonly summary: string | null;
  readonly description: string | null;
  readonly source: string;
  readonly originating_module: string | null;
  readonly originating_entity_type: string | null;
  readonly originating_entity_id: string | null;
  readonly originating_feedback_id: string | null;
  readonly customer_ref: string | null;
  readonly subject_ref: string | null;
  readonly product_ref: string | null;
  readonly transaction_ref: string | null;
  readonly classification: string | null;
  readonly confidentiality: string;
  readonly severity: string | null;
  readonly priority: string;
  readonly risk_rating: string | null;
  readonly current_owner: string | null;
  readonly responsible_team: string | null;
  readonly branch: string | null;
  readonly department: string | null;
  readonly workflow_instance_ref: string | null;
  readonly sla_policy_code: string | null;
  readonly escalation_ref: string | null;
  readonly status: string;
  readonly current_stage: string | null;
  readonly legal_status: string | null;
  readonly court_reference: string | null;
  readonly recovery_state: string;
  readonly recovery_claimed_minor: string | null;
  readonly recovery_recovered_minor: string | null;
  readonly recovery_currency: string | null;
  readonly legal_hold: boolean;
  readonly subject_informed: boolean;
  readonly triage_status: string | null;
  readonly resolution_summary: string | null;
  readonly closure_summary: string | null;
  readonly residual_risk: string | null;
  readonly opened_at: string | null;
  readonly resolved_at: string | null;
  readonly closed_at: string | null;
  readonly correlation_id: string;
  readonly idempotency_key: string | null;
  readonly version: number;
}

export interface PartyRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly case_id: string;
  readonly party_type: string;
  readonly role: string | null;
  readonly entity_ref: string | null;
  readonly display_label: string | null;
  readonly contact_ref: string | null;
  readonly confidentiality: string;
  readonly active: boolean;
  readonly version: number;
}

export interface ActivityRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly case_id: string;
  readonly activity_type: string;
  readonly headline: string;
  readonly status: string;
  readonly direction: string | null;
  readonly confidentiality: string;
  readonly outcome: string | null;
  readonly version: number;
}

export interface TaskRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly case_id: string;
  readonly task_type: string;
  readonly headline: string;
  readonly status: string;
  readonly priority: string;
  readonly mandatory: boolean;
  readonly outcome: string | null;
  readonly version: number;
}

export interface IssueRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly case_id: string;
  readonly issue_code: string | null;
  readonly category: string | null;
  readonly description: string;
  readonly severity: string | null;
  readonly mandatory: boolean;
  readonly finding: string | null;
  readonly outcome: string | null;
  readonly resolved: boolean;
  readonly version: number;
}

export interface InvestigationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly case_id: string;
  readonly scope: string | null;
  readonly investigator: string | null;
  readonly substantiation: string | null;
  readonly root_cause: string | null;
  readonly status: string;
  readonly version: number;
}

export interface FindingRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly case_id: string;
  readonly issue_id: string | null;
  readonly finding_type: string;
  readonly summary: string | null;
  readonly review_status: string | null;
  readonly confidentiality: string;
}

export interface DocumentRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly case_id: string;
  readonly document_ref: string;
  readonly document_role: string | null;
  readonly evidence_category: string | null;
  readonly confidentiality: string;
  readonly privileged: boolean;
  readonly exhibit_reference: string | null;
  readonly version: number;
}

export interface EvidenceRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly case_id: string;
  readonly document_ref: string | null;
  readonly evidence_type: string;
  readonly description: string | null;
  readonly verification_status: string;
  readonly custody_status: string | null;
  readonly confidentiality: string;
  readonly privileged: boolean;
}

export interface DeadlineRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly case_id: string;
  readonly deadline_type: string;
  readonly due_at: string;
  readonly status: string;
  readonly waived: boolean;
  readonly version: number;
}

export interface HearingRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly case_id: string;
  readonly hearing_type: string;
  readonly title: string | null;
  readonly scheduled_at: string | null;
  readonly status: string;
  readonly outcome: string | null;
  readonly next_at: string | null;
  readonly version: number;
}

export interface DecisionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly case_id: string;
  readonly decision_type: string;
  readonly summary: string | null;
  readonly remedy_type: string | null;
  readonly approval_status: string;
  readonly submitted_by: string | null;
  readonly approved_by: string | null;
  readonly confidentiality: string;
  readonly version: number;
}

export interface SettlementRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly case_id: string;
  readonly settlement_type: string | null;
  readonly amount_minor: string | null;
  readonly currency: string | null;
  readonly approval_status: string;
  readonly proposed_by: string | null;
  readonly approved_by: string | null;
  readonly confidentiality: string;
  readonly performance_status: string | null;
  readonly version: number;
}

export interface NoteRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly case_id: string;
  readonly note_type: string;
  readonly headline: string | null;
  readonly content: string;
  readonly confidentiality: string;
  readonly privileged: boolean;
}

export interface RelationshipRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly from_case_id: string;
  readonly to_case_id: string;
  readonly kind: string;
  readonly status: string;
  readonly version: number;
}

export interface HandoffIntakeRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly handoff_id: string;
  readonly feedback_id: string | null;
  readonly case_id: string;
}

const SPEC_COLS = 'tenant_id, id, code, version_number, name, scope, status, spec, content_hash, version';
const CASE_COLS =
  'tenant_id, id, case_number, case_type_code, case_type_version, title, summary, description, source, ' +
  'originating_module, originating_entity_type, originating_entity_id, originating_feedback_id, customer_ref, ' +
  'subject_ref, product_ref, transaction_ref, classification, confidentiality, severity, priority, risk_rating, ' +
  'current_owner, responsible_team, branch, department, workflow_instance_ref, sla_policy_code, escalation_ref, ' +
  'status, current_stage, legal_status, court_reference, recovery_state, recovery_claimed_minor, ' +
  'recovery_recovered_minor, recovery_currency, legal_hold, subject_informed, triage_status, resolution_summary, ' +
  'closure_summary, residual_risk, opened_at, resolved_at, closed_at, correlation_id, idempotency_key, version';
const PARTY_COLS =
  'tenant_id, id, case_id, party_type, role, entity_ref, display_label, contact_ref, confidentiality, active, version';
const ACT_COLS =
  'tenant_id, id, case_id, activity_type, headline, status, direction, confidentiality, outcome, version';
const TASK_COLS =
  'tenant_id, id, case_id, task_type, headline, status, priority, mandatory, outcome, version';
const ISSUE_COLS =
  'tenant_id, id, case_id, issue_code, category, description, severity, mandatory, finding, outcome, resolved, version';
const INV_COLS = 'tenant_id, id, case_id, scope, investigator, substantiation, root_cause, status, version';
const FIND_COLS = 'tenant_id, id, case_id, issue_id, finding_type, summary, review_status, confidentiality';
const DOC_COLS =
  'tenant_id, id, case_id, document_ref, document_role, evidence_category, confidentiality, privileged, exhibit_reference, version';
const EV_COLS =
  'tenant_id, id, case_id, document_ref, evidence_type, description, verification_status, custody_status, confidentiality, privileged';
const DL_COLS = 'tenant_id, id, case_id, deadline_type, due_at, status, waived, version';
const HEAR_COLS =
  'tenant_id, id, case_id, hearing_type, title, scheduled_at, status, outcome, next_at, version';
const DEC_COLS =
  'tenant_id, id, case_id, decision_type, summary, remedy_type, approval_status, submitted_by, approved_by, confidentiality, version';
const SET_COLS =
  'tenant_id, id, case_id, settlement_type, amount_minor, currency, approval_status, proposed_by, approved_by, confidentiality, performance_status, version';
const NOTE_COLS = 'tenant_id, id, case_id, note_type, headline, content, confidentiality, privileged';
const REL_COLS = 'tenant_id, id, from_case_id, to_case_id, kind, status, version';
const INTAKE_COLS = 'tenant_id, id, handoff_id, feedback_id, case_id';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m13 repository: expected a row from ${what}`);
  return row;
}

export class CaseRepository {
  // --- specs (case_type + case_sla_policy share shape) ------------------------------------------
  private async insertSpec(
    tx: Tx,
    table: string,
    i: {
      tenantId: string;
      code: string;
      versionNumber: number;
      name: string;
      scope: string;
      spec: unknown;
      createdBy: string | null;
    },
  ): Promise<SpecRow> {
    const r = await tx.query<SpecRow>(
      `INSERT INTO ${table} (tenant_id, code, version_number, name, scope, spec, created_by) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING ${SPEC_COLS}`,
      [i.tenantId, i.code, i.versionNumber, i.name, i.scope, JSON.stringify(i.spec), i.createdBy],
    );
    return firstRow(r.rows, `insert ${table}`);
  }
  private async nextSpecVersion(tx: Tx, table: string, code: string, scope: string): Promise<number> {
    const r = await tx.query<{ next: number }>(
      `SELECT COALESCE(MAX(version_number),0)+1 AS next FROM ${table} WHERE code=$1 AND scope=$2`,
      [code, scope],
    );
    return firstRow(r.rows, 'next version').next;
  }
  private async findSpec(tx: Tx, table: string, id: string): Promise<SpecRow | null> {
    const r = await tx.query<SpecRow>(`SELECT ${SPEC_COLS} FROM ${table} WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  private async findActiveSpec(tx: Tx, table: string, code: string): Promise<SpecRow | null> {
    const r = await tx.query<SpecRow>(
      `SELECT ${SPEC_COLS} FROM ${table} WHERE code=$1 AND status='ACTIVE' ORDER BY version_number DESC LIMIT 1`,
      [code],
    );
    return r.rows[0] ?? null;
  }
  private async updateSpecStatus(
    tx: Tx,
    table: string,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      contentHash: string | null;
      publishedBy: string | null;
    },
  ): Promise<SpecRow | null> {
    const r = await tx.query<SpecRow>(
      `UPDATE ${table} SET status=$3, content_hash=COALESCE($4,content_hash), published_at=CASE WHEN $3='PUBLISHED' THEN now() ELSE published_at END, published_by=COALESCE($5,published_by), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${SPEC_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.contentHash, i.publishedBy],
    );
    return r.rows[0] ?? null;
  }
  private async retireActiveSpec(
    tx: Tx,
    table: string,
    code: string,
    scope: string,
    exceptId: string,
  ): Promise<void> {
    await tx.query(
      `UPDATE ${table} SET status='RETIRED', version=version+1 WHERE code=$1 AND scope=$2 AND status='ACTIVE' AND id<>$3`,
      [code, scope, exceptId],
    );
  }
  insertCaseType(
    tx: Tx,
    i: {
      tenantId: string;
      code: string;
      versionNumber: number;
      name: string;
      scope: string;
      spec: unknown;
      createdBy: string | null;
    },
  ) {
    return this.insertSpec(tx, 'case_type', i);
  }
  nextCaseTypeVersion(tx: Tx, code: string, scope: string) {
    return this.nextSpecVersion(tx, 'case_type', code, scope);
  }
  findCaseType(tx: Tx, id: string) {
    return this.findSpec(tx, 'case_type', id);
  }
  findActiveCaseType(tx: Tx, code: string) {
    return this.findActiveSpec(tx, 'case_type', code);
  }
  updateCaseTypeStatus(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      contentHash: string | null;
      publishedBy: string | null;
    },
  ) {
    return this.updateSpecStatus(tx, 'case_type', i);
  }
  retireActiveCaseTypes(tx: Tx, code: string, scope: string, exceptId: string) {
    return this.retireActiveSpec(tx, 'case_type', code, scope, exceptId);
  }
  insertSlaPolicy(
    tx: Tx,
    i: {
      tenantId: string;
      code: string;
      versionNumber: number;
      name: string;
      scope: string;
      spec: unknown;
      createdBy: string | null;
    },
  ) {
    return this.insertSpec(tx, 'case_sla_policy', i);
  }
  nextSlaPolicyVersion(tx: Tx, code: string, scope: string) {
    return this.nextSpecVersion(tx, 'case_sla_policy', code, scope);
  }
  findSlaPolicy(tx: Tx, id: string) {
    return this.findSpec(tx, 'case_sla_policy', id);
  }
  findActiveSlaPolicy(tx: Tx, code: string) {
    return this.findActiveSpec(tx, 'case_sla_policy', code);
  }
  updateSlaPolicyStatus(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      contentHash: string | null;
      publishedBy: string | null;
    },
  ) {
    return this.updateSpecStatus(tx, 'case_sla_policy', i);
  }
  retireActiveSlaPolicies(tx: Tx, code: string, scope: string, exceptId: string) {
    return this.retireActiveSpec(tx, 'case_sla_policy', code, scope, exceptId);
  }

  // --- case record ------------------------------------------------------------------------------
  async insertCase(
    tx: Tx,
    i: {
      tenantId: string;
      caseNumber: string;
      caseTypeCode: string;
      caseTypeVersion: number | null;
      title: string;
      summary: string | null;
      description: string | null;
      source: string;
      originatingModule: string | null;
      originatingEntityType: string | null;
      originatingEntityId: string | null;
      originatingFeedbackId: string | null;
      customerRef: string | null;
      subjectRef: string | null;
      productRef: string | null;
      branch: string | null;
      department: string | null;
      confidentiality: string;
      severity: string | null;
      priority: string;
      slaPolicyCode: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      causationId: string | null;
      by: string | null;
    },
  ): Promise<CaseRow> {
    const r = await tx.query<CaseRow>(
      `INSERT INTO case_record (tenant_id, case_number, case_type_code, case_type_version, title, summary, description, source, originating_module, originating_entity_type, originating_entity_id, originating_feedback_id, customer_ref, subject_ref, product_ref, branch, department, confidentiality, severity, priority, sla_policy_code, idempotency_key, correlation_id, causation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$25) RETURNING ${CASE_COLS}`,
      [
        i.tenantId,
        i.caseNumber,
        i.caseTypeCode,
        i.caseTypeVersion,
        i.title,
        i.summary,
        i.description,
        i.source,
        i.originatingModule,
        i.originatingEntityType,
        i.originatingEntityId,
        i.originatingFeedbackId,
        i.customerRef,
        i.subjectRef,
        i.productRef,
        i.branch,
        i.department,
        i.confidentiality,
        i.severity,
        i.priority,
        i.slaPolicyCode,
        i.idempotencyKey,
        i.correlationId,
        i.causationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert case');
  }
  async findCase(tx: Tx, id: string): Promise<CaseRow | null> {
    const r = await tx.query<CaseRow>(`SELECT ${CASE_COLS} FROM case_record WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findCaseByIdempotencyKey(tx: Tx, key: string): Promise<CaseRow | null> {
    const r = await tx.query<CaseRow>(`SELECT ${CASE_COLS} FROM case_record WHERE idempotency_key=$1`, [key]);
    return r.rows[0] ?? null;
  }
  async updateCaseStatus(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      by: string | null;
      stamp?: 'opened' | 'resolved' | 'closed' | null;
    },
  ): Promise<CaseRow | null> {
    const stampCol =
      i.stamp === 'opened'
        ? ', opened_at=COALESCE(opened_at, now())'
        : i.stamp === 'resolved'
          ? ', resolved_at=now()'
          : i.stamp === 'closed'
            ? ', closed_at=now()'
            : '';
    const r = await tx.query<CaseRow>(
      `UPDATE case_record SET status=$3, updated_by=$4, updated_at=now(), version=version+1${stampCol} WHERE id=$1 AND version=$2 RETURNING ${CASE_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async patchCase(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      severity?: string | null;
      priority?: string | null;
      riskRating?: string | null;
      confidentiality?: string | null;
      triageStatus?: string | null;
      currentStage?: string | null;
      slaPolicyCode?: string | null;
      escalationRef?: string | null;
      currentOwner?: string | null;
      responsibleTeam?: string | null;
      workflowInstanceRef?: string | null;
      legalStatus?: string | null;
      courtReference?: string | null;
      recoveryState?: string | null;
      recoveryClaimedMinor?: number | null;
      recoveryRecoveredMinor?: number | null;
      recoveryCurrency?: string | null;
      legalHold?: boolean | null;
      subjectInformed?: boolean | null;
      resolutionSummary?: string | null;
      closureSummary?: string | null;
      residualRisk?: string | null;
      by: string | null;
    },
  ): Promise<CaseRow | null> {
    const r = await tx.query<CaseRow>(
      `UPDATE case_record SET
         severity=COALESCE($3,severity), priority=COALESCE($4,priority), risk_rating=COALESCE($5,risk_rating),
         confidentiality=COALESCE($6,confidentiality), triage_status=COALESCE($7,triage_status),
         current_stage=COALESCE($8,current_stage), sla_policy_code=COALESCE($9,sla_policy_code),
         escalation_ref=COALESCE($10,escalation_ref), current_owner=COALESCE($11,current_owner),
         responsible_team=COALESCE($12,responsible_team), workflow_instance_ref=COALESCE($13,workflow_instance_ref),
         legal_status=COALESCE($14,legal_status), court_reference=COALESCE($15,court_reference),
         recovery_state=COALESCE($16,recovery_state), recovery_claimed_minor=COALESCE($17,recovery_claimed_minor),
         recovery_recovered_minor=COALESCE($18,recovery_recovered_minor), recovery_currency=COALESCE($19,recovery_currency),
         legal_hold=COALESCE($20,legal_hold), subject_informed=COALESCE($21,subject_informed),
         resolution_summary=COALESCE($22,resolution_summary), closure_summary=COALESCE($23,closure_summary),
         residual_risk=COALESCE($24,residual_risk), updated_by=$25, updated_at=now(), version=version+1
       WHERE id=$1 AND version=$2 RETURNING ${CASE_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.severity ?? null,
        i.priority ?? null,
        i.riskRating ?? null,
        i.confidentiality ?? null,
        i.triageStatus ?? null,
        i.currentStage ?? null,
        i.slaPolicyCode ?? null,
        i.escalationRef ?? null,
        i.currentOwner ?? null,
        i.responsibleTeam ?? null,
        i.workflowInstanceRef ?? null,
        i.legalStatus ?? null,
        i.courtReference ?? null,
        i.recoveryState ?? null,
        i.recoveryClaimedMinor ?? null,
        i.recoveryRecoveredMinor ?? null,
        i.recoveryCurrency ?? null,
        i.legalHold ?? null,
        i.subjectInformed ?? null,
        i.resolutionSummary ?? null,
        i.closureSummary ?? null,
        i.residualRisk ?? null,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async assignCase(
    tx: Tx,
    i: { id: string; expectedVersion: number; owner: string; toStatus: string; by: string | null },
  ): Promise<CaseRow | null> {
    const r = await tx.query<CaseRow>(
      `UPDATE case_record SET current_owner=$3, status=$4, assigned_at=COALESCE(assigned_at, now()), updated_by=$5, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${CASE_COLS}`,
      [i.id, i.expectedVersion, i.owner, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async searchCases(
    tx: Tx,
    f: {
      caseTypeCode?: string;
      status?: string;
      severity?: string;
      priority?: string;
      branch?: string;
      department?: string;
      owner?: string;
      limit: number;
      offset: number;
    },
  ): Promise<CaseRow[]> {
    const r = await tx.query<CaseRow>(
      `SELECT ${CASE_COLS} FROM case_record WHERE ($1::text IS NULL OR case_type_code=$1) AND ($2::text IS NULL OR status=$2) AND ($3::text IS NULL OR severity=$3) AND ($4::text IS NULL OR priority=$4) AND ($5::text IS NULL OR branch=$5) AND ($6::text IS NULL OR department=$6) AND ($7::uuid IS NULL OR current_owner=$7) ORDER BY created_at DESC LIMIT $8 OFFSET $9`,
      [
        f.caseTypeCode ?? null,
        f.status ?? null,
        f.severity ?? null,
        f.priority ?? null,
        f.branch ?? null,
        f.department ?? null,
        f.owner ?? null,
        f.limit,
        f.offset,
      ],
    );
    return r.rows;
  }
  async analyticsByDimension(tx: Tx, dimension: string): Promise<{ dim: string | null; count: string }[]> {
    const col =
      {
        case_type: 'case_type_code',
        source: 'source',
        branch: 'branch',
        department: 'department',
        severity: 'severity',
        priority: 'priority',
        status: 'status',
        confidentiality: 'confidentiality',
        legal_status: 'legal_status',
        recovery_state: 'recovery_state',
        risk: 'risk_rating',
      }[dimension] ?? 'status';
    const r = await tx.query<{ dim: string | null; count: string }>(
      `SELECT ${col} AS dim, count(*)::text AS count FROM case_record GROUP BY ${col} ORDER BY count DESC`,
    );
    return r.rows;
  }

  // --- handoff intake (idempotent) --------------------------------------------------------------
  async insertHandoffIntake(
    tx: Tx,
    i: {
      tenantId: string;
      handoffId: string;
      feedbackId: string | null;
      caseId: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<HandoffIntakeRow> {
    const r = await tx.query<HandoffIntakeRow>(
      `INSERT INTO case_handoff_intake (tenant_id, handoff_id, feedback_id, case_id, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${INTAKE_COLS}`,
      [i.tenantId, i.handoffId, i.feedbackId, i.caseId, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert handoff intake');
  }
  async findHandoffIntake(tx: Tx, handoffId: string): Promise<HandoffIntakeRow | null> {
    const r = await tx.query<HandoffIntakeRow>(
      `SELECT ${INTAKE_COLS} FROM case_handoff_intake WHERE handoff_id=$1`,
      [handoffId],
    );
    return r.rows[0] ?? null;
  }

  // --- histories (append-only) ------------------------------------------------------------------
  async insertStatusHistory(
    tx: Tx,
    i: {
      tenantId: string;
      caseId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO case_status_history (tenant_id, case_id, from_status, to_status, reason, reason_code, changed_by, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.caseId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }
  async insertAssignmentHistory(
    tx: Tx,
    i: {
      tenantId: string;
      caseId: string;
      kind: string;
      ref: string;
      by: string | null;
      reason: string | null;
      delegation: boolean;
      ruleEvalId: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO case_assignment_history (tenant_id, case_id, assigned_to_kind, assigned_to_ref, assigned_by, reason, delegation, rule_eval_id, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [i.tenantId, i.caseId, i.kind, i.ref, i.by, i.reason, i.delegation, i.ruleEvalId, i.correlationId],
    );
  }

  // --- parties ----------------------------------------------------------------------------------
  async insertParty(
    tx: Tx,
    i: {
      tenantId: string;
      caseId: string;
      partyType: string;
      role: string | null;
      entityRef: string | null;
      displayLabel: string | null;
      contactRef: string | null;
      representation: string | null;
      confidentiality: string;
      relationship: string | null;
      consentAuthority: string | null;
      by: string | null;
    },
  ): Promise<PartyRow> {
    const r = await tx.query<PartyRow>(
      `INSERT INTO case_party (tenant_id, case_id, party_type, role, entity_ref, display_label, contact_ref, representation, confidentiality, relationship, consent_authority, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING ${PARTY_COLS}`,
      [
        i.tenantId,
        i.caseId,
        i.partyType,
        i.role,
        i.entityRef,
        i.displayLabel,
        i.contactRef,
        i.representation,
        i.confidentiality,
        i.relationship,
        i.consentAuthority,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert party');
  }
  async findParty(tx: Tx, id: string): Promise<PartyRow | null> {
    const r = await tx.query<PartyRow>(`SELECT ${PARTY_COLS} FROM case_party WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async deactivateParty(
    tx: Tx,
    i: { id: string; expectedVersion: number; by: string | null },
  ): Promise<PartyRow | null> {
    const r = await tx.query<PartyRow>(
      `UPDATE case_party SET active=false, active_to=now(), updated_by=$3, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND active=true RETURNING ${PARTY_COLS}`,
      [i.id, i.expectedVersion, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listParties(tx: Tx, caseId: string): Promise<PartyRow[]> {
    const r = await tx.query<PartyRow>(
      `SELECT ${PARTY_COLS} FROM case_party WHERE case_id=$1 ORDER BY created_at`,
      [caseId],
    );
    return r.rows;
  }

  // --- activities -------------------------------------------------------------------------------
  async insertActivity(
    tx: Tx,
    i: {
      tenantId: string;
      caseId: string;
      activityType: string;
      headline: string;
      description: string | null;
      occurredAt: string | null;
      dueAt: string | null;
      assignedTo: string | null;
      direction: string | null;
      partyRef: string | null;
      source: string | null;
      confidentiality: string;
      documentRefs: unknown;
      responseRequired: boolean;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ActivityRow> {
    const r = await tx.query<ActivityRow>(
      `INSERT INTO case_activity (tenant_id, case_id, activity_type, headline, description, occurred_at, due_at, assigned_to, direction, party_ref, source, confidentiality, document_refs, response_required, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16) RETURNING ${ACT_COLS}`,
      [
        i.tenantId,
        i.caseId,
        i.activityType,
        i.headline,
        i.description,
        i.occurredAt,
        i.dueAt,
        i.assignedTo,
        i.direction,
        i.partyRef,
        i.source,
        i.confidentiality,
        i.documentRefs === null ? null : JSON.stringify(i.documentRefs),
        i.responseRequired,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert activity');
  }
  async completeActivity(
    tx: Tx,
    i: { id: string; expectedVersion: number; outcome: string | null; by: string | null },
  ): Promise<ActivityRow | null> {
    const r = await tx.query<ActivityRow>(
      `UPDATE case_activity SET status='completed', completed_at=now(), completed_by=$4, outcome=$3, version=version+1 WHERE id=$1 AND version=$2 AND status<>'completed' RETURNING ${ACT_COLS}`,
      [i.id, i.expectedVersion, i.outcome, i.by],
    );
    return r.rows[0] ?? null;
  }
  async findActivity(tx: Tx, id: string): Promise<ActivityRow | null> {
    const r = await tx.query<ActivityRow>(`SELECT ${ACT_COLS} FROM case_activity WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async listActivities(tx: Tx, caseId: string): Promise<ActivityRow[]> {
    const r = await tx.query<ActivityRow>(
      `SELECT ${ACT_COLS} FROM case_activity WHERE case_id=$1 ORDER BY created_at`,
      [caseId],
    );
    return r.rows;
  }

  // --- tasks ------------------------------------------------------------------------------------
  async insertTask(
    tx: Tx,
    i: {
      tenantId: string;
      caseId: string;
      taskType: string;
      headline: string;
      description: string | null;
      owner: string | null;
      team: string | null;
      dueAt: string | null;
      priority: string;
      mandatory: boolean;
      completionCriteria: string | null;
      dependsOn: string | null;
      workflowTaskRef: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<TaskRow> {
    const r = await tx.query<TaskRow>(
      `INSERT INTO case_task (tenant_id, case_id, task_type, headline, description, owner, team, due_at, priority, mandatory, completion_criteria, depends_on, workflow_task_ref, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${TASK_COLS}`,
      [
        i.tenantId,
        i.caseId,
        i.taskType,
        i.headline,
        i.description,
        i.owner,
        i.team,
        i.dueAt,
        i.priority,
        i.mandatory,
        i.completionCriteria,
        i.dependsOn,
        i.workflowTaskRef,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert task');
  }
  async completeTask(
    tx: Tx,
    i: { id: string; expectedVersion: number; outcome: string | null; by: string | null },
  ): Promise<TaskRow | null> {
    const r = await tx.query<TaskRow>(
      `UPDATE case_task SET status='completed', completed_at=now(), completed_by=$4, outcome=$3, version=version+1 WHERE id=$1 AND version=$2 AND status<>'completed' AND status<>'cancelled' RETURNING ${TASK_COLS}`,
      [i.id, i.expectedVersion, i.outcome, i.by],
    );
    return r.rows[0] ?? null;
  }
  async findTask(tx: Tx, id: string): Promise<TaskRow | null> {
    const r = await tx.query<TaskRow>(`SELECT ${TASK_COLS} FROM case_task WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async listTasks(tx: Tx, caseId: string): Promise<TaskRow[]> {
    const r = await tx.query<TaskRow>(
      `SELECT ${TASK_COLS} FROM case_task WHERE case_id=$1 ORDER BY created_at`,
      [caseId],
    );
    return r.rows;
  }
  async countOpenMandatoryTasks(tx: Tx, caseId: string): Promise<number> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM case_task WHERE case_id=$1 AND mandatory=true AND status NOT IN ('completed','cancelled')`,
      [caseId],
    );
    return Number(r.rows[0]?.c ?? '0');
  }

  // --- issues -----------------------------------------------------------------------------------
  async insertIssue(
    tx: Tx,
    i: {
      tenantId: string;
      caseId: string;
      issueCode: string | null;
      category: string | null;
      description: string;
      severity: string | null;
      affectedParty: string | null;
      respondent: string | null;
      ruleReference: string | null;
      mandatory: boolean;
      correlationId: string;
      by: string | null;
    },
  ): Promise<IssueRow> {
    const r = await tx.query<IssueRow>(
      `INSERT INTO case_issue (tenant_id, case_id, issue_code, category, description, severity, affected_party, respondent, rule_reference, mandatory, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING ${ISSUE_COLS}`,
      [
        i.tenantId,
        i.caseId,
        i.issueCode,
        i.category,
        i.description,
        i.severity,
        i.affectedParty,
        i.respondent,
        i.ruleReference,
        i.mandatory,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert issue');
  }
  async patchIssue(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      finding: string | null;
      outcome: string | null;
      remediation: string | null;
      resolved: boolean | null;
      by: string | null;
    },
  ): Promise<IssueRow | null> {
    const r = await tx.query<IssueRow>(
      `UPDATE case_issue SET finding=COALESCE($3,finding), outcome=COALESCE($4,outcome), remediation=COALESCE($5,remediation), resolved=COALESCE($6,resolved), updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${ISSUE_COLS}`,
      [i.id, i.expectedVersion, i.finding, i.outcome, i.remediation, i.resolved, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listIssues(tx: Tx, caseId: string): Promise<IssueRow[]> {
    const r = await tx.query<IssueRow>(
      `SELECT ${ISSUE_COLS} FROM case_issue WHERE case_id=$1 ORDER BY created_at`,
      [caseId],
    );
    return r.rows;
  }
  async countUnresolvedMandatoryIssues(tx: Tx, caseId: string): Promise<number> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM case_issue WHERE case_id=$1 AND mandatory=true AND resolved=false`,
      [caseId],
    );
    return Number(r.rows[0]?.c ?? '0');
  }

  // --- investigation ----------------------------------------------------------------------------
  async upsertInvestigation(
    tx: Tx,
    i: {
      tenantId: string;
      caseId: string;
      plan: string | null;
      allegation: string | null;
      scope: string | null;
      investigator: string | null;
      targetCompletionAt: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<InvestigationRow> {
    const r = await tx.query<InvestigationRow>(
      `INSERT INTO case_investigation (tenant_id, case_id, plan, allegation, scope, investigator, started_at, target_completion_at, status, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6, now(), $7, 'in_progress', $8,$9,$9) ON CONFLICT (tenant_id, case_id) DO UPDATE SET plan=EXCLUDED.plan, allegation=EXCLUDED.allegation, scope=EXCLUDED.scope, investigator=EXCLUDED.investigator, target_completion_at=EXCLUDED.target_completion_at, updated_by=EXCLUDED.updated_by, updated_at=now(), version=case_investigation.version+1 RETURNING ${INV_COLS}`,
      [
        i.tenantId,
        i.caseId,
        i.plan,
        i.allegation,
        i.scope,
        i.investigator,
        i.targetCompletionAt,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'upsert investigation');
  }
  async completeInvestigation(
    tx: Tx,
    i: {
      caseId: string;
      expectedVersion: number;
      substantiation: string | null;
      contributingFactors: string | null;
      rootCause: string | null;
      recommendedAction: string | null;
      managementReview: string | null;
      by: string | null;
    },
  ): Promise<InvestigationRow | null> {
    const r = await tx.query<InvestigationRow>(
      `UPDATE case_investigation SET substantiation=$3, contributing_factors=$4, root_cause=$5, recommended_action=$6, management_review=$7, status='completed', completed_at=now(), updated_by=$8, updated_at=now(), version=version+1 WHERE case_id=$1 AND version=$2 AND status<>'completed' RETURNING ${INV_COLS}`,
      [
        i.caseId,
        i.expectedVersion,
        i.substantiation,
        i.contributingFactors,
        i.rootCause,
        i.recommendedAction,
        i.managementReview,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async findInvestigation(tx: Tx, caseId: string): Promise<InvestigationRow | null> {
    const r = await tx.query<InvestigationRow>(
      `SELECT ${INV_COLS} FROM case_investigation WHERE case_id=$1`,
      [caseId],
    );
    return r.rows[0] ?? null;
  }

  // --- findings (append-only) -------------------------------------------------------------------
  async insertFinding(
    tx: Tx,
    i: {
      tenantId: string;
      caseId: string;
      issueId: string | null;
      findingType: string;
      summary: string | null;
      evidenceConsidered: string | null;
      substantiation: string | null;
      basisReference: string | null;
      investigator: string | null;
      reviewer: string | null;
      reviewStatus: string | null;
      confidentiality: string;
      recommendedAction: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<FindingRow> {
    const r = await tx.query<FindingRow>(
      `INSERT INTO case_finding (tenant_id, case_id, issue_id, finding_type, summary, evidence_considered, substantiation, basis_reference, investigator, reviewer, review_status, confidentiality, recommended_action, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${FIND_COLS}`,
      [
        i.tenantId,
        i.caseId,
        i.issueId,
        i.findingType,
        i.summary,
        i.evidenceConsidered,
        i.substantiation,
        i.basisReference,
        i.investigator,
        i.reviewer,
        i.reviewStatus,
        i.confidentiality,
        i.recommendedAction,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert finding');
  }
  async listFindings(tx: Tx, caseId: string): Promise<FindingRow[]> {
    const r = await tx.query<FindingRow>(
      `SELECT ${FIND_COLS} FROM case_finding WHERE case_id=$1 ORDER BY created_at`,
      [caseId],
    );
    return r.rows;
  }
  async hasFindings(tx: Tx, caseId: string): Promise<boolean> {
    const r = await tx.query<{ c: string }>(`SELECT count(*)::text AS c FROM case_finding WHERE case_id=$1`, [
      caseId,
    ]);
    return Number(r.rows[0]?.c ?? '0') > 0;
  }

  // --- documents --------------------------------------------------------------------------------
  async insertDocument(
    tx: Tx,
    i: {
      tenantId: string;
      caseId: string;
      documentRef: string;
      documentRole: string | null;
      evidenceCategory: string | null;
      filingDate: string | null;
      receivedDate: string | null;
      servedDate: string | null;
      confidentiality: string;
      privileged: boolean;
      source: string | null;
      relatedActivity: string | null;
      relatedHearing: string | null;
      exhibitReference: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<DocumentRow> {
    const r = await tx.query<DocumentRow>(
      `INSERT INTO case_document (tenant_id, case_id, document_ref, document_role, evidence_category, filing_date, received_date, served_date, confidentiality, privileged, source, related_activity, related_hearing, exhibit_reference, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING ${DOC_COLS}`,
      [
        i.tenantId,
        i.caseId,
        i.documentRef,
        i.documentRole,
        i.evidenceCategory,
        i.filingDate,
        i.receivedDate,
        i.servedDate,
        i.confidentiality,
        i.privileged,
        i.source,
        i.relatedActivity,
        i.relatedHearing,
        i.exhibitReference,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert document');
  }
  async listDocuments(tx: Tx, caseId: string): Promise<DocumentRow[]> {
    const r = await tx.query<DocumentRow>(
      `SELECT ${DOC_COLS} FROM case_document WHERE case_id=$1 ORDER BY created_at`,
      [caseId],
    );
    return r.rows;
  }

  // --- evidence ---------------------------------------------------------------------------------
  async insertEvidence(
    tx: Tx,
    i: {
      tenantId: string;
      caseId: string;
      documentRef: string | null;
      evidenceType: string;
      description: string | null;
      source: string | null;
      custodian: string | null;
      collectedBy: string | null;
      collectedAt: string | null;
      integrityHash: string | null;
      confidentiality: string;
      privileged: boolean;
      relatedIssue: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<EvidenceRow> {
    const r = await tx.query<EvidenceRow>(
      `INSERT INTO case_evidence (tenant_id, case_id, document_ref, evidence_type, description, source, custodian, collected_by, collected_at, integrity_hash, confidentiality, privileged, related_issue, custody_status, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'collected',$14,$15) RETURNING ${EV_COLS}`,
      [
        i.tenantId,
        i.caseId,
        i.documentRef,
        i.evidenceType,
        i.description,
        i.source,
        i.custodian,
        i.collectedBy,
        i.collectedAt,
        i.integrityHash,
        i.confidentiality,
        i.privileged,
        i.relatedIssue,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert evidence');
  }
  /** Compare-and-set verify: only an unverified item can be verified — single-winner. */
  async verifyEvidence(
    tx: Tx,
    i: { id: string; authenticityStatus: string; admissibilityStatus: string | null; by: string | null },
  ): Promise<EvidenceRow | null> {
    const r = await tx.query<EvidenceRow>(
      `UPDATE case_evidence SET verification_status='verified', authenticity_status=$2, admissibility_status=$3, custody_status='verified', verified_by=$4, verified_at=now() WHERE id=$1 AND verification_status='unverified' RETURNING ${EV_COLS}`,
      [i.id, i.authenticityStatus, i.admissibilityStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async findEvidence(tx: Tx, id: string): Promise<EvidenceRow | null> {
    const r = await tx.query<EvidenceRow>(`SELECT ${EV_COLS} FROM case_evidence WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async listEvidence(tx: Tx, caseId: string): Promise<EvidenceRow[]> {
    const r = await tx.query<EvidenceRow>(
      `SELECT ${EV_COLS} FROM case_evidence WHERE case_id=$1 ORDER BY created_at`,
      [caseId],
    );
    return r.rows;
  }

  // --- deadlines --------------------------------------------------------------------------------
  async insertDeadline(
    tx: Tx,
    i: {
      tenantId: string;
      caseId: string;
      deadlineType: string;
      startAt: string | null;
      dueAt: string;
      calculationRule: string | null;
      source: string | null;
      authority: string | null;
      linkedActivity: string | null;
      linkedTask: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<DeadlineRow> {
    const r = await tx.query<DeadlineRow>(
      `INSERT INTO case_deadline (tenant_id, case_id, deadline_type, start_at, due_at, calculation_rule, source, authority, linked_activity, linked_task, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${DL_COLS}`,
      [
        i.tenantId,
        i.caseId,
        i.deadlineType,
        i.startAt,
        i.dueAt,
        i.calculationRule,
        i.source,
        i.authority,
        i.linkedActivity,
        i.linkedTask,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert deadline');
  }
  async findDeadline(tx: Tx, id: string): Promise<DeadlineRow | null> {
    const r = await tx.query<DeadlineRow>(`SELECT ${DL_COLS} FROM case_deadline WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async extendDeadline(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      extensionTo: string;
      reason: string | null;
      authority: string | null;
    },
  ): Promise<DeadlineRow | null> {
    const r = await tx.query<DeadlineRow>(
      `UPDATE case_deadline SET extension_to=$3, extension_reason=$4, due_at=$3, status='extended', waiver_authority=$5, version=version+1 WHERE id=$1 AND version=$2 AND status IN ('open','extended') RETURNING ${DL_COLS}`,
      [i.id, i.expectedVersion, i.extensionTo, i.reason, i.authority],
    );
    return r.rows[0] ?? null;
  }
  async completeDeadline(tx: Tx, i: { id: string; expectedVersion: number }): Promise<DeadlineRow | null> {
    const r = await tx.query<DeadlineRow>(
      `UPDATE case_deadline SET status='completed', completed_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status IN ('open','extended') RETURNING ${DL_COLS}`,
      [i.id, i.expectedVersion],
    );
    return r.rows[0] ?? null;
  }
  /** Compare-and-set breach: only an open/extended deadline breaches — single-winner. */
  async markDeadlineBreach(tx: Tx, id: string): Promise<DeadlineRow | null> {
    const r = await tx.query<DeadlineRow>(
      `UPDATE case_deadline SET status='breached', breached_at=now(), version=version+1 WHERE id=$1 AND status IN ('open','extended') RETURNING ${DL_COLS}`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async listDeadlines(tx: Tx, caseId: string): Promise<DeadlineRow[]> {
    const r = await tx.query<DeadlineRow>(
      `SELECT ${DL_COLS} FROM case_deadline WHERE case_id=$1 ORDER BY due_at`,
      [caseId],
    );
    return r.rows;
  }
  async countOpenDeadlines(tx: Tx, caseId: string): Promise<number> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM case_deadline WHERE case_id=$1 AND status IN ('open','extended')`,
      [caseId],
    );
    return Number(r.rows[0]?.c ?? '0');
  }

  // --- hearings ---------------------------------------------------------------------------------
  async insertHearing(
    tx: Tx,
    i: {
      tenantId: string;
      caseId: string;
      hearingType: string;
      title: string | null;
      scheduledAt: string | null;
      venue: string | null;
      virtualLinkRef: string | null;
      court: string | null;
      presidingRef: string | null;
      attendanceRequirement: string | null;
      documentRefs: unknown;
      correlationId: string;
      by: string | null;
    },
  ): Promise<HearingRow> {
    const r = await tx.query<HearingRow>(
      `INSERT INTO case_hearing (tenant_id, case_id, hearing_type, title, scheduled_at, venue, virtual_link_ref, court, presiding_ref, attendance_requirement, document_refs, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$13) RETURNING ${HEAR_COLS}`,
      [
        i.tenantId,
        i.caseId,
        i.hearingType,
        i.title,
        i.scheduledAt,
        i.venue,
        i.virtualLinkRef,
        i.court,
        i.presidingRef,
        i.attendanceRequirement,
        i.documentRefs === null ? null : JSON.stringify(i.documentRefs),
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert hearing');
  }
  async updateHearing(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      scheduledAt: string | null;
      status: string | null;
      adjournmentReason: string | null;
      nextAt: string | null;
      by: string | null;
    },
  ): Promise<HearingRow | null> {
    const r = await tx.query<HearingRow>(
      `UPDATE case_hearing SET scheduled_at=COALESCE($3,scheduled_at), status=COALESCE($4,status), adjournment_reason=COALESCE($5,adjournment_reason), next_at=COALESCE($6,next_at), updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${HEAR_COLS}`,
      [i.id, i.expectedVersion, i.scheduledAt, i.status, i.adjournmentReason, i.nextAt, i.by],
    );
    return r.rows[0] ?? null;
  }
  async completeHearing(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      outcome: string | null;
      nextAction: string | null;
      nextAt: string | null;
      by: string | null;
    },
  ): Promise<HearingRow | null> {
    const r = await tx.query<HearingRow>(
      `UPDATE case_hearing SET status='completed', outcome=$3, next_action=$4, next_at=$5, completed_at=now(), updated_by=$6, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status<>'completed' RETURNING ${HEAR_COLS}`,
      [i.id, i.expectedVersion, i.outcome, i.nextAction, i.nextAt, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listHearings(tx: Tx, caseId: string): Promise<HearingRow[]> {
    const r = await tx.query<HearingRow>(
      `SELECT ${HEAR_COLS} FROM case_hearing WHERE case_id=$1 ORDER BY scheduled_at NULLS LAST`,
      [caseId],
    );
    return r.rows;
  }

  // --- decisions (append-only, maker-checker) ---------------------------------------------------
  async insertDecision(
    tx: Tx,
    i: {
      tenantId: string;
      caseId: string;
      decisionType: string;
      summary: string | null;
      reasons: string | null;
      conditions: string | null;
      remedyType: string | null;
      remedyDetail: string | null;
      financeReference: string | null;
      supportingDocuments: unknown;
      reviewAvailable: boolean;
      confidentiality: string;
      submittedBy: string | null;
      correlationId: string;
    },
  ): Promise<DecisionRow> {
    const r = await tx.query<DecisionRow>(
      `INSERT INTO case_decision (tenant_id, case_id, decision_type, summary, reasons, conditions, remedy_type, remedy_detail, finance_reference, supporting_documents, review_available, confidentiality, submitted_by, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14) RETURNING ${DEC_COLS}`,
      [
        i.tenantId,
        i.caseId,
        i.decisionType,
        i.summary,
        i.reasons,
        i.conditions,
        i.remedyType,
        i.remedyDetail,
        i.financeReference,
        i.supportingDocuments === null ? null : JSON.stringify(i.supportingDocuments),
        i.reviewAvailable,
        i.confidentiality,
        i.submittedBy,
        i.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert decision');
  }
  async findDecision(tx: Tx, id: string): Promise<DecisionRow | null> {
    const r = await tx.query<DecisionRow>(`SELECT ${DEC_COLS} FROM case_decision WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async approveDecision(
    tx: Tx,
    i: { id: string; expectedVersion: number; approval: string; approvedBy: string | null },
  ): Promise<DecisionRow | null> {
    const r = await tx.query<DecisionRow>(
      `UPDATE case_decision SET approval_status=$3, approved_by=$4, approved_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND approval_status='submitted' RETURNING ${DEC_COLS}`,
      [i.id, i.expectedVersion, i.approval, i.approvedBy],
    );
    return r.rows[0] ?? null;
  }
  async listDecisions(tx: Tx, caseId: string): Promise<DecisionRow[]> {
    const r = await tx.query<DecisionRow>(
      `SELECT ${DEC_COLS} FROM case_decision WHERE case_id=$1 ORDER BY submitted_at`,
      [caseId],
    );
    return r.rows;
  }
  async hasApprovedDecision(tx: Tx, caseId: string): Promise<boolean> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM case_decision WHERE case_id=$1 AND approval_status='approved'`,
      [caseId],
    );
    return Number(r.rows[0]?.c ?? '0') > 0;
  }

  // --- settlement -------------------------------------------------------------------------------
  async insertSettlement(
    tx: Tx,
    i: {
      tenantId: string;
      caseId: string;
      settlementType: string | null;
      proposedTerms: string | null;
      confidentialTerms: string | null;
      amountMinor: number | null;
      currency: string | null;
      nonMonetaryTerms: string | null;
      proposedBy: string | null;
      effectiveDate: string | null;
      documentRef: string | null;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<SettlementRow> {
    const r = await tx.query<SettlementRow>(
      `INSERT INTO case_settlement (tenant_id, case_id, settlement_type, proposed_terms, confidential_terms, amount_minor, currency, non_monetary_terms, proposed_by, effective_date, document_ref, confidentiality, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING ${SET_COLS}`,
      [
        i.tenantId,
        i.caseId,
        i.settlementType,
        i.proposedTerms,
        i.confidentialTerms,
        i.amountMinor,
        i.currency,
        i.nonMonetaryTerms,
        i.proposedBy,
        i.effectiveDate,
        i.documentRef,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert settlement');
  }
  async findSettlement(tx: Tx, id: string): Promise<SettlementRow | null> {
    const r = await tx.query<SettlementRow>(`SELECT ${SET_COLS} FROM case_settlement WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async approveSettlement(
    tx: Tx,
    i: { id: string; expectedVersion: number; approval: string; approvedBy: string | null },
  ): Promise<SettlementRow | null> {
    const r = await tx.query<SettlementRow>(
      `UPDATE case_settlement SET approval_status=$3, approved_by=$4, approved_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND approval_status='proposed' RETURNING ${SET_COLS}`,
      [i.id, i.expectedVersion, i.approval, i.approvedBy],
    );
    return r.rows[0] ?? null;
  }
  async listSettlements(tx: Tx, caseId: string): Promise<SettlementRow[]> {
    const r = await tx.query<SettlementRow>(
      `SELECT ${SET_COLS} FROM case_settlement WHERE case_id=$1 ORDER BY created_at`,
      [caseId],
    );
    return r.rows;
  }

  // --- notes (append-only) ----------------------------------------------------------------------
  async insertNote(
    tx: Tx,
    i: {
      tenantId: string;
      caseId: string;
      noteType: string;
      headline: string | null;
      content: string;
      author: string | null;
      confidentiality: string;
      privileged: boolean;
      relatedActivity: string | null;
      relatedIssue: string | null;
      relatedDocument: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<NoteRow> {
    const r = await tx.query<NoteRow>(
      `INSERT INTO case_note (tenant_id, case_id, note_type, headline, content, author, confidentiality, privileged, related_activity, related_issue, related_document, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${NOTE_COLS}`,
      [
        i.tenantId,
        i.caseId,
        i.noteType,
        i.headline,
        i.content,
        i.author,
        i.confidentiality,
        i.privileged,
        i.relatedActivity,
        i.relatedIssue,
        i.relatedDocument,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert note');
  }
  async listNotes(tx: Tx, caseId: string): Promise<NoteRow[]> {
    const r = await tx.query<NoteRow>(
      `SELECT ${NOTE_COLS} FROM case_note WHERE case_id=$1 ORDER BY created_at`,
      [caseId],
    );
    return r.rows;
  }

  // --- relationships ----------------------------------------------------------------------------
  async insertRelationship(
    tx: Tx,
    i: {
      tenantId: string;
      fromId: string;
      toId: string;
      kind: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<RelationshipRow> {
    const r = await tx.query<RelationshipRow>(
      `INSERT INTO case_relationship (tenant_id, from_case_id, to_case_id, kind, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${REL_COLS}`,
      [i.tenantId, i.fromId, i.toId, i.kind, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert relationship');
  }
  async findReverseRelationship(
    tx: Tx,
    fromId: string,
    toId: string,
    kind: string,
  ): Promise<RelationshipRow | null> {
    const r = await tx.query<RelationshipRow>(
      `SELECT ${REL_COLS} FROM case_relationship WHERE from_case_id=$1 AND to_case_id=$2 AND kind=$3 AND status='active'`,
      [toId, fromId, kind],
    );
    return r.rows[0] ?? null;
  }
  async listRelationships(tx: Tx, caseId: string): Promise<RelationshipRow[]> {
    const r = await tx.query<RelationshipRow>(
      `SELECT ${REL_COLS} FROM case_relationship WHERE (from_case_id=$1 OR to_case_id=$1) AND status='active' ORDER BY created_at`,
      [caseId],
    );
    return r.rows;
  }
}
