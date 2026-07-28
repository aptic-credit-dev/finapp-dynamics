/**
 * M16 repository — ALL SQL for litigation & adjudicative proceedings. Every query is parameterized; every mutating
 * UPDATE is optimistic-lock guarded (`WHERE ... AND version = $expected`) or a compare-and-set claim, so a
 * stale/losing command changes zero rows and the caller reacts. Queries carry NO tenant_id predicate: RLS is the
 * isolation guarantee. All methods take the caller's `Tx` so state, evidence, audit and outbox commit atomically.
 * Referral evidence, status/assignment histories, proceeding records, orders, outcomes and notes are append-only
 * (INSERT + SELECT by grant). m16 NEVER reads m14 tables — the source matter id is an opaque reference.
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

export interface ProceedingRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly proceeding_number: string;
  readonly proceeding_type_code: string;
  readonly proceeding_type_version: number | null;
  readonly source: string;
  readonly source_matter_id: string | null;
  readonly source_reference: string | null;
  readonly originating_module: string | null;
  readonly title: string;
  readonly summary: string | null;
  readonly description: string | null;
  readonly jurisdiction: string | null;
  readonly forum: string | null;
  readonly forum_type: string | null;
  readonly court: string | null;
  readonly station: string | null;
  readonly division: string | null;
  readonly external_case_number: string | null;
  readonly organization_role: string | null;
  readonly claim_amount_minor: string | null;
  readonly currency: string | null;
  readonly confidentiality: string;
  readonly privileged: boolean;
  readonly litigation_risk: string | null;
  readonly priority: string;
  readonly legal_owner: string | null;
  readonly litigation_team: string | null;
  readonly business_owner: string | null;
  readonly external_counsel_ref: string | null;
  readonly workflow_instance_ref: string | null;
  readonly sla_policy_code: string | null;
  readonly escalation_ref: string | null;
  readonly status: string;
  readonly procedural_stage: string | null;
  readonly legal_hold: boolean;
  readonly matter_update_emitted: boolean;
  readonly limitation_at: string | null;
  readonly appeal_status: string | null;
  readonly enforcement_referral_ready: boolean;
  readonly final_outcome: string | null;
  readonly residual_obligations: string | null;
  readonly filed_at: string | null;
  readonly served_at: string | null;
  readonly commenced_at: string | null;
  readonly concluded_at: string | null;
  readonly closed_at: string | null;
  readonly reopened_at: string | null;
  readonly archived_at: string | null;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly idempotency_key: string | null;
  readonly version: number;
}

export interface ReferralRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly referral_key: string;
  readonly source_matter_id: string;
  readonly proceeding_id: string;
  readonly proceeding_type_code: string | null;
  readonly safe_metadata: unknown;
}

export interface PartyRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly proceeding_id: string;
  readonly party_role: string;
  readonly entity_ref: string | null;
  readonly display_label: string | null;
  readonly representation_ref: string | null;
  readonly advocate_ref: string | null;
  readonly law_firm_ref: string | null;
  readonly lead_counsel_ref: string | null;
  readonly service_address_ref: string | null;
  readonly service_status: string | null;
  readonly authority: string | null;
  readonly contact_ref: string | null;
  readonly confidentiality: string;
  readonly active: boolean;
  readonly version: number;
}

export interface ClaimRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly proceeding_id: string;
  readonly claim_type: string;
  readonly statement: string | null;
  readonly cause_reference: string | null;
  readonly relief_sought: string | null;
  readonly amount_minor: string | null;
  readonly currency: string | null;
  readonly non_monetary_relief: string | null;
  readonly counterclaim: boolean;
  readonly defence: string | null;
  readonly admission_status: string | null;
  readonly risk: string | null;
  readonly status: string;
  readonly outcome: string | null;
  readonly confidentiality: string;
  readonly version: number;
}

export interface FilingRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly proceeding_id: string;
  readonly filing_role: string;
  readonly document_ref: string | null;
  readonly document_version: number | null;
  readonly filing_status: string;
  readonly filed_date: string | null;
  readonly filed_by: string | null;
  readonly prepared_by: string | null;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly receiving_registry: string | null;
  readonly filing_reference: string | null;
  readonly court_stamp_reference: string | null;
  readonly rejection_reason: string | null;
  readonly privileged: boolean;
  readonly confidentiality: string;
  readonly version: number;
}

export interface ServiceRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly proceeding_id: string;
  readonly item_served: string | null;
  readonly party_ref: string | null;
  readonly service_method: string | null;
  readonly service_date: string | null;
  readonly location_reference: string | null;
  readonly served_by: string | null;
  readonly recipient: string | null;
  readonly acknowledgment: string | null;
  readonly certificate_document_ref: string | null;
  readonly deemed_basis: string | null;
  readonly service_status: string;
  readonly failure_reason: string | null;
  readonly next_attempt_at: string | null;
  readonly verification_status: string;
  readonly verified_by: string | null;
  readonly verified_at: string | null;
  readonly confidentiality: string;
  readonly version: number;
}

export interface AppearanceRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly proceeding_id: string;
  readonly appearance_type: string;
  readonly scheduled_at: string | null;
  readonly forum: string | null;
  readonly venue: string | null;
  readonly virtual_link_ref: string | null;
  readonly presiding_ref: string | null;
  readonly panel_members: string | null;
  readonly attendance_requirements: string | null;
  readonly purpose: string | null;
  readonly status: string;
  readonly outcome: string | null;
  readonly directions: string | null;
  readonly next_action: string | null;
  readonly next_at: string | null;
  readonly adjournment_reason: string | null;
  readonly confidentiality: string;
  readonly version: number;
}

export interface ProceedingRecordRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly proceeding_id: string;
  readonly appearance_id: string | null;
  readonly attendance: string | null;
  readonly submissions_summary: string | null;
  readonly evidence_taken: string | null;
  readonly applications_made: string | null;
  readonly objections: string | null;
  readonly directions: string | null;
  readonly orders_summary: string | null;
  readonly adjournment: string | null;
  readonly next_at: string | null;
  readonly legal_officer: string | null;
  readonly counsel_report_ref: string | null;
  readonly document_ref: string | null;
  readonly privileged: boolean;
  readonly confidentiality: string;
  readonly approval_status: string;
}

export interface WitnessRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly proceeding_id: string;
  readonly witness_ref: string | null;
  readonly witness_type: string;
  readonly role: string | null;
  readonly relevance: string | null;
  readonly statement_document_ref: string | null;
  readonly availability: string | null;
  readonly contact_ref: string | null;
  readonly attendance_status: string | null;
  readonly summons_status: string | null;
  readonly preparation_status: string | null;
  readonly examination_status: string | null;
  readonly protection_flag: boolean;
  readonly assigned_counsel_ref: string | null;
  readonly confidentiality: string;
  readonly privileged: boolean;
  readonly version: number;
}

export interface ExpertRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly proceeding_id: string;
  readonly expert_ref: string | null;
  readonly expertise: string | null;
  readonly engagement_reference: string | null;
  readonly instruction_scope: string | null;
  readonly report_document_ref: string | null;
  readonly report_due_date: string | null;
  readonly report_status: string | null;
  readonly attendance_status: string | null;
  readonly cost_reference: string | null;
  readonly internal_owner: string | null;
  readonly confidentiality: string;
  readonly privileged: boolean;
  readonly version: number;
}

export interface ExhibitRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly proceeding_id: string;
  readonly exhibit_number: string | null;
  readonly description: string | null;
  readonly source: string | null;
  readonly related_witness: string | null;
  readonly document_ref: string | null;
  readonly evidence_ref: string | null;
  readonly marked_status: string | null;
  readonly admitted_status: string;
  readonly admission_date: string | null;
  readonly chain_of_custody_ref: string | null;
  readonly confidentiality: string;
  readonly privileged: boolean;
  readonly version: number;
}

export interface BundleRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly proceeding_id: string;
  readonly bundle_type: string | null;
  readonly title: string | null;
  readonly bundle_version: number;
  readonly index_document_ref: string | null;
  readonly compilation_status: string;
  readonly review_status: string | null;
  readonly approval_status: string;
  readonly filing_status: string | null;
  readonly service_status: string | null;
  readonly appearance_ref: string | null;
  readonly prepared_by: string | null;
  readonly reviewed_by: string | null;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly privileged: boolean;
  readonly confidentiality: string;
  readonly version: number;
}

export interface BundleItemRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly bundle_id: string;
  readonly document_ref: string | null;
  readonly tab: string | null;
  readonly page_from: number | null;
  readonly page_to: number | null;
  readonly description: string | null;
  readonly sort_order: number;
}

export interface OrderRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly proceeding_id: string;
  readonly order_type: string;
  readonly order_date: string | null;
  readonly issuing_forum: string | null;
  readonly presiding_ref: string | null;
  readonly summary: string | null;
  readonly operative_terms: string | null;
  readonly affected_parties: string | null;
  readonly effective_date: string | null;
  readonly expiry_date: string | null;
  readonly compliance_deadline: string | null;
  readonly appeal_status: string | null;
  readonly document_ref: string | null;
  readonly status: string;
  readonly privileged: boolean;
  readonly confidentiality: string;
}

export interface ComplianceRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly proceeding_id: string;
  readonly order_id: string | null;
  readonly obligation: string | null;
  readonly responsible_ref: string | null;
  readonly affected_party: string | null;
  readonly due_date: string | null;
  readonly status: string;
  readonly evidence_reference: string | null;
  readonly completion_date: string | null;
  readonly breach_date: string | null;
  readonly extension_to: string | null;
  readonly waiver: string | null;
  readonly outcome: string | null;
  readonly version: number;
}

export interface OutcomeRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly proceeding_id: string;
  readonly outcome_type: string;
  readonly outcome_date: string | null;
  readonly forum: string | null;
  readonly presiding_ref: string | null;
  readonly summary: string | null;
  readonly disposition: string | null;
  readonly amount_awarded_minor: string | null;
  readonly currency: string | null;
  readonly costs_awarded_minor: string | null;
  readonly orders_summary: string | null;
  readonly appealable: boolean;
  readonly appeal_deadline: string | null;
  readonly document_ref: string | null;
  readonly status: string;
  readonly privileged: boolean;
  readonly confidentiality: string;
}

export interface AppealRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly proceeding_id: string;
  readonly appeal_type: string | null;
  readonly forum: string | null;
  readonly approval_status: string;
  readonly approved_by: string | null;
  readonly deadline: string | null;
  readonly filing_status: string | null;
  readonly appeal_number: string | null;
  readonly grounds_summary: string | null;
  readonly counsel_ref: string | null;
  readonly record_reference: string | null;
  readonly status: string;
  readonly outcome: string | null;
  readonly linked_proceeding_id: string | null;
  readonly source_matter_id: string | null;
  readonly confidentiality: string;
  readonly version: number;
}

export interface DeadlineRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly proceeding_id: string;
  readonly deadline_type: string;
  readonly source: string | null;
  readonly authority: string | null;
  readonly start_at: string | null;
  readonly due_at: string;
  readonly rule: unknown;
  readonly business_calendar_ref: string | null;
  readonly warn_window_ms: string | null;
  readonly status: string;
  readonly waived: boolean;
  readonly completed_at: string | null;
  readonly version: number;
}

export interface CostRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly proceeding_id: string;
  readonly cost_type: string | null;
  readonly description: string | null;
  readonly amount_minor: string | null;
  readonly currency: string | null;
  readonly incurred_date: string | null;
  readonly counsel_reference: string | null;
  readonly invoice_reference: string | null;
  readonly approval_status: string;
  readonly payment_reference: string | null;
  readonly recoverable: boolean;
  readonly taxed: boolean;
  readonly version: number;
}

export interface NoteRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly proceeding_id: string;
  readonly note_type: string;
  readonly headline: string | null;
  readonly content: string;
  readonly related_appearance: string | null;
  readonly confidentiality: string;
  readonly privileged: boolean;
}

export interface RelationshipRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly from_proceeding_id: string;
  readonly to_proceeding_id: string;
  readonly kind: string;
  readonly status: string;
  readonly version: number;
}

const SPEC_COLS = 'tenant_id, id, code, version_number, name, scope, status, spec, content_hash, version';
const PROC_COLS =
  'tenant_id, id, proceeding_number, proceeding_type_code, proceeding_type_version, source, source_matter_id, ' +
  'source_reference, originating_module, title, summary, description, jurisdiction, forum, forum_type, court, ' +
  'station, division, external_case_number, organization_role, claim_amount_minor, currency, confidentiality, ' +
  'privileged, litigation_risk, priority, legal_owner, litigation_team, business_owner, external_counsel_ref, ' +
  'workflow_instance_ref, sla_policy_code, escalation_ref, status, procedural_stage, legal_hold, ' +
  'matter_update_emitted, limitation_at, appeal_status, enforcement_referral_ready, final_outcome, ' +
  'residual_obligations, filed_at, served_at, commenced_at, concluded_at, closed_at, reopened_at, archived_at, ' +
  'correlation_id, causation_id, idempotency_key, version';
const REFERRAL_COLS =
  'tenant_id, id, referral_key, source_matter_id, proceeding_id, proceeding_type_code, safe_metadata';
const PARTY_COLS =
  'tenant_id, id, proceeding_id, party_role, entity_ref, display_label, representation_ref, advocate_ref, ' +
  'law_firm_ref, lead_counsel_ref, service_address_ref, service_status, authority, contact_ref, confidentiality, ' +
  'active, version';
const CLAIM_COLS =
  'tenant_id, id, proceeding_id, claim_type, statement, cause_reference, relief_sought, amount_minor, currency, ' +
  'non_monetary_relief, counterclaim, defence, admission_status, risk, status, outcome, confidentiality, version';
const FILING_COLS =
  'tenant_id, id, proceeding_id, filing_role, document_ref, document_version, filing_status, filed_date, filed_by, ' +
  'prepared_by, approved_by, approved_at, receiving_registry, filing_reference, court_stamp_reference, ' +
  'rejection_reason, privileged, confidentiality, version';
const SERVICE_COLS =
  'tenant_id, id, proceeding_id, item_served, party_ref, service_method, service_date, location_reference, ' +
  'served_by, recipient, acknowledgment, certificate_document_ref, deemed_basis, service_status, failure_reason, ' +
  'next_attempt_at, verification_status, verified_by, verified_at, confidentiality, version';
const APPEARANCE_COLS =
  'tenant_id, id, proceeding_id, appearance_type, scheduled_at, forum, venue, virtual_link_ref, presiding_ref, ' +
  'panel_members, attendance_requirements, purpose, status, outcome, directions, next_action, next_at, ' +
  'adjournment_reason, confidentiality, version';
const RECORD_COLS =
  'tenant_id, id, proceeding_id, appearance_id, attendance, submissions_summary, evidence_taken, applications_made, ' +
  'objections, directions, orders_summary, adjournment, next_at, legal_officer, counsel_report_ref, document_ref, ' +
  'privileged, confidentiality, approval_status';
const WITNESS_COLS =
  'tenant_id, id, proceeding_id, witness_ref, witness_type, role, relevance, statement_document_ref, availability, ' +
  'contact_ref, attendance_status, summons_status, preparation_status, examination_status, protection_flag, ' +
  'assigned_counsel_ref, confidentiality, privileged, version';
const EXPERT_COLS =
  'tenant_id, id, proceeding_id, expert_ref, expertise, engagement_reference, instruction_scope, ' +
  'report_document_ref, report_due_date, report_status, attendance_status, cost_reference, internal_owner, ' +
  'confidentiality, privileged, version';
const EXHIBIT_COLS =
  'tenant_id, id, proceeding_id, exhibit_number, description, source, related_witness, document_ref, evidence_ref, ' +
  'marked_status, admitted_status, admission_date, chain_of_custody_ref, confidentiality, privileged, version';
const BUNDLE_COLS =
  'tenant_id, id, proceeding_id, bundle_type, title, bundle_version, index_document_ref, compilation_status, ' +
  'review_status, approval_status, filing_status, service_status, appearance_ref, prepared_by, reviewed_by, ' +
  'approved_by, approved_at, privileged, confidentiality, version';
const BUNDLE_ITEM_COLS =
  'tenant_id, id, bundle_id, document_ref, tab, page_from, page_to, description, sort_order';
const ORDER_COLS =
  'tenant_id, id, proceeding_id, order_type, order_date, issuing_forum, presiding_ref, summary, operative_terms, ' +
  'affected_parties, effective_date, expiry_date, compliance_deadline, appeal_status, document_ref, status, ' +
  'privileged, confidentiality';
const COMPLIANCE_COLS =
  'tenant_id, id, proceeding_id, order_id, obligation, responsible_ref, affected_party, due_date, status, ' +
  'evidence_reference, completion_date, breach_date, extension_to, waiver, outcome, version';
const OUTCOME_COLS =
  'tenant_id, id, proceeding_id, outcome_type, outcome_date, forum, presiding_ref, summary, disposition, ' +
  'amount_awarded_minor, currency, costs_awarded_minor, orders_summary, appealable, appeal_deadline, document_ref, ' +
  'status, privileged, confidentiality';
const APPEAL_COLS =
  'tenant_id, id, proceeding_id, appeal_type, forum, approval_status, approved_by, deadline, filing_status, ' +
  'appeal_number, grounds_summary, counsel_ref, record_reference, status, outcome, linked_proceeding_id, ' +
  'source_matter_id, confidentiality, version';
const DEADLINE_COLS =
  'tenant_id, id, proceeding_id, deadline_type, source, authority, start_at, due_at, rule, business_calendar_ref, ' +
  'warn_window_ms, status, waived, completed_at, version';
const COST_COLS =
  'tenant_id, id, proceeding_id, cost_type, description, amount_minor, currency, incurred_date, counsel_reference, ' +
  'invoice_reference, approval_status, payment_reference, recoverable, taxed, version';
const NOTE_COLS =
  'tenant_id, id, proceeding_id, note_type, headline, content, related_appearance, confidentiality, privileged';
const REL_COLS = 'tenant_id, id, from_proceeding_id, to_proceeding_id, kind, status, version';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m16 repository: expected a row from ${what}`);
  return row;
}
function count(rows: { c: string }[]): number {
  return Number(rows[0]?.c ?? '0');
}

export class LitigationRepository {
  // --- specs (proceeding_type + sla_policy) -----------------------------------------------------
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
  insertProceedingType(
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
    return this.insertSpec(tx, 'litigation_proceeding_type', i);
  }
  nextProceedingTypeVersion(tx: Tx, code: string, scope: string) {
    return this.nextSpecVersion(tx, 'litigation_proceeding_type', code, scope);
  }
  findProceedingType(tx: Tx, id: string) {
    return this.findSpec(tx, 'litigation_proceeding_type', id);
  }
  findActiveProceedingType(tx: Tx, code: string) {
    return this.findActiveSpec(tx, 'litigation_proceeding_type', code);
  }
  updateProceedingTypeStatus(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      contentHash: string | null;
      publishedBy: string | null;
    },
  ) {
    return this.updateSpecStatus(tx, 'litigation_proceeding_type', i);
  }
  retireActiveProceedingTypes(tx: Tx, code: string, scope: string, exceptId: string) {
    return this.retireActiveSpec(tx, 'litigation_proceeding_type', code, scope, exceptId);
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
    return this.insertSpec(tx, 'litigation_sla_policy', i);
  }
  nextSlaPolicyVersion(tx: Tx, code: string, scope: string) {
    return this.nextSpecVersion(tx, 'litigation_sla_policy', code, scope);
  }
  findSlaPolicy(tx: Tx, id: string) {
    return this.findSpec(tx, 'litigation_sla_policy', id);
  }
  findActiveSlaPolicy(tx: Tx, code: string) {
    return this.findActiveSpec(tx, 'litigation_sla_policy', code);
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
    return this.updateSpecStatus(tx, 'litigation_sla_policy', i);
  }
  retireActiveSlaPolicies(tx: Tx, code: string, scope: string, exceptId: string) {
    return this.retireActiveSpec(tx, 'litigation_sla_policy', code, scope, exceptId);
  }

  // --- proceeding record ------------------------------------------------------------------------
  async insertProceeding(
    tx: Tx,
    i: {
      tenantId: string;
      proceedingNumber: string;
      proceedingTypeCode: string;
      proceedingTypeVersion: number | null;
      source: string;
      sourceMatterId: string | null;
      originatingModule: string | null;
      title: string;
      summary: string | null;
      description: string | null;
      jurisdiction: string | null;
      forum: string | null;
      forumType: string | null;
      court: string | null;
      station: string | null;
      division: string | null;
      externalCaseNumber: string | null;
      organizationRole: string | null;
      claimAmountMinor: number | null;
      currency: string | null;
      confidentiality: string;
      privileged: boolean;
      litigationRisk: string | null;
      priority: string;
      slaPolicyCode: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      causationId: string | null;
      by: string | null;
    },
  ): Promise<ProceedingRow> {
    const r = await tx.query<ProceedingRow>(
      `INSERT INTO litigation_proceeding (tenant_id, proceeding_number, proceeding_type_code, proceeding_type_version, source, source_matter_id, originating_module, title, summary, description, jurisdiction, forum, forum_type, court, station, division, external_case_number, organization_role, claim_amount_minor, currency, confidentiality, privileged, litigation_risk, priority, sla_policy_code, idempotency_key, correlation_id, causation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$29) RETURNING ${PROC_COLS}`,
      [
        i.tenantId,
        i.proceedingNumber,
        i.proceedingTypeCode,
        i.proceedingTypeVersion,
        i.source,
        i.sourceMatterId,
        i.originatingModule,
        i.title,
        i.summary,
        i.description,
        i.jurisdiction,
        i.forum,
        i.forumType,
        i.court,
        i.station,
        i.division,
        i.externalCaseNumber,
        i.organizationRole,
        i.claimAmountMinor,
        i.currency,
        i.confidentiality,
        i.privileged,
        i.litigationRisk,
        i.priority,
        i.slaPolicyCode,
        i.idempotencyKey,
        i.correlationId,
        i.causationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert proceeding');
  }
  async findProceeding(tx: Tx, id: string): Promise<ProceedingRow | null> {
    const r = await tx.query<ProceedingRow>(`SELECT ${PROC_COLS} FROM litigation_proceeding WHERE id=$1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }
  async findProceedingByIdempotencyKey(tx: Tx, key: string): Promise<ProceedingRow | null> {
    const r = await tx.query<ProceedingRow>(
      `SELECT ${PROC_COLS} FROM litigation_proceeding WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async updateProceedingStatus(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      by: string | null;
      stamp?: 'filed' | 'served' | 'commenced' | 'concluded' | 'closed' | 'reopened' | 'archived' | null;
    },
  ): Promise<ProceedingRow | null> {
    const stampCol =
      i.stamp === 'filed'
        ? ', filed_at=now()'
        : i.stamp === 'served'
          ? ', served_at=now()'
          : i.stamp === 'commenced'
            ? ', commenced_at=COALESCE(commenced_at, now())'
            : i.stamp === 'concluded'
              ? ', concluded_at=now()'
              : i.stamp === 'closed'
                ? ', closed_at=now()'
                : i.stamp === 'reopened'
                  ? ', reopened_at=now()'
                  : i.stamp === 'archived'
                    ? ', archived_at=now()'
                    : '';
    const r = await tx.query<ProceedingRow>(
      `UPDATE litigation_proceeding SET status=$3, updated_by=$4, updated_at=now(), version=version+1${stampCol} WHERE id=$1 AND version=$2 RETURNING ${PROC_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async patchProceeding(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      litigationRisk?: string | null;
      priority?: string | null;
      confidentiality?: string | null;
      privileged?: boolean | null;
      proceduralStage?: string | null;
      slaPolicyCode?: string | null;
      escalationRef?: string | null;
      legalOwner?: string | null;
      litigationTeam?: string | null;
      businessOwner?: string | null;
      workflowInstanceRef?: string | null;
      jurisdiction?: string | null;
      forum?: string | null;
      forumType?: string | null;
      court?: string | null;
      station?: string | null;
      division?: string | null;
      externalCaseNumber?: string | null;
      organizationRole?: string | null;
      claimAmountMinor?: number | null;
      currency?: string | null;
      legalHold?: boolean | null;
      matterUpdateEmitted?: boolean | null;
      limitationAt?: string | null;
      appealStatus?: string | null;
      enforcementReferralReady?: boolean | null;
      finalOutcome?: string | null;
      residualObligations?: string | null;
      summary?: string | null;
      description?: string | null;
      by: string | null;
    },
  ): Promise<ProceedingRow | null> {
    const r = await tx.query<ProceedingRow>(
      `UPDATE litigation_proceeding SET
         litigation_risk=COALESCE($3,litigation_risk), priority=COALESCE($4,priority), confidentiality=COALESCE($5,confidentiality),
         privileged=COALESCE($6,privileged), procedural_stage=COALESCE($7,procedural_stage), sla_policy_code=COALESCE($8,sla_policy_code),
         escalation_ref=COALESCE($9,escalation_ref), legal_owner=COALESCE($10,legal_owner), litigation_team=COALESCE($11,litigation_team),
         business_owner=COALESCE($12,business_owner), workflow_instance_ref=COALESCE($13,workflow_instance_ref),
         jurisdiction=COALESCE($14,jurisdiction), forum=COALESCE($15,forum), forum_type=COALESCE($16,forum_type),
         court=COALESCE($17,court), station=COALESCE($18,station), division=COALESCE($19,division),
         external_case_number=COALESCE($20,external_case_number), organization_role=COALESCE($21,organization_role),
         claim_amount_minor=COALESCE($22,claim_amount_minor), currency=COALESCE($23,currency), legal_hold=COALESCE($24,legal_hold),
         matter_update_emitted=COALESCE($25,matter_update_emitted), limitation_at=COALESCE($26,limitation_at),
         appeal_status=COALESCE($27,appeal_status), enforcement_referral_ready=COALESCE($28,enforcement_referral_ready),
         final_outcome=COALESCE($29,final_outcome), residual_obligations=COALESCE($30,residual_obligations),
         summary=COALESCE($31,summary), description=COALESCE($32,description),
         updated_by=$33, updated_at=now(), version=version+1
       WHERE id=$1 AND version=$2 RETURNING ${PROC_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.litigationRisk ?? null,
        i.priority ?? null,
        i.confidentiality ?? null,
        i.privileged ?? null,
        i.proceduralStage ?? null,
        i.slaPolicyCode ?? null,
        i.escalationRef ?? null,
        i.legalOwner ?? null,
        i.litigationTeam ?? null,
        i.businessOwner ?? null,
        i.workflowInstanceRef ?? null,
        i.jurisdiction ?? null,
        i.forum ?? null,
        i.forumType ?? null,
        i.court ?? null,
        i.station ?? null,
        i.division ?? null,
        i.externalCaseNumber ?? null,
        i.organizationRole ?? null,
        i.claimAmountMinor ?? null,
        i.currency ?? null,
        i.legalHold ?? null,
        i.matterUpdateEmitted ?? null,
        i.limitationAt ?? null,
        i.appealStatus ?? null,
        i.enforcementReferralReady ?? null,
        i.finalOutcome ?? null,
        i.residualObligations ?? null,
        i.summary ?? null,
        i.description ?? null,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async assignProceeding(
    tx: Tx,
    i: { id: string; expectedVersion: number; owner: string; toStatus: string; by: string | null },
  ): Promise<ProceedingRow | null> {
    const r = await tx.query<ProceedingRow>(
      `UPDATE litigation_proceeding SET legal_owner=$3, status=$4, updated_by=$5, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${PROC_COLS}`,
      [i.id, i.expectedVersion, i.owner, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async searchProceedings(
    tx: Tx,
    f: {
      proceedingTypeCode?: string;
      status?: string;
      litigationRisk?: string;
      priority?: string;
      jurisdiction?: string;
      forum?: string;
      owner?: string;
      limit: number;
      offset: number;
    },
  ): Promise<ProceedingRow[]> {
    const r = await tx.query<ProceedingRow>(
      `SELECT ${PROC_COLS} FROM litigation_proceeding WHERE ($1::text IS NULL OR proceeding_type_code=$1) AND ($2::text IS NULL OR status=$2) AND ($3::text IS NULL OR litigation_risk=$3) AND ($4::text IS NULL OR priority=$4) AND ($5::text IS NULL OR jurisdiction=$5) AND ($6::text IS NULL OR forum=$6) AND ($7::uuid IS NULL OR legal_owner=$7) ORDER BY created_at DESC LIMIT $8 OFFSET $9`,
      [
        f.proceedingTypeCode ?? null,
        f.status ?? null,
        f.litigationRisk ?? null,
        f.priority ?? null,
        f.jurisdiction ?? null,
        f.forum ?? null,
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
        proceeding_type: 'proceeding_type_code',
        source: 'source',
        jurisdiction: 'jurisdiction',
        forum: 'forum',
        forum_type: 'forum_type',
        organization_role: 'organization_role',
        litigation_risk: 'litigation_risk',
        priority: 'priority',
        status: 'status',
        confidentiality: 'confidentiality',
      }[dimension] ?? 'status';
    const r = await tx.query<{ dim: string | null; count: string }>(
      `SELECT ${col} AS dim, count(*)::text AS count FROM litigation_proceeding GROUP BY ${col} ORDER BY count DESC`,
    );
    return r.rows;
  }

  // --- referral ledger (idempotent, append-only) ------------------------------------------------
  async insertReferral(
    tx: Tx,
    i: {
      tenantId: string;
      referralKey: string;
      sourceMatterId: string;
      proceedingId: string;
      proceedingTypeCode: string | null;
      safeMetadata: unknown;
      correlationId: string;
      causationId: string | null;
      by: string | null;
    },
  ): Promise<ReferralRow> {
    const r = await tx.query<ReferralRow>(
      `INSERT INTO litigation_referral (tenant_id, referral_key, source_matter_id, proceeding_id, proceeding_type_code, safe_metadata, correlation_id, causation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) RETURNING ${REFERRAL_COLS}`,
      [
        i.tenantId,
        i.referralKey,
        i.sourceMatterId,
        i.proceedingId,
        i.proceedingTypeCode,
        JSON.stringify(i.safeMetadata ?? {}),
        i.correlationId,
        i.causationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert referral');
  }
  async findReferral(tx: Tx, referralKey: string): Promise<ReferralRow | null> {
    const r = await tx.query<ReferralRow>(
      `SELECT ${REFERRAL_COLS} FROM litigation_referral WHERE referral_key=$1`,
      [referralKey],
    );
    return r.rows[0] ?? null;
  }

  // --- histories (append-only) ------------------------------------------------------------------
  async insertStatusHistory(
    tx: Tx,
    i: {
      tenantId: string;
      proceedingId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO litigation_status_history (tenant_id, proceeding_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.proceedingId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }
  async insertAssignmentHistory(
    tx: Tx,
    i: {
      tenantId: string;
      proceedingId: string;
      kind: string;
      ref: string | null;
      reason: string | null;
      ruleEvalId: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO litigation_assignment_history (tenant_id, proceeding_id, kind, ref, reason, rule_evaluation_id, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.proceedingId, i.kind, i.ref, i.reason, i.ruleEvalId, i.by, i.correlationId],
    );
  }

  // --- parties ----------------------------------------------------------------------------------
  async insertParty(
    tx: Tx,
    i: {
      tenantId: string;
      proceedingId: string;
      partyRole: string;
      entityRef: string | null;
      displayLabel: string | null;
      representationRef: string | null;
      advocateRef: string | null;
      lawFirmRef: string | null;
      leadCounselRef: string | null;
      serviceAddressRef: string | null;
      authority: string | null;
      contactRef: string | null;
      confidentiality: string;
      by: string | null;
    },
  ): Promise<PartyRow> {
    const r = await tx.query<PartyRow>(
      `INSERT INTO litigation_party (tenant_id, proceeding_id, party_role, entity_ref, display_label, representation_ref, advocate_ref, law_firm_ref, lead_counsel_ref, service_address_ref, authority, contact_ref, confidentiality, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING ${PARTY_COLS}`,
      [
        i.tenantId,
        i.proceedingId,
        i.partyRole,
        i.entityRef,
        i.displayLabel,
        i.representationRef,
        i.advocateRef,
        i.lawFirmRef,
        i.leadCounselRef,
        i.serviceAddressRef,
        i.authority,
        i.contactRef,
        i.confidentiality,
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
      `UPDATE litigation_party SET active=false, active_to=now(), updated_by=$3, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND active=true RETURNING ${PARTY_COLS}`,
      [i.id, i.expectedVersion, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listParties(tx: Tx, proceedingId: string): Promise<PartyRow[]> {
    const r = await tx.query<PartyRow>(
      `SELECT ${PARTY_COLS} FROM litigation_party WHERE proceeding_id=$1 ORDER BY created_at`,
      [proceedingId],
    );
    return r.rows;
  }

  // --- claims -----------------------------------------------------------------------------------
  async insertClaim(
    tx: Tx,
    i: {
      tenantId: string;
      proceedingId: string;
      claimType: string;
      statement: string | null;
      causeReference: string | null;
      reliefSought: string | null;
      amountMinor: number | null;
      currency: string | null;
      nonMonetaryRelief: string | null;
      counterclaim: boolean;
      defence: string | null;
      risk: string | null;
      confidentiality: string;
      by: string | null;
    },
  ): Promise<ClaimRow> {
    const r = await tx.query<ClaimRow>(
      `INSERT INTO litigation_claim (tenant_id, proceeding_id, claim_type, statement, cause_reference, relief_sought, amount_minor, currency, non_monetary_relief, counterclaim, defence, risk, confidentiality, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING ${CLAIM_COLS}`,
      [
        i.tenantId,
        i.proceedingId,
        i.claimType,
        i.statement,
        i.causeReference,
        i.reliefSought,
        i.amountMinor,
        i.currency,
        i.nonMonetaryRelief,
        i.counterclaim,
        i.defence,
        i.risk,
        i.confidentiality,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert claim');
  }
  async patchClaim(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      admissionStatus: string | null;
      outcome: string | null;
      status: string | null;
      defence: string | null;
      by: string | null;
    },
  ): Promise<ClaimRow | null> {
    const r = await tx.query<ClaimRow>(
      `UPDATE litigation_claim SET admission_status=COALESCE($3,admission_status), outcome=COALESCE($4,outcome), status=COALESCE($5,status), defence=COALESCE($6,defence), updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${CLAIM_COLS}`,
      [i.id, i.expectedVersion, i.admissionStatus, i.outcome, i.status, i.defence, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listClaims(tx: Tx, proceedingId: string): Promise<ClaimRow[]> {
    const r = await tx.query<ClaimRow>(
      `SELECT ${CLAIM_COLS} FROM litigation_claim WHERE proceeding_id=$1 ORDER BY created_at`,
      [proceedingId],
    );
    return r.rows;
  }

  // --- filings (maker-checker) ------------------------------------------------------------------
  async insertFiling(
    tx: Tx,
    i: {
      tenantId: string;
      proceedingId: string;
      filingRole: string;
      documentRef: string | null;
      documentVersion: number | null;
      preparedBy: string | null;
      receivingRegistry: string | null;
      filingReference: string | null;
      privileged: boolean;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<FilingRow> {
    const r = await tx.query<FilingRow>(
      `INSERT INTO litigation_filing (tenant_id, proceeding_id, filing_role, document_ref, document_version, prepared_by, receiving_registry, filing_reference, privileged, confidentiality, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING ${FILING_COLS}`,
      [
        i.tenantId,
        i.proceedingId,
        i.filingRole,
        i.documentRef,
        i.documentVersion,
        i.preparedBy,
        i.receivingRegistry,
        i.filingReference,
        i.privileged,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert filing');
  }
  async findFiling(tx: Tx, id: string): Promise<FilingRow | null> {
    const r = await tx.query<FilingRow>(`SELECT ${FILING_COLS} FROM litigation_filing WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async reviewFiling(
    tx: Tx,
    i: { id: string; expectedVersion: number; by: string | null },
  ): Promise<FilingRow | null> {
    const r = await tx.query<FilingRow>(
      `UPDATE litigation_filing SET filing_status='review', updated_by=$3, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND filing_status IN ('draft','review') RETURNING ${FILING_COLS}`,
      [i.id, i.expectedVersion, i.by],
    );
    return r.rows[0] ?? null;
  }
  async approveFiling(
    tx: Tx,
    i: { id: string; expectedVersion: number; approvedBy: string | null },
  ): Promise<FilingRow | null> {
    const r = await tx.query<FilingRow>(
      `UPDATE litigation_filing SET filing_status='approved', approved_by=$3, approved_at=now(), updated_by=$3, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND filing_status IN ('draft','review') RETURNING ${FILING_COLS}`,
      [i.id, i.expectedVersion, i.approvedBy],
    );
    return r.rows[0] ?? null;
  }
  async fileFiling(
    tx: Tx,
    i: { id: string; expectedVersion: number; courtStampReference: string | null; by: string | null },
  ): Promise<FilingRow | null> {
    const r = await tx.query<FilingRow>(
      `UPDATE litigation_filing SET filing_status='filed', filed_date=current_date, filed_by=$4, court_stamp_reference=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND filing_status IN ('approved','ready') RETURNING ${FILING_COLS}`,
      [i.id, i.expectedVersion, i.courtStampReference, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listFilings(tx: Tx, proceedingId: string): Promise<FilingRow[]> {
    const r = await tx.query<FilingRow>(
      `SELECT ${FILING_COLS} FROM litigation_filing WHERE proceeding_id=$1 ORDER BY created_at`,
      [proceedingId],
    );
    return r.rows;
  }
  async countOpenFilings(tx: Tx, proceedingId: string): Promise<number> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM litigation_filing WHERE proceeding_id=$1 AND filing_status IN ('draft','review','approved','ready')`,
      [proceedingId],
    );
    return count(r.rows);
  }

  // --- service (single-winner verify) -----------------------------------------------------------
  async insertService(
    tx: Tx,
    i: {
      tenantId: string;
      proceedingId: string;
      itemServed: string | null;
      partyRef: string | null;
      serviceMethod: string | null;
      serviceDate: string | null;
      locationReference: string | null;
      servedBy: string | null;
      recipient: string | null;
      serviceStatus: string;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ServiceRow> {
    const r = await tx.query<ServiceRow>(
      `INSERT INTO litigation_service (tenant_id, proceeding_id, item_served, party_ref, service_method, service_date, location_reference, served_by, recipient, service_status, confidentiality, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING ${SERVICE_COLS}`,
      [
        i.tenantId,
        i.proceedingId,
        i.itemServed,
        i.partyRef,
        i.serviceMethod,
        i.serviceDate,
        i.locationReference,
        i.servedBy,
        i.recipient,
        i.serviceStatus,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert service');
  }
  /** Single-winner verification: compare-and-set on verification_status='unverified'. */
  async verifyService(
    tx: Tx,
    i: { id: string; decision: 'verified' | 'rejected'; by: string | null },
  ): Promise<ServiceRow | null> {
    const r = await tx.query<ServiceRow>(
      `UPDATE litigation_service SET verification_status=$2, verified_by=$3, verified_at=now(), updated_by=$3, updated_at=now(), version=version+1 WHERE id=$1 AND verification_status='unverified' RETURNING ${SERVICE_COLS}`,
      [i.id, i.decision, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listServices(tx: Tx, proceedingId: string): Promise<ServiceRow[]> {
    const r = await tx.query<ServiceRow>(
      `SELECT ${SERVICE_COLS} FROM litigation_service WHERE proceeding_id=$1 ORDER BY created_at`,
      [proceedingId],
    );
    return r.rows;
  }
  /** Service is complete when no attempt is still pending/attempted/failed. */
  async serviceCompleted(tx: Tx, proceedingId: string): Promise<boolean> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM litigation_service WHERE proceeding_id=$1 AND service_status IN ('pending','attempted','failed')`,
      [proceedingId],
    );
    return count(r.rows) === 0;
  }

  // --- appearances ------------------------------------------------------------------------------
  async insertAppearance(
    tx: Tx,
    i: {
      tenantId: string;
      proceedingId: string;
      appearanceType: string;
      scheduledAt: string | null;
      forum: string | null;
      venue: string | null;
      presidingRef: string | null;
      purpose: string | null;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<AppearanceRow> {
    const r = await tx.query<AppearanceRow>(
      `INSERT INTO litigation_appearance (tenant_id, proceeding_id, appearance_type, scheduled_at, forum, venue, presiding_ref, purpose, confidentiality, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING ${APPEARANCE_COLS}`,
      [
        i.tenantId,
        i.proceedingId,
        i.appearanceType,
        i.scheduledAt,
        i.forum,
        i.venue,
        i.presidingRef,
        i.purpose,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert appearance');
  }
  async updateAppearance(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      scheduledAt: string | null;
      forum: string | null;
      venue: string | null;
      presidingRef: string | null;
      purpose: string | null;
      by: string | null;
    },
  ): Promise<AppearanceRow | null> {
    const r = await tx.query<AppearanceRow>(
      `UPDATE litigation_appearance SET scheduled_at=COALESCE($3,scheduled_at), forum=COALESCE($4,forum), venue=COALESCE($5,venue), presiding_ref=COALESCE($6,presiding_ref), purpose=COALESCE($7,purpose), updated_by=$8, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status='scheduled' RETURNING ${APPEARANCE_COLS}`,
      [i.id, i.expectedVersion, i.scheduledAt, i.forum, i.venue, i.presidingRef, i.purpose, i.by],
    );
    return r.rows[0] ?? null;
  }
  async completeAppearance(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      outcome: string | null;
      directions: string | null;
      nextAction: string | null;
      nextAt: string | null;
      by: string | null;
    },
  ): Promise<AppearanceRow | null> {
    const r = await tx.query<AppearanceRow>(
      `UPDATE litigation_appearance SET status='completed', outcome=$3, directions=$4, next_action=$5, next_at=$6, updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status IN ('scheduled','adjourned') RETURNING ${APPEARANCE_COLS}`,
      [i.id, i.expectedVersion, i.outcome, i.directions, i.nextAction, i.nextAt, i.by],
    );
    return r.rows[0] ?? null;
  }
  async adjournAppearance(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      reason: string | null;
      nextAt: string | null;
      by: string | null;
    },
  ): Promise<AppearanceRow | null> {
    const r = await tx.query<AppearanceRow>(
      `UPDATE litigation_appearance SET status='adjourned', adjournment_reason=$3, next_at=$4, updated_by=$5, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status IN ('scheduled','adjourned') RETURNING ${APPEARANCE_COLS}`,
      [i.id, i.expectedVersion, i.reason, i.nextAt, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listAppearances(tx: Tx, proceedingId: string): Promise<AppearanceRow[]> {
    const r = await tx.query<AppearanceRow>(
      `SELECT ${APPEARANCE_COLS} FROM litigation_appearance WHERE proceeding_id=$1 ORDER BY scheduled_at NULLS LAST`,
      [proceedingId],
    );
    return r.rows;
  }
  async countOpenAppearances(tx: Tx, proceedingId: string): Promise<number> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM litigation_appearance WHERE proceeding_id=$1 AND status IN ('scheduled','adjourned')`,
      [proceedingId],
    );
    return count(r.rows);
  }
  async countOpenHearings(tx: Tx, proceedingId: string): Promise<number> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM litigation_appearance WHERE proceeding_id=$1 AND appearance_type IN ('hearing','appeal_hearing') AND status IN ('scheduled','adjourned')`,
      [proceedingId],
    );
    return count(r.rows);
  }

  // --- proceeding records (append-only) ---------------------------------------------------------
  async insertRecord(
    tx: Tx,
    i: {
      tenantId: string;
      proceedingId: string;
      appearanceId: string | null;
      attendance: string | null;
      submissionsSummary: string | null;
      evidenceTaken: string | null;
      directions: string | null;
      ordersSummary: string | null;
      nextAt: string | null;
      legalOfficer: string | null;
      documentRef: string | null;
      privileged: boolean;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ProceedingRecordRow> {
    const r = await tx.query<ProceedingRecordRow>(
      `INSERT INTO litigation_proceeding_record (tenant_id, proceeding_id, appearance_id, attendance, submissions_summary, evidence_taken, directions, orders_summary, next_at, legal_officer, document_ref, privileged, confidentiality, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${RECORD_COLS}`,
      [
        i.tenantId,
        i.proceedingId,
        i.appearanceId,
        i.attendance,
        i.submissionsSummary,
        i.evidenceTaken,
        i.directions,
        i.ordersSummary,
        i.nextAt,
        i.legalOfficer,
        i.documentRef,
        i.privileged,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert record');
  }
  async listRecords(tx: Tx, proceedingId: string): Promise<ProceedingRecordRow[]> {
    const r = await tx.query<ProceedingRecordRow>(
      `SELECT ${RECORD_COLS} FROM litigation_proceeding_record WHERE proceeding_id=$1 ORDER BY created_at`,
      [proceedingId],
    );
    return r.rows;
  }

  // --- witnesses --------------------------------------------------------------------------------
  async insertWitness(
    tx: Tx,
    i: {
      tenantId: string;
      proceedingId: string;
      witnessRef: string | null;
      witnessType: string;
      role: string | null;
      relevance: string | null;
      statementDocumentRef: string | null;
      contactRef: string | null;
      protectionFlag: boolean;
      confidentiality: string;
      privileged: boolean;
      by: string | null;
    },
  ): Promise<WitnessRow> {
    const r = await tx.query<WitnessRow>(
      `INSERT INTO litigation_witness (tenant_id, proceeding_id, witness_ref, witness_type, role, relevance, statement_document_ref, contact_ref, protection_flag, confidentiality, privileged, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING ${WITNESS_COLS}`,
      [
        i.tenantId,
        i.proceedingId,
        i.witnessRef,
        i.witnessType,
        i.role,
        i.relevance,
        i.statementDocumentRef,
        i.contactRef,
        i.protectionFlag,
        i.confidentiality,
        i.privileged,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert witness');
  }
  async updateWitness(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      attendanceStatus: string | null;
      summonsStatus: string | null;
      preparationStatus: string | null;
      examinationStatus: string | null;
      statementDocumentRef: string | null;
      by: string | null;
    },
  ): Promise<WitnessRow | null> {
    const r = await tx.query<WitnessRow>(
      `UPDATE litigation_witness SET attendance_status=COALESCE($3,attendance_status), summons_status=COALESCE($4,summons_status), preparation_status=COALESCE($5,preparation_status), examination_status=COALESCE($6,examination_status), statement_document_ref=COALESCE($7,statement_document_ref), updated_by=$8, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${WITNESS_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.attendanceStatus,
        i.summonsStatus,
        i.preparationStatus,
        i.examinationStatus,
        i.statementDocumentRef,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async listWitnesses(tx: Tx, proceedingId: string): Promise<WitnessRow[]> {
    const r = await tx.query<WitnessRow>(
      `SELECT ${WITNESS_COLS} FROM litigation_witness WHERE proceeding_id=$1 ORDER BY created_at`,
      [proceedingId],
    );
    return r.rows;
  }

  // --- experts ----------------------------------------------------------------------------------
  async insertExpert(
    tx: Tx,
    i: {
      tenantId: string;
      proceedingId: string;
      expertRef: string | null;
      expertise: string | null;
      engagementReference: string | null;
      instructionScope: string | null;
      reportDocumentRef: string | null;
      reportDueDate: string | null;
      internalOwner: string | null;
      confidentiality: string;
      privileged: boolean;
      by: string | null;
    },
  ): Promise<ExpertRow> {
    const r = await tx.query<ExpertRow>(
      `INSERT INTO litigation_expert (tenant_id, proceeding_id, expert_ref, expertise, engagement_reference, instruction_scope, report_document_ref, report_due_date, internal_owner, confidentiality, privileged, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING ${EXPERT_COLS}`,
      [
        i.tenantId,
        i.proceedingId,
        i.expertRef,
        i.expertise,
        i.engagementReference,
        i.instructionScope,
        i.reportDocumentRef,
        i.reportDueDate,
        i.internalOwner,
        i.confidentiality,
        i.privileged,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert expert');
  }
  async updateExpert(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      reportStatus: string | null;
      attendanceStatus: string | null;
      reportDocumentRef: string | null;
      by: string | null;
    },
  ): Promise<ExpertRow | null> {
    const r = await tx.query<ExpertRow>(
      `UPDATE litigation_expert SET report_status=COALESCE($3,report_status), attendance_status=COALESCE($4,attendance_status), report_document_ref=COALESCE($5,report_document_ref), updated_by=$6, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${EXPERT_COLS}`,
      [i.id, i.expectedVersion, i.reportStatus, i.attendanceStatus, i.reportDocumentRef, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listExperts(tx: Tx, proceedingId: string): Promise<ExpertRow[]> {
    const r = await tx.query<ExpertRow>(
      `SELECT ${EXPERT_COLS} FROM litigation_expert WHERE proceeding_id=$1 ORDER BY created_at`,
      [proceedingId],
    );
    return r.rows;
  }

  // --- exhibits (single-winner admit) -----------------------------------------------------------
  async insertExhibit(
    tx: Tx,
    i: {
      tenantId: string;
      proceedingId: string;
      exhibitNumber: string | null;
      description: string | null;
      source: string | null;
      relatedWitness: string | null;
      documentRef: string | null;
      evidenceRef: string | null;
      confidentiality: string;
      privileged: boolean;
      by: string | null;
    },
  ): Promise<ExhibitRow> {
    const r = await tx.query<ExhibitRow>(
      `INSERT INTO litigation_exhibit (tenant_id, proceeding_id, exhibit_number, description, source, related_witness, document_ref, evidence_ref, confidentiality, privileged, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING ${EXHIBIT_COLS}`,
      [
        i.tenantId,
        i.proceedingId,
        i.exhibitNumber,
        i.description,
        i.source,
        i.relatedWitness,
        i.documentRef,
        i.evidenceRef,
        i.confidentiality,
        i.privileged,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert exhibit');
  }
  /** Single-winner admission decision: compare-and-set on admitted_status='pending'. */
  async admitExhibit(
    tx: Tx,
    i: { id: string; decision: 'admitted' | 'rejected' | 'marked' | 'withdrawn'; by: string | null },
  ): Promise<ExhibitRow | null> {
    const r = await tx.query<ExhibitRow>(
      `UPDATE litigation_exhibit SET admitted_status=$2, admission_date=CASE WHEN $2='admitted' THEN current_date ELSE admission_date END, updated_by=$3, updated_at=now(), version=version+1 WHERE id=$1 AND admitted_status IN ('pending','marked') RETURNING ${EXHIBIT_COLS}`,
      [i.id, i.decision, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listExhibits(tx: Tx, proceedingId: string): Promise<ExhibitRow[]> {
    const r = await tx.query<ExhibitRow>(
      `SELECT ${EXHIBIT_COLS} FROM litigation_exhibit WHERE proceeding_id=$1 ORDER BY created_at`,
      [proceedingId],
    );
    return r.rows;
  }

  // --- bundles (maker-checker) ------------------------------------------------------------------
  async insertBundle(
    tx: Tx,
    i: {
      tenantId: string;
      proceedingId: string;
      bundleType: string | null;
      title: string | null;
      indexDocumentRef: string | null;
      appearanceRef: string | null;
      preparedBy: string | null;
      privileged: boolean;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<BundleRow> {
    const r = await tx.query<BundleRow>(
      `INSERT INTO litigation_bundle (tenant_id, proceeding_id, bundle_type, title, index_document_ref, appearance_ref, prepared_by, privileged, confidentiality, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING ${BUNDLE_COLS}`,
      [
        i.tenantId,
        i.proceedingId,
        i.bundleType,
        i.title,
        i.indexDocumentRef,
        i.appearanceRef,
        i.preparedBy,
        i.privileged,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert bundle');
  }
  async findBundle(tx: Tx, id: string): Promise<BundleRow | null> {
    const r = await tx.query<BundleRow>(`SELECT ${BUNDLE_COLS} FROM litigation_bundle WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async approveBundle(
    tx: Tx,
    i: { id: string; expectedVersion: number; approvedBy: string | null },
  ): Promise<BundleRow | null> {
    const r = await tx.query<BundleRow>(
      `UPDATE litigation_bundle SET approval_status='approved', approved_by=$3, approved_at=now(), updated_by=$3, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND approval_status IN ('draft','review') RETURNING ${BUNDLE_COLS}`,
      [i.id, i.expectedVersion, i.approvedBy],
    );
    return r.rows[0] ?? null;
  }
  async fileBundle(
    tx: Tx,
    i: { id: string; expectedVersion: number; by: string | null },
  ): Promise<BundleRow | null> {
    const r = await tx.query<BundleRow>(
      `UPDATE litigation_bundle SET filing_status='filed', updated_by=$3, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND approval_status='approved' RETURNING ${BUNDLE_COLS}`,
      [i.id, i.expectedVersion, i.by],
    );
    return r.rows[0] ?? null;
  }
  async insertBundleItem(
    tx: Tx,
    i: {
      tenantId: string;
      bundleId: string;
      documentRef: string | null;
      tab: string | null;
      pageFrom: number | null;
      pageTo: number | null;
      description: string | null;
      sortOrder: number;
      by: string | null;
    },
  ): Promise<BundleItemRow> {
    const r = await tx.query<BundleItemRow>(
      `INSERT INTO litigation_bundle_item (tenant_id, bundle_id, document_ref, tab, page_from, page_to, description, sort_order, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${BUNDLE_ITEM_COLS}`,
      [i.tenantId, i.bundleId, i.documentRef, i.tab, i.pageFrom, i.pageTo, i.description, i.sortOrder, i.by],
    );
    return firstRow(r.rows, 'insert bundle item');
  }
  async listBundles(tx: Tx, proceedingId: string): Promise<BundleRow[]> {
    const r = await tx.query<BundleRow>(
      `SELECT ${BUNDLE_COLS} FROM litigation_bundle WHERE proceeding_id=$1 ORDER BY created_at`,
      [proceedingId],
    );
    return r.rows;
  }

  // --- orders (append-only) ---------------------------------------------------------------------
  async insertOrder(
    tx: Tx,
    i: {
      tenantId: string;
      proceedingId: string;
      orderType: string;
      orderDate: string | null;
      issuingForum: string | null;
      presidingRef: string | null;
      summary: string | null;
      operativeTerms: string | null;
      effectiveDate: string | null;
      expiryDate: string | null;
      documentRef: string | null;
      privileged: boolean;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<OrderRow> {
    const r = await tx.query<OrderRow>(
      `INSERT INTO litigation_order (tenant_id, proceeding_id, order_type, order_date, issuing_forum, presiding_ref, summary, operative_terms, effective_date, expiry_date, document_ref, privileged, confidentiality, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${ORDER_COLS}`,
      [
        i.tenantId,
        i.proceedingId,
        i.orderType,
        i.orderDate,
        i.issuingForum,
        i.presidingRef,
        i.summary,
        i.operativeTerms,
        i.effectiveDate,
        i.expiryDate,
        i.documentRef,
        i.privileged,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert order');
  }
  async listOrders(tx: Tx, proceedingId: string): Promise<OrderRow[]> {
    const r = await tx.query<OrderRow>(
      `SELECT ${ORDER_COLS} FROM litigation_order WHERE proceeding_id=$1 ORDER BY created_at`,
      [proceedingId],
    );
    return r.rows;
  }
  /** An active stay order blocks closure (fail closed). */
  async activeStay(tx: Tx, proceedingId: string): Promise<boolean> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM litigation_order WHERE proceeding_id=$1 AND order_type='stay' AND status='active'`,
      [proceedingId],
    );
    return count(r.rows) > 0;
  }

  // --- compliance obligations -------------------------------------------------------------------
  async insertObligation(
    tx: Tx,
    i: {
      tenantId: string;
      proceedingId: string;
      orderId: string | null;
      obligation: string | null;
      responsibleRef: string | null;
      affectedParty: string | null;
      dueDate: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ComplianceRow> {
    const r = await tx.query<ComplianceRow>(
      `INSERT INTO litigation_compliance_obligation (tenant_id, proceeding_id, order_id, obligation, responsible_ref, affected_party, due_date, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING ${COMPLIANCE_COLS}`,
      [
        i.tenantId,
        i.proceedingId,
        i.orderId,
        i.obligation,
        i.responsibleRef,
        i.affectedParty,
        i.dueDate,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert obligation');
  }
  async completeObligation(
    tx: Tx,
    i: { id: string; expectedVersion: number; evidenceReference: string | null; by: string | null },
  ): Promise<ComplianceRow | null> {
    const r = await tx.query<ComplianceRow>(
      `UPDATE litigation_compliance_obligation SET status='completed', completion_date=current_date, evidence_reference=COALESCE($3,evidence_reference), updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status IN ('open','in_progress','extended') RETURNING ${COMPLIANCE_COLS}`,
      [i.id, i.expectedVersion, i.evidenceReference, i.by],
    );
    return r.rows[0] ?? null;
  }
  async breachObligation(
    tx: Tx,
    i: { id: string; expectedVersion: number; by: string | null },
  ): Promise<ComplianceRow | null> {
    const r = await tx.query<ComplianceRow>(
      `UPDATE litigation_compliance_obligation SET status='breached', breach_date=current_date, updated_by=$3, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status IN ('open','in_progress','extended') RETURNING ${COMPLIANCE_COLS}`,
      [i.id, i.expectedVersion, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listObligations(tx: Tx, proceedingId: string): Promise<ComplianceRow[]> {
    const r = await tx.query<ComplianceRow>(
      `SELECT ${COMPLIANCE_COLS} FROM litigation_compliance_obligation WHERE proceeding_id=$1 ORDER BY created_at`,
      [proceedingId],
    );
    return r.rows;
  }
  async countOpenComplianceObligations(tx: Tx, proceedingId: string): Promise<number> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM litigation_compliance_obligation WHERE proceeding_id=$1 AND status IN ('open','in_progress','extended')`,
      [proceedingId],
    );
    return count(r.rows);
  }

  // --- outcomes (append-only) -------------------------------------------------------------------
  async insertOutcome(
    tx: Tx,
    i: {
      tenantId: string;
      proceedingId: string;
      outcomeType: string;
      outcomeDate: string | null;
      forum: string | null;
      presidingRef: string | null;
      summary: string | null;
      disposition: string | null;
      amountAwardedMinor: number | null;
      currency: string | null;
      costsAwardedMinor: number | null;
      appealable: boolean;
      appealDeadline: string | null;
      documentRef: string | null;
      privileged: boolean;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<OutcomeRow> {
    const r = await tx.query<OutcomeRow>(
      `INSERT INTO litigation_outcome (tenant_id, proceeding_id, outcome_type, outcome_date, forum, presiding_ref, summary, disposition, amount_awarded_minor, currency, costs_awarded_minor, appealable, appeal_deadline, document_ref, privileged, confidentiality, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING ${OUTCOME_COLS}`,
      [
        i.tenantId,
        i.proceedingId,
        i.outcomeType,
        i.outcomeDate,
        i.forum,
        i.presidingRef,
        i.summary,
        i.disposition,
        i.amountAwardedMinor,
        i.currency,
        i.costsAwardedMinor,
        i.appealable,
        i.appealDeadline,
        i.documentRef,
        i.privileged,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert outcome');
  }
  async listOutcomes(tx: Tx, proceedingId: string): Promise<OutcomeRow[]> {
    const r = await tx.query<OutcomeRow>(
      `SELECT ${OUTCOME_COLS} FROM litigation_outcome WHERE proceeding_id=$1 ORDER BY created_at`,
      [proceedingId],
    );
    return r.rows;
  }
  async hasOutcome(tx: Tx, proceedingId: string): Promise<boolean> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM litigation_outcome WHERE proceeding_id=$1`,
      [proceedingId],
    );
    return count(r.rows) > 0;
  }

  // --- appeals (one-active per proceeding) ------------------------------------------------------
  async insertAppeal(
    tx: Tx,
    i: {
      tenantId: string;
      proceedingId: string;
      appealType: string | null;
      forum: string | null;
      deadline: string | null;
      groundsSummary: string | null;
      counselRef: string | null;
      sourceMatterId: string | null;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<AppealRow> {
    const r = await tx.query<AppealRow>(
      `INSERT INTO litigation_appeal (tenant_id, proceeding_id, appeal_type, forum, deadline, grounds_summary, counsel_ref, source_matter_id, confidentiality, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING ${APPEAL_COLS}`,
      [
        i.tenantId,
        i.proceedingId,
        i.appealType,
        i.forum,
        i.deadline,
        i.groundsSummary,
        i.counselRef,
        i.sourceMatterId,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert appeal');
  }
  async updateAppeal(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      approvalStatus: string | null;
      approvedBy: string | null;
      filingStatus: string | null;
      appealNumber: string | null;
      status: string | null;
      outcome: string | null;
      by: string | null;
    },
  ): Promise<AppealRow | null> {
    const r = await tx.query<AppealRow>(
      `UPDATE litigation_appeal SET approval_status=COALESCE($3,approval_status), approved_by=COALESCE($4,approved_by), filing_status=COALESCE($5,filing_status), appeal_number=COALESCE($6,appeal_number), status=COALESCE($7,status), outcome=COALESCE($8,outcome), updated_by=$9, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${APPEAL_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.approvalStatus,
        i.approvedBy,
        i.filingStatus,
        i.appealNumber,
        i.status,
        i.outcome,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async listAppeals(tx: Tx, proceedingId: string): Promise<AppealRow[]> {
    const r = await tx.query<AppealRow>(
      `SELECT ${APPEAL_COLS} FROM litigation_appeal WHERE proceeding_id=$1 ORDER BY created_at`,
      [proceedingId],
    );
    return r.rows;
  }

  // --- deadlines --------------------------------------------------------------------------------
  async insertDeadline(
    tx: Tx,
    i: {
      tenantId: string;
      proceedingId: string;
      deadlineType: string;
      startAt: string | null;
      dueAt: string;
      rule: unknown;
      source: string | null;
      authority: string | null;
      warnWindowMs: number | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<DeadlineRow> {
    const r = await tx.query<DeadlineRow>(
      `INSERT INTO litigation_deadline (tenant_id, proceeding_id, deadline_type, start_at, due_at, rule, source, authority, warn_window_ms, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$11) RETURNING ${DEADLINE_COLS}`,
      [
        i.tenantId,
        i.proceedingId,
        i.deadlineType,
        i.startAt,
        i.dueAt,
        JSON.stringify(i.rule ?? {}),
        i.source,
        i.authority,
        i.warnWindowMs,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert deadline');
  }
  async findDeadline(tx: Tx, id: string): Promise<DeadlineRow | null> {
    const r = await tx.query<DeadlineRow>(`SELECT ${DEADLINE_COLS} FROM litigation_deadline WHERE id=$1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }
  async extendDeadline(
    tx: Tx,
    i: { id: string; expectedVersion: number; extensionTo: string; by: string | null },
  ): Promise<DeadlineRow | null> {
    const r = await tx.query<DeadlineRow>(
      `UPDATE litigation_deadline SET due_at=$3, status='extended', updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status IN ('open','extended') RETURNING ${DEADLINE_COLS}`,
      [i.id, i.expectedVersion, i.extensionTo, i.by],
    );
    return r.rows[0] ?? null;
  }
  async markDeadlineBreach(tx: Tx, id: string): Promise<DeadlineRow | null> {
    const r = await tx.query<DeadlineRow>(
      `UPDATE litigation_deadline SET status='breached', updated_at=now(), version=version+1 WHERE id=$1 AND status IN ('open','extended') RETURNING ${DEADLINE_COLS}`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async listDeadlines(tx: Tx, proceedingId: string): Promise<DeadlineRow[]> {
    const r = await tx.query<DeadlineRow>(
      `SELECT ${DEADLINE_COLS} FROM litigation_deadline WHERE proceeding_id=$1 ORDER BY due_at`,
      [proceedingId],
    );
    return r.rows;
  }
  async countOpenDeadlines(tx: Tx, proceedingId: string): Promise<number> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM litigation_deadline WHERE proceeding_id=$1 AND status IN ('open','extended')`,
      [proceedingId],
    );
    return count(r.rows);
  }
  async hasImminentLimitation(tx: Tx, proceedingId: string, withinIso: string): Promise<boolean> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM litigation_deadline WHERE proceeding_id=$1 AND deadline_type='limitation' AND status IN ('open','extended') AND due_at <= $2`,
      [proceedingId, withinIso],
    );
    return count(r.rows) > 0;
  }

  // --- cost references --------------------------------------------------------------------------
  async insertCost(
    tx: Tx,
    i: {
      tenantId: string;
      proceedingId: string;
      costType: string | null;
      description: string | null;
      amountMinor: number | null;
      currency: string | null;
      counselReference: string | null;
      invoiceReference: string | null;
      recoverable: boolean;
      correlationId: string;
      by: string | null;
    },
  ): Promise<CostRow> {
    const r = await tx.query<CostRow>(
      `INSERT INTO litigation_cost_reference (tenant_id, proceeding_id, cost_type, description, amount_minor, currency, incurred_date, counsel_reference, invoice_reference, recoverable, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6, current_date, $7,$8,$9,$10,$11,$11) RETURNING ${COST_COLS}`,
      [
        i.tenantId,
        i.proceedingId,
        i.costType,
        i.description,
        i.amountMinor,
        i.currency,
        i.counselReference,
        i.invoiceReference,
        i.recoverable,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert cost');
  }
  async listCosts(tx: Tx, proceedingId: string): Promise<CostRow[]> {
    const r = await tx.query<CostRow>(
      `SELECT ${COST_COLS} FROM litigation_cost_reference WHERE proceeding_id=$1 ORDER BY created_at`,
      [proceedingId],
    );
    return r.rows;
  }

  // --- notes (append-only) ----------------------------------------------------------------------
  async insertNote(
    tx: Tx,
    i: {
      tenantId: string;
      proceedingId: string;
      noteType: string;
      headline: string | null;
      content: string;
      relatedAppearance: string | null;
      privileged: boolean;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<NoteRow> {
    const r = await tx.query<NoteRow>(
      `INSERT INTO litigation_note (tenant_id, proceeding_id, note_type, headline, content, related_appearance, privileged, confidentiality, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${NOTE_COLS}`,
      [
        i.tenantId,
        i.proceedingId,
        i.noteType,
        i.headline,
        i.content,
        i.relatedAppearance,
        i.privileged,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert note');
  }
  async listNotes(tx: Tx, proceedingId: string): Promise<NoteRow[]> {
    const r = await tx.query<NoteRow>(
      `SELECT ${NOTE_COLS} FROM litigation_note WHERE proceeding_id=$1 ORDER BY created_at`,
      [proceedingId],
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
      `INSERT INTO litigation_relationship (tenant_id, from_proceeding_id, to_proceeding_id, kind, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${REL_COLS}`,
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
      `SELECT ${REL_COLS} FROM litigation_relationship WHERE from_proceeding_id=$1 AND to_proceeding_id=$2 AND kind=$3 AND status='active'`,
      [toId, fromId, kind],
    );
    return r.rows[0] ?? null;
  }
  async listRelationships(tx: Tx, proceedingId: string): Promise<RelationshipRow[]> {
    const r = await tx.query<RelationshipRow>(
      `SELECT ${REL_COLS} FROM litigation_relationship WHERE (from_proceeding_id=$1 OR to_proceeding_id=$1) AND status='active' ORDER BY created_at`,
      [proceedingId],
    );
    return r.rows;
  }
}
