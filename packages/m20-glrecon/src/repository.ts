/**
 * M20 repository — ALL SQL for GL reconciliation across the 24 gl_* tables. Every query is parameterized; every
 * mutating UPDATE on a mutable aggregate is optimistic-lock guarded (`WHERE id=$1 AND version=$expected`) so a stale
 * command changes zero rows and the caller reacts (single-winner). Queries carry NO tenant_id predicate: RLS FORCE is
 * the isolation guarantee. All methods take the caller's `Tx` so the row write, its append-only evidence, audit and
 * outbox commit atomically. Ruleset/status/certification history, import errors, run balances, match lines, engine
 * candidates, manual decisions, run summaries and notes are append-only (INSERT + SELECT). Duplicate imports are
 * blocked by the per-account file-hash unique index; a match is idempotent on its key; a ruleset has exactly one
 * active version per code; a GL balance satisfies the invariant closing = opening + debits − credits (DB-checked).
 *
 * MONEY IS INTEGER MINOR UNITS (bigint). Every `*_minor` column is PROJECTED `::text` and carried in the Row types as
 * a STRING — never parsed into a binary float (ADR-007, CLAUDE.md money rule). INSERTs accept an integer `number`
 * (validated by callers / the engine); the driver serialises it losslessly to bigint. m20 owns only `gl_*`; it NEVER
 * reads another module's tables (gl_account_ref/currency_ref/document_ref are OPAQUE ids). It never posts a journal.
 */
import type { Tx } from '@finapp/kernel';

// --- row types (raw DB shape; snake_case columns as SELECTed) ------------------------------------
export interface GlAccountRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly gl_account_ref: string | null;
  readonly currency_ref: string | null;
  readonly source_system: string;
  readonly code: string;
  readonly name: string;
  readonly normal_side: string;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}

export interface GlRulesetRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly code: string;
  readonly version_number: number;
  readonly name: string | null;
  readonly status: string;
  readonly date_window_days: number;
  /** INTEGER MINOR UNITS — read/written as a STRING, never a float (ADR-007). */
  readonly amount_tolerance_minor: string;
  readonly require_opposite_direction: boolean;
  readonly content_hash: string | null;
  readonly supersedes_id: string | null;
  readonly superseded_by_id: string | null;
  readonly version: number;
  readonly correlation_id: string;
}

export interface GlRuleRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly ruleset_id: string;
  readonly rule_code: string;
  readonly rule_kind: string;
  readonly weight: number;
  readonly priority: number;
  readonly version: number;
  readonly correlation_id: string;
}

export interface GlRulesetHistoryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly ruleset_id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly reason: string | null;
  readonly by_user: string | null;
  readonly correlation_id: string;
}

export interface GlImportRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly gl_account_id: string;
  readonly source_format: string;
  readonly file_hash: string;
  readonly file_name: string | null;
  readonly document_ref: string | null;
  readonly status: string;
  readonly line_count: number;
  readonly period_start: string | null;
  readonly period_end: string | null;
  readonly idempotency_key: string | null;
  readonly version: number;
  readonly correlation_id: string;
}

export interface GlImportErrorRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly import_id: string;
  readonly import_kind: string;
  readonly line_no: number | null;
  readonly error_code: string;
  readonly detail: string | null;
  readonly correlation_id: string;
}

export interface GlBalanceRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly gl_account_id: string;
  readonly import_id: string | null;
  readonly currency_ref: string | null;
  readonly period_start: string;
  readonly period_end: string;
  /** INTEGER MINOR UNITS — read/written as STRINGS, never a float (ADR-007). */
  readonly opening_balance_minor: string;
  readonly debits_minor: string;
  readonly credits_minor: string;
  readonly closing_balance_minor: string;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}

export interface GlLineRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly import_id: string;
  readonly gl_account_id: string;
  readonly line_no: number;
  readonly txn_date: string;
  /** INTEGER MINOR UNITS — read/written as a STRING, never a float (ADR-007). */
  readonly amount_minor: string;
  readonly direction: string;
  readonly reference: string | null;
  readonly description: string | null;
  readonly source_ref: string | null;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}

export interface GlSourceImportRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly gl_account_id: string;
  readonly source_system: string;
  readonly source_format: string;
  readonly file_hash: string | null;
  readonly document_ref: string | null;
  readonly status: string;
  readonly entry_count: number;
  readonly idempotency_key: string | null;
  readonly version: number;
  readonly correlation_id: string;
}

export interface GlSourceLineRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly source_import_id: string;
  readonly gl_account_id: string;
  readonly line_no: number | null;
  readonly entry_date: string;
  /** INTEGER MINOR UNITS — read/written as a STRING, never a float (ADR-007). */
  readonly amount_minor: string;
  readonly direction: string;
  readonly reference: string | null;
  readonly description: string | null;
  readonly source_ref: string | null;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}

export interface GlRunRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly gl_account_id: string;
  readonly ruleset_id: string | null;
  readonly period_start: string | null;
  readonly period_end: string | null;
  /** INTEGER MINOR UNITS — read/written as STRINGS, never a float (ADR-007). */
  readonly opening_balance_minor: string | null;
  readonly closing_balance_minor: string | null;
  readonly status: string;
  readonly matched_count: number;
  readonly unmatched_count: number;
  readonly exception_count: number;
  readonly item_count: number;
  readonly version: number;
  readonly correlation_id: string;
}

export interface GlRunStatusHistoryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly run_id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly reason: string | null;
  readonly reason_code: string | null;
  readonly by_user: string | null;
  readonly correlation_id: string;
}

export interface GlRunBalanceRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly run_id: string;
  /** INTEGER MINOR UNITS — read/written as STRINGS, never a float (ADR-007). */
  readonly opening_minor: string;
  readonly debits_minor: string;
  readonly credits_minor: string;
  readonly calculated_closing_minor: string;
  readonly source_closing_minor: string | null;
  readonly variance_minor: string;
  readonly balanced: boolean;
  readonly correlation_id: string;
}

export interface GlMatchRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly run_id: string;
  readonly match_type: string;
  readonly status: string;
  readonly confidence_band: string | null;
  readonly colour_status: string | null;
  readonly score: number | null;
  /** INTEGER MINOR UNITS — read/written as a STRING, never a float (ADR-007). */
  readonly amount_variance_minor: string;
  readonly matched_by: string;
  readonly ruleset_id: string | null;
  readonly ruleset_version: number | null;
  readonly idempotency_key: string | null;
  readonly version: number;
  readonly correlation_id: string;
}

export interface GlMatchLineRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly match_id: string;
  readonly side: string;
  readonly gl_line_id: string | null;
  readonly source_line_id: string | null;
  /** INTEGER MINOR UNITS — read/written as a STRING, never a float (ADR-007). */
  readonly amount_minor: string;
  readonly correlation_id: string;
}

export interface GlMatchCandidateRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly run_id: string;
  readonly gl_line_id: string | null;
  readonly source_line_id: string | null;
  readonly score: number;
  readonly confidence_band: string;
  readonly colour_status: string | null;
  /** INTEGER MINOR UNITS — read/written as a STRING, never a float (ADR-007). */
  readonly amount_variance_minor: string;
  readonly date_variance_days: number | null;
  readonly reference_match: string | null;
  /** Text-similarity ratio 0..1 (NOT money) — carried as a STRING for exact fidelity. */
  readonly description_score: string | null;
  readonly direction_compatible: boolean | null;
  readonly reason_codes: readonly string[];
  readonly rule_codes: readonly string[];
  readonly ruleset_id: string | null;
  readonly ruleset_version: number | null;
  readonly correlation_id: string;
}

export interface GlReconcilingItemRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly run_id: string;
  readonly item_type: string;
  readonly gl_line_id: string | null;
  readonly source_line_id: string | null;
  /** INTEGER MINOR UNITS — read/written as a STRING, never a float (ADR-007). */
  readonly amount_minor: string;
  readonly direction: string | null;
  readonly status: string;
  readonly age_days: number;
  readonly reason: string | null;
  readonly cleared_by: string | null;
  readonly cleared_at: string | null;
  readonly version: number;
  readonly correlation_id: string;
}

export interface GlExceptionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly run_id: string;
  readonly gl_line_id: string | null;
  readonly source_line_id: string | null;
  readonly exception_type: string;
  readonly status: string;
  readonly assigned_to: string | null;
  readonly age_days: number;
  readonly reason: string | null;
  readonly required: boolean;
  readonly resolved_by: string | null;
  readonly resolved_at: string | null;
  readonly version: number;
  readonly correlation_id: string;
}

export interface GlManualDecisionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly run_id: string;
  readonly decision_type: string;
  readonly match_id: string | null;
  readonly gl_line_id: string | null;
  readonly source_line_id: string | null;
  readonly exception_id: string | null;
  readonly item_id: string | null;
  readonly by_user: string | null;
  readonly reason: string | null;
  readonly correlation_id: string;
}

export interface GlCertificationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly run_id: string;
  readonly gl_account_id: string;
  readonly period_start: string | null;
  readonly period_end: string | null;
  readonly currency_ref: string | null;
  /** INTEGER MINOR UNITS — read/written as STRINGS, never a float (ADR-007). */
  readonly calculated_balance_minor: string;
  readonly source_balance_minor: string;
  readonly variance_minor: string;
  readonly unresolved_exception_count: number;
  readonly open_item_count: number;
  readonly status: string;
  readonly is_override: boolean;
  readonly override_reason: string | null;
  readonly certified_by: string | null;
  readonly certified_at: string | null;
  readonly version: number;
  readonly correlation_id: string;
}

export interface GlCertificationHistoryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly certification_id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly reason: string | null;
  readonly is_override: boolean;
  readonly by_user: string | null;
  readonly correlation_id: string;
}

export interface GlRecommendationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly run_id: string;
  readonly exception_id: string | null;
  readonly reconciling_item_id: string | null;
  readonly debit_account_ref: string | null;
  readonly credit_account_ref: string | null;
  /** INTEGER MINOR UNITS — read/written as a STRING, never a float (ADR-007). */
  readonly amount_minor: string;
  readonly currency_ref: string | null;
  readonly description: string | null;
  readonly reason_code: string | null;
  readonly confidence_band: string | null;
  readonly status: string;
  readonly is_draft: boolean;
  readonly handoff_ref: string | null;
  readonly version: number;
  readonly correlation_id: string;
}

export interface GlRunSummaryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly run_id: string;
  readonly matched_count: number;
  readonly unmatched_count: number;
  readonly exception_count: number;
  readonly item_count: number;
  /** INTEGER MINOR UNITS — read/written as STRINGS, never a float (ADR-007). */
  readonly matched_amount_minor: string;
  readonly unmatched_amount_minor: string;
  readonly balance_variance_minor: string;
  readonly balanced: boolean;
  readonly colour_status: string | null;
  readonly correlation_id: string;
}

export interface GlNoteRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly run_id: string;
  readonly note_type: string;
  readonly content: string;
  readonly by_user: string | null;
  readonly correlation_id: string;
}

// --- column projections (kept in one place so SELECT/INSERT/UPDATE stay in lock-step) ------------
const ACCOUNT_COLS =
  'tenant_id, id, gl_account_ref, currency_ref, source_system, code, name, normal_side, status, version, correlation_id';
const RULESET_COLS =
  'tenant_id, id, code, version_number, name, status, date_window_days, amount_tolerance_minor::text AS amount_tolerance_minor, require_opposite_direction, content_hash, supersedes_id, superseded_by_id, version, correlation_id';
const RULE_COLS =
  'tenant_id, id, ruleset_id, rule_code, rule_kind, weight, priority, version, correlation_id';
const RULESET_HISTORY_COLS =
  'tenant_id, id, ruleset_id, from_status, to_status, reason, by_user, correlation_id';
const IMPORT_COLS =
  'tenant_id, id, gl_account_id, source_format, file_hash, file_name, document_ref, status, line_count, period_start::text AS period_start, period_end::text AS period_end, idempotency_key, version, correlation_id';
const IMPORT_ERROR_COLS =
  'tenant_id, id, import_id, import_kind, line_no, error_code, detail, correlation_id';
const BALANCE_COLS =
  'tenant_id, id, gl_account_id, import_id, currency_ref, period_start::text AS period_start, period_end::text AS period_end, opening_balance_minor::text AS opening_balance_minor, debits_minor::text AS debits_minor, credits_minor::text AS credits_minor, closing_balance_minor::text AS closing_balance_minor, status, version, correlation_id';
const LINE_COLS =
  'tenant_id, id, import_id, gl_account_id, line_no, txn_date::text AS txn_date, amount_minor::text AS amount_minor, direction, reference, description, source_ref, status, version, correlation_id';
const SOURCE_IMPORT_COLS =
  'tenant_id, id, gl_account_id, source_system, source_format, file_hash, document_ref, status, entry_count, idempotency_key, version, correlation_id';
const SOURCE_LINE_COLS =
  'tenant_id, id, source_import_id, gl_account_id, line_no, entry_date::text AS entry_date, amount_minor::text AS amount_minor, direction, reference, description, source_ref, status, version, correlation_id';
const RUN_COLS =
  'tenant_id, id, gl_account_id, ruleset_id, period_start::text AS period_start, period_end::text AS period_end, opening_balance_minor::text AS opening_balance_minor, closing_balance_minor::text AS closing_balance_minor, status, matched_count, unmatched_count, exception_count, item_count, version, correlation_id';
const RUN_STATUS_HISTORY_COLS =
  'tenant_id, id, run_id, from_status, to_status, reason, reason_code, by_user, correlation_id';
const RUN_BALANCE_COLS =
  'tenant_id, id, run_id, opening_minor::text AS opening_minor, debits_minor::text AS debits_minor, credits_minor::text AS credits_minor, calculated_closing_minor::text AS calculated_closing_minor, source_closing_minor::text AS source_closing_minor, variance_minor::text AS variance_minor, balanced, correlation_id';
const MATCH_COLS =
  'tenant_id, id, run_id, match_type, status, confidence_band, colour_status, score, amount_variance_minor::text AS amount_variance_minor, matched_by, ruleset_id, ruleset_version, idempotency_key, version, correlation_id';
const MATCH_LINE_COLS =
  'tenant_id, id, match_id, side, gl_line_id, source_line_id, amount_minor::text AS amount_minor, correlation_id';
const MATCH_CANDIDATE_COLS =
  'tenant_id, id, run_id, gl_line_id, source_line_id, score, confidence_band, colour_status, amount_variance_minor::text AS amount_variance_minor, date_variance_days, reference_match, description_score::text AS description_score, direction_compatible, reason_codes, rule_codes, ruleset_id, ruleset_version, correlation_id';
const ITEM_COLS =
  'tenant_id, id, run_id, item_type, gl_line_id, source_line_id, amount_minor::text AS amount_minor, direction, status, age_days, reason, cleared_by, cleared_at::text AS cleared_at, version, correlation_id';
const EXCEPTION_COLS =
  'tenant_id, id, run_id, gl_line_id, source_line_id, exception_type, status, assigned_to, age_days, reason, required, resolved_by, resolved_at::text AS resolved_at, version, correlation_id';
const MANUAL_DECISION_COLS =
  'tenant_id, id, run_id, decision_type, match_id, gl_line_id, source_line_id, exception_id, item_id, by_user, reason, correlation_id';
const CERTIFICATION_COLS =
  'tenant_id, id, run_id, gl_account_id, period_start::text AS period_start, period_end::text AS period_end, currency_ref, calculated_balance_minor::text AS calculated_balance_minor, source_balance_minor::text AS source_balance_minor, variance_minor::text AS variance_minor, unresolved_exception_count, open_item_count, status, is_override, override_reason, certified_by, certified_at::text AS certified_at, version, correlation_id';
const CERTIFICATION_HISTORY_COLS =
  'tenant_id, id, certification_id, from_status, to_status, reason, is_override, by_user, correlation_id';
const RECOMMENDATION_COLS =
  'tenant_id, id, run_id, exception_id, reconciling_item_id, debit_account_ref, credit_account_ref, amount_minor::text AS amount_minor, currency_ref, description, reason_code, confidence_band, status, is_draft, handoff_ref, version, correlation_id';
const RUN_SUMMARY_COLS =
  'tenant_id, id, run_id, matched_count, unmatched_count, exception_count, item_count, matched_amount_minor::text AS matched_amount_minor, unmatched_amount_minor::text AS unmatched_amount_minor, balance_variance_minor::text AS balance_variance_minor, balanced, colour_status, correlation_id';
const NOTE_COLS = 'tenant_id, id, run_id, note_type, content, by_user, correlation_id';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m20 repository: expected a row from ${what}`);
  return row;
}

export class GlreconRepository {
  // --- GL account -------------------------------------------------------------------------------
  async insertAccount(
    tx: Tx,
    i: {
      tenantId: string;
      glAccountRef: string | null;
      currencyRef: string | null;
      sourceSystem: string;
      code: string;
      name: string;
      normalSide: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<GlAccountRow> {
    const r = await tx.query<GlAccountRow>(
      `INSERT INTO gl_recon_account (tenant_id, gl_account_ref, currency_ref, source_system, code, name, normal_side, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING ${ACCOUNT_COLS}`,
      [
        i.tenantId,
        i.glAccountRef,
        i.currencyRef,
        i.sourceSystem,
        i.code,
        i.name,
        i.normalSide,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert account');
  }
  async findAccount(tx: Tx, id: string): Promise<GlAccountRow | null> {
    const r = await tx.query<GlAccountRow>(`SELECT ${ACCOUNT_COLS} FROM gl_recon_account WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async updateAccount(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      name: string | null;
      sourceSystem: string | null;
      normalSide: string | null;
      glAccountRef: string | null;
      currencyRef: string | null;
      by: string | null;
    },
  ): Promise<GlAccountRow | null> {
    const r = await tx.query<GlAccountRow>(
      `UPDATE gl_recon_account SET name=COALESCE($3,name), source_system=COALESCE($4,source_system), normal_side=COALESCE($5,normal_side), gl_account_ref=COALESCE($6,gl_account_ref), currency_ref=COALESCE($7,currency_ref), updated_by=$8, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status <> 'archived' RETURNING ${ACCOUNT_COLS}`,
      [i.id, i.expectedVersion, i.name, i.sourceSystem, i.normalSide, i.glAccountRef, i.currencyRef, i.by],
    );
    return r.rows[0] ?? null;
  }
  async setAccountStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; toStatus: string; by: string | null },
  ): Promise<GlAccountRow | null> {
    const r = await tx.query<GlAccountRow>(
      `UPDATE gl_recon_account SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${ACCOUNT_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listAccounts(tx: Tx, status?: string): Promise<GlAccountRow[]> {
    const r = await tx.query<GlAccountRow>(
      `SELECT ${ACCOUNT_COLS} FROM gl_recon_account WHERE ($1::text IS NULL OR status=$1) ORDER BY code`,
      [status ?? null],
    );
    return r.rows;
  }

  // --- ruleset (versioned; immutable-after-publish; one active per code) ------------------------
  async insertRuleset(
    tx: Tx,
    i: {
      tenantId: string;
      code: string;
      versionNumber: number;
      name: string | null;
      dateWindowDays: number;
      amountToleranceMinor: number;
      requireOppositeDirection: boolean;
      supersedesId: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<GlRulesetRow> {
    const r = await tx.query<GlRulesetRow>(
      `INSERT INTO gl_ruleset (tenant_id, code, version_number, name, date_window_days, amount_tolerance_minor, require_opposite_direction, supersedes_id, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING ${RULESET_COLS}`,
      [
        i.tenantId,
        i.code,
        i.versionNumber,
        i.name,
        i.dateWindowDays,
        i.amountToleranceMinor,
        i.requireOppositeDirection,
        i.supersedesId,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert ruleset');
  }
  async findRuleset(tx: Tx, id: string): Promise<GlRulesetRow | null> {
    const r = await tx.query<GlRulesetRow>(`SELECT ${RULESET_COLS} FROM gl_ruleset WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findActiveRuleset(tx: Tx, code: string): Promise<GlRulesetRow | null> {
    const r = await tx.query<GlRulesetRow>(
      `SELECT ${RULESET_COLS} FROM gl_ruleset WHERE code=$1 AND status='active'`,
      [code],
    );
    return r.rows[0] ?? null;
  }
  async nextRulesetVersion(tx: Tx, code: string): Promise<number> {
    const r = await tx.query<{ next: number }>(
      `SELECT COALESCE(MAX(version_number),0)+1 AS next FROM gl_ruleset WHERE code=$1`,
      [code],
    );
    return firstRow(r.rows, 'next ruleset version').next;
  }
  async updateRulesetDraft(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      name: string | null;
      dateWindowDays: number | null;
      amountToleranceMinor: number | null;
      requireOppositeDirection: boolean | null;
      by: string | null;
    },
  ): Promise<GlRulesetRow | null> {
    const r = await tx.query<GlRulesetRow>(
      `UPDATE gl_ruleset SET name=COALESCE($3,name), date_window_days=COALESCE($4,date_window_days), amount_tolerance_minor=COALESCE($5,amount_tolerance_minor), require_opposite_direction=COALESCE($6,require_opposite_direction), updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status='draft' RETURNING ${RULESET_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.name,
        i.dateWindowDays,
        i.amountToleranceMinor,
        i.requireOppositeDirection,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async transitionRuleset(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      contentHash?: string | null;
      supersededById?: string | null;
      by: string | null;
    },
  ): Promise<GlRulesetRow | null> {
    const r = await tx.query<GlRulesetRow>(
      `UPDATE gl_ruleset SET status=$3, content_hash=COALESCE($4,content_hash), superseded_by_id=COALESCE($5,superseded_by_id), updated_by=$6, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${RULESET_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.contentHash ?? null, i.supersededById ?? null, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listRulesets(tx: Tx, i: { code?: string; status?: string }): Promise<GlRulesetRow[]> {
    const r = await tx.query<GlRulesetRow>(
      `SELECT ${RULESET_COLS} FROM gl_ruleset WHERE ($1::text IS NULL OR code=$1) AND ($2::text IS NULL OR status=$2) ORDER BY code, version_number DESC`,
      [i.code ?? null, i.status ?? null],
    );
    return r.rows;
  }

  // --- rule -------------------------------------------------------------------------------------
  async insertRule(
    tx: Tx,
    i: {
      tenantId: string;
      rulesetId: string;
      ruleCode: string;
      ruleKind: string;
      weight: number;
      priority: number;
      correlationId: string;
      by: string | null;
    },
  ): Promise<GlRuleRow> {
    const r = await tx.query<GlRuleRow>(
      `INSERT INTO gl_rule (tenant_id, ruleset_id, rule_code, rule_kind, weight, priority, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${RULE_COLS}`,
      [i.tenantId, i.rulesetId, i.ruleCode, i.ruleKind, i.weight, i.priority, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert rule');
  }
  async listRulesByRuleset(tx: Tx, rulesetId: string): Promise<GlRuleRow[]> {
    const r = await tx.query<GlRuleRow>(
      `SELECT ${RULE_COLS} FROM gl_rule WHERE ruleset_id=$1 ORDER BY priority, rule_code`,
      [rulesetId],
    );
    return r.rows;
  }

  // --- ruleset history (append-only) ------------------------------------------------------------
  async insertRulesetHistory(
    tx: Tx,
    i: {
      tenantId: string;
      rulesetId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO gl_ruleset_history (tenant_id, ruleset_id, from_status, to_status, reason, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [i.tenantId, i.rulesetId, i.fromStatus, i.toStatus, i.reason, i.by, i.correlationId],
    );
  }
  async listRulesetHistory(tx: Tx, rulesetId: string): Promise<GlRulesetHistoryRow[]> {
    const r = await tx.query<GlRulesetHistoryRow>(
      `SELECT ${RULESET_HISTORY_COLS} FROM gl_ruleset_history WHERE ruleset_id=$1 ORDER BY created_at`,
      [rulesetId],
    );
    return r.rows;
  }

  // --- GL import (duplicate-protected on (account, file_hash)) ----------------------------------
  async insertImport(
    tx: Tx,
    i: {
      tenantId: string;
      glAccountId: string;
      sourceFormat: string;
      fileHash: string;
      fileName: string | null;
      documentRef: string | null;
      periodStart: string | null;
      periodEnd: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<GlImportRow> {
    const r = await tx.query<GlImportRow>(
      `INSERT INTO gl_import (tenant_id, gl_account_id, source_format, file_hash, file_name, document_ref, period_start, period_end, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11,$11) RETURNING ${IMPORT_COLS}`,
      [
        i.tenantId,
        i.glAccountId,
        i.sourceFormat,
        i.fileHash,
        i.fileName,
        i.documentRef,
        i.periodStart,
        i.periodEnd,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert import');
  }
  async findImport(tx: Tx, id: string): Promise<GlImportRow | null> {
    const r = await tx.query<GlImportRow>(`SELECT ${IMPORT_COLS} FROM gl_import WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findImportByFileHash(tx: Tx, glAccountId: string, fileHash: string): Promise<GlImportRow | null> {
    const r = await tx.query<GlImportRow>(
      `SELECT ${IMPORT_COLS} FROM gl_import WHERE gl_account_id=$1 AND file_hash=$2`,
      [glAccountId, fileHash],
    );
    return r.rows[0] ?? null;
  }
  async findImportByIdempotencyKey(tx: Tx, key: string): Promise<GlImportRow | null> {
    const r = await tx.query<GlImportRow>(`SELECT ${IMPORT_COLS} FROM gl_import WHERE idempotency_key=$1`, [
      key,
    ]);
    return r.rows[0] ?? null;
  }
  async setImportStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; lineCount: number | null; by: string | null },
  ): Promise<GlImportRow | null> {
    const r = await tx.query<GlImportRow>(
      `UPDATE gl_import SET status=$3, line_count=COALESCE($4,line_count), updated_by=$5, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${IMPORT_COLS}`,
      [i.id, i.expectedVersion, i.status, i.lineCount, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listImports(tx: Tx, glAccountId: string): Promise<GlImportRow[]> {
    const r = await tx.query<GlImportRow>(
      `SELECT ${IMPORT_COLS} FROM gl_import WHERE gl_account_id=$1 ORDER BY created_at DESC`,
      [glAccountId],
    );
    return r.rows;
  }

  // --- import error (append-only) ---------------------------------------------------------------
  async insertImportError(
    tx: Tx,
    i: {
      tenantId: string;
      importId: string;
      importKind: string;
      lineNo: number | null;
      errorCode: string;
      detail: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO gl_import_error (tenant_id, import_id, import_kind, line_no, error_code, detail, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [i.tenantId, i.importId, i.importKind, i.lineNo, i.errorCode, i.detail, i.correlationId],
    );
  }
  async listImportErrors(tx: Tx, importId: string): Promise<GlImportErrorRow[]> {
    const r = await tx.query<GlImportErrorRow>(
      `SELECT ${IMPORT_ERROR_COLS} FROM gl_import_error WHERE import_id=$1 ORDER BY created_at`,
      [importId],
    );
    return r.rows;
  }

  // --- GL balance (invariant-checked) -----------------------------------------------------------
  async insertBalance(
    tx: Tx,
    i: {
      tenantId: string;
      glAccountId: string;
      importId: string | null;
      currencyRef: string | null;
      periodStart: string;
      periodEnd: string;
      openingBalanceMinor: number;
      debitsMinor: number;
      creditsMinor: number;
      closingBalanceMinor: number;
      correlationId: string;
      by: string | null;
    },
  ): Promise<GlBalanceRow> {
    const r = await tx.query<GlBalanceRow>(
      `INSERT INTO gl_balance (tenant_id, gl_account_id, import_id, currency_ref, period_start, period_end, opening_balance_minor, debits_minor, credits_minor, closing_balance_minor, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,$11,$12,$12) RETURNING ${BALANCE_COLS}`,
      [
        i.tenantId,
        i.glAccountId,
        i.importId,
        i.currencyRef,
        i.periodStart,
        i.periodEnd,
        i.openingBalanceMinor,
        i.debitsMinor,
        i.creditsMinor,
        i.closingBalanceMinor,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert balance');
  }
  async findBalance(tx: Tx, id: string): Promise<GlBalanceRow | null> {
    const r = await tx.query<GlBalanceRow>(`SELECT ${BALANCE_COLS} FROM gl_balance WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findBalanceForPeriod(
    tx: Tx,
    glAccountId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<GlBalanceRow | null> {
    const r = await tx.query<GlBalanceRow>(
      `SELECT ${BALANCE_COLS} FROM gl_balance WHERE gl_account_id=$1 AND period_start=$2::date AND period_end=$3::date`,
      [glAccountId, periodStart, periodEnd],
    );
    return r.rows[0] ?? null;
  }
  async listBalances(tx: Tx, glAccountId: string): Promise<GlBalanceRow[]> {
    const r = await tx.query<GlBalanceRow>(
      `SELECT ${BALANCE_COLS} FROM gl_balance WHERE gl_account_id=$1 ORDER BY period_start DESC`,
      [glAccountId],
    );
    return r.rows;
  }

  // --- GL line ----------------------------------------------------------------------------------
  async insertLine(
    tx: Tx,
    i: {
      tenantId: string;
      importId: string;
      glAccountId: string;
      lineNo: number;
      txnDate: string;
      amountMinor: number;
      direction: string;
      reference: string | null;
      description: string | null;
      sourceRef: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<GlLineRow> {
    const r = await tx.query<GlLineRow>(
      `INSERT INTO gl_line (tenant_id, import_id, gl_account_id, line_no, txn_date, amount_minor, direction, reference, description, source_ref, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING ${LINE_COLS}`,
      [
        i.tenantId,
        i.importId,
        i.glAccountId,
        i.lineNo,
        i.txnDate,
        i.amountMinor,
        i.direction,
        i.reference,
        i.description,
        i.sourceRef,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert line');
  }
  async findLine(tx: Tx, id: string): Promise<GlLineRow | null> {
    const r = await tx.query<GlLineRow>(`SELECT ${LINE_COLS} FROM gl_line WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async listLinesByImport(tx: Tx, importId: string): Promise<GlLineRow[]> {
    const r = await tx.query<GlLineRow>(
      `SELECT ${LINE_COLS} FROM gl_line WHERE import_id=$1 ORDER BY line_no`,
      [importId],
    );
    return r.rows;
  }
  async listUnmatchedLines(tx: Tx, glAccountId: string): Promise<GlLineRow[]> {
    const r = await tx.query<GlLineRow>(
      `SELECT ${LINE_COLS} FROM gl_line WHERE gl_account_id=$1 AND status='unmatched' ORDER BY txn_date, line_no, id`,
      [glAccountId],
    );
    return r.rows;
  }
  async setLineStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; toStatus: string; by: string | null },
  ): Promise<GlLineRow | null> {
    const r = await tx.query<GlLineRow>(
      `UPDATE gl_line SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${LINE_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }

  // --- source import ----------------------------------------------------------------------------
  async insertSourceImport(
    tx: Tx,
    i: {
      tenantId: string;
      glAccountId: string;
      sourceSystem: string;
      sourceFormat: string;
      fileHash: string | null;
      documentRef: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<GlSourceImportRow> {
    const r = await tx.query<GlSourceImportRow>(
      `INSERT INTO gl_source_import (tenant_id, gl_account_id, source_system, source_format, file_hash, document_ref, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING ${SOURCE_IMPORT_COLS}`,
      [
        i.tenantId,
        i.glAccountId,
        i.sourceSystem,
        i.sourceFormat,
        i.fileHash,
        i.documentRef,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert source import');
  }
  async findSourceImport(tx: Tx, id: string): Promise<GlSourceImportRow | null> {
    const r = await tx.query<GlSourceImportRow>(
      `SELECT ${SOURCE_IMPORT_COLS} FROM gl_source_import WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async findSourceImportByFileHash(
    tx: Tx,
    glAccountId: string,
    fileHash: string,
  ): Promise<GlSourceImportRow | null> {
    const r = await tx.query<GlSourceImportRow>(
      `SELECT ${SOURCE_IMPORT_COLS} FROM gl_source_import WHERE gl_account_id=$1 AND file_hash=$2`,
      [glAccountId, fileHash],
    );
    return r.rows[0] ?? null;
  }
  async setSourceImportStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; entryCount: number | null; by: string | null },
  ): Promise<GlSourceImportRow | null> {
    const r = await tx.query<GlSourceImportRow>(
      `UPDATE gl_source_import SET status=$3, entry_count=COALESCE($4,entry_count), updated_by=$5, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${SOURCE_IMPORT_COLS}`,
      [i.id, i.expectedVersion, i.status, i.entryCount, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listSourceImports(tx: Tx, glAccountId: string): Promise<GlSourceImportRow[]> {
    const r = await tx.query<GlSourceImportRow>(
      `SELECT ${SOURCE_IMPORT_COLS} FROM gl_source_import WHERE gl_account_id=$1 ORDER BY created_at DESC`,
      [glAccountId],
    );
    return r.rows;
  }

  // --- source line ------------------------------------------------------------------------------
  async insertSourceLine(
    tx: Tx,
    i: {
      tenantId: string;
      sourceImportId: string;
      glAccountId: string;
      lineNo: number | null;
      entryDate: string;
      amountMinor: number;
      direction: string;
      reference: string | null;
      description: string | null;
      sourceRef: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<GlSourceLineRow> {
    const r = await tx.query<GlSourceLineRow>(
      `INSERT INTO gl_source_line (tenant_id, source_import_id, gl_account_id, line_no, entry_date, amount_minor, direction, reference, description, source_ref, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING ${SOURCE_LINE_COLS}`,
      [
        i.tenantId,
        i.sourceImportId,
        i.glAccountId,
        i.lineNo,
        i.entryDate,
        i.amountMinor,
        i.direction,
        i.reference,
        i.description,
        i.sourceRef,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert source line');
  }
  async findSourceLine(tx: Tx, id: string): Promise<GlSourceLineRow | null> {
    const r = await tx.query<GlSourceLineRow>(`SELECT ${SOURCE_LINE_COLS} FROM gl_source_line WHERE id=$1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }
  async listSourceLinesByImport(tx: Tx, sourceImportId: string): Promise<GlSourceLineRow[]> {
    const r = await tx.query<GlSourceLineRow>(
      `SELECT ${SOURCE_LINE_COLS} FROM gl_source_line WHERE source_import_id=$1 ORDER BY line_no NULLS LAST, id`,
      [sourceImportId],
    );
    return r.rows;
  }
  async listUnmatchedSourceLines(tx: Tx, glAccountId: string): Promise<GlSourceLineRow[]> {
    const r = await tx.query<GlSourceLineRow>(
      `SELECT ${SOURCE_LINE_COLS} FROM gl_source_line WHERE gl_account_id=$1 AND status='unmatched' ORDER BY entry_date, id`,
      [glAccountId],
    );
    return r.rows;
  }
  async setSourceLineStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; toStatus: string; by: string | null },
  ): Promise<GlSourceLineRow | null> {
    const r = await tx.query<GlSourceLineRow>(
      `UPDATE gl_source_line SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${SOURCE_LINE_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }

  // --- reconciliation run -----------------------------------------------------------------------
  async insertRun(
    tx: Tx,
    i: {
      tenantId: string;
      glAccountId: string;
      rulesetId: string | null;
      periodStart: string | null;
      periodEnd: string | null;
      openingBalanceMinor: number | null;
      closingBalanceMinor: number | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<GlRunRow> {
    const r = await tx.query<GlRunRow>(
      `INSERT INTO gl_recon_run (tenant_id, gl_account_id, ruleset_id, period_start, period_end, opening_balance_minor, closing_balance_minor, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$8,$9,$9) RETURNING ${RUN_COLS}`,
      [
        i.tenantId,
        i.glAccountId,
        i.rulesetId,
        i.periodStart,
        i.periodEnd,
        i.openingBalanceMinor,
        i.closingBalanceMinor,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert run');
  }
  async findRun(tx: Tx, id: string): Promise<GlRunRow | null> {
    const r = await tx.query<GlRunRow>(`SELECT ${RUN_COLS} FROM gl_recon_run WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async transitionRun(
    tx: Tx,
    i: { id: string; expectedVersion: number; toStatus: string; by: string | null },
  ): Promise<GlRunRow | null> {
    const r = await tx.query<GlRunRow>(
      `UPDATE gl_recon_run SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${RUN_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async updateRunCounts(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      matchedCount: number;
      unmatchedCount: number;
      exceptionCount: number;
      itemCount: number;
      by: string | null;
    },
  ): Promise<GlRunRow | null> {
    const r = await tx.query<GlRunRow>(
      `UPDATE gl_recon_run SET matched_count=$3, unmatched_count=$4, exception_count=$5, item_count=$6, updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${RUN_COLS}`,
      [i.id, i.expectedVersion, i.matchedCount, i.unmatchedCount, i.exceptionCount, i.itemCount, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listRuns(tx: Tx, i: { glAccountId?: string; status?: string }): Promise<GlRunRow[]> {
    const r = await tx.query<GlRunRow>(
      `SELECT ${RUN_COLS} FROM gl_recon_run WHERE ($1::uuid IS NULL OR gl_account_id=$1) AND ($2::text IS NULL OR status=$2) ORDER BY created_at DESC`,
      [i.glAccountId ?? null, i.status ?? null],
    );
    return r.rows;
  }

  // --- run status history (append-only) ---------------------------------------------------------
  async insertRunStatusHistory(
    tx: Tx,
    i: {
      tenantId: string;
      runId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO gl_run_status_history (tenant_id, run_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.runId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }
  async listRunStatusHistory(tx: Tx, runId: string): Promise<GlRunStatusHistoryRow[]> {
    const r = await tx.query<GlRunStatusHistoryRow>(
      `SELECT ${RUN_STATUS_HISTORY_COLS} FROM gl_run_status_history WHERE run_id=$1 ORDER BY created_at`,
      [runId],
    );
    return r.rows;
  }

  // --- run balance (append-only invariant evidence) ---------------------------------------------
  async insertRunBalance(
    tx: Tx,
    i: {
      tenantId: string;
      runId: string;
      openingMinor: number;
      debitsMinor: number;
      creditsMinor: number;
      calculatedClosingMinor: number;
      sourceClosingMinor: number | null;
      varianceMinor: number;
      balanced: boolean;
      correlationId: string;
      by: string | null;
    },
  ): Promise<GlRunBalanceRow> {
    const r = await tx.query<GlRunBalanceRow>(
      `INSERT INTO gl_run_balance (tenant_id, run_id, opening_minor, debits_minor, credits_minor, calculated_closing_minor, source_closing_minor, variance_minor, balanced, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${RUN_BALANCE_COLS}`,
      [
        i.tenantId,
        i.runId,
        i.openingMinor,
        i.debitsMinor,
        i.creditsMinor,
        i.calculatedClosingMinor,
        i.sourceClosingMinor,
        i.varianceMinor,
        i.balanced,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert run balance');
  }
  async listRunBalancesByRun(tx: Tx, runId: string): Promise<GlRunBalanceRow[]> {
    const r = await tx.query<GlRunBalanceRow>(
      `SELECT ${RUN_BALANCE_COLS} FROM gl_run_balance WHERE run_id=$1 ORDER BY created_at`,
      [runId],
    );
    return r.rows;
  }
  /** Aggregate the GL debits/credits for a run's account in EXACT minor units (bigint SUM projected ::text). */
  async aggregateGlAmounts(
    tx: Tx,
    glAccountId: string,
  ): Promise<{ debitsMinor: string; creditsMinor: string }> {
    const r = await tx.query<{ debits_minor: string; credits_minor: string }>(
      `SELECT
         COALESCE(SUM(amount_minor) FILTER (WHERE direction='debit'),0)::text AS debits_minor,
         COALESCE(SUM(amount_minor) FILTER (WHERE direction='credit'),0)::text AS credits_minor
       FROM gl_line WHERE gl_account_id=$1`,
      [glAccountId],
    );
    const row = firstRow(r.rows, 'aggregate gl amounts');
    return { debitsMinor: row.debits_minor, creditsMinor: row.credits_minor };
  }

  // --- match ------------------------------------------------------------------------------------
  async insertMatch(
    tx: Tx,
    i: {
      tenantId: string;
      runId: string;
      matchType: string;
      status: string;
      confidenceBand: string | null;
      colourStatus: string | null;
      score: number | null;
      amountVarianceMinor: number;
      matchedBy: string;
      rulesetId: string | null;
      rulesetVersion: number | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<GlMatchRow> {
    const r = await tx.query<GlMatchRow>(
      `INSERT INTO gl_match (tenant_id, run_id, match_type, status, confidence_band, colour_status, score, amount_variance_minor, matched_by, ruleset_id, ruleset_version, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING ${MATCH_COLS}`,
      [
        i.tenantId,
        i.runId,
        i.matchType,
        i.status,
        i.confidenceBand,
        i.colourStatus,
        i.score,
        i.amountVarianceMinor,
        i.matchedBy,
        i.rulesetId,
        i.rulesetVersion,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert match');
  }
  async findMatch(tx: Tx, id: string): Promise<GlMatchRow | null> {
    const r = await tx.query<GlMatchRow>(`SELECT ${MATCH_COLS} FROM gl_match WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async transitionMatch(
    tx: Tx,
    i: { id: string; expectedVersion: number; toStatus: string; by: string | null },
  ): Promise<GlMatchRow | null> {
    const r = await tx.query<GlMatchRow>(
      `UPDATE gl_match SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${MATCH_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listMatchesByRun(tx: Tx, i: { runId: string; status?: string }): Promise<GlMatchRow[]> {
    const r = await tx.query<GlMatchRow>(
      `SELECT ${MATCH_COLS} FROM gl_match WHERE run_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY created_at`,
      [i.runId, i.status ?? null],
    );
    return r.rows;
  }

  // --- match line (append-only member) ----------------------------------------------------------
  async insertMatchLine(
    tx: Tx,
    i: {
      tenantId: string;
      matchId: string;
      side: string;
      glLineId: string | null;
      sourceLineId: string | null;
      amountMinor: number;
      correlationId: string;
      by: string | null;
    },
  ): Promise<GlMatchLineRow> {
    const r = await tx.query<GlMatchLineRow>(
      `INSERT INTO gl_match_line (tenant_id, match_id, side, gl_line_id, source_line_id, amount_minor, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${MATCH_LINE_COLS}`,
      [i.tenantId, i.matchId, i.side, i.glLineId, i.sourceLineId, i.amountMinor, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert match line');
  }
  async listMatchLinesByMatch(tx: Tx, matchId: string): Promise<GlMatchLineRow[]> {
    const r = await tx.query<GlMatchLineRow>(
      `SELECT ${MATCH_LINE_COLS} FROM gl_match_line WHERE match_id=$1 ORDER BY side, created_at`,
      [matchId],
    );
    return r.rows;
  }

  // --- match candidate (append-only engine evidence) --------------------------------------------
  async insertMatchCandidate(
    tx: Tx,
    i: {
      tenantId: string;
      runId: string;
      glLineId: string | null;
      sourceLineId: string | null;
      score: number;
      confidenceBand: string;
      colourStatus: string | null;
      amountVarianceMinor: number;
      dateVarianceDays: number | null;
      referenceMatch: string | null;
      descriptionScore: string | null;
      directionCompatible: boolean | null;
      reasonCodes: readonly string[];
      ruleCodes: readonly string[];
      rulesetId: string | null;
      rulesetVersion: number | null;
      correlationId: string;
    },
  ): Promise<GlMatchCandidateRow> {
    const r = await tx.query<GlMatchCandidateRow>(
      `INSERT INTO gl_match_candidate (tenant_id, run_id, gl_line_id, source_line_id, score, confidence_band, colour_status, amount_variance_minor, date_variance_days, reference_match, description_score, direction_compatible, reason_codes, rule_codes, ruleset_id, ruleset_version, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::numeric,$12,$13,$14,$15,$16,$17) RETURNING ${MATCH_CANDIDATE_COLS}`,
      [
        i.tenantId,
        i.runId,
        i.glLineId,
        i.sourceLineId,
        i.score,
        i.confidenceBand,
        i.colourStatus,
        i.amountVarianceMinor,
        i.dateVarianceDays,
        i.referenceMatch,
        i.descriptionScore,
        i.directionCompatible,
        i.reasonCodes,
        i.ruleCodes,
        i.rulesetId,
        i.rulesetVersion,
        i.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert match candidate');
  }
  async listMatchCandidatesByRun(tx: Tx, runId: string): Promise<GlMatchCandidateRow[]> {
    const r = await tx.query<GlMatchCandidateRow>(
      `SELECT ${MATCH_CANDIDATE_COLS} FROM gl_match_candidate WHERE run_id=$1 ORDER BY created_at`,
      [runId],
    );
    return r.rows;
  }

  // --- reconciling item -------------------------------------------------------------------------
  async insertReconcilingItem(
    tx: Tx,
    i: {
      tenantId: string;
      runId: string;
      itemType: string;
      glLineId: string | null;
      sourceLineId: string | null;
      amountMinor: number;
      direction: string | null;
      ageDays: number;
      reason: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<GlReconcilingItemRow> {
    const r = await tx.query<GlReconcilingItemRow>(
      `INSERT INTO gl_reconciling_item (tenant_id, run_id, item_type, gl_line_id, source_line_id, amount_minor, direction, age_days, reason, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING ${ITEM_COLS}`,
      [
        i.tenantId,
        i.runId,
        i.itemType,
        i.glLineId,
        i.sourceLineId,
        i.amountMinor,
        i.direction,
        i.ageDays,
        i.reason,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert reconciling item');
  }
  async findReconcilingItem(tx: Tx, id: string): Promise<GlReconcilingItemRow | null> {
    const r = await tx.query<GlReconcilingItemRow>(
      `SELECT ${ITEM_COLS} FROM gl_reconciling_item WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async transitionReconcilingItem(
    tx: Tx,
    i: { id: string; expectedVersion: number; toStatus: string; clearedBy: string | null; by: string | null },
  ): Promise<GlReconcilingItemRow | null> {
    const r = await tx.query<GlReconcilingItemRow>(
      `UPDATE gl_reconciling_item SET status=$3, cleared_by=COALESCE($4,cleared_by), cleared_at=CASE WHEN $3 IN ('cleared','waived') THEN now() ELSE cleared_at END, updated_by=$5, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${ITEM_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.clearedBy, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listReconcilingItemsByRun(
    tx: Tx,
    i: { runId: string; status?: string },
  ): Promise<GlReconcilingItemRow[]> {
    const r = await tx.query<GlReconcilingItemRow>(
      `SELECT ${ITEM_COLS} FROM gl_reconciling_item WHERE run_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY created_at`,
      [i.runId, i.status ?? null],
    );
    return r.rows;
  }
  async countOpenItems(tx: Tx, runId: string): Promise<number> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM gl_reconciling_item WHERE run_id=$1 AND status='open'`,
      [runId],
    );
    return Number(firstRow(r.rows, 'count open items').c);
  }

  // --- exception --------------------------------------------------------------------------------
  async insertException(
    tx: Tx,
    i: {
      tenantId: string;
      runId: string;
      glLineId: string | null;
      sourceLineId: string | null;
      exceptionType: string;
      ageDays: number;
      reason: string | null;
      required: boolean;
      correlationId: string;
      by: string | null;
    },
  ): Promise<GlExceptionRow> {
    const r = await tx.query<GlExceptionRow>(
      `INSERT INTO gl_exception (tenant_id, run_id, gl_line_id, source_line_id, exception_type, age_days, reason, required, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING ${EXCEPTION_COLS}`,
      [
        i.tenantId,
        i.runId,
        i.glLineId,
        i.sourceLineId,
        i.exceptionType,
        i.ageDays,
        i.reason,
        i.required,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert exception');
  }
  async findException(tx: Tx, id: string): Promise<GlExceptionRow | null> {
    const r = await tx.query<GlExceptionRow>(`SELECT ${EXCEPTION_COLS} FROM gl_exception WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async assignException(
    tx: Tx,
    i: { id: string; expectedVersion: number; assignedTo: string; by: string | null },
  ): Promise<GlExceptionRow | null> {
    const r = await tx.query<GlExceptionRow>(
      `UPDATE gl_exception SET assigned_to=$3, status=CASE WHEN status='open' THEN 'under_review' ELSE status END, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${EXCEPTION_COLS}`,
      [i.id, i.expectedVersion, i.assignedTo, i.by],
    );
    return r.rows[0] ?? null;
  }
  async transitionException(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      resolvedBy: string | null;
      by: string | null;
    },
  ): Promise<GlExceptionRow | null> {
    const r = await tx.query<GlExceptionRow>(
      `UPDATE gl_exception SET status=$3, resolved_by=COALESCE($4,resolved_by), resolved_at=CASE WHEN $3 IN ('resolved','waived') THEN now() ELSE resolved_at END, updated_by=$5, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${EXCEPTION_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.resolvedBy, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listExceptionsByRun(tx: Tx, i: { runId: string; status?: string }): Promise<GlExceptionRow[]> {
    const r = await tx.query<GlExceptionRow>(
      `SELECT ${EXCEPTION_COLS} FROM gl_exception WHERE run_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY created_at`,
      [i.runId, i.status ?? null],
    );
    return r.rows;
  }
  /** Fail-closed completion gate: the count of still-open REQUIRED exceptions for a run. */
  async countOpenRequiredExceptions(tx: Tx, runId: string): Promise<number> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM gl_exception WHERE run_id=$1 AND status IN ('open','under_review') AND required=true`,
      [runId],
    );
    return Number(firstRow(r.rows, 'count open required exceptions').c);
  }

  // --- manual decision (append-only evidence) ---------------------------------------------------
  async insertManualDecision(
    tx: Tx,
    i: {
      tenantId: string;
      runId: string;
      decisionType: string;
      matchId: string | null;
      glLineId: string | null;
      sourceLineId: string | null;
      exceptionId: string | null;
      itemId: string | null;
      reason: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<GlManualDecisionRow> {
    const r = await tx.query<GlManualDecisionRow>(
      `INSERT INTO gl_manual_decision (tenant_id, run_id, decision_type, match_id, gl_line_id, source_line_id, exception_id, item_id, by_user, reason, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${MANUAL_DECISION_COLS}`,
      [
        i.tenantId,
        i.runId,
        i.decisionType,
        i.matchId,
        i.glLineId,
        i.sourceLineId,
        i.exceptionId,
        i.itemId,
        i.by,
        i.reason,
        i.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert manual decision');
  }
  async listManualDecisionsByRun(tx: Tx, runId: string): Promise<GlManualDecisionRow[]> {
    const r = await tx.query<GlManualDecisionRow>(
      `SELECT ${MANUAL_DECISION_COLS} FROM gl_manual_decision WHERE run_id=$1 ORDER BY created_at`,
      [runId],
    );
    return r.rows;
  }

  // --- certification ----------------------------------------------------------------------------
  async insertCertification(
    tx: Tx,
    i: {
      tenantId: string;
      runId: string;
      glAccountId: string;
      periodStart: string | null;
      periodEnd: string | null;
      currencyRef: string | null;
      calculatedBalanceMinor: number;
      sourceBalanceMinor: number;
      varianceMinor: number;
      unresolvedExceptionCount: number;
      openItemCount: number;
      correlationId: string;
      by: string | null;
    },
  ): Promise<GlCertificationRow> {
    const r = await tx.query<GlCertificationRow>(
      `INSERT INTO gl_certification (tenant_id, run_id, gl_account_id, period_start, period_end, currency_ref, calculated_balance_minor, source_balance_minor, variance_minor, unresolved_exception_count, open_item_count, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING ${CERTIFICATION_COLS}`,
      [
        i.tenantId,
        i.runId,
        i.glAccountId,
        i.periodStart,
        i.periodEnd,
        i.currencyRef,
        i.calculatedBalanceMinor,
        i.sourceBalanceMinor,
        i.varianceMinor,
        i.unresolvedExceptionCount,
        i.openItemCount,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert certification');
  }
  async findCertification(tx: Tx, id: string): Promise<GlCertificationRow | null> {
    const r = await tx.query<GlCertificationRow>(
      `SELECT ${CERTIFICATION_COLS} FROM gl_certification WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async decideCertification(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      isOverride: boolean;
      overrideReason: string | null;
      certifiedBy: string | null;
      by: string | null;
    },
  ): Promise<GlCertificationRow | null> {
    const r = await tx.query<GlCertificationRow>(
      `UPDATE gl_certification SET status=$3, is_override=$4, override_reason=COALESCE($5,override_reason), certified_by=CASE WHEN $3='certified' THEN $6 ELSE certified_by END, certified_at=CASE WHEN $3='certified' THEN now() ELSE certified_at END, updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status='draft' RETURNING ${CERTIFICATION_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.isOverride, i.overrideReason, i.certifiedBy, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listCertificationsByRun(tx: Tx, runId: string): Promise<GlCertificationRow[]> {
    const r = await tx.query<GlCertificationRow>(
      `SELECT ${CERTIFICATION_COLS} FROM gl_certification WHERE run_id=$1 ORDER BY created_at DESC`,
      [runId],
    );
    return r.rows;
  }

  // --- certification history (append-only) ------------------------------------------------------
  async insertCertificationHistory(
    tx: Tx,
    i: {
      tenantId: string;
      certificationId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      isOverride: boolean;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO gl_certification_history (tenant_id, certification_id, from_status, to_status, reason, is_override, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        i.tenantId,
        i.certificationId,
        i.fromStatus,
        i.toStatus,
        i.reason,
        i.isOverride,
        i.by,
        i.correlationId,
      ],
    );
  }
  async listCertificationHistory(tx: Tx, certificationId: string): Promise<GlCertificationHistoryRow[]> {
    const r = await tx.query<GlCertificationHistoryRow>(
      `SELECT ${CERTIFICATION_HISTORY_COLS} FROM gl_certification_history WHERE certification_id=$1 ORDER BY created_at`,
      [certificationId],
    );
    return r.rows;
  }

  // --- draft journal recommendation -------------------------------------------------------------
  async insertRecommendation(
    tx: Tx,
    i: {
      tenantId: string;
      runId: string;
      exceptionId: string | null;
      reconcilingItemId: string | null;
      debitAccountRef: string | null;
      creditAccountRef: string | null;
      amountMinor: number;
      currencyRef: string | null;
      description: string | null;
      reasonCode: string | null;
      confidenceBand: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<GlRecommendationRow> {
    const r = await tx.query<GlRecommendationRow>(
      `INSERT INTO gl_journal_recommendation (tenant_id, run_id, exception_id, reconciling_item_id, debit_account_ref, credit_account_ref, amount_minor, currency_ref, description, reason_code, confidence_band, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING ${RECOMMENDATION_COLS}`,
      [
        i.tenantId,
        i.runId,
        i.exceptionId,
        i.reconcilingItemId,
        i.debitAccountRef,
        i.creditAccountRef,
        i.amountMinor,
        i.currencyRef,
        i.description,
        i.reasonCode,
        i.confidenceBand,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert recommendation');
  }
  async findRecommendation(tx: Tx, id: string): Promise<GlRecommendationRow | null> {
    const r = await tx.query<GlRecommendationRow>(
      `SELECT ${RECOMMENDATION_COLS} FROM gl_journal_recommendation WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async setRecommendationStatus(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      handoffRef: string | null;
      by: string | null;
    },
  ): Promise<GlRecommendationRow | null> {
    const r = await tx.query<GlRecommendationRow>(
      `UPDATE gl_journal_recommendation SET status=$3, handoff_ref=COALESCE($4,handoff_ref), updated_by=$5, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status='proposed' RETURNING ${RECOMMENDATION_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.handoffRef, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listRecommendationsByRun(
    tx: Tx,
    i: { runId: string; status?: string },
  ): Promise<GlRecommendationRow[]> {
    const r = await tx.query<GlRecommendationRow>(
      `SELECT ${RECOMMENDATION_COLS} FROM gl_journal_recommendation WHERE run_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY created_at`,
      [i.runId, i.status ?? null],
    );
    return r.rows;
  }

  // --- run summary (append-only) ----------------------------------------------------------------
  async insertRunSummary(
    tx: Tx,
    i: {
      tenantId: string;
      runId: string;
      matchedCount: number;
      unmatchedCount: number;
      exceptionCount: number;
      itemCount: number;
      matchedAmountMinor: string;
      unmatchedAmountMinor: string;
      balanceVarianceMinor: string;
      balanced: boolean;
      colourStatus: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<GlRunSummaryRow> {
    const r = await tx.query<GlRunSummaryRow>(
      `INSERT INTO gl_run_summary (tenant_id, run_id, matched_count, unmatched_count, exception_count, item_count, matched_amount_minor, unmatched_amount_minor, balance_variance_minor, balanced, colour_status, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${RUN_SUMMARY_COLS}`,
      [
        i.tenantId,
        i.runId,
        i.matchedCount,
        i.unmatchedCount,
        i.exceptionCount,
        i.itemCount,
        i.matchedAmountMinor,
        i.unmatchedAmountMinor,
        i.balanceVarianceMinor,
        i.balanced,
        i.colourStatus,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert run summary');
  }
  async listRunSummariesByRun(tx: Tx, runId: string): Promise<GlRunSummaryRow[]> {
    const r = await tx.query<GlRunSummaryRow>(
      `SELECT ${RUN_SUMMARY_COLS} FROM gl_run_summary WHERE run_id=$1 ORDER BY created_at`,
      [runId],
    );
    return r.rows;
  }

  // --- note (append-only) -----------------------------------------------------------------------
  async insertNote(
    tx: Tx,
    i: {
      tenantId: string;
      runId: string;
      noteType: string;
      content: string;
      by: string | null;
      correlationId: string;
    },
  ): Promise<GlNoteRow> {
    const r = await tx.query<GlNoteRow>(
      `INSERT INTO gl_note (tenant_id, run_id, note_type, content, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${NOTE_COLS}`,
      [i.tenantId, i.runId, i.noteType, i.content, i.by, i.correlationId],
    );
    return firstRow(r.rows, 'insert note');
  }
  async listNotesByRun(tx: Tx, runId: string): Promise<GlNoteRow[]> {
    const r = await tx.query<GlNoteRow>(
      `SELECT ${NOTE_COLS} FROM gl_note WHERE run_id=$1 ORDER BY created_at`,
      [runId],
    );
    return r.rows;
  }
}
