/**
 * M14 repository — ALL SQL for legal matter management. Every query is parameterized; every mutating UPDATE is
 * optimistic-lock guarded (`WHERE ... AND version = $expected`) or a compare-and-set claim, so a stale/losing
 * command changes zero rows and the caller reacts. Queries carry NO tenant_id predicate: RLS is the isolation
 * guarantee. All methods take the caller's `Tx` so state, evidence, audit and outbox commit atomically. Status
 * history, assignment history, case-conversion, counsel reports, outcomes and notes are append-only (INSERT +
 * SELECT by grant).
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

export interface MatterRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly matter_number: string;
  readonly matter_type_code: string;
  readonly matter_type_version: number | null;
  readonly source: string;
  readonly source_case_id: string | null;
  readonly source_reference: string | null;
  readonly originating_module: string | null;
  readonly title: string;
  readonly summary: string | null;
  readonly legal_description: string | null;
  readonly jurisdiction: string | null;
  readonly forum: string | null;
  readonly station: string | null;
  readonly external_case_number: string | null;
  readonly court_reference: string | null;
  readonly confidentiality: string;
  readonly privileged: boolean;
  readonly legal_risk: string | null;
  readonly priority: string;
  readonly claim_amount_minor: string | null;
  readonly exposure_amount_minor: string | null;
  readonly currency: string | null;
  readonly cause_of_action: string | null;
  readonly relief_sought: string | null;
  readonly current_owner: string | null;
  readonly legal_team: string | null;
  readonly business_owner: string | null;
  readonly branch: string | null;
  readonly department: string | null;
  readonly workflow_instance_ref: string | null;
  readonly sla_policy_code: string | null;
  readonly escalation_ref: string | null;
  readonly status: string;
  readonly current_stage: string | null;
  readonly legal_hold: boolean;
  readonly business_owner_informed: boolean;
  readonly limitation_at: string | null;
  readonly appeal_status: string | null;
  readonly appeal_forum: string | null;
  readonly appeal_deadline: string | null;
  readonly enforcement_stage: string;
  readonly enforcement_recovered_minor: string | null;
  readonly resolution_summary: string | null;
  readonly closure_summary: string | null;
  readonly final_outcome: string | null;
  readonly residual_risk: string | null;
  readonly opened_at: string | null;
  readonly filed_at: string | null;
  readonly resolved_at: string | null;
  readonly closed_at: string | null;
  readonly correlation_id: string;
  readonly idempotency_key: string | null;
  readonly version: number;
}

export interface ConversionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly source_case_id: string;
  readonly matter_id: string;
}
export interface InstructionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly matter_id: string;
  readonly instruction_type: string | null;
  readonly summary: string | null;
  readonly acceptance_status: string;
  readonly accepted_by: string | null;
  readonly confidentiality: string;
  readonly privileged: boolean;
  readonly version: number;
}
export interface PartyRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly matter_id: string;
  readonly party_role: string;
  readonly entity_ref: string | null;
  readonly display_label: string | null;
  readonly advocate_ref: string | null;
  readonly law_firm_ref: string | null;
  readonly contact_ref: string | null;
  readonly confidentiality: string;
  readonly active: boolean;
  readonly version: number;
}
export interface ActivityRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly matter_id: string;
  readonly activity_type: string;
  readonly headline: string;
  readonly status: string;
  readonly direction: string | null;
  readonly confidentiality: string;
  readonly privileged: boolean;
  readonly outcome: string | null;
  readonly version: number;
}
export interface TaskRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly matter_id: string;
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
  readonly matter_id: string;
  readonly issue_code: string | null;
  readonly category: string | null;
  readonly statement: string;
  readonly cause_of_action: string | null;
  readonly risk: string | null;
  readonly mandatory: boolean;
  readonly outcome: string | null;
  readonly status: string;
  readonly version: number;
}
export interface PositionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly matter_id: string;
  readonly approval_status: string;
  readonly reviewer: string | null;
  readonly privileged: boolean;
  readonly confidentiality: string;
}
export interface OpinionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly matter_id: string;
  readonly opinion_type: string | null;
  readonly summary_conclusion: string | null;
  readonly risk_rating: string | null;
  readonly approval_status: string;
  readonly document_ref: string | null;
  readonly privileged: boolean;
  readonly confidentiality: string;
}
export interface ResearchRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly matter_id: string;
  readonly reference_type: string;
  readonly citation: string | null;
  readonly title: string | null;
  readonly verified: boolean;
  readonly version: number;
}
export interface PleadingRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly matter_id: string;
  readonly document_role: string;
  readonly document_ref: string | null;
  readonly filing_status: string;
  readonly service_status: string | null;
  readonly court_stamp_reference: string | null;
  readonly privileged: boolean;
  readonly confidentiality: string;
  readonly version: number;
}
export interface CourtEventRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly matter_id: string;
  readonly event_type: string;
  readonly title: string | null;
  readonly scheduled_at: string | null;
  readonly forum: string | null;
  readonly status: string;
  readonly outcome: string | null;
  readonly next_at: string | null;
  readonly version: number;
}
export interface DeadlineRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly matter_id: string;
  readonly deadline_type: string;
  readonly due_at: string;
  readonly status: string;
  readonly waived: boolean;
  readonly version: number;
}
export interface CounselRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly matter_id: string;
  readonly law_firm_ref: string | null;
  readonly advocate_ref: string | null;
  readonly status: string;
  readonly next_report_due: string | null;
  readonly version: number;
}
export interface CounselReportRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly matter_id: string;
  readonly reporting_period: string | null;
  readonly status_summary: string | null;
  readonly report_date: string | null;
  readonly document_ref: string | null;
  readonly confidentiality: string;
  readonly privileged: boolean;
}
export interface CostRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly matter_id: string;
  readonly cost_type: string | null;
  readonly amount_minor: string | null;
  readonly currency: string | null;
  readonly approval_status: string;
  readonly recoverable: boolean;
  readonly version: number;
}
export interface SettlementRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly matter_id: string;
  readonly amount_minor: string | null;
  readonly currency: string | null;
  readonly approval_status: string;
  readonly proposed_by: string | null;
  readonly approved_by: string | null;
  readonly confidentiality: string;
  readonly performance_status: string | null;
  readonly version: number;
}
export interface OutcomeRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly matter_id: string;
  readonly outcome_type: string;
  readonly outcome_date: string | null;
  readonly summary: string | null;
  readonly amount_awarded_minor: string | null;
  readonly currency: string | null;
  readonly appealable: boolean;
  readonly status: string;
}
export interface NoteRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly matter_id: string;
  readonly note_type: string;
  readonly headline: string | null;
  readonly content: string;
  readonly confidentiality: string;
  readonly privileged: boolean;
}
export interface RelationshipRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly from_matter_id: string;
  readonly to_matter_id: string;
  readonly kind: string;
  readonly status: string;
  readonly version: number;
}

const SPEC_COLS = 'tenant_id, id, code, version_number, name, scope, status, spec, content_hash, version';
const MATTER_COLS =
  'tenant_id, id, matter_number, matter_type_code, matter_type_version, source, source_case_id, source_reference, ' +
  'originating_module, title, summary, legal_description, jurisdiction, forum, station, external_case_number, ' +
  'court_reference, confidentiality, privileged, legal_risk, priority, claim_amount_minor, exposure_amount_minor, ' +
  'currency, cause_of_action, relief_sought, current_owner, legal_team, business_owner, branch, department, ' +
  'workflow_instance_ref, sla_policy_code, escalation_ref, status, current_stage, legal_hold, business_owner_informed, ' +
  'limitation_at, appeal_status, appeal_forum, appeal_deadline, enforcement_stage, enforcement_recovered_minor, ' +
  'resolution_summary, closure_summary, final_outcome, residual_risk, opened_at, filed_at, resolved_at, closed_at, ' +
  'correlation_id, idempotency_key, version';
const CONV_COLS = 'tenant_id, id, source_case_id, matter_id';
const INSTR_COLS =
  'tenant_id, id, matter_id, instruction_type, summary, acceptance_status, accepted_by, confidentiality, privileged, version';
const PARTY_COLS =
  'tenant_id, id, matter_id, party_role, entity_ref, display_label, advocate_ref, law_firm_ref, contact_ref, confidentiality, active, version';
const ACT_COLS =
  'tenant_id, id, matter_id, activity_type, headline, status, direction, confidentiality, privileged, outcome, version';
const TASK_COLS =
  'tenant_id, id, matter_id, task_type, headline, status, priority, mandatory, outcome, version';
const ISSUE_COLS =
  'tenant_id, id, matter_id, issue_code, category, statement, cause_of_action, risk, mandatory, outcome, status, version';
const POS_COLS = 'tenant_id, id, matter_id, approval_status, reviewer, privileged, confidentiality';
const OPIN_COLS =
  'tenant_id, id, matter_id, opinion_type, summary_conclusion, risk_rating, approval_status, document_ref, privileged, confidentiality';
const RES_COLS = 'tenant_id, id, matter_id, reference_type, citation, title, verified, version';
const PLEAD_COLS =
  'tenant_id, id, matter_id, document_role, document_ref, filing_status, service_status, court_stamp_reference, privileged, confidentiality, version';
const CE_COLS =
  'tenant_id, id, matter_id, event_type, title, scheduled_at, forum, status, outcome, next_at, version';
const DL_COLS = 'tenant_id, id, matter_id, deadline_type, due_at, status, waived, version';
const COUNSEL_COLS = 'tenant_id, id, matter_id, law_firm_ref, advocate_ref, status, next_report_due, version';
const CR_COLS =
  'tenant_id, id, matter_id, reporting_period, status_summary, report_date, document_ref, confidentiality, privileged';
const COST_COLS =
  'tenant_id, id, matter_id, cost_type, amount_minor, currency, approval_status, recoverable, version';
const SET_COLS =
  'tenant_id, id, matter_id, amount_minor, currency, approval_status, proposed_by, approved_by, confidentiality, performance_status, version';
const OUT_COLS =
  'tenant_id, id, matter_id, outcome_type, outcome_date, summary, amount_awarded_minor, currency, appealable, status';
const NOTE_COLS = 'tenant_id, id, matter_id, note_type, headline, content, confidentiality, privileged';
const REL_COLS = 'tenant_id, id, from_matter_id, to_matter_id, kind, status, version';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m14 repository: expected a row from ${what}`);
  return row;
}

export class LegalRepository {
  // --- specs (matter_type + sla_policy) ---------------------------------------------------------
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
  insertMatterType(
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
    return this.insertSpec(tx, 'legal_matter_type', i);
  }
  nextMatterTypeVersion(tx: Tx, code: string, scope: string) {
    return this.nextSpecVersion(tx, 'legal_matter_type', code, scope);
  }
  findMatterType(tx: Tx, id: string) {
    return this.findSpec(tx, 'legal_matter_type', id);
  }
  findActiveMatterType(tx: Tx, code: string) {
    return this.findActiveSpec(tx, 'legal_matter_type', code);
  }
  updateMatterTypeStatus(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      contentHash: string | null;
      publishedBy: string | null;
    },
  ) {
    return this.updateSpecStatus(tx, 'legal_matter_type', i);
  }
  retireActiveMatterTypes(tx: Tx, code: string, scope: string, exceptId: string) {
    return this.retireActiveSpec(tx, 'legal_matter_type', code, scope, exceptId);
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
    return this.insertSpec(tx, 'legal_sla_policy', i);
  }
  nextSlaPolicyVersion(tx: Tx, code: string, scope: string) {
    return this.nextSpecVersion(tx, 'legal_sla_policy', code, scope);
  }
  findSlaPolicy(tx: Tx, id: string) {
    return this.findSpec(tx, 'legal_sla_policy', id);
  }
  findActiveSlaPolicy(tx: Tx, code: string) {
    return this.findActiveSpec(tx, 'legal_sla_policy', code);
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
    return this.updateSpecStatus(tx, 'legal_sla_policy', i);
  }
  retireActiveSlaPolicies(tx: Tx, code: string, scope: string, exceptId: string) {
    return this.retireActiveSpec(tx, 'legal_sla_policy', code, scope, exceptId);
  }

  // --- jurisdiction (config) --------------------------------------------------------------------
  async upsertJurisdiction(
    tx: Tx,
    i: {
      tenantId: string;
      code: string;
      name: string;
      kind: string;
      country: string | null;
      station: string | null;
      active: boolean;
      by: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO legal_jurisdiction (tenant_id, code, name, kind, country, station, active, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) ON CONFLICT (tenant_id, code) DO UPDATE SET name=EXCLUDED.name, kind=EXCLUDED.kind, country=EXCLUDED.country, station=EXCLUDED.station, active=EXCLUDED.active, updated_by=EXCLUDED.updated_by, updated_at=now(), version=legal_jurisdiction.version+1`,
      [i.tenantId, i.code, i.name, i.kind, i.country, i.station, i.active, i.by],
    );
  }

  // --- matter record ----------------------------------------------------------------------------
  async insertMatter(
    tx: Tx,
    i: {
      tenantId: string;
      matterNumber: string;
      matterTypeCode: string;
      matterTypeVersion: number | null;
      source: string;
      sourceCaseId: string | null;
      originatingModule: string | null;
      title: string;
      summary: string | null;
      legalDescription: string | null;
      jurisdiction: string | null;
      forum: string | null;
      confidentiality: string;
      privileged: boolean;
      legalRisk: string | null;
      priority: string;
      branch: string | null;
      department: string | null;
      slaPolicyCode: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      causationId: string | null;
      by: string | null;
    },
  ): Promise<MatterRow> {
    const r = await tx.query<MatterRow>(
      `INSERT INTO legal_matter (tenant_id, matter_number, matter_type_code, matter_type_version, source, source_case_id, originating_module, title, summary, legal_description, jurisdiction, forum, confidentiality, privileged, legal_risk, priority, branch, department, sla_policy_code, idempotency_key, correlation_id, causation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$23) RETURNING ${MATTER_COLS}`,
      [
        i.tenantId,
        i.matterNumber,
        i.matterTypeCode,
        i.matterTypeVersion,
        i.source,
        i.sourceCaseId,
        i.originatingModule,
        i.title,
        i.summary,
        i.legalDescription,
        i.jurisdiction,
        i.forum,
        i.confidentiality,
        i.privileged,
        i.legalRisk,
        i.priority,
        i.branch,
        i.department,
        i.slaPolicyCode,
        i.idempotencyKey,
        i.correlationId,
        i.causationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert matter');
  }
  async findMatter(tx: Tx, id: string): Promise<MatterRow | null> {
    const r = await tx.query<MatterRow>(`SELECT ${MATTER_COLS} FROM legal_matter WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findMatterByIdempotencyKey(tx: Tx, key: string): Promise<MatterRow | null> {
    const r = await tx.query<MatterRow>(`SELECT ${MATTER_COLS} FROM legal_matter WHERE idempotency_key=$1`, [
      key,
    ]);
    return r.rows[0] ?? null;
  }
  async updateMatterStatus(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      by: string | null;
      stamp?: 'opened' | 'filed' | 'resolved' | 'closed' | null;
    },
  ): Promise<MatterRow | null> {
    const stampCol =
      i.stamp === 'opened'
        ? ', opened_at=COALESCE(opened_at, now())'
        : i.stamp === 'filed'
          ? ', filed_at=now()'
          : i.stamp === 'resolved'
            ? ', resolved_at=now()'
            : i.stamp === 'closed'
              ? ', closed_at=now()'
              : '';
    const r = await tx.query<MatterRow>(
      `UPDATE legal_matter SET status=$3, updated_by=$4, updated_at=now(), version=version+1${stampCol} WHERE id=$1 AND version=$2 RETURNING ${MATTER_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async patchMatter(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      legalRisk?: string | null;
      priority?: string | null;
      confidentiality?: string | null;
      privileged?: boolean | null;
      currentStage?: string | null;
      slaPolicyCode?: string | null;
      escalationRef?: string | null;
      currentOwner?: string | null;
      legalTeam?: string | null;
      businessOwner?: string | null;
      workflowInstanceRef?: string | null;
      jurisdiction?: string | null;
      forum?: string | null;
      station?: string | null;
      externalCaseNumber?: string | null;
      courtReference?: string | null;
      causeOfAction?: string | null;
      reliefSought?: string | null;
      claimAmountMinor?: number | null;
      exposureAmountMinor?: number | null;
      currency?: string | null;
      legalHold?: boolean | null;
      businessOwnerInformed?: boolean | null;
      limitationAt?: string | null;
      appealStatus?: string | null;
      appealForum?: string | null;
      appealDeadline?: string | null;
      enforcementStage?: string | null;
      enforcementRecoveredMinor?: number | null;
      resolutionSummary?: string | null;
      closureSummary?: string | null;
      finalOutcome?: string | null;
      residualRisk?: string | null;
      by: string | null;
    },
  ): Promise<MatterRow | null> {
    const r = await tx.query<MatterRow>(
      `UPDATE legal_matter SET
         legal_risk=COALESCE($3,legal_risk), priority=COALESCE($4,priority), confidentiality=COALESCE($5,confidentiality),
         privileged=COALESCE($6,privileged), current_stage=COALESCE($7,current_stage), sla_policy_code=COALESCE($8,sla_policy_code),
         escalation_ref=COALESCE($9,escalation_ref), current_owner=COALESCE($10,current_owner), legal_team=COALESCE($11,legal_team),
         business_owner=COALESCE($12,business_owner), workflow_instance_ref=COALESCE($13,workflow_instance_ref),
         jurisdiction=COALESCE($14,jurisdiction), forum=COALESCE($15,forum), station=COALESCE($16,station),
         external_case_number=COALESCE($17,external_case_number), court_reference=COALESCE($18,court_reference),
         cause_of_action=COALESCE($19,cause_of_action), relief_sought=COALESCE($20,relief_sought),
         claim_amount_minor=COALESCE($21,claim_amount_minor), exposure_amount_minor=COALESCE($22,exposure_amount_minor),
         currency=COALESCE($23,currency), legal_hold=COALESCE($24,legal_hold), business_owner_informed=COALESCE($25,business_owner_informed),
         limitation_at=COALESCE($26,limitation_at), appeal_status=COALESCE($27,appeal_status), appeal_forum=COALESCE($28,appeal_forum),
         appeal_deadline=COALESCE($29,appeal_deadline), enforcement_stage=COALESCE($30,enforcement_stage),
         enforcement_recovered_minor=COALESCE($31,enforcement_recovered_minor), resolution_summary=COALESCE($32,resolution_summary),
         closure_summary=COALESCE($33,closure_summary), final_outcome=COALESCE($34,final_outcome), residual_risk=COALESCE($35,residual_risk),
         updated_by=$36, updated_at=now(), version=version+1
       WHERE id=$1 AND version=$2 RETURNING ${MATTER_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.legalRisk ?? null,
        i.priority ?? null,
        i.confidentiality ?? null,
        i.privileged ?? null,
        i.currentStage ?? null,
        i.slaPolicyCode ?? null,
        i.escalationRef ?? null,
        i.currentOwner ?? null,
        i.legalTeam ?? null,
        i.businessOwner ?? null,
        i.workflowInstanceRef ?? null,
        i.jurisdiction ?? null,
        i.forum ?? null,
        i.station ?? null,
        i.externalCaseNumber ?? null,
        i.courtReference ?? null,
        i.causeOfAction ?? null,
        i.reliefSought ?? null,
        i.claimAmountMinor ?? null,
        i.exposureAmountMinor ?? null,
        i.currency ?? null,
        i.legalHold ?? null,
        i.businessOwnerInformed ?? null,
        i.limitationAt ?? null,
        i.appealStatus ?? null,
        i.appealForum ?? null,
        i.appealDeadline ?? null,
        i.enforcementStage ?? null,
        i.enforcementRecoveredMinor ?? null,
        i.resolutionSummary ?? null,
        i.closureSummary ?? null,
        i.finalOutcome ?? null,
        i.residualRisk ?? null,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async assignMatter(
    tx: Tx,
    i: { id: string; expectedVersion: number; owner: string; toStatus: string; by: string | null },
  ): Promise<MatterRow | null> {
    const r = await tx.query<MatterRow>(
      `UPDATE legal_matter SET current_owner=$3, status=$4, updated_by=$5, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${MATTER_COLS}`,
      [i.id, i.expectedVersion, i.owner, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async searchMatters(
    tx: Tx,
    f: {
      matterTypeCode?: string;
      status?: string;
      legalRisk?: string;
      priority?: string;
      jurisdiction?: string;
      branch?: string;
      owner?: string;
      limit: number;
      offset: number;
    },
  ): Promise<MatterRow[]> {
    const r = await tx.query<MatterRow>(
      `SELECT ${MATTER_COLS} FROM legal_matter WHERE ($1::text IS NULL OR matter_type_code=$1) AND ($2::text IS NULL OR status=$2) AND ($3::text IS NULL OR legal_risk=$3) AND ($4::text IS NULL OR priority=$4) AND ($5::text IS NULL OR jurisdiction=$5) AND ($6::text IS NULL OR branch=$6) AND ($7::uuid IS NULL OR current_owner=$7) ORDER BY created_at DESC LIMIT $8 OFFSET $9`,
      [
        f.matterTypeCode ?? null,
        f.status ?? null,
        f.legalRisk ?? null,
        f.priority ?? null,
        f.jurisdiction ?? null,
        f.branch ?? null,
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
        matter_type: 'matter_type_code',
        source: 'source',
        jurisdiction: 'jurisdiction',
        forum: 'forum',
        branch: 'branch',
        department: 'department',
        legal_risk: 'legal_risk',
        priority: 'priority',
        status: 'status',
        confidentiality: 'confidentiality',
        enforcement_state: 'enforcement_stage',
      }[dimension] ?? 'status';
    const r = await tx.query<{ dim: string | null; count: string }>(
      `SELECT ${col} AS dim, count(*)::text AS count FROM legal_matter GROUP BY ${col} ORDER BY count DESC`,
    );
    return r.rows;
  }

  // --- case conversion (idempotent) -------------------------------------------------------------
  async insertConversion(
    tx: Tx,
    i: { tenantId: string; sourceCaseId: string; matterId: string; correlationId: string; by: string | null },
  ): Promise<ConversionRow> {
    const r = await tx.query<ConversionRow>(
      `INSERT INTO legal_case_conversion (tenant_id, source_case_id, matter_id, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING ${CONV_COLS}`,
      [i.tenantId, i.sourceCaseId, i.matterId, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert conversion');
  }
  async findConversion(tx: Tx, sourceCaseId: string): Promise<ConversionRow | null> {
    const r = await tx.query<ConversionRow>(
      `SELECT ${CONV_COLS} FROM legal_case_conversion WHERE source_case_id=$1`,
      [sourceCaseId],
    );
    return r.rows[0] ?? null;
  }

  // --- histories (append-only) ------------------------------------------------------------------
  async insertStatusHistory(
    tx: Tx,
    i: {
      tenantId: string;
      matterId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO legal_matter_status_history (tenant_id, matter_id, from_status, to_status, reason, reason_code, changed_by, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.matterId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }
  async insertAssignmentHistory(
    tx: Tx,
    i: {
      tenantId: string;
      matterId: string;
      kind: string;
      ref: string;
      by: string | null;
      reason: string | null;
      ruleEvalId: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO legal_assignment_history (tenant_id, matter_id, assigned_to_kind, assigned_to_ref, assigned_by, reason, rule_eval_id, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.matterId, i.kind, i.ref, i.by, i.reason, i.ruleEvalId, i.correlationId],
    );
  }

  // --- instructions -----------------------------------------------------------------------------
  async insertInstruction(
    tx: Tx,
    i: {
      tenantId: string;
      matterId: string;
      instructionType: string | null;
      instructingDepartment: string | null;
      instructingOfficer: string | null;
      summary: string | null;
      scope: string | null;
      desiredOutcome: string | null;
      urgency: string | null;
      requiredAction: string | null;
      responsibleOfficer: string | null;
      confidentiality: string;
      privileged: boolean;
      correlationId: string;
      by: string | null;
    },
  ): Promise<InstructionRow> {
    const r = await tx.query<InstructionRow>(
      `INSERT INTO legal_instruction (tenant_id, matter_id, instruction_type, instructing_department, instructing_officer, instruction_date, summary, scope, desired_outcome, urgency, required_action, responsible_officer, confidentiality, privileged, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5, now(), $6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${INSTR_COLS}`,
      [
        i.tenantId,
        i.matterId,
        i.instructionType,
        i.instructingDepartment,
        i.instructingOfficer,
        i.summary,
        i.scope,
        i.desiredOutcome,
        i.urgency,
        i.requiredAction,
        i.responsibleOfficer,
        i.confidentiality,
        i.privileged,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert instruction');
  }
  async findInstruction(tx: Tx, id: string): Promise<InstructionRow | null> {
    const r = await tx.query<InstructionRow>(`SELECT ${INSTR_COLS} FROM legal_instruction WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async decideInstruction(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      status: 'accepted' | 'rejected';
      by: string | null;
      rejectionReason: string | null;
    },
  ): Promise<InstructionRow | null> {
    const r = await tx.query<InstructionRow>(
      `UPDATE legal_instruction SET acceptance_status=$3, accepted_by=CASE WHEN $3='accepted' THEN $4 ELSE accepted_by END, accepted_at=CASE WHEN $3='accepted' THEN now() ELSE accepted_at END, rejection_reason=$5, version=version+1 WHERE id=$1 AND version=$2 AND acceptance_status='pending' RETURNING ${INSTR_COLS}`,
      [i.id, i.expectedVersion, i.status, i.by, i.rejectionReason],
    );
    return r.rows[0] ?? null;
  }
  async listInstructions(tx: Tx, matterId: string): Promise<InstructionRow[]> {
    const r = await tx.query<InstructionRow>(
      `SELECT ${INSTR_COLS} FROM legal_instruction WHERE matter_id=$1 ORDER BY created_at`,
      [matterId],
    );
    return r.rows;
  }
  async hasPendingInstruction(tx: Tx, matterId: string): Promise<boolean> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM legal_instruction WHERE matter_id=$1 AND acceptance_status='pending'`,
      [matterId],
    );
    return Number(r.rows[0]?.c ?? '0') > 0;
  }

  // --- parties ----------------------------------------------------------------------------------
  async insertParty(
    tx: Tx,
    i: {
      tenantId: string;
      matterId: string;
      partyRole: string;
      entityRef: string | null;
      displayLabel: string | null;
      advocateRef: string | null;
      lawFirmRef: string | null;
      contactRef: string | null;
      authority: string | null;
      confidentiality: string;
      relationship: string | null;
      by: string | null;
    },
  ): Promise<PartyRow> {
    const r = await tx.query<PartyRow>(
      `INSERT INTO legal_party (tenant_id, matter_id, party_role, entity_ref, display_label, advocate_ref, law_firm_ref, contact_ref, authority, confidentiality, relationship, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING ${PARTY_COLS}`,
      [
        i.tenantId,
        i.matterId,
        i.partyRole,
        i.entityRef,
        i.displayLabel,
        i.advocateRef,
        i.lawFirmRef,
        i.contactRef,
        i.authority,
        i.confidentiality,
        i.relationship,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert party');
  }
  async deactivateParty(
    tx: Tx,
    i: { id: string; expectedVersion: number; by: string | null },
  ): Promise<PartyRow | null> {
    const r = await tx.query<PartyRow>(
      `UPDATE legal_party SET active=false, active_to=now(), updated_by=$3, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND active=true RETURNING ${PARTY_COLS}`,
      [i.id, i.expectedVersion, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listParties(tx: Tx, matterId: string): Promise<PartyRow[]> {
    const r = await tx.query<PartyRow>(
      `SELECT ${PARTY_COLS} FROM legal_party WHERE matter_id=$1 ORDER BY created_at`,
      [matterId],
    );
    return r.rows;
  }

  // --- activities -------------------------------------------------------------------------------
  async insertActivity(
    tx: Tx,
    i: {
      tenantId: string;
      matterId: string;
      activityType: string;
      headline: string;
      description: string | null;
      occurredAt: string | null;
      dueAt: string | null;
      assignedTo: string | null;
      direction: string | null;
      source: string | null;
      confidentiality: string;
      privileged: boolean;
      documentRefs: unknown;
      responseRequired: boolean;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ActivityRow> {
    const r = await tx.query<ActivityRow>(
      `INSERT INTO legal_activity (tenant_id, matter_id, activity_type, headline, description, occurred_at, due_at, assigned_to, direction, source, confidentiality, privileged, document_refs, response_required, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16) RETURNING ${ACT_COLS}`,
      [
        i.tenantId,
        i.matterId,
        i.activityType,
        i.headline,
        i.description,
        i.occurredAt,
        i.dueAt,
        i.assignedTo,
        i.direction,
        i.source,
        i.confidentiality,
        i.privileged,
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
      `UPDATE legal_activity SET status='completed', completed_at=now(), completed_by=$4, outcome=$3, version=version+1 WHERE id=$1 AND version=$2 AND status<>'completed' RETURNING ${ACT_COLS}`,
      [i.id, i.expectedVersion, i.outcome, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listActivities(tx: Tx, matterId: string): Promise<ActivityRow[]> {
    const r = await tx.query<ActivityRow>(
      `SELECT ${ACT_COLS} FROM legal_activity WHERE matter_id=$1 ORDER BY created_at`,
      [matterId],
    );
    return r.rows;
  }

  // --- tasks ------------------------------------------------------------------------------------
  async insertTask(
    tx: Tx,
    i: {
      tenantId: string;
      matterId: string;
      taskType: string;
      headline: string;
      description: string | null;
      owner: string | null;
      team: string | null;
      dueAt: string | null;
      priority: string;
      mandatory: boolean;
      workflowTaskRef: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<TaskRow> {
    const r = await tx.query<TaskRow>(
      `INSERT INTO legal_task (tenant_id, matter_id, task_type, headline, description, owner, team, due_at, priority, mandatory, workflow_task_ref, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${TASK_COLS}`,
      [
        i.tenantId,
        i.matterId,
        i.taskType,
        i.headline,
        i.description,
        i.owner,
        i.team,
        i.dueAt,
        i.priority,
        i.mandatory,
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
      `UPDATE legal_task SET status='completed', completed_at=now(), completed_by=$4, outcome=$3, version=version+1 WHERE id=$1 AND version=$2 AND status NOT IN ('completed','cancelled') RETURNING ${TASK_COLS}`,
      [i.id, i.expectedVersion, i.outcome, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listTasks(tx: Tx, matterId: string): Promise<TaskRow[]> {
    const r = await tx.query<TaskRow>(
      `SELECT ${TASK_COLS} FROM legal_task WHERE matter_id=$1 ORDER BY created_at`,
      [matterId],
    );
    return r.rows;
  }
  async countOpenMandatoryTasks(tx: Tx, matterId: string): Promise<number> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM legal_task WHERE matter_id=$1 AND mandatory=true AND status NOT IN ('completed','cancelled')`,
      [matterId],
    );
    return Number(r.rows[0]?.c ?? '0');
  }

  // --- issues -----------------------------------------------------------------------------------
  async insertIssue(
    tx: Tx,
    i: {
      tenantId: string;
      matterId: string;
      issueCode: string | null;
      category: string | null;
      statement: string;
      causeOfAction: string | null;
      defence: string | null;
      legalBasisReference: string | null;
      affectedParty: string | null;
      risk: string | null;
      mandatory: boolean;
      correlationId: string;
      by: string | null;
    },
  ): Promise<IssueRow> {
    const r = await tx.query<IssueRow>(
      `INSERT INTO legal_issue (tenant_id, matter_id, issue_code, category, statement, cause_of_action, defence, legal_basis_reference, affected_party, risk, mandatory, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING ${ISSUE_COLS}`,
      [
        i.tenantId,
        i.matterId,
        i.issueCode,
        i.category,
        i.statement,
        i.causeOfAction,
        i.defence,
        i.legalBasisReference,
        i.affectedParty,
        i.risk,
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
      position: string | null;
      outcome: string | null;
      status: string | null;
      by: string | null;
    },
  ): Promise<IssueRow | null> {
    const r = await tx.query<IssueRow>(
      `UPDATE legal_issue SET position=COALESCE($3,position), outcome=COALESCE($4,outcome), status=COALESCE($5,status), updated_by=$6, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${ISSUE_COLS}`,
      [i.id, i.expectedVersion, i.position, i.outcome, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listIssues(tx: Tx, matterId: string): Promise<IssueRow[]> {
    const r = await tx.query<IssueRow>(
      `SELECT ${ISSUE_COLS} FROM legal_issue WHERE matter_id=$1 ORDER BY created_at`,
      [matterId],
    );
    return r.rows;
  }

  // --- positions (privileged) -------------------------------------------------------------------
  async insertPosition(
    tx: Tx,
    i: {
      tenantId: string;
      matterId: string;
      position: string | null;
      strategy: string | null;
      strengths: string | null;
      weaknesses: string | null;
      exposureSummary: string | null;
      recommendedApproach: string | null;
      settlementPosture: string | null;
      limitationRisks: string | null;
      reviewer: string | null;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<PositionRow> {
    const r = await tx.query<PositionRow>(
      `INSERT INTO legal_position (tenant_id, matter_id, position, strategy, strengths, weaknesses, exposure_summary, recommended_approach, settlement_posture, limitation_risks, reviewer, confidentiality, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING ${POS_COLS}`,
      [
        i.tenantId,
        i.matterId,
        i.position,
        i.strategy,
        i.strengths,
        i.weaknesses,
        i.exposureSummary,
        i.recommendedApproach,
        i.settlementPosture,
        i.limitationRisks,
        i.reviewer,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert position');
  }
  async listPositions(tx: Tx, matterId: string): Promise<PositionRow[]> {
    const r = await tx.query<PositionRow>(
      `SELECT ${POS_COLS} FROM legal_position WHERE matter_id=$1 ORDER BY created_at DESC`,
      [matterId],
    );
    return r.rows;
  }

  // --- opinions ---------------------------------------------------------------------------------
  async insertOpinion(
    tx: Tx,
    i: {
      tenantId: string;
      matterId: string;
      opinionType: string | null;
      questionPresented: string | null;
      summaryConclusion: string | null;
      riskRating: string | null;
      recommendation: string | null;
      author: string | null;
      documentRef: string | null;
      confidentiality: string;
      relatedIssue: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<OpinionRow> {
    const r = await tx.query<OpinionRow>(
      `INSERT INTO legal_opinion (tenant_id, matter_id, opinion_type, question_presented, summary_conclusion, risk_rating, recommendation, author, issue_date, document_ref, confidentiality, related_issue, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, current_date, $9,$10,$11,$12,$13) RETURNING ${OPIN_COLS}`,
      [
        i.tenantId,
        i.matterId,
        i.opinionType,
        i.questionPresented,
        i.summaryConclusion,
        i.riskRating,
        i.recommendation,
        i.author,
        i.documentRef,
        i.confidentiality,
        i.relatedIssue,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert opinion');
  }
  async listOpinions(tx: Tx, matterId: string): Promise<OpinionRow[]> {
    const r = await tx.query<OpinionRow>(
      `SELECT ${OPIN_COLS} FROM legal_opinion WHERE matter_id=$1 ORDER BY created_at`,
      [matterId],
    );
    return r.rows;
  }

  // --- research references ----------------------------------------------------------------------
  async insertResearch(
    tx: Tx,
    i: {
      tenantId: string;
      matterId: string;
      referenceType: string;
      citation: string | null;
      title: string | null;
      jurisdiction: string | null;
      source: string | null;
      relevanceSummary: string | null;
      relatedIssue: string | null;
      documentRef: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ResearchRow> {
    const r = await tx.query<ResearchRow>(
      `INSERT INTO legal_research_reference (tenant_id, matter_id, reference_type, citation, title, jurisdiction, source, relevance_summary, related_issue, document_ref, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${RES_COLS}`,
      [
        i.tenantId,
        i.matterId,
        i.referenceType,
        i.citation,
        i.title,
        i.jurisdiction,
        i.source,
        i.relevanceSummary,
        i.relatedIssue,
        i.documentRef,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert research');
  }
  async listResearch(tx: Tx, matterId: string): Promise<ResearchRow[]> {
    const r = await tx.query<ResearchRow>(
      `SELECT ${RES_COLS} FROM legal_research_reference WHERE matter_id=$1 ORDER BY created_at`,
      [matterId],
    );
    return r.rows;
  }

  // --- pleadings --------------------------------------------------------------------------------
  async insertPleading(
    tx: Tx,
    i: {
      tenantId: string;
      matterId: string;
      documentRole: string;
      documentRef: string | null;
      confidentiality: string;
      privileged: boolean;
      relatedCourtEvent: string | null;
      relatedIssue: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<PleadingRow> {
    const r = await tx.query<PleadingRow>(
      `INSERT INTO legal_pleading (tenant_id, matter_id, document_role, document_ref, confidentiality, privileged, related_court_event, related_issue, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${PLEAD_COLS}`,
      [
        i.tenantId,
        i.matterId,
        i.documentRole,
        i.documentRef,
        i.confidentiality,
        i.privileged,
        i.relatedCourtEvent,
        i.relatedIssue,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert pleading');
  }
  async filePleading(
    tx: Tx,
    i: { id: string; expectedVersion: number; courtStampReference: string | null; by: string | null },
  ): Promise<PleadingRow | null> {
    const r = await tx.query<PleadingRow>(
      `UPDATE legal_pleading SET filing_status='filed', filing_date=current_date, court_stamp_reference=$3, filed_by=$4, version=version+1 WHERE id=$1 AND version=$2 AND filing_status IN ('draft','ready') RETURNING ${PLEAD_COLS}`,
      [i.id, i.expectedVersion, i.courtStampReference, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listPleadings(tx: Tx, matterId: string): Promise<PleadingRow[]> {
    const r = await tx.query<PleadingRow>(
      `SELECT ${PLEAD_COLS} FROM legal_pleading WHERE matter_id=$1 ORDER BY created_at`,
      [matterId],
    );
    return r.rows;
  }

  // --- court events -----------------------------------------------------------------------------
  async insertCourtEvent(
    tx: Tx,
    i: {
      tenantId: string;
      matterId: string;
      eventType: string;
      title: string | null;
      scheduledAt: string | null;
      forum: string | null;
      venue: string | null;
      presidingRef: string | null;
      documentRefs: unknown;
      correlationId: string;
      by: string | null;
    },
  ): Promise<CourtEventRow> {
    const r = await tx.query<CourtEventRow>(
      `INSERT INTO legal_court_event (tenant_id, matter_id, event_type, title, scheduled_at, forum, venue, presiding_ref, document_refs, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$11) RETURNING ${CE_COLS}`,
      [
        i.tenantId,
        i.matterId,
        i.eventType,
        i.title,
        i.scheduledAt,
        i.forum,
        i.venue,
        i.presidingRef,
        i.documentRefs === null ? null : JSON.stringify(i.documentRefs),
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert court event');
  }
  async updateCourtEvent(
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
  ): Promise<CourtEventRow | null> {
    const r = await tx.query<CourtEventRow>(
      `UPDATE legal_court_event SET scheduled_at=COALESCE($3,scheduled_at), status=COALESCE($4,status), adjournment_reason=COALESCE($5,adjournment_reason), next_at=COALESCE($6,next_at), updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${CE_COLS}`,
      [i.id, i.expectedVersion, i.scheduledAt, i.status, i.adjournmentReason, i.nextAt, i.by],
    );
    return r.rows[0] ?? null;
  }
  async completeCourtEvent(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      outcome: string | null;
      orderDirection: string | null;
      nextAction: string | null;
      nextAt: string | null;
      by: string | null;
    },
  ): Promise<CourtEventRow | null> {
    const r = await tx.query<CourtEventRow>(
      `UPDATE legal_court_event SET status='completed', outcome=$3, order_direction=$4, next_action=$5, next_at=$6, completed_at=now(), updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status<>'completed' RETURNING ${CE_COLS}`,
      [i.id, i.expectedVersion, i.outcome, i.orderDirection, i.nextAction, i.nextAt, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listCourtEvents(tx: Tx, matterId: string): Promise<CourtEventRow[]> {
    const r = await tx.query<CourtEventRow>(
      `SELECT ${CE_COLS} FROM legal_court_event WHERE matter_id=$1 ORDER BY scheduled_at NULLS LAST`,
      [matterId],
    );
    return r.rows;
  }

  // --- deadlines --------------------------------------------------------------------------------
  async insertDeadline(
    tx: Tx,
    i: {
      tenantId: string;
      matterId: string;
      deadlineType: string;
      startAt: string | null;
      dueAt: string;
      calculationRule: string | null;
      source: string | null;
      authority: string | null;
      linkedTask: string | null;
      linkedActivity: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<DeadlineRow> {
    const r = await tx.query<DeadlineRow>(
      `INSERT INTO legal_deadline (tenant_id, matter_id, deadline_type, start_at, due_at, calculation_rule, source, authority, linked_task, linked_activity, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${DL_COLS}`,
      [
        i.tenantId,
        i.matterId,
        i.deadlineType,
        i.startAt,
        i.dueAt,
        i.calculationRule,
        i.source,
        i.authority,
        i.linkedTask,
        i.linkedActivity,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert deadline');
  }
  async findDeadline(tx: Tx, id: string): Promise<DeadlineRow | null> {
    const r = await tx.query<DeadlineRow>(`SELECT ${DL_COLS} FROM legal_deadline WHERE id=$1`, [id]);
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
      `UPDATE legal_deadline SET extension_to=$3, extension_reason=$4, due_at=$3, status='extended', extension_authority=$5, version=version+1 WHERE id=$1 AND version=$2 AND status IN ('open','extended') RETURNING ${DL_COLS}`,
      [i.id, i.expectedVersion, i.extensionTo, i.reason, i.authority],
    );
    return r.rows[0] ?? null;
  }
  async completeDeadline(tx: Tx, i: { id: string; expectedVersion: number }): Promise<DeadlineRow | null> {
    const r = await tx.query<DeadlineRow>(
      `UPDATE legal_deadline SET status='completed', completed_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status IN ('open','extended') RETURNING ${DL_COLS}`,
      [i.id, i.expectedVersion],
    );
    return r.rows[0] ?? null;
  }
  async markDeadlineBreach(tx: Tx, id: string): Promise<DeadlineRow | null> {
    const r = await tx.query<DeadlineRow>(
      `UPDATE legal_deadline SET status='breached', breached_at=now(), version=version+1 WHERE id=$1 AND status IN ('open','extended') RETURNING ${DL_COLS}`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async listDeadlines(tx: Tx, matterId: string): Promise<DeadlineRow[]> {
    const r = await tx.query<DeadlineRow>(
      `SELECT ${DL_COLS} FROM legal_deadline WHERE matter_id=$1 ORDER BY due_at`,
      [matterId],
    );
    return r.rows;
  }
  async countOpenDeadlines(tx: Tx, matterId: string): Promise<number> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM legal_deadline WHERE matter_id=$1 AND status IN ('open','extended')`,
      [matterId],
    );
    return Number(r.rows[0]?.c ?? '0');
  }
  async hasImminentLimitation(tx: Tx, matterId: string, withinIso: string): Promise<boolean> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM legal_deadline WHERE matter_id=$1 AND deadline_type='limitation' AND status IN ('open','extended') AND due_at <= $2`,
      [matterId, withinIso],
    );
    return Number(r.rows[0]?.c ?? '0') > 0;
  }

  // --- external counsel + reports ---------------------------------------------------------------
  async insertCounsel(
    tx: Tx,
    i: {
      tenantId: string;
      matterId: string;
      lawFirmRef: string | null;
      advocateRef: string | null;
      instructionScope: string | null;
      engagementReference: string | null;
      reportingFrequency: string | null;
      internalOwner: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<CounselRow> {
    const r = await tx.query<CounselRow>(
      `INSERT INTO legal_external_counsel (tenant_id, matter_id, law_firm_ref, advocate_ref, instruction_date, instruction_scope, engagement_reference, reporting_frequency, internal_owner, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4, current_date, $5,$6,$7,$8,$9,$10,$10) RETURNING ${COUNSEL_COLS}`,
      [
        i.tenantId,
        i.matterId,
        i.lawFirmRef,
        i.advocateRef,
        i.instructionScope,
        i.engagementReference,
        i.reportingFrequency,
        i.internalOwner,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert counsel');
  }
  async updateCounsel(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      status: string | null;
      lastUpdateSummary: string | null;
      nextReportDue: string | null;
      by: string | null;
    },
  ): Promise<CounselRow | null> {
    const r = await tx.query<CounselRow>(
      `UPDATE legal_external_counsel SET status=COALESCE($3,status), last_update_summary=COALESCE($4,last_update_summary), last_update_date=CASE WHEN $4 IS NOT NULL THEN current_date ELSE last_update_date END, next_report_due=COALESCE($5,next_report_due), updated_by=$6, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${COUNSEL_COLS}`,
      [i.id, i.expectedVersion, i.status, i.lastUpdateSummary, i.nextReportDue, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listCounsel(tx: Tx, matterId: string): Promise<CounselRow[]> {
    const r = await tx.query<CounselRow>(
      `SELECT ${COUNSEL_COLS} FROM legal_external_counsel WHERE matter_id=$1 ORDER BY created_at`,
      [matterId],
    );
    return r.rows;
  }
  async insertCounselReport(
    tx: Tx,
    i: {
      tenantId: string;
      matterId: string;
      counselId: string | null;
      reportingPeriod: string | null;
      statusSummary: string | null;
      actionTaken: string | null;
      nextAction: string | null;
      risks: string | null;
      documentRef: string | null;
      author: string | null;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<CounselReportRow> {
    const r = await tx.query<CounselReportRow>(
      `INSERT INTO legal_counsel_report (tenant_id, matter_id, counsel_id, reporting_period, status_summary, action_taken, next_action, risks, report_date, document_ref, author, confidentiality, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, current_date, $9,$10,$11,$12,$13) RETURNING ${CR_COLS}`,
      [
        i.tenantId,
        i.matterId,
        i.counselId,
        i.reportingPeriod,
        i.statusSummary,
        i.actionTaken,
        i.nextAction,
        i.risks,
        i.documentRef,
        i.author,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert counsel report');
  }
  async listCounselReports(tx: Tx, matterId: string): Promise<CounselReportRow[]> {
    const r = await tx.query<CounselReportRow>(
      `SELECT ${CR_COLS} FROM legal_counsel_report WHERE matter_id=$1 ORDER BY created_at`,
      [matterId],
    );
    return r.rows;
  }

  // --- costs ------------------------------------------------------------------------------------
  async insertCost(
    tx: Tx,
    i: {
      tenantId: string;
      matterId: string;
      costType: string | null;
      description: string | null;
      amountMinor: number | null;
      currency: string | null;
      externalCounselRef: string | null;
      invoiceReference: string | null;
      recoverable: boolean;
      correlationId: string;
      by: string | null;
    },
  ): Promise<CostRow> {
    const r = await tx.query<CostRow>(
      `INSERT INTO legal_cost_reference (tenant_id, matter_id, cost_type, description, amount_minor, currency, incurred_date, external_counsel_ref, invoice_reference, recoverable, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6, current_date, $7,$8,$9,$10,$11) RETURNING ${COST_COLS}`,
      [
        i.tenantId,
        i.matterId,
        i.costType,
        i.description,
        i.amountMinor,
        i.currency,
        i.externalCounselRef,
        i.invoiceReference,
        i.recoverable,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert cost');
  }
  async listCosts(tx: Tx, matterId: string): Promise<CostRow[]> {
    const r = await tx.query<CostRow>(
      `SELECT ${COST_COLS} FROM legal_cost_reference WHERE matter_id=$1 ORDER BY created_at`,
      [matterId],
    );
    return r.rows;
  }
  async hasCosts(tx: Tx, matterId: string): Promise<boolean> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM legal_cost_reference WHERE matter_id=$1`,
      [matterId],
    );
    return Number(r.rows[0]?.c ?? '0') > 0;
  }

  // --- settlement -------------------------------------------------------------------------------
  async insertSettlement(
    tx: Tx,
    i: {
      tenantId: string;
      matterId: string;
      proposal: string | null;
      monetaryTerms: string | null;
      confidentialTerms: string | null;
      amountMinor: number | null;
      currency: string | null;
      nonMonetaryTerms: string | null;
      settlementAuthority: string | null;
      proposedBy: string | null;
      effectiveDate: string | null;
      documentRef: string | null;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<SettlementRow> {
    const r = await tx.query<SettlementRow>(
      `INSERT INTO legal_settlement (tenant_id, matter_id, proposal, monetary_terms, confidential_terms, amount_minor, currency, non_monetary_terms, settlement_authority, proposed_by, effective_date, settlement_document_ref, confidentiality, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING ${SET_COLS}`,
      [
        i.tenantId,
        i.matterId,
        i.proposal,
        i.monetaryTerms,
        i.confidentialTerms,
        i.amountMinor,
        i.currency,
        i.nonMonetaryTerms,
        i.settlementAuthority,
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
    const r = await tx.query<SettlementRow>(`SELECT ${SET_COLS} FROM legal_settlement WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async approveSettlement(
    tx: Tx,
    i: { id: string; expectedVersion: number; approval: string; approvedBy: string | null },
  ): Promise<SettlementRow | null> {
    const r = await tx.query<SettlementRow>(
      `UPDATE legal_settlement SET approval_status=$3, approved_by=$4, approved_at=now(), updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND approval_status='proposed' RETURNING ${SET_COLS}`,
      [i.id, i.expectedVersion, i.approval, i.approvedBy],
    );
    return r.rows[0] ?? null;
  }
  async listSettlements(tx: Tx, matterId: string): Promise<SettlementRow[]> {
    const r = await tx.query<SettlementRow>(
      `SELECT ${SET_COLS} FROM legal_settlement WHERE matter_id=$1 ORDER BY created_at`,
      [matterId],
    );
    return r.rows;
  }

  // --- outcome (append-only) --------------------------------------------------------------------
  async insertOutcome(
    tx: Tx,
    i: {
      tenantId: string;
      matterId: string;
      outcomeType: string;
      outcomeDate: string | null;
      summary: string | null;
      amountAwardedMinor: number | null;
      currency: string | null;
      costsAwardedMinor: number | null;
      orders: string | null;
      documentRef: string | null;
      appealable: boolean;
      appealDeadline: string | null;
      responsibleOfficer: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<OutcomeRow> {
    const r = await tx.query<OutcomeRow>(
      `INSERT INTO legal_outcome (tenant_id, matter_id, outcome_type, outcome_date, summary, amount_awarded_minor, currency, costs_awarded_minor, orders, document_ref, appealable, appeal_deadline, responsible_officer, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${OUT_COLS}`,
      [
        i.tenantId,
        i.matterId,
        i.outcomeType,
        i.outcomeDate,
        i.summary,
        i.amountAwardedMinor,
        i.currency,
        i.costsAwardedMinor,
        i.orders,
        i.documentRef,
        i.appealable,
        i.appealDeadline,
        i.responsibleOfficer,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert outcome');
  }
  async listOutcomes(tx: Tx, matterId: string): Promise<OutcomeRow[]> {
    const r = await tx.query<OutcomeRow>(
      `SELECT ${OUT_COLS} FROM legal_outcome WHERE matter_id=$1 ORDER BY created_at`,
      [matterId],
    );
    return r.rows;
  }
  async hasOutcome(tx: Tx, matterId: string): Promise<boolean> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM legal_outcome WHERE matter_id=$1`,
      [matterId],
    );
    return Number(r.rows[0]?.c ?? '0') > 0;
  }

  // --- notes (append-only) ----------------------------------------------------------------------
  async insertNote(
    tx: Tx,
    i: {
      tenantId: string;
      matterId: string;
      noteType: string;
      headline: string | null;
      content: string;
      author: string | null;
      privileged: boolean;
      confidentiality: string;
      relatedIssue: string | null;
      relatedActivity: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<NoteRow> {
    const r = await tx.query<NoteRow>(
      `INSERT INTO legal_note (tenant_id, matter_id, note_type, headline, content, author, privileged, confidentiality, related_issue, related_activity, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${NOTE_COLS}`,
      [
        i.tenantId,
        i.matterId,
        i.noteType,
        i.headline,
        i.content,
        i.author,
        i.privileged,
        i.confidentiality,
        i.relatedIssue,
        i.relatedActivity,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert note');
  }
  async listNotes(tx: Tx, matterId: string): Promise<NoteRow[]> {
    const r = await tx.query<NoteRow>(
      `SELECT ${NOTE_COLS} FROM legal_note WHERE matter_id=$1 ORDER BY created_at`,
      [matterId],
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
      `INSERT INTO legal_relationship (tenant_id, from_matter_id, to_matter_id, kind, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${REL_COLS}`,
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
      `SELECT ${REL_COLS} FROM legal_relationship WHERE from_matter_id=$1 AND to_matter_id=$2 AND kind=$3 AND status='active'`,
      [toId, fromId, kind],
    );
    return r.rows[0] ?? null;
  }
  async listRelationships(tx: Tx, matterId: string): Promise<RelationshipRow[]> {
    const r = await tx.query<RelationshipRow>(
      `SELECT ${REL_COLS} FROM legal_relationship WHERE (from_matter_id=$1 OR to_matter_id=$1) AND status='active' ORDER BY created_at`,
      [matterId],
    );
    return r.rows;
  }
}
