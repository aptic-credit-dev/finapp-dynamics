/**
 * M17 repository — ALL SQL for recovery & enforcement cases. Every query is parameterized; every mutating UPDATE
 * is optimistic-lock guarded (`WHERE ... AND version = $expected`) or a compare-and-set claim, so a stale/losing
 * command changes zero rows and the caller reacts. Queries carry NO tenant_id predicate: RLS is the isolation
 * guarantee. All methods take the caller's `Tx` so state, evidence, audit and outbox commit atomically. Referral
 * evidence, status/assignment histories, strategy selections, agent reports, receipts, waivers, outcomes and notes
 * are append-only (INSERT + SELECT by grant). m17 NEVER reads m14/m16 tables — the source proceeding/matter ids are
 * opaque references. ALL amounts are REFERENCES only (bigint minor units returned as strings) — no cash application.
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

export interface RecoveryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly recovery_number: string;
  readonly recovery_type_code: string;
  readonly recovery_type_version: number | null;
  readonly source: string;
  readonly source_proceeding_id: string | null;
  readonly source_matter_id: string | null;
  readonly source_reference: string | null;
  readonly originating_module: string | null;
  readonly title: string;
  readonly summary: string | null;
  readonly description: string | null;
  readonly instrument_type: string | null;
  readonly jurisdiction: string | null;
  readonly forum: string | null;
  readonly principal_amount_minor: string | null;
  readonly interest_amount_minor: string | null;
  readonly cost_amount_minor: string | null;
  readonly recoverable_amount_minor: string | null;
  readonly recovered_amount_minor: string | null;
  readonly outstanding_amount_minor: string | null;
  readonly currency: string | null;
  readonly confidentiality: string;
  readonly privileged: boolean;
  readonly recovery_risk: string | null;
  readonly priority: string;
  readonly strategy: string | null;
  readonly legal_owner: string | null;
  readonly recovery_team: string | null;
  readonly business_owner: string | null;
  readonly external_agent_ref: string | null;
  readonly workflow_instance_ref: string | null;
  readonly sla_policy_code: string | null;
  readonly escalation_ref: string | null;
  readonly status: string;
  readonly enforcement_stage: string | null;
  readonly legal_hold: boolean;
  readonly source_update_emitted: boolean;
  readonly write_off_recommended: boolean;
  readonly limitation_at: string | null;
  readonly final_outcome: string | null;
  readonly residual_note: string | null;
  readonly referred_at: string | null;
  readonly resolved_at: string | null;
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
  readonly source_proceeding_id: string;
  readonly source_matter_id: string | null;
  readonly recovery_id: string;
  readonly recovery_type_code: string | null;
  readonly safe_metadata: unknown;
}

export interface PartyRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly recovery_id: string;
  readonly party_role: string;
  readonly entity_ref: string | null;
  readonly display_label: string | null;
  readonly liability_basis: string | null;
  readonly liability_amount_minor: string | null;
  readonly contact_ref: string | null;
  readonly address_ref: string | null;
  readonly authority: string | null;
  readonly confidentiality: string;
  readonly active: boolean;
  readonly version: number;
}

export interface InstrumentRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly recovery_id: string;
  readonly instrument_type: string;
  readonly reference: string | null;
  readonly issuing_forum: string | null;
  readonly issue_date: string | null;
  readonly maturity_date: string | null;
  readonly face_amount_minor: string | null;
  readonly currency: string | null;
  readonly enforceable: boolean;
  readonly enforceability_note: string | null;
  readonly document_ref: string | null;
  readonly source_proceeding_id: string | null;
  readonly confidentiality: string;
  readonly version: number;
}

export interface StrategyRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly recovery_id: string;
  readonly strategy: string;
  readonly rationale: string | null;
  readonly selected_by: string | null;
  readonly rule_evaluation_id: string | null;
  readonly rule_version: string | null;
  readonly confidentiality: string;
}

export interface DemandRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly recovery_id: string;
  readonly demand_type: string;
  readonly party_ref: string | null;
  readonly amount_demanded_minor: string | null;
  readonly currency: string | null;
  readonly issued_date: string | null;
  readonly response_due: string | null;
  readonly delivery_method: string | null;
  readonly document_ref: string | null;
  readonly status: string;
  readonly response_status: string | null;
  readonly response_date: string | null;
  readonly response_summary: string | null;
  readonly confidentiality: string;
  readonly version: number;
}

export interface NegotiationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly recovery_id: string;
  readonly party_ref: string | null;
  readonly opened_date: string | null;
  readonly closed_date: string | null;
  readonly position_summary: string | null;
  readonly counter_position: string | null;
  readonly offered_amount_minor: string | null;
  readonly currency: string | null;
  readonly status: string;
  readonly outcome: string | null;
  readonly confidentiality: string;
  readonly version: number;
}

export interface ArrangementRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly recovery_id: string;
  readonly arrangement_type: string;
  readonly total_amount_minor: string | null;
  readonly currency: string | null;
  readonly installment_count: number | null;
  readonly installment_amount_minor: string | null;
  readonly frequency: string | null;
  readonly start_date: string | null;
  readonly end_date: string | null;
  readonly terms_summary: string | null;
  readonly approval_status: string;
  readonly proposed_by: string | null;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly status: string;
  readonly default_reason: string | null;
  readonly document_ref: string | null;
  readonly confidentiality: string;
  readonly version: number;
}

export interface InstallmentRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly arrangement_id: string;
  readonly recovery_id: string;
  readonly sequence_number: number;
  readonly due_date: string | null;
  readonly expected_amount_minor: string | null;
  readonly currency: string | null;
  readonly status: string;
  readonly receipt_ref: string | null;
  readonly paid_date: string | null;
  readonly note: string | null;
  readonly version: number;
}

export interface EnforcementActionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly recovery_id: string;
  readonly action_type: string;
  readonly forum: string | null;
  readonly reference: string | null;
  readonly initiated_date: string | null;
  readonly target_asset_ref: string | null;
  readonly target_party_ref: string | null;
  readonly expected_amount_minor: string | null;
  readonly currency: string | null;
  readonly agent_ref: string | null;
  readonly status: string;
  readonly outcome: string | null;
  readonly completed_date: string | null;
  readonly document_ref: string | null;
  readonly confidentiality: string;
  readonly version: number;
}

export interface SecurityRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly recovery_id: string;
  readonly security_type: string;
  readonly description: string | null;
  readonly asset_ref: string | null;
  readonly registration_reference: string | null;
  readonly charge_priority: string | null;
  readonly estimated_value_minor: string | null;
  readonly forced_sale_value_minor: string | null;
  readonly currency: string | null;
  readonly valuation_date: string | null;
  readonly valuation_ref: string | null;
  readonly status: string;
  readonly realized_amount_minor: string | null;
  readonly realized_date: string | null;
  readonly document_ref: string | null;
  readonly confidentiality: string;
  readonly version: number;
}

export interface AgentRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly recovery_id: string;
  readonly agent_ref: string | null;
  readonly agent_type: string | null;
  readonly engagement_reference: string | null;
  readonly instruction_scope: string | null;
  readonly fee_arrangement_reference: string | null;
  readonly reporting_frequency: string | null;
  readonly next_report_due: string | null;
  readonly internal_owner: string | null;
  readonly status: string;
  readonly performance_note: string | null;
  readonly confidentiality: string;
  readonly version: number;
}

export interface AgentReportRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly recovery_id: string;
  readonly agent_id: string | null;
  readonly reporting_period: string | null;
  readonly status_summary: string | null;
  readonly action_taken: string | null;
  readonly next_action: string | null;
  readonly amount_collected_minor: string | null;
  readonly currency: string | null;
  readonly report_date: string | null;
  readonly document_ref: string | null;
  readonly confidentiality: string;
}

export interface ReceiptRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly recovery_id: string;
  readonly receipt_type: string;
  readonly external_reference: string | null;
  readonly amount_minor: string | null;
  readonly currency: string | null;
  readonly received_date: string | null;
  readonly party_ref: string | null;
  readonly arrangement_ref: string | null;
  readonly enforcement_action_ref: string | null;
  readonly security_ref: string | null;
  readonly finance_reference: string | null;
  readonly document_ref: string | null;
  readonly confidentiality: string;
}

export interface WaiverRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly recovery_id: string;
  readonly waiver_type: string | null;
  readonly amount_minor: string | null;
  readonly currency: string | null;
  readonly reason: string | null;
  readonly granted_by: string | null;
  readonly authority: string | null;
  readonly granted_date: string | null;
  readonly document_ref: string | null;
  readonly confidentiality: string;
}

export interface WriteoffRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly recovery_id: string;
  readonly reason_code: string;
  readonly amount_minor: string | null;
  readonly currency: string | null;
  readonly narrative: string | null;
  readonly recommended_by: string | null;
  readonly recommended_date: string | null;
  readonly approval_status: string;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly finance_reference: string | null;
  readonly document_ref: string | null;
  readonly confidentiality: string;
  readonly version: number;
}

export interface OutcomeRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly recovery_id: string;
  readonly outcome_type: string;
  readonly outcome_date: string | null;
  readonly summary: string | null;
  readonly recovered_amount_minor: string | null;
  readonly waived_amount_minor: string | null;
  readonly written_off_amount_minor: string | null;
  readonly outstanding_amount_minor: string | null;
  readonly currency: string | null;
  readonly document_ref: string | null;
  readonly confidentiality: string;
}

export interface DeadlineRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly recovery_id: string;
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
  readonly related_demand: string | null;
  readonly related_arrangement: string | null;
  readonly related_enforcement: string | null;
  readonly version: number;
}

export interface CostRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly recovery_id: string;
  readonly cost_type: string | null;
  readonly description: string | null;
  readonly amount_minor: string | null;
  readonly currency: string | null;
  readonly incurred_date: string | null;
  readonly agent_reference: string | null;
  readonly invoice_reference: string | null;
  readonly approval_status: string;
  readonly payment_reference: string | null;
  readonly recoverable: boolean;
  readonly document_ref: string | null;
  readonly version: number;
}

export interface NoteRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly recovery_id: string;
  readonly note_type: string;
  readonly headline: string | null;
  readonly content: string;
  readonly confidentiality: string;
  readonly privileged: boolean;
}

export interface RelationshipRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly from_recovery_id: string;
  readonly to_recovery_id: string;
  readonly kind: string;
  readonly status: string;
  readonly version: number;
}

const SPEC_COLS = 'tenant_id, id, code, version_number, name, scope, status, spec, content_hash, version';
const RECOVERY_COLS =
  'tenant_id, id, recovery_number, recovery_type_code, recovery_type_version, source, source_proceeding_id, ' +
  'source_matter_id, source_reference, originating_module, title, summary, description, instrument_type, ' +
  'jurisdiction, forum, principal_amount_minor, interest_amount_minor, cost_amount_minor, recoverable_amount_minor, ' +
  'recovered_amount_minor, outstanding_amount_minor, currency, confidentiality, privileged, recovery_risk, priority, ' +
  'strategy, legal_owner, recovery_team, business_owner, external_agent_ref, workflow_instance_ref, sla_policy_code, ' +
  'escalation_ref, status, enforcement_stage, legal_hold, source_update_emitted, write_off_recommended, ' +
  'limitation_at, final_outcome, residual_note, referred_at, resolved_at, closed_at, reopened_at, archived_at, ' +
  'correlation_id, causation_id, idempotency_key, version';
const REFERRAL_COLS =
  'tenant_id, id, referral_key, source_proceeding_id, source_matter_id, recovery_id, recovery_type_code, safe_metadata';
const PARTY_COLS =
  'tenant_id, id, recovery_id, party_role, entity_ref, display_label, liability_basis, liability_amount_minor, ' +
  'contact_ref, address_ref, authority, confidentiality, active, version';
const INSTRUMENT_COLS =
  'tenant_id, id, recovery_id, instrument_type, reference, issuing_forum, issue_date, maturity_date, ' +
  'face_amount_minor, currency, enforceable, enforceability_note, document_ref, source_proceeding_id, ' +
  'confidentiality, version';
const STRATEGY_COLS =
  'tenant_id, id, recovery_id, strategy, rationale, selected_by, rule_evaluation_id, rule_version, confidentiality';
const DEMAND_COLS =
  'tenant_id, id, recovery_id, demand_type, party_ref, amount_demanded_minor, currency, issued_date, response_due, ' +
  'delivery_method, document_ref, status, response_status, response_date, response_summary, confidentiality, version';
const NEGOTIATION_COLS =
  'tenant_id, id, recovery_id, party_ref, opened_date, closed_date, position_summary, counter_position, ' +
  'offered_amount_minor, currency, status, outcome, confidentiality, version';
const ARRANGEMENT_COLS =
  'tenant_id, id, recovery_id, arrangement_type, total_amount_minor, currency, installment_count, ' +
  'installment_amount_minor, frequency, start_date, end_date, terms_summary, approval_status, proposed_by, ' +
  'approved_by, approved_at, status, default_reason, document_ref, confidentiality, version';
const INSTALLMENT_COLS =
  'tenant_id, id, arrangement_id, recovery_id, sequence_number, due_date, expected_amount_minor, currency, status, ' +
  'receipt_ref, paid_date, note, version';
const ENFORCEMENT_COLS =
  'tenant_id, id, recovery_id, action_type, forum, reference, initiated_date, target_asset_ref, target_party_ref, ' +
  'expected_amount_minor, currency, agent_ref, status, outcome, completed_date, document_ref, confidentiality, version';
const SECURITY_COLS =
  'tenant_id, id, recovery_id, security_type, description, asset_ref, registration_reference, charge_priority, ' +
  'estimated_value_minor, forced_sale_value_minor, currency, valuation_date, valuation_ref, status, ' +
  'realized_amount_minor, realized_date, document_ref, confidentiality, version';
const AGENT_COLS =
  'tenant_id, id, recovery_id, agent_ref, agent_type, engagement_reference, instruction_scope, ' +
  'fee_arrangement_reference, reporting_frequency, next_report_due, internal_owner, status, performance_note, ' +
  'confidentiality, version';
const AGENT_REPORT_COLS =
  'tenant_id, id, recovery_id, agent_id, reporting_period, status_summary, action_taken, next_action, ' +
  'amount_collected_minor, currency, report_date, document_ref, confidentiality';
const RECEIPT_COLS =
  'tenant_id, id, recovery_id, receipt_type, external_reference, amount_minor, currency, received_date, party_ref, ' +
  'arrangement_ref, enforcement_action_ref, security_ref, finance_reference, document_ref, confidentiality';
const WAIVER_COLS =
  'tenant_id, id, recovery_id, waiver_type, amount_minor, currency, reason, granted_by, authority, granted_date, ' +
  'document_ref, confidentiality';
const WRITEOFF_COLS =
  'tenant_id, id, recovery_id, reason_code, amount_minor, currency, narrative, recommended_by, recommended_date, ' +
  'approval_status, approved_by, approved_at, finance_reference, document_ref, confidentiality, version';
const OUTCOME_COLS =
  'tenant_id, id, recovery_id, outcome_type, outcome_date, summary, recovered_amount_minor, waived_amount_minor, ' +
  'written_off_amount_minor, outstanding_amount_minor, currency, document_ref, confidentiality';
const DEADLINE_COLS =
  'tenant_id, id, recovery_id, deadline_type, source, authority, start_at, due_at, rule, business_calendar_ref, ' +
  'warn_window_ms, status, waived, completed_at, related_demand, related_arrangement, related_enforcement, version';
const COST_COLS =
  'tenant_id, id, recovery_id, cost_type, description, amount_minor, currency, incurred_date, agent_reference, ' +
  'invoice_reference, approval_status, payment_reference, recoverable, document_ref, version';
const NOTE_COLS = 'tenant_id, id, recovery_id, note_type, headline, content, confidentiality, privileged';
const REL_COLS = 'tenant_id, id, from_recovery_id, to_recovery_id, kind, status, version';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m17 repository: expected a row from ${what}`);
  return row;
}
function count(rows: { c: string }[]): number {
  return Number(rows[0]?.c ?? '0');
}

export class RecoveryRepository {
  // --- specs (recovery_type + sla_policy) -------------------------------------------------------
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
  insertRecoveryType(
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
    return this.insertSpec(tx, 'recovery_type', i);
  }
  nextRecoveryTypeVersion(tx: Tx, code: string, scope: string) {
    return this.nextSpecVersion(tx, 'recovery_type', code, scope);
  }
  findRecoveryType(tx: Tx, id: string) {
    return this.findSpec(tx, 'recovery_type', id);
  }
  findActiveRecoveryType(tx: Tx, code: string) {
    return this.findActiveSpec(tx, 'recovery_type', code);
  }
  updateRecoveryTypeStatus(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      contentHash: string | null;
      publishedBy: string | null;
    },
  ) {
    return this.updateSpecStatus(tx, 'recovery_type', i);
  }
  retireActiveRecoveryTypes(tx: Tx, code: string, scope: string, exceptId: string) {
    return this.retireActiveSpec(tx, 'recovery_type', code, scope, exceptId);
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
    return this.insertSpec(tx, 'recovery_sla_policy', i);
  }
  nextSlaPolicyVersion(tx: Tx, code: string, scope: string) {
    return this.nextSpecVersion(tx, 'recovery_sla_policy', code, scope);
  }
  findSlaPolicy(tx: Tx, id: string) {
    return this.findSpec(tx, 'recovery_sla_policy', id);
  }
  findActiveSlaPolicy(tx: Tx, code: string) {
    return this.findActiveSpec(tx, 'recovery_sla_policy', code);
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
    return this.updateSpecStatus(tx, 'recovery_sla_policy', i);
  }
  retireActiveSlaPolicies(tx: Tx, code: string, scope: string, exceptId: string) {
    return this.retireActiveSpec(tx, 'recovery_sla_policy', code, scope, exceptId);
  }

  // --- recovery case ----------------------------------------------------------------------------
  async insertRecovery(
    tx: Tx,
    i: {
      tenantId: string;
      recoveryNumber: string;
      recoveryTypeCode: string;
      recoveryTypeVersion: number | null;
      source: string;
      sourceProceedingId: string | null;
      sourceMatterId: string | null;
      sourceReference: string | null;
      originatingModule: string | null;
      title: string;
      summary: string | null;
      description: string | null;
      instrumentType: string | null;
      jurisdiction: string | null;
      forum: string | null;
      principalAmountMinor: number | null;
      interestAmountMinor: number | null;
      costAmountMinor: number | null;
      recoverableAmountMinor: number | null;
      currency: string | null;
      confidentiality: string;
      privileged: boolean;
      recoveryRisk: string | null;
      priority: string;
      strategy: string | null;
      slaPolicyCode: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      causationId: string | null;
      by: string | null;
    },
  ): Promise<RecoveryRow> {
    const r = await tx.query<RecoveryRow>(
      `INSERT INTO recovery_case (tenant_id, recovery_number, recovery_type_code, recovery_type_version, source, source_proceeding_id, source_matter_id, source_reference, originating_module, title, summary, description, instrument_type, jurisdiction, forum, principal_amount_minor, interest_amount_minor, cost_amount_minor, recoverable_amount_minor, currency, confidentiality, privileged, recovery_risk, priority, strategy, sla_policy_code, idempotency_key, correlation_id, causation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$30) RETURNING ${RECOVERY_COLS}`,
      [
        i.tenantId,
        i.recoveryNumber,
        i.recoveryTypeCode,
        i.recoveryTypeVersion,
        i.source,
        i.sourceProceedingId,
        i.sourceMatterId,
        i.sourceReference,
        i.originatingModule,
        i.title,
        i.summary,
        i.description,
        i.instrumentType,
        i.jurisdiction,
        i.forum,
        i.principalAmountMinor,
        i.interestAmountMinor,
        i.costAmountMinor,
        i.recoverableAmountMinor,
        i.currency,
        i.confidentiality,
        i.privileged,
        i.recoveryRisk,
        i.priority,
        i.strategy,
        i.slaPolicyCode,
        i.idempotencyKey,
        i.correlationId,
        i.causationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert recovery');
  }
  async findRecovery(tx: Tx, id: string): Promise<RecoveryRow | null> {
    const r = await tx.query<RecoveryRow>(`SELECT ${RECOVERY_COLS} FROM recovery_case WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findByIdempotencyKey(tx: Tx, key: string): Promise<RecoveryRow | null> {
    const r = await tx.query<RecoveryRow>(
      `SELECT ${RECOVERY_COLS} FROM recovery_case WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async updateRecoveryStatus(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      by: string | null;
      stamp?: 'referred' | 'resolved' | 'closed' | 'reopened' | 'archived' | null;
    },
  ): Promise<RecoveryRow | null> {
    const stampCol =
      i.stamp === 'referred'
        ? ', referred_at=COALESCE(referred_at, now())'
        : i.stamp === 'resolved'
          ? ', resolved_at=now()'
          : i.stamp === 'closed'
            ? ', closed_at=now()'
            : i.stamp === 'reopened'
              ? ', reopened_at=now()'
              : i.stamp === 'archived'
                ? ', archived_at=now()'
                : '';
    const r = await tx.query<RecoveryRow>(
      `UPDATE recovery_case SET status=$3, updated_by=$4, updated_at=now(), version=version+1${stampCol} WHERE id=$1 AND version=$2 RETURNING ${RECOVERY_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async patchRecovery(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      recoveryRisk?: string | null;
      priority?: string | null;
      confidentiality?: string | null;
      privileged?: boolean | null;
      strategy?: string | null;
      slaPolicyCode?: string | null;
      escalationRef?: string | null;
      legalOwner?: string | null;
      recoveryTeam?: string | null;
      businessOwner?: string | null;
      externalAgentRef?: string | null;
      workflowInstanceRef?: string | null;
      jurisdiction?: string | null;
      forum?: string | null;
      instrumentType?: string | null;
      enforcementStage?: string | null;
      principalAmountMinor?: number | null;
      interestAmountMinor?: number | null;
      costAmountMinor?: number | null;
      recoverableAmountMinor?: number | null;
      recoveredAmountMinor?: number | null;
      outstandingAmountMinor?: number | null;
      currency?: string | null;
      legalHold?: boolean | null;
      sourceUpdateEmitted?: boolean | null;
      writeOffRecommended?: boolean | null;
      limitationAt?: string | null;
      finalOutcome?: string | null;
      residualNote?: string | null;
      summary?: string | null;
      description?: string | null;
      sourceReference?: string | null;
      by: string | null;
    },
  ): Promise<RecoveryRow | null> {
    const r = await tx.query<RecoveryRow>(
      `UPDATE recovery_case SET
         recovery_risk=COALESCE($3,recovery_risk), priority=COALESCE($4,priority), confidentiality=COALESCE($5,confidentiality),
         privileged=COALESCE($6,privileged), strategy=COALESCE($7,strategy), sla_policy_code=COALESCE($8,sla_policy_code),
         escalation_ref=COALESCE($9,escalation_ref), legal_owner=COALESCE($10,legal_owner), recovery_team=COALESCE($11,recovery_team),
         business_owner=COALESCE($12,business_owner), external_agent_ref=COALESCE($13,external_agent_ref),
         workflow_instance_ref=COALESCE($14,workflow_instance_ref), jurisdiction=COALESCE($15,jurisdiction),
         forum=COALESCE($16,forum), instrument_type=COALESCE($17,instrument_type), enforcement_stage=COALESCE($18,enforcement_stage),
         principal_amount_minor=COALESCE($19,principal_amount_minor), interest_amount_minor=COALESCE($20,interest_amount_minor),
         cost_amount_minor=COALESCE($21,cost_amount_minor), recoverable_amount_minor=COALESCE($22,recoverable_amount_minor),
         recovered_amount_minor=COALESCE($23,recovered_amount_minor), outstanding_amount_minor=COALESCE($24,outstanding_amount_minor),
         currency=COALESCE($25,currency), legal_hold=COALESCE($26,legal_hold), source_update_emitted=COALESCE($27,source_update_emitted),
         write_off_recommended=COALESCE($28,write_off_recommended), limitation_at=COALESCE($29,limitation_at),
         final_outcome=COALESCE($30,final_outcome), residual_note=COALESCE($31,residual_note),
         summary=COALESCE($32,summary), description=COALESCE($33,description), source_reference=COALESCE($34,source_reference),
         updated_by=$35, updated_at=now(), version=version+1
       WHERE id=$1 AND version=$2 RETURNING ${RECOVERY_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.recoveryRisk ?? null,
        i.priority ?? null,
        i.confidentiality ?? null,
        i.privileged ?? null,
        i.strategy ?? null,
        i.slaPolicyCode ?? null,
        i.escalationRef ?? null,
        i.legalOwner ?? null,
        i.recoveryTeam ?? null,
        i.businessOwner ?? null,
        i.externalAgentRef ?? null,
        i.workflowInstanceRef ?? null,
        i.jurisdiction ?? null,
        i.forum ?? null,
        i.instrumentType ?? null,
        i.enforcementStage ?? null,
        i.principalAmountMinor ?? null,
        i.interestAmountMinor ?? null,
        i.costAmountMinor ?? null,
        i.recoverableAmountMinor ?? null,
        i.recoveredAmountMinor ?? null,
        i.outstandingAmountMinor ?? null,
        i.currency ?? null,
        i.legalHold ?? null,
        i.sourceUpdateEmitted ?? null,
        i.writeOffRecommended ?? null,
        i.limitationAt ?? null,
        i.finalOutcome ?? null,
        i.residualNote ?? null,
        i.summary ?? null,
        i.description ?? null,
        i.sourceReference ?? null,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async assignRecovery(
    tx: Tx,
    i: { id: string; expectedVersion: number; owner: string; toStatus: string; by: string | null },
  ): Promise<RecoveryRow | null> {
    const r = await tx.query<RecoveryRow>(
      `UPDATE recovery_case SET legal_owner=$3, status=$4, updated_by=$5, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${RECOVERY_COLS}`,
      [i.id, i.expectedVersion, i.owner, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async searchRecoveries(
    tx: Tx,
    f: {
      recoveryTypeCode?: string;
      status?: string;
      recoveryRisk?: string;
      priority?: string;
      jurisdiction?: string;
      strategy?: string;
      owner?: string;
      limit: number;
      offset: number;
    },
  ): Promise<RecoveryRow[]> {
    const r = await tx.query<RecoveryRow>(
      `SELECT ${RECOVERY_COLS} FROM recovery_case WHERE ($1::text IS NULL OR recovery_type_code=$1) AND ($2::text IS NULL OR status=$2) AND ($3::text IS NULL OR recovery_risk=$3) AND ($4::text IS NULL OR priority=$4) AND ($5::text IS NULL OR jurisdiction=$5) AND ($6::text IS NULL OR strategy=$6) AND ($7::uuid IS NULL OR legal_owner=$7) ORDER BY created_at DESC LIMIT $8 OFFSET $9`,
      [
        f.recoveryTypeCode ?? null,
        f.status ?? null,
        f.recoveryRisk ?? null,
        f.priority ?? null,
        f.jurisdiction ?? null,
        f.strategy ?? null,
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
        recovery_type: 'recovery_type_code',
        source: 'source',
        jurisdiction: 'jurisdiction',
        instrument_type: 'instrument_type',
        strategy: 'strategy',
        enforcement_stage: 'enforcement_stage',
        recovery_risk: 'recovery_risk',
        priority: 'priority',
        status: 'status',
        confidentiality: 'confidentiality',
      }[dimension] ?? 'status';
    const r = await tx.query<{ dim: string | null; count: string }>(
      `SELECT ${col} AS dim, count(*)::text AS count FROM recovery_case GROUP BY ${col} ORDER BY count DESC`,
    );
    return r.rows;
  }

  // --- referral ledger (idempotent, append-only) ------------------------------------------------
  async insertReferral(
    tx: Tx,
    i: {
      tenantId: string;
      referralKey: string;
      sourceProceedingId: string;
      sourceMatterId: string | null;
      recoveryId: string;
      recoveryTypeCode: string | null;
      safeMetadata: unknown;
      correlationId: string;
      causationId: string | null;
      by: string | null;
    },
  ): Promise<ReferralRow> {
    const r = await tx.query<ReferralRow>(
      `INSERT INTO recovery_referral (tenant_id, referral_key, source_proceeding_id, source_matter_id, recovery_id, recovery_type_code, safe_metadata, correlation_id, causation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10) RETURNING ${REFERRAL_COLS}`,
      [
        i.tenantId,
        i.referralKey,
        i.sourceProceedingId,
        i.sourceMatterId,
        i.recoveryId,
        i.recoveryTypeCode,
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
      `SELECT ${REFERRAL_COLS} FROM recovery_referral WHERE referral_key=$1`,
      [referralKey],
    );
    return r.rows[0] ?? null;
  }

  // --- histories (append-only) ------------------------------------------------------------------
  async insertStatusHistory(
    tx: Tx,
    i: {
      tenantId: string;
      recoveryId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO recovery_status_history (tenant_id, recovery_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.recoveryId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }
  async insertAssignmentHistory(
    tx: Tx,
    i: {
      tenantId: string;
      recoveryId: string;
      kind: string;
      ref: string | null;
      reason: string | null;
      ruleEvalId: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO recovery_assignment_history (tenant_id, recovery_id, kind, ref, reason, rule_evaluation_id, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.recoveryId, i.kind, i.ref, i.reason, i.ruleEvalId, i.by, i.correlationId],
    );
  }

  // --- parties ----------------------------------------------------------------------------------
  async insertParty(
    tx: Tx,
    i: {
      tenantId: string;
      recoveryId: string;
      partyRole: string;
      entityRef: string | null;
      displayLabel: string | null;
      liabilityBasis: string | null;
      liabilityAmountMinor: number | null;
      contactRef: string | null;
      addressRef: string | null;
      authority: string | null;
      confidentiality: string;
      by: string | null;
    },
  ): Promise<PartyRow> {
    const r = await tx.query<PartyRow>(
      `INSERT INTO recovery_party (tenant_id, recovery_id, party_role, entity_ref, display_label, liability_basis, liability_amount_minor, contact_ref, address_ref, authority, confidentiality, active_from, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), $12,$12) RETURNING ${PARTY_COLS}`,
      [
        i.tenantId,
        i.recoveryId,
        i.partyRole,
        i.entityRef,
        i.displayLabel,
        i.liabilityBasis,
        i.liabilityAmountMinor,
        i.contactRef,
        i.addressRef,
        i.authority,
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
      `UPDATE recovery_party SET active=false, active_to=now(), updated_by=$3, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND active=true RETURNING ${PARTY_COLS}`,
      [i.id, i.expectedVersion, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listParties(tx: Tx, recoveryId: string): Promise<PartyRow[]> {
    const r = await tx.query<PartyRow>(
      `SELECT ${PARTY_COLS} FROM recovery_party WHERE recovery_id=$1 ORDER BY created_at`,
      [recoveryId],
    );
    return r.rows;
  }

  // --- strategy (append-only) -------------------------------------------------------------------
  async insertStrategy(
    tx: Tx,
    i: {
      tenantId: string;
      recoveryId: string;
      strategy: string;
      rationale: string | null;
      selectedBy: string | null;
      ruleEvaluationId: string | null;
      ruleVersion: string | null;
      confidentiality: string;
      correlationId: string;
    },
  ): Promise<StrategyRow> {
    const r = await tx.query<StrategyRow>(
      `INSERT INTO recovery_strategy (tenant_id, recovery_id, strategy, rationale, selected_by, rule_evaluation_id, rule_version, confidentiality, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${STRATEGY_COLS}`,
      [
        i.tenantId,
        i.recoveryId,
        i.strategy,
        i.rationale,
        i.selectedBy,
        i.ruleEvaluationId,
        i.ruleVersion,
        i.confidentiality,
        i.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert strategy');
  }
  async listStrategies(tx: Tx, recoveryId: string): Promise<StrategyRow[]> {
    const r = await tx.query<StrategyRow>(
      `SELECT ${STRATEGY_COLS} FROM recovery_strategy WHERE recovery_id=$1 ORDER BY created_at`,
      [recoveryId],
    );
    return r.rows;
  }

  // --- instruments ------------------------------------------------------------------------------
  async insertInstrument(
    tx: Tx,
    i: {
      tenantId: string;
      recoveryId: string;
      instrumentType: string;
      reference: string | null;
      issuingForum: string | null;
      issueDate: string | null;
      maturityDate: string | null;
      faceAmountMinor: number | null;
      currency: string | null;
      enforceable: boolean;
      enforceabilityNote: string | null;
      documentRef: string | null;
      sourceProceedingId: string | null;
      confidentiality: string;
      by: string | null;
    },
  ): Promise<InstrumentRow> {
    const r = await tx.query<InstrumentRow>(
      `INSERT INTO recovery_instrument (tenant_id, recovery_id, instrument_type, reference, issuing_forum, issue_date, maturity_date, face_amount_minor, currency, enforceable, enforceability_note, document_ref, source_proceeding_id, confidentiality, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING ${INSTRUMENT_COLS}`,
      [
        i.tenantId,
        i.recoveryId,
        i.instrumentType,
        i.reference,
        i.issuingForum,
        i.issueDate,
        i.maturityDate,
        i.faceAmountMinor,
        i.currency,
        i.enforceable,
        i.enforceabilityNote,
        i.documentRef,
        i.sourceProceedingId,
        i.confidentiality,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert instrument');
  }
  async updateInstrument(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      reference: string | null;
      issuingForum: string | null;
      enforceable: boolean | null;
      enforceabilityNote: string | null;
      documentRef: string | null;
      by: string | null;
    },
  ): Promise<InstrumentRow | null> {
    const r = await tx.query<InstrumentRow>(
      `UPDATE recovery_instrument SET reference=COALESCE($3,reference), issuing_forum=COALESCE($4,issuing_forum), enforceable=COALESCE($5,enforceable), enforceability_note=COALESCE($6,enforceability_note), document_ref=COALESCE($7,document_ref), updated_by=$8, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${INSTRUMENT_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.reference,
        i.issuingForum,
        i.enforceable,
        i.enforceabilityNote,
        i.documentRef,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async listInstruments(tx: Tx, recoveryId: string): Promise<InstrumentRow[]> {
    const r = await tx.query<InstrumentRow>(
      `SELECT ${INSTRUMENT_COLS} FROM recovery_instrument WHERE recovery_id=$1 ORDER BY created_at`,
      [recoveryId],
    );
    return r.rows;
  }

  // --- demands ----------------------------------------------------------------------------------
  async insertDemand(
    tx: Tx,
    i: {
      tenantId: string;
      recoveryId: string;
      demandType: string;
      partyRef: string | null;
      amountDemandedMinor: number | null;
      currency: string | null;
      issuedDate: string | null;
      responseDue: string | null;
      deliveryMethod: string | null;
      documentRef: string | null;
      status: string;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<DemandRow> {
    const r = await tx.query<DemandRow>(
      `INSERT INTO recovery_demand (tenant_id, recovery_id, demand_type, party_ref, amount_demanded_minor, currency, issued_date, response_due, delivery_method, document_ref, status, confidentiality, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING ${DEMAND_COLS}`,
      [
        i.tenantId,
        i.recoveryId,
        i.demandType,
        i.partyRef,
        i.amountDemandedMinor,
        i.currency,
        i.issuedDate,
        i.responseDue,
        i.deliveryMethod,
        i.documentRef,
        i.status,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert demand');
  }
  async respondDemand(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      responseStatus: string | null;
      responseDate: string | null;
      responseSummary: string | null;
      status: string | null;
      by: string | null;
    },
  ): Promise<DemandRow | null> {
    const r = await tx.query<DemandRow>(
      `UPDATE recovery_demand SET response_status=COALESCE($3,response_status), response_date=COALESCE($4,response_date), response_summary=COALESCE($5,response_summary), status=COALESCE($6,status), updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${DEMAND_COLS}`,
      [i.id, i.expectedVersion, i.responseStatus, i.responseDate, i.responseSummary, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listDemands(tx: Tx, recoveryId: string): Promise<DemandRow[]> {
    const r = await tx.query<DemandRow>(
      `SELECT ${DEMAND_COLS} FROM recovery_demand WHERE recovery_id=$1 ORDER BY created_at`,
      [recoveryId],
    );
    return r.rows;
  }

  // --- negotiations -----------------------------------------------------------------------------
  async insertNegotiation(
    tx: Tx,
    i: {
      tenantId: string;
      recoveryId: string;
      partyRef: string | null;
      openedDate: string | null;
      positionSummary: string | null;
      offeredAmountMinor: number | null;
      currency: string | null;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<NegotiationRow> {
    const r = await tx.query<NegotiationRow>(
      `INSERT INTO recovery_negotiation (tenant_id, recovery_id, party_ref, opened_date, position_summary, offered_amount_minor, currency, confidentiality, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING ${NEGOTIATION_COLS}`,
      [
        i.tenantId,
        i.recoveryId,
        i.partyRef,
        i.openedDate,
        i.positionSummary,
        i.offeredAmountMinor,
        i.currency,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert negotiation');
  }
  async updateNegotiation(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      positionSummary: string | null;
      counterPosition: string | null;
      offeredAmountMinor: number | null;
      status: string | null;
      by: string | null;
    },
  ): Promise<NegotiationRow | null> {
    const r = await tx.query<NegotiationRow>(
      `UPDATE recovery_negotiation SET position_summary=COALESCE($3,position_summary), counter_position=COALESCE($4,counter_position), offered_amount_minor=COALESCE($5,offered_amount_minor), status=COALESCE($6,status), updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status IN ('open','on_hold') RETURNING ${NEGOTIATION_COLS}`,
      [i.id, i.expectedVersion, i.positionSummary, i.counterPosition, i.offeredAmountMinor, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async closeNegotiation(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      status: string;
      outcome: string | null;
      closedDate: string | null;
      by: string | null;
    },
  ): Promise<NegotiationRow | null> {
    const r = await tx.query<NegotiationRow>(
      `UPDATE recovery_negotiation SET status=$3, outcome=COALESCE($4,outcome), closed_date=COALESCE($5, current_date), updated_by=$6, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status IN ('open','on_hold','agreed') RETURNING ${NEGOTIATION_COLS}`,
      [i.id, i.expectedVersion, i.status, i.outcome, i.closedDate, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listNegotiations(tx: Tx, recoveryId: string): Promise<NegotiationRow[]> {
    const r = await tx.query<NegotiationRow>(
      `SELECT ${NEGOTIATION_COLS} FROM recovery_negotiation WHERE recovery_id=$1 ORDER BY created_at`,
      [recoveryId],
    );
    return r.rows;
  }

  // --- arrangements (maker-checker; single-winner approve) --------------------------------------
  async insertArrangement(
    tx: Tx,
    i: {
      tenantId: string;
      recoveryId: string;
      arrangementType: string;
      totalAmountMinor: number | null;
      currency: string | null;
      installmentCount: number | null;
      installmentAmountMinor: number | null;
      frequency: string | null;
      startDate: string | null;
      endDate: string | null;
      termsSummary: string | null;
      proposedBy: string | null;
      documentRef: string | null;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ArrangementRow> {
    const r = await tx.query<ArrangementRow>(
      `INSERT INTO recovery_arrangement (tenant_id, recovery_id, arrangement_type, total_amount_minor, currency, installment_count, installment_amount_minor, frequency, start_date, end_date, terms_summary, proposed_by, document_ref, confidentiality, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16) RETURNING ${ARRANGEMENT_COLS}`,
      [
        i.tenantId,
        i.recoveryId,
        i.arrangementType,
        i.totalAmountMinor,
        i.currency,
        i.installmentCount,
        i.installmentAmountMinor,
        i.frequency,
        i.startDate,
        i.endDate,
        i.termsSummary,
        i.proposedBy,
        i.documentRef,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert arrangement');
  }
  async findArrangement(tx: Tx, id: string): Promise<ArrangementRow | null> {
    const r = await tx.query<ArrangementRow>(
      `SELECT ${ARRANGEMENT_COLS} FROM recovery_arrangement WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  /** Single-winner approval: compare-and-set on approval_status='proposed' AND version=$expected. Sets status active. */
  async approveArrangement(
    tx: Tx,
    i: { id: string; expectedVersion: number; approvedBy: string | null },
  ): Promise<ArrangementRow | null> {
    const r = await tx.query<ArrangementRow>(
      `UPDATE recovery_arrangement SET approval_status='approved', approved_by=$3, approved_at=now(), status='active', updated_by=$3, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND approval_status='proposed' RETURNING ${ARRANGEMENT_COLS}`,
      [i.id, i.expectedVersion, i.approvedBy],
    );
    return r.rows[0] ?? null;
  }
  async defaultArrangement(
    tx: Tx,
    i: { id: string; expectedVersion: number; defaultReason: string | null; by: string | null },
  ): Promise<ArrangementRow | null> {
    const r = await tx.query<ArrangementRow>(
      `UPDATE recovery_arrangement SET status='defaulted', default_reason=COALESCE($3,default_reason), updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status='active' RETURNING ${ARRANGEMENT_COLS}`,
      [i.id, i.expectedVersion, i.defaultReason, i.by],
    );
    return r.rows[0] ?? null;
  }
  async completeArrangement(
    tx: Tx,
    i: { id: string; expectedVersion: number; by: string | null },
  ): Promise<ArrangementRow | null> {
    const r = await tx.query<ArrangementRow>(
      `UPDATE recovery_arrangement SET status='completed', updated_by=$3, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status='active' RETURNING ${ARRANGEMENT_COLS}`,
      [i.id, i.expectedVersion, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listArrangements(tx: Tx, recoveryId: string): Promise<ArrangementRow[]> {
    const r = await tx.query<ArrangementRow>(
      `SELECT ${ARRANGEMENT_COLS} FROM recovery_arrangement WHERE recovery_id=$1 ORDER BY created_at`,
      [recoveryId],
    );
    return r.rows;
  }
  async activeArrangement(tx: Tx, recoveryId: string): Promise<boolean> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM recovery_arrangement WHERE recovery_id=$1 AND status='active'`,
      [recoveryId],
    );
    return count(r.rows) > 0;
  }

  // --- installments (schedule metadata only; NO cash application) --------------------------------
  async insertInstallment(
    tx: Tx,
    i: {
      tenantId: string;
      arrangementId: string;
      recoveryId: string;
      sequenceNumber: number;
      dueDate: string | null;
      expectedAmountMinor: number | null;
      currency: string | null;
      by: string | null;
    },
  ): Promise<InstallmentRow> {
    const r = await tx.query<InstallmentRow>(
      `INSERT INTO recovery_installment (tenant_id, arrangement_id, recovery_id, sequence_number, due_date, expected_amount_minor, currency, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING ${INSTALLMENT_COLS}`,
      [
        i.tenantId,
        i.arrangementId,
        i.recoveryId,
        i.sequenceNumber,
        i.dueDate,
        i.expectedAmountMinor,
        i.currency,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert installment');
  }
  async recordInstallment(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      status: string;
      receiptRef: string | null;
      paidDate: string | null;
      note: string | null;
      by: string | null;
    },
  ): Promise<InstallmentRow | null> {
    const r = await tx.query<InstallmentRow>(
      `UPDATE recovery_installment SET status=$3, receipt_ref=COALESCE($4,receipt_ref), paid_date=COALESCE($5,paid_date), note=COALESCE($6,note), updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status IN ('scheduled','due','missed') RETURNING ${INSTALLMENT_COLS}`,
      [i.id, i.expectedVersion, i.status, i.receiptRef, i.paidDate, i.note, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listInstallments(tx: Tx, arrangementId: string): Promise<InstallmentRow[]> {
    const r = await tx.query<InstallmentRow>(
      `SELECT ${INSTALLMENT_COLS} FROM recovery_installment WHERE arrangement_id=$1 ORDER BY sequence_number`,
      [arrangementId],
    );
    return r.rows;
  }

  // --- enforcement actions ----------------------------------------------------------------------
  async insertEnforcement(
    tx: Tx,
    i: {
      tenantId: string;
      recoveryId: string;
      actionType: string;
      forum: string | null;
      reference: string | null;
      initiatedDate: string | null;
      targetAssetRef: string | null;
      targetPartyRef: string | null;
      expectedAmountMinor: number | null;
      currency: string | null;
      agentRef: string | null;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<EnforcementActionRow> {
    const r = await tx.query<EnforcementActionRow>(
      `INSERT INTO recovery_enforcement_action (tenant_id, recovery_id, action_type, forum, reference, initiated_date, target_asset_ref, target_party_ref, expected_amount_minor, currency, agent_ref, confidentiality, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING ${ENFORCEMENT_COLS}`,
      [
        i.tenantId,
        i.recoveryId,
        i.actionType,
        i.forum,
        i.reference,
        i.initiatedDate,
        i.targetAssetRef,
        i.targetPartyRef,
        i.expectedAmountMinor,
        i.currency,
        i.agentRef,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert enforcement');
  }
  async updateEnforcement(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      status: string | null;
      reference: string | null;
      outcome: string | null;
      by: string | null;
    },
  ): Promise<EnforcementActionRow | null> {
    const r = await tx.query<EnforcementActionRow>(
      `UPDATE recovery_enforcement_action SET status=COALESCE($3,status), reference=COALESCE($4,reference), outcome=COALESCE($5,outcome), updated_by=$6, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status IN ('initiated','pending','active','stayed') RETURNING ${ENFORCEMENT_COLS}`,
      [i.id, i.expectedVersion, i.status, i.reference, i.outcome, i.by],
    );
    return r.rows[0] ?? null;
  }
  async completeEnforcement(
    tx: Tx,
    i: { id: string; expectedVersion: number; outcome: string | null; by: string | null },
  ): Promise<EnforcementActionRow | null> {
    const r = await tx.query<EnforcementActionRow>(
      `UPDATE recovery_enforcement_action SET status='completed', outcome=COALESCE($3,outcome), completed_date=current_date, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status IN ('initiated','pending','active') RETURNING ${ENFORCEMENT_COLS}`,
      [i.id, i.expectedVersion, i.outcome, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listEnforcements(tx: Tx, recoveryId: string): Promise<EnforcementActionRow[]> {
    const r = await tx.query<EnforcementActionRow>(
      `SELECT ${ENFORCEMENT_COLS} FROM recovery_enforcement_action WHERE recovery_id=$1 ORDER BY created_at`,
      [recoveryId],
    );
    return r.rows;
  }
  async countOpenEnforcementActions(tx: Tx, recoveryId: string): Promise<number> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM recovery_enforcement_action WHERE recovery_id=$1 AND status IN ('initiated','pending','active')`,
      [recoveryId],
    );
    return count(r.rows);
  }

  // --- security (single-winner realize) ---------------------------------------------------------
  async insertSecurity(
    tx: Tx,
    i: {
      tenantId: string;
      recoveryId: string;
      securityType: string;
      description: string | null;
      assetRef: string | null;
      registrationReference: string | null;
      chargePriority: string | null;
      estimatedValueMinor: number | null;
      forcedSaleValueMinor: number | null;
      currency: string | null;
      valuationDate: string | null;
      valuationRef: string | null;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<SecurityRow> {
    const r = await tx.query<SecurityRow>(
      `INSERT INTO recovery_security (tenant_id, recovery_id, security_type, description, asset_ref, registration_reference, charge_priority, estimated_value_minor, forced_sale_value_minor, currency, valuation_date, valuation_ref, confidentiality, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING ${SECURITY_COLS}`,
      [
        i.tenantId,
        i.recoveryId,
        i.securityType,
        i.description,
        i.assetRef,
        i.registrationReference,
        i.chargePriority,
        i.estimatedValueMinor,
        i.forcedSaleValueMinor,
        i.currency,
        i.valuationDate,
        i.valuationRef,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert security');
  }
  /** Records a realized amount as a REFERENCE. Single-winner: only from held/perfected/realizing. */
  async realizeSecurity(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      realizedAmountMinor: number | null;
      realizedDate: string | null;
      by: string | null;
    },
  ): Promise<SecurityRow | null> {
    const r = await tx.query<SecurityRow>(
      `UPDATE recovery_security SET status='realized', realized_amount_minor=$3, realized_date=COALESCE($4, current_date), updated_by=$5, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status IN ('held','perfected','realizing') RETURNING ${SECURITY_COLS}`,
      [i.id, i.expectedVersion, i.realizedAmountMinor, i.realizedDate, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listSecurities(tx: Tx, recoveryId: string): Promise<SecurityRow[]> {
    const r = await tx.query<SecurityRow>(
      `SELECT ${SECURITY_COLS} FROM recovery_security WHERE recovery_id=$1 ORDER BY created_at`,
      [recoveryId],
    );
    return r.rows;
  }

  // --- external agents --------------------------------------------------------------------------
  async insertAgent(
    tx: Tx,
    i: {
      tenantId: string;
      recoveryId: string;
      agentRef: string | null;
      agentType: string | null;
      engagementReference: string | null;
      instructionScope: string | null;
      feeArrangementReference: string | null;
      reportingFrequency: string | null;
      nextReportDue: string | null;
      internalOwner: string | null;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<AgentRow> {
    const r = await tx.query<AgentRow>(
      `INSERT INTO recovery_agent (tenant_id, recovery_id, agent_ref, agent_type, engagement_reference, instruction_scope, fee_arrangement_reference, reporting_frequency, next_report_due, internal_owner, confidentiality, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING ${AGENT_COLS}`,
      [
        i.tenantId,
        i.recoveryId,
        i.agentRef,
        i.agentType,
        i.engagementReference,
        i.instructionScope,
        i.feeArrangementReference,
        i.reportingFrequency,
        i.nextReportDue,
        i.internalOwner,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert agent');
  }
  async updateAgent(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      status: string | null;
      reportingFrequency: string | null;
      nextReportDue: string | null;
      performanceNote: string | null;
      by: string | null;
    },
  ): Promise<AgentRow | null> {
    const r = await tx.query<AgentRow>(
      `UPDATE recovery_agent SET status=COALESCE($3,status), reporting_frequency=COALESCE($4,reporting_frequency), next_report_due=COALESCE($5,next_report_due), performance_note=COALESCE($6,performance_note), updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status <> 'terminated' RETURNING ${AGENT_COLS}`,
      [i.id, i.expectedVersion, i.status, i.reportingFrequency, i.nextReportDue, i.performanceNote, i.by],
    );
    return r.rows[0] ?? null;
  }
  async terminateAgent(
    tx: Tx,
    i: { id: string; expectedVersion: number; by: string | null },
  ): Promise<AgentRow | null> {
    const r = await tx.query<AgentRow>(
      `UPDATE recovery_agent SET status='terminated', updated_by=$3, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status <> 'terminated' RETURNING ${AGENT_COLS}`,
      [i.id, i.expectedVersion, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listAgents(tx: Tx, recoveryId: string): Promise<AgentRow[]> {
    const r = await tx.query<AgentRow>(
      `SELECT ${AGENT_COLS} FROM recovery_agent WHERE recovery_id=$1 ORDER BY created_at`,
      [recoveryId],
    );
    return r.rows;
  }
  async hasActiveAgent(tx: Tx, recoveryId: string): Promise<boolean> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM recovery_agent WHERE recovery_id=$1 AND status IN ('instructed','active','reporting','suspended')`,
      [recoveryId],
    );
    return count(r.rows) > 0;
  }

  // --- agent reports (append-only) --------------------------------------------------------------
  async insertAgentReport(
    tx: Tx,
    i: {
      tenantId: string;
      recoveryId: string;
      agentId: string | null;
      reportingPeriod: string | null;
      statusSummary: string | null;
      actionTaken: string | null;
      nextAction: string | null;
      amountCollectedMinor: number | null;
      currency: string | null;
      reportDate: string | null;
      documentRef: string | null;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<AgentReportRow> {
    const r = await tx.query<AgentReportRow>(
      `INSERT INTO recovery_agent_report (tenant_id, recovery_id, agent_id, reporting_period, status_summary, action_taken, next_action, amount_collected_minor, currency, report_date, document_ref, confidentiality, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING ${AGENT_REPORT_COLS}`,
      [
        i.tenantId,
        i.recoveryId,
        i.agentId,
        i.reportingPeriod,
        i.statusSummary,
        i.actionTaken,
        i.nextAction,
        i.amountCollectedMinor,
        i.currency,
        i.reportDate,
        i.documentRef,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert agent report');
  }
  async listAgentReports(tx: Tx, recoveryId: string): Promise<AgentReportRow[]> {
    const r = await tx.query<AgentReportRow>(
      `SELECT ${AGENT_REPORT_COLS} FROM recovery_agent_report WHERE recovery_id=$1 ORDER BY created_at`,
      [recoveryId],
    );
    return r.rows;
  }
  async hasAgentReport(tx: Tx, recoveryId: string): Promise<boolean> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM recovery_agent_report WHERE recovery_id=$1`,
      [recoveryId],
    );
    return count(r.rows) > 0;
  }

  // --- receipts (append-only, REFERENCE only) ---------------------------------------------------
  async insertReceipt(
    tx: Tx,
    i: {
      tenantId: string;
      recoveryId: string;
      receiptType: string;
      externalReference: string | null;
      amountMinor: number | null;
      currency: string | null;
      receivedDate: string | null;
      partyRef: string | null;
      arrangementRef: string | null;
      enforcementActionRef: string | null;
      securityRef: string | null;
      financeReference: string | null;
      documentRef: string | null;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ReceiptRow> {
    const r = await tx.query<ReceiptRow>(
      `INSERT INTO recovery_receipt (tenant_id, recovery_id, receipt_type, external_reference, amount_minor, currency, received_date, party_ref, arrangement_ref, enforcement_action_ref, security_ref, finance_reference, document_ref, confidentiality, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING ${RECEIPT_COLS}`,
      [
        i.tenantId,
        i.recoveryId,
        i.receiptType,
        i.externalReference,
        i.amountMinor,
        i.currency,
        i.receivedDate,
        i.partyRef,
        i.arrangementRef,
        i.enforcementActionRef,
        i.securityRef,
        i.financeReference,
        i.documentRef,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert receipt');
  }
  async listReceipts(tx: Tx, recoveryId: string): Promise<ReceiptRow[]> {
    const r = await tx.query<ReceiptRow>(
      `SELECT ${RECEIPT_COLS} FROM recovery_receipt WHERE recovery_id=$1 ORDER BY created_at`,
      [recoveryId],
    );
    return r.rows;
  }

  // --- waivers (append-only) --------------------------------------------------------------------
  async insertWaiver(
    tx: Tx,
    i: {
      tenantId: string;
      recoveryId: string;
      waiverType: string | null;
      amountMinor: number | null;
      currency: string | null;
      reason: string | null;
      grantedBy: string | null;
      authority: string | null;
      grantedDate: string | null;
      documentRef: string | null;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<WaiverRow> {
    const r = await tx.query<WaiverRow>(
      `INSERT INTO recovery_waiver (tenant_id, recovery_id, waiver_type, amount_minor, currency, reason, granted_by, authority, granted_date, document_ref, confidentiality, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${WAIVER_COLS}`,
      [
        i.tenantId,
        i.recoveryId,
        i.waiverType,
        i.amountMinor,
        i.currency,
        i.reason,
        i.grantedBy,
        i.authority,
        i.grantedDate,
        i.documentRef,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert waiver');
  }
  async listWaivers(tx: Tx, recoveryId: string): Promise<WaiverRow[]> {
    const r = await tx.query<WaiverRow>(
      `SELECT ${WAIVER_COLS} FROM recovery_waiver WHERE recovery_id=$1 ORDER BY created_at`,
      [recoveryId],
    );
    return r.rows;
  }

  // --- write-off recommendations (maker-checker; single-winner approve) -------------------------
  async insertWriteOff(
    tx: Tx,
    i: {
      tenantId: string;
      recoveryId: string;
      reasonCode: string;
      amountMinor: number | null;
      currency: string | null;
      narrative: string | null;
      recommendedBy: string | null;
      recommendedDate: string | null;
      documentRef: string | null;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<WriteoffRow> {
    const r = await tx.query<WriteoffRow>(
      `INSERT INTO recovery_writeoff_recommendation (tenant_id, recovery_id, reason_code, amount_minor, currency, narrative, recommended_by, recommended_date, document_ref, confidentiality, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING ${WRITEOFF_COLS}`,
      [
        i.tenantId,
        i.recoveryId,
        i.reasonCode,
        i.amountMinor,
        i.currency,
        i.narrative,
        i.recommendedBy,
        i.recommendedDate,
        i.documentRef,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert writeoff');
  }
  async findWriteOff(tx: Tx, id: string): Promise<WriteoffRow | null> {
    const r = await tx.query<WriteoffRow>(
      `SELECT ${WRITEOFF_COLS} FROM recovery_writeoff_recommendation WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  /** Single-winner approval: compare-and-set on approval_status='recommended' AND version=$expected. */
  async approveWriteOff(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      decision: 'approved' | 'rejected';
      approvedBy: string | null;
      financeReference: string | null;
    },
  ): Promise<WriteoffRow | null> {
    const r = await tx.query<WriteoffRow>(
      `UPDATE recovery_writeoff_recommendation SET approval_status=$3, approved_by=$4, approved_at=now(), finance_reference=COALESCE($5,finance_reference), updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND approval_status='recommended' RETURNING ${WRITEOFF_COLS}`,
      [i.id, i.expectedVersion, i.decision, i.approvedBy, i.financeReference],
    );
    return r.rows[0] ?? null;
  }
  async listWriteOffs(tx: Tx, recoveryId: string): Promise<WriteoffRow[]> {
    const r = await tx.query<WriteoffRow>(
      `SELECT ${WRITEOFF_COLS} FROM recovery_writeoff_recommendation WHERE recovery_id=$1 ORDER BY created_at`,
      [recoveryId],
    );
    return r.rows;
  }
  /** Closure guard: no write-off recommendation left in the un-dispositioned 'recommended' state. */
  async writeOffDispositioned(tx: Tx, recoveryId: string): Promise<boolean> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM recovery_writeoff_recommendation WHERE recovery_id=$1 AND approval_status='recommended'`,
      [recoveryId],
    );
    return count(r.rows) === 0;
  }

  // --- outcomes (append-only) -------------------------------------------------------------------
  async insertOutcome(
    tx: Tx,
    i: {
      tenantId: string;
      recoveryId: string;
      outcomeType: string;
      outcomeDate: string | null;
      summary: string | null;
      recoveredAmountMinor: number | null;
      waivedAmountMinor: number | null;
      writtenOffAmountMinor: number | null;
      outstandingAmountMinor: number | null;
      currency: string | null;
      documentRef: string | null;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<OutcomeRow> {
    const r = await tx.query<OutcomeRow>(
      `INSERT INTO recovery_outcome (tenant_id, recovery_id, outcome_type, outcome_date, summary, recovered_amount_minor, waived_amount_minor, written_off_amount_minor, outstanding_amount_minor, currency, document_ref, confidentiality, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING ${OUTCOME_COLS}`,
      [
        i.tenantId,
        i.recoveryId,
        i.outcomeType,
        i.outcomeDate,
        i.summary,
        i.recoveredAmountMinor,
        i.waivedAmountMinor,
        i.writtenOffAmountMinor,
        i.outstandingAmountMinor,
        i.currency,
        i.documentRef,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert outcome');
  }
  async listOutcomes(tx: Tx, recoveryId: string): Promise<OutcomeRow[]> {
    const r = await tx.query<OutcomeRow>(
      `SELECT ${OUTCOME_COLS} FROM recovery_outcome WHERE recovery_id=$1 ORDER BY created_at`,
      [recoveryId],
    );
    return r.rows;
  }
  async hasOutcome(tx: Tx, recoveryId: string): Promise<boolean> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM recovery_outcome WHERE recovery_id=$1`,
      [recoveryId],
    );
    return count(r.rows) > 0;
  }

  // --- deadlines --------------------------------------------------------------------------------
  async insertDeadline(
    tx: Tx,
    i: {
      tenantId: string;
      recoveryId: string;
      deadlineType: string;
      startAt: string | null;
      dueAt: string;
      rule: unknown;
      source: string | null;
      authority: string | null;
      warnWindowMs: number | null;
      relatedDemand: string | null;
      relatedArrangement: string | null;
      relatedEnforcement: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<DeadlineRow> {
    const r = await tx.query<DeadlineRow>(
      `INSERT INTO recovery_deadline (tenant_id, recovery_id, deadline_type, start_at, due_at, rule, source, authority, warn_window_ms, related_demand, related_arrangement, related_enforcement, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING ${DEADLINE_COLS}`,
      [
        i.tenantId,
        i.recoveryId,
        i.deadlineType,
        i.startAt,
        i.dueAt,
        JSON.stringify(i.rule ?? {}),
        i.source,
        i.authority,
        i.warnWindowMs,
        i.relatedDemand,
        i.relatedArrangement,
        i.relatedEnforcement,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert deadline');
  }
  async findDeadline(tx: Tx, id: string): Promise<DeadlineRow | null> {
    const r = await tx.query<DeadlineRow>(`SELECT ${DEADLINE_COLS} FROM recovery_deadline WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async extendDeadline(
    tx: Tx,
    i: { id: string; expectedVersion: number; extensionTo: string; by: string | null },
  ): Promise<DeadlineRow | null> {
    const r = await tx.query<DeadlineRow>(
      `UPDATE recovery_deadline SET due_at=$3, status='extended', updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status IN ('open','extended') RETURNING ${DEADLINE_COLS}`,
      [i.id, i.expectedVersion, i.extensionTo, i.by],
    );
    return r.rows[0] ?? null;
  }
  async markDeadlineBreach(tx: Tx, id: string): Promise<DeadlineRow | null> {
    const r = await tx.query<DeadlineRow>(
      `UPDATE recovery_deadline SET status='breached', updated_at=now(), version=version+1 WHERE id=$1 AND status IN ('open','extended') RETURNING ${DEADLINE_COLS}`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async listDeadlines(tx: Tx, recoveryId: string): Promise<DeadlineRow[]> {
    const r = await tx.query<DeadlineRow>(
      `SELECT ${DEADLINE_COLS} FROM recovery_deadline WHERE recovery_id=$1 ORDER BY due_at`,
      [recoveryId],
    );
    return r.rows;
  }
  async countOpenDeadlines(tx: Tx, recoveryId: string): Promise<number> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM recovery_deadline WHERE recovery_id=$1 AND status IN ('open','extended')`,
      [recoveryId],
    );
    return count(r.rows);
  }
  async hasImminentLimitation(tx: Tx, recoveryId: string, withinIso: string): Promise<boolean> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM recovery_deadline WHERE recovery_id=$1 AND deadline_type='limitation' AND status IN ('open','extended') AND due_at <= $2`,
      [recoveryId, withinIso],
    );
    return count(r.rows) > 0;
  }

  // --- cost references --------------------------------------------------------------------------
  async insertCost(
    tx: Tx,
    i: {
      tenantId: string;
      recoveryId: string;
      costType: string | null;
      description: string | null;
      amountMinor: number | null;
      currency: string | null;
      agentReference: string | null;
      invoiceReference: string | null;
      recoverable: boolean;
      correlationId: string;
      by: string | null;
    },
  ): Promise<CostRow> {
    const r = await tx.query<CostRow>(
      `INSERT INTO recovery_cost_reference (tenant_id, recovery_id, cost_type, description, amount_minor, currency, incurred_date, agent_reference, invoice_reference, recoverable, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6, current_date, $7,$8,$9,$10,$11,$11) RETURNING ${COST_COLS}`,
      [
        i.tenantId,
        i.recoveryId,
        i.costType,
        i.description,
        i.amountMinor,
        i.currency,
        i.agentReference,
        i.invoiceReference,
        i.recoverable,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert cost');
  }
  async listCosts(tx: Tx, recoveryId: string): Promise<CostRow[]> {
    const r = await tx.query<CostRow>(
      `SELECT ${COST_COLS} FROM recovery_cost_reference WHERE recovery_id=$1 ORDER BY created_at`,
      [recoveryId],
    );
    return r.rows;
  }

  // --- notes (append-only) ----------------------------------------------------------------------
  async insertNote(
    tx: Tx,
    i: {
      tenantId: string;
      recoveryId: string;
      noteType: string;
      headline: string | null;
      content: string;
      privileged: boolean;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<NoteRow> {
    const r = await tx.query<NoteRow>(
      `INSERT INTO recovery_note (tenant_id, recovery_id, note_type, headline, content, privileged, confidentiality, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${NOTE_COLS}`,
      [
        i.tenantId,
        i.recoveryId,
        i.noteType,
        i.headline,
        i.content,
        i.privileged,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert note');
  }
  async listNotes(tx: Tx, recoveryId: string): Promise<NoteRow[]> {
    const r = await tx.query<NoteRow>(
      `SELECT ${NOTE_COLS} FROM recovery_note WHERE recovery_id=$1 ORDER BY created_at`,
      [recoveryId],
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
      `INSERT INTO recovery_relationship (tenant_id, from_recovery_id, to_recovery_id, kind, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${REL_COLS}`,
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
      `SELECT ${REL_COLS} FROM recovery_relationship WHERE from_recovery_id=$1 AND to_recovery_id=$2 AND kind=$3 AND status='active'`,
      [toId, fromId, kind],
    );
    return r.rows[0] ?? null;
  }
  async listRelationships(tx: Tx, recoveryId: string): Promise<RelationshipRow[]> {
    const r = await tx.query<RelationshipRow>(
      `SELECT ${REL_COLS} FROM recovery_relationship WHERE (from_recovery_id=$1 OR to_recovery_id=$1) AND status='active' ORDER BY created_at`,
      [recoveryId],
    );
    return r.rows;
  }

  // --- closure count helpers --------------------------------------------------------------------
  /** Agent-final-report guard: true when there is no still-active agent OR at least one agent report exists. */
  async agentFinalReport(tx: Tx, recoveryId: string): Promise<boolean> {
    const active = await this.hasActiveAgent(tx, recoveryId);
    if (!active) return true;
    return this.hasAgentReport(tx, recoveryId);
  }
}
