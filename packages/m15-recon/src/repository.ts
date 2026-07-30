/**
 * M15 repository — ALL SQL for bank reconciliation across the 18 recon_* tables. Every query is parameterized; every
 * mutating UPDATE on a mutable aggregate is optimistic-lock guarded (`WHERE id=$1 AND version=$expected`) so a stale
 * command changes zero rows and the caller reacts (single-winner). Queries carry NO tenant_id predicate: RLS FORCE is
 * the isolation guarantee. All methods take the caller's `Tx` so the row write, its append-only evidence, audit and
 * outbox commit atomically. Ruleset/status history, match lines, engine candidates, manual decisions, run summaries,
 * notes and import errors are append-only (INSERT + SELECT). Duplicate imports are blocked by the per-account
 * file-hash unique index; a match is idempotent on its key; a ruleset has exactly one active version per code.
 *
 * MONEY IS INTEGER MINOR UNITS (bigint). Every `*_minor` column is PROJECTED `::text` and carried in the Row types as
 * a STRING — never parsed into a binary float (ADR-007, CLAUDE.md money rule). INSERTs accept an integer `number`
 * (validated by callers / the m15a engine); the driver serialises it losslessly to bigint. m15 owns only `recon_*`;
 * it NEVER reads another module's tables (entity_ref/currency_ref/document_ref are OPAQUE ids).
 */
import type { Tx } from '@finapp/kernel';

// --- row types (raw DB shape; snake_case columns as SELECTed) ------------------------------------
export interface BankAccountRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly entity_ref: string | null;
  readonly currency_ref: string | null;
  readonly bank_name: string;
  readonly account_label: string;
  readonly account_ref_masked: string | null;
  readonly branch: string | null;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}

export interface MatchingRulesetRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly code: string;
  readonly version_number: number;
  readonly name: string | null;
  readonly status: string;
  readonly date_window_days: number;
  /** Amount tolerance in INTEGER MINOR UNITS — read/written as a STRING, never a float (ADR-007). */
  readonly amount_tolerance_minor: string;
  readonly require_opposite_direction: boolean;
  readonly content_hash: string | null;
  readonly supersedes_id: string | null;
  readonly superseded_by_id: string | null;
  readonly version: number;
  readonly correlation_id: string;
}

export interface MatchingRuleRow {
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

export interface RulesetHistoryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly ruleset_id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly reason: string | null;
  readonly by_user: string | null;
  readonly correlation_id: string;
}

export interface StatementImportRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly bank_account_id: string;
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

export interface StatementLineRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly import_id: string;
  readonly bank_account_id: string;
  readonly line_no: number;
  readonly txn_date: string;
  readonly value_date: string | null;
  /** INTEGER MINOR UNITS — read/written as a STRING, never a float (ADR-007). */
  readonly amount_minor: string;
  readonly direction: string;
  readonly reference: string | null;
  readonly description: string | null;
  readonly counterparty_ref: string | null;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}

export interface LedgerImportRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly bank_account_id: string;
  readonly source_format: string;
  readonly file_hash: string | null;
  readonly document_ref: string | null;
  readonly status: string;
  readonly entry_count: number;
  readonly idempotency_key: string | null;
  readonly version: number;
  readonly correlation_id: string;
}

export interface LedgerEntryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly ledger_import_id: string;
  readonly bank_account_id: string;
  readonly entry_no: number | null;
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

export interface RunRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly bank_account_id: string;
  readonly ruleset_id: string | null;
  readonly period_start: string | null;
  readonly period_end: string | null;
  /** INTEGER MINOR UNITS — read/written as a STRING, never a float (ADR-007). */
  readonly opening_balance_minor: string | null;
  readonly closing_balance_minor: string | null;
  readonly status: string;
  readonly matched_count: number;
  readonly unmatched_count: number;
  readonly exception_count: number;
  readonly version: number;
  readonly correlation_id: string;
}

export interface StatusHistoryRow {
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

export interface MatchRow {
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

export interface MatchLineRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly match_id: string;
  readonly side: string;
  readonly statement_line_id: string | null;
  readonly ledger_entry_id: string | null;
  /** INTEGER MINOR UNITS — read/written as a STRING, never a float (ADR-007). */
  readonly amount_minor: string;
  readonly correlation_id: string;
}

export interface MatchCandidateRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly run_id: string;
  readonly statement_line_id: string | null;
  readonly ledger_entry_id: string | null;
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

export interface ExceptionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly run_id: string;
  readonly statement_line_id: string | null;
  readonly ledger_entry_id: string | null;
  readonly exception_type: string;
  readonly status: string;
  readonly age_days: number;
  readonly reason: string | null;
  readonly required: boolean;
  readonly resolved_by: string | null;
  readonly resolved_at: string | null;
  readonly version: number;
  readonly correlation_id: string;
}

export interface ManualDecisionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly run_id: string;
  readonly decision_type: string;
  readonly match_id: string | null;
  readonly statement_line_id: string | null;
  readonly ledger_entry_id: string | null;
  readonly exception_id: string | null;
  readonly by_user: string | null;
  readonly reason: string | null;
  readonly correlation_id: string;
}

export interface RunSummaryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly run_id: string;
  readonly matched_count: number;
  readonly unmatched_count: number;
  readonly exception_count: number;
  /** INTEGER MINOR UNITS — read/written as a STRING, never a float (ADR-007). */
  readonly matched_amount_minor: string;
  readonly unmatched_amount_minor: string;
  readonly colour_status: string | null;
  readonly correlation_id: string;
}

export interface NoteRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly run_id: string;
  readonly note_type: string;
  readonly content: string;
  readonly by_user: string | null;
  readonly correlation_id: string;
}

export interface ImportErrorRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly import_id: string;
  readonly import_kind: string;
  readonly line_no: number | null;
  readonly error_code: string;
  readonly detail: string | null;
  readonly correlation_id: string;
}

// --- column projections (kept in one place so SELECT/INSERT/UPDATE stay in lock-step) ------------
const BANK_ACCOUNT_COLS =
  'tenant_id, id, entity_ref, currency_ref, bank_name, account_label, account_ref_masked, branch, status, version, correlation_id';
const RULESET_COLS =
  'tenant_id, id, code, version_number, name, status, date_window_days, amount_tolerance_minor::text AS amount_tolerance_minor, require_opposite_direction, content_hash, supersedes_id, superseded_by_id, version, correlation_id';
const RULE_COLS =
  'tenant_id, id, ruleset_id, rule_code, rule_kind, weight, priority, version, correlation_id';
const RULESET_HISTORY_COLS =
  'tenant_id, id, ruleset_id, from_status, to_status, reason, by_user, correlation_id';
const STATEMENT_IMPORT_COLS =
  'tenant_id, id, bank_account_id, source_format, file_hash, file_name, document_ref, status, line_count, period_start::text AS period_start, period_end::text AS period_end, idempotency_key, version, correlation_id';
const STATEMENT_LINE_COLS =
  'tenant_id, id, import_id, bank_account_id, line_no, txn_date::text AS txn_date, value_date::text AS value_date, amount_minor::text AS amount_minor, direction, reference, description, counterparty_ref, status, version, correlation_id';
const LEDGER_IMPORT_COLS =
  'tenant_id, id, bank_account_id, source_format, file_hash, document_ref, status, entry_count, idempotency_key, version, correlation_id';
const LEDGER_ENTRY_COLS =
  'tenant_id, id, ledger_import_id, bank_account_id, entry_no, entry_date::text AS entry_date, amount_minor::text AS amount_minor, direction, reference, description, source_ref, status, version, correlation_id';
const RUN_COLS =
  'tenant_id, id, bank_account_id, ruleset_id, period_start::text AS period_start, period_end::text AS period_end, opening_balance_minor::text AS opening_balance_minor, closing_balance_minor::text AS closing_balance_minor, status, matched_count, unmatched_count, exception_count, version, correlation_id';
const STATUS_HISTORY_COLS =
  'tenant_id, id, run_id, from_status, to_status, reason, reason_code, by_user, correlation_id';
const MATCH_COLS =
  'tenant_id, id, run_id, match_type, status, confidence_band, colour_status, score, amount_variance_minor::text AS amount_variance_minor, matched_by, ruleset_id, ruleset_version, idempotency_key, version, correlation_id';
const MATCH_LINE_COLS =
  'tenant_id, id, match_id, side, statement_line_id, ledger_entry_id, amount_minor::text AS amount_minor, correlation_id';
const MATCH_CANDIDATE_COLS =
  'tenant_id, id, run_id, statement_line_id, ledger_entry_id, score, confidence_band, colour_status, amount_variance_minor::text AS amount_variance_minor, date_variance_days, reference_match, description_score::text AS description_score, direction_compatible, reason_codes, rule_codes, ruleset_id, ruleset_version, correlation_id';
const EXCEPTION_COLS =
  'tenant_id, id, run_id, statement_line_id, ledger_entry_id, exception_type, status, age_days, reason, required, resolved_by, resolved_at, version, correlation_id';
const MANUAL_DECISION_COLS =
  'tenant_id, id, run_id, decision_type, match_id, statement_line_id, ledger_entry_id, exception_id, by_user, reason, correlation_id';
const RUN_SUMMARY_COLS =
  'tenant_id, id, run_id, matched_count, unmatched_count, exception_count, matched_amount_minor::text AS matched_amount_minor, unmatched_amount_minor::text AS unmatched_amount_minor, colour_status, correlation_id';
const NOTE_COLS = 'tenant_id, id, run_id, note_type, content, by_user, correlation_id';
const IMPORT_ERROR_COLS =
  'tenant_id, id, import_id, import_kind, line_no, error_code, detail, correlation_id';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m15 repository: expected a row from ${what}`);
  return row;
}

export class ReconRepository {
  // --- bank account -----------------------------------------------------------------------------
  async insertBankAccount(
    tx: Tx,
    i: {
      tenantId: string;
      entityRef: string | null;
      currencyRef: string | null;
      bankName: string;
      accountLabel: string;
      accountRefMasked: string | null;
      branch: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<BankAccountRow> {
    const r = await tx.query<BankAccountRow>(
      `INSERT INTO recon_bank_account (tenant_id, entity_ref, currency_ref, bank_name, account_label, account_ref_masked, branch, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING ${BANK_ACCOUNT_COLS}`,
      [
        i.tenantId,
        i.entityRef,
        i.currencyRef,
        i.bankName,
        i.accountLabel,
        i.accountRefMasked,
        i.branch,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert bank account');
  }
  async findBankAccount(tx: Tx, id: string): Promise<BankAccountRow | null> {
    const r = await tx.query<BankAccountRow>(
      `SELECT ${BANK_ACCOUNT_COLS} FROM recon_bank_account WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async updateBankAccount(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      bankName: string | null;
      accountLabel: string | null;
      accountRefMasked: string | null;
      branch: string | null;
      entityRef: string | null;
      currencyRef: string | null;
      by: string | null;
    },
  ): Promise<BankAccountRow | null> {
    const r = await tx.query<BankAccountRow>(
      `UPDATE recon_bank_account SET bank_name=COALESCE($3,bank_name), account_label=COALESCE($4,account_label), account_ref_masked=COALESCE($5,account_ref_masked), branch=COALESCE($6,branch), entity_ref=COALESCE($7,entity_ref), currency_ref=COALESCE($8,currency_ref), updated_by=$9, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status <> 'archived' RETURNING ${BANK_ACCOUNT_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.bankName,
        i.accountLabel,
        i.accountRefMasked,
        i.branch,
        i.entityRef,
        i.currencyRef,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async setBankAccountStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; toStatus: string; by: string | null },
  ): Promise<BankAccountRow | null> {
    const r = await tx.query<BankAccountRow>(
      `UPDATE recon_bank_account SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${BANK_ACCOUNT_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listBankAccounts(tx: Tx, status?: string): Promise<BankAccountRow[]> {
    const r = await tx.query<BankAccountRow>(
      `SELECT ${BANK_ACCOUNT_COLS} FROM recon_bank_account WHERE ($1::text IS NULL OR status=$1) ORDER BY bank_name, account_label`,
      [status ?? null],
    );
    return r.rows;
  }

  // --- matching ruleset (versioned; immutable-after-publish; one active per code) ---------------
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
  ): Promise<MatchingRulesetRow> {
    const r = await tx.query<MatchingRulesetRow>(
      `INSERT INTO recon_matching_ruleset (tenant_id, code, version_number, name, date_window_days, amount_tolerance_minor, require_opposite_direction, supersedes_id, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING ${RULESET_COLS}`,
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
  async findRuleset(tx: Tx, id: string): Promise<MatchingRulesetRow | null> {
    const r = await tx.query<MatchingRulesetRow>(
      `SELECT ${RULESET_COLS} FROM recon_matching_ruleset WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  /** Idempotency/one-active lookup — the single live head for a code (partial index `..._one_active`). */
  async findActiveRuleset(tx: Tx, code: string): Promise<MatchingRulesetRow | null> {
    const r = await tx.query<MatchingRulesetRow>(
      `SELECT ${RULESET_COLS} FROM recon_matching_ruleset WHERE code=$1 AND status='active'`,
      [code],
    );
    return r.rows[0] ?? null;
  }
  async nextRulesetVersion(tx: Tx, code: string): Promise<number> {
    const r = await tx.query<{ next: number }>(
      `SELECT COALESCE(MAX(version_number),0)+1 AS next FROM recon_matching_ruleset WHERE code=$1`,
      [code],
    );
    return firstRow(r.rows, 'next ruleset version').next;
  }
  /** Content patch — draft only (a published ruleset is frozen). CAS on version. */
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
  ): Promise<MatchingRulesetRow | null> {
    const r = await tx.query<MatchingRulesetRow>(
      `UPDATE recon_matching_ruleset SET name=COALESCE($3,name), date_window_days=COALESCE($4,date_window_days), amount_tolerance_minor=COALESCE($5,amount_tolerance_minor), require_opposite_direction=COALESCE($6,require_opposite_direction), updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status='draft' RETURNING ${RULESET_COLS}`,
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
  /** The single ruleset lifecycle-transition UPDATE. CAS on version; content_hash freezes at publish. */
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
  ): Promise<MatchingRulesetRow | null> {
    const r = await tx.query<MatchingRulesetRow>(
      `UPDATE recon_matching_ruleset SET status=$3, content_hash=COALESCE($4,content_hash), superseded_by_id=COALESCE($5,superseded_by_id), updated_by=$6, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${RULESET_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.contentHash ?? null, i.supersededById ?? null, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listRulesets(tx: Tx, i: { code?: string; status?: string }): Promise<MatchingRulesetRow[]> {
    const r = await tx.query<MatchingRulesetRow>(
      `SELECT ${RULESET_COLS} FROM recon_matching_ruleset WHERE ($1::text IS NULL OR code=$1) AND ($2::text IS NULL OR status=$2) ORDER BY code, version_number DESC`,
      [i.code ?? null, i.status ?? null],
    );
    return r.rows;
  }

  // --- matching rule ----------------------------------------------------------------------------
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
  ): Promise<MatchingRuleRow> {
    const r = await tx.query<MatchingRuleRow>(
      `INSERT INTO recon_matching_rule (tenant_id, ruleset_id, rule_code, rule_kind, weight, priority, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${RULE_COLS}`,
      [i.tenantId, i.rulesetId, i.ruleCode, i.ruleKind, i.weight, i.priority, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert rule');
  }
  async listRulesByRuleset(tx: Tx, rulesetId: string): Promise<MatchingRuleRow[]> {
    const r = await tx.query<MatchingRuleRow>(
      `SELECT ${RULE_COLS} FROM recon_matching_rule WHERE ruleset_id=$1 ORDER BY priority, rule_code`,
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
      `INSERT INTO recon_ruleset_history (tenant_id, ruleset_id, from_status, to_status, reason, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [i.tenantId, i.rulesetId, i.fromStatus, i.toStatus, i.reason, i.by, i.correlationId],
    );
  }
  async listRulesetHistory(tx: Tx, rulesetId: string): Promise<RulesetHistoryRow[]> {
    const r = await tx.query<RulesetHistoryRow>(
      `SELECT ${RULESET_HISTORY_COLS} FROM recon_ruleset_history WHERE ruleset_id=$1 ORDER BY created_at`,
      [rulesetId],
    );
    return r.rows;
  }

  // --- statement import (duplicate-protected on (bank_account, file_hash)) -----------------------
  async insertStatementImport(
    tx: Tx,
    i: {
      tenantId: string;
      bankAccountId: string;
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
  ): Promise<StatementImportRow> {
    const r = await tx.query<StatementImportRow>(
      `INSERT INTO recon_statement_import (tenant_id, bank_account_id, source_format, file_hash, file_name, document_ref, period_start, period_end, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11,$11) RETURNING ${STATEMENT_IMPORT_COLS}`,
      [
        i.tenantId,
        i.bankAccountId,
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
    return firstRow(r.rows, 'insert statement import');
  }
  async findStatementImport(tx: Tx, id: string): Promise<StatementImportRow | null> {
    const r = await tx.query<StatementImportRow>(
      `SELECT ${STATEMENT_IMPORT_COLS} FROM recon_statement_import WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  /** Duplicate-import lookup on the natural key (bank_account, file_hash). */
  async findStatementImportByFileHash(
    tx: Tx,
    bankAccountId: string,
    fileHash: string,
  ): Promise<StatementImportRow | null> {
    const r = await tx.query<StatementImportRow>(
      `SELECT ${STATEMENT_IMPORT_COLS} FROM recon_statement_import WHERE bank_account_id=$1 AND file_hash=$2`,
      [bankAccountId, fileHash],
    );
    return r.rows[0] ?? null;
  }
  async findStatementImportByIdempotencyKey(tx: Tx, key: string): Promise<StatementImportRow | null> {
    const r = await tx.query<StatementImportRow>(
      `SELECT ${STATEMENT_IMPORT_COLS} FROM recon_statement_import WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async finalizeStatementImport(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; lineCount: number; by: string | null },
  ): Promise<StatementImportRow | null> {
    const r = await tx.query<StatementImportRow>(
      `UPDATE recon_statement_import SET status=$3, line_count=$4, updated_by=$5, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${STATEMENT_IMPORT_COLS}`,
      [i.id, i.expectedVersion, i.status, i.lineCount, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listStatementImports(tx: Tx, bankAccountId: string): Promise<StatementImportRow[]> {
    const r = await tx.query<StatementImportRow>(
      `SELECT ${STATEMENT_IMPORT_COLS} FROM recon_statement_import WHERE bank_account_id=$1 ORDER BY created_at DESC`,
      [bankAccountId],
    );
    return r.rows;
  }

  // --- statement line ---------------------------------------------------------------------------
  async insertStatementLine(
    tx: Tx,
    i: {
      tenantId: string;
      importId: string;
      bankAccountId: string;
      lineNo: number;
      txnDate: string;
      valueDate: string | null;
      amountMinor: number;
      direction: string;
      reference: string | null;
      description: string | null;
      counterpartyRef: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<StatementLineRow> {
    const r = await tx.query<StatementLineRow>(
      `INSERT INTO recon_statement_line (tenant_id, import_id, bank_account_id, line_no, txn_date, value_date, amount_minor, direction, reference, description, counterparty_ref, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING ${STATEMENT_LINE_COLS}`,
      [
        i.tenantId,
        i.importId,
        i.bankAccountId,
        i.lineNo,
        i.txnDate,
        i.valueDate,
        i.amountMinor,
        i.direction,
        i.reference,
        i.description,
        i.counterpartyRef,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert statement line');
  }
  async findStatementLine(tx: Tx, id: string): Promise<StatementLineRow | null> {
    const r = await tx.query<StatementLineRow>(
      `SELECT ${STATEMENT_LINE_COLS} FROM recon_statement_line WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async listStatementLinesByImport(tx: Tx, importId: string): Promise<StatementLineRow[]> {
    const r = await tx.query<StatementLineRow>(
      `SELECT ${STATEMENT_LINE_COLS} FROM recon_statement_line WHERE import_id=$1 ORDER BY line_no`,
      [importId],
    );
    return r.rows;
  }
  /** Unmatched statement lines for an account — the matching engine's left input (deterministic order). */
  async listUnmatchedStatementLines(tx: Tx, bankAccountId: string): Promise<StatementLineRow[]> {
    const r = await tx.query<StatementLineRow>(
      `SELECT ${STATEMENT_LINE_COLS} FROM recon_statement_line WHERE bank_account_id=$1 AND status='unmatched' ORDER BY txn_date, line_no, id`,
      [bankAccountId],
    );
    return r.rows;
  }
  async setStatementLineStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; toStatus: string; by: string | null },
  ): Promise<StatementLineRow | null> {
    const r = await tx.query<StatementLineRow>(
      `UPDATE recon_statement_line SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${STATEMENT_LINE_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }

  // --- ledger import ----------------------------------------------------------------------------
  async insertLedgerImport(
    tx: Tx,
    i: {
      tenantId: string;
      bankAccountId: string;
      sourceFormat: string;
      fileHash: string | null;
      documentRef: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<LedgerImportRow> {
    const r = await tx.query<LedgerImportRow>(
      `INSERT INTO recon_ledger_import (tenant_id, bank_account_id, source_format, file_hash, document_ref, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING ${LEDGER_IMPORT_COLS}`,
      [
        i.tenantId,
        i.bankAccountId,
        i.sourceFormat,
        i.fileHash,
        i.documentRef,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert ledger import');
  }
  async findLedgerImport(tx: Tx, id: string): Promise<LedgerImportRow | null> {
    const r = await tx.query<LedgerImportRow>(
      `SELECT ${LEDGER_IMPORT_COLS} FROM recon_ledger_import WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  /** Duplicate-import lookup on (bank_account, file_hash) — only when a file hash is supplied. */
  async findLedgerImportByFileHash(
    tx: Tx,
    bankAccountId: string,
    fileHash: string,
  ): Promise<LedgerImportRow | null> {
    const r = await tx.query<LedgerImportRow>(
      `SELECT ${LEDGER_IMPORT_COLS} FROM recon_ledger_import WHERE bank_account_id=$1 AND file_hash=$2`,
      [bankAccountId, fileHash],
    );
    return r.rows[0] ?? null;
  }
  async finalizeLedgerImport(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; entryCount: number; by: string | null },
  ): Promise<LedgerImportRow | null> {
    const r = await tx.query<LedgerImportRow>(
      `UPDATE recon_ledger_import SET status=$3, entry_count=$4, updated_by=$5, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${LEDGER_IMPORT_COLS}`,
      [i.id, i.expectedVersion, i.status, i.entryCount, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listLedgerImports(tx: Tx, bankAccountId: string): Promise<LedgerImportRow[]> {
    const r = await tx.query<LedgerImportRow>(
      `SELECT ${LEDGER_IMPORT_COLS} FROM recon_ledger_import WHERE bank_account_id=$1 ORDER BY created_at DESC`,
      [bankAccountId],
    );
    return r.rows;
  }

  // --- ledger entry -----------------------------------------------------------------------------
  async insertLedgerEntry(
    tx: Tx,
    i: {
      tenantId: string;
      ledgerImportId: string;
      bankAccountId: string;
      entryNo: number | null;
      entryDate: string;
      amountMinor: number;
      direction: string;
      reference: string | null;
      description: string | null;
      sourceRef: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<LedgerEntryRow> {
    const r = await tx.query<LedgerEntryRow>(
      `INSERT INTO recon_ledger_entry (tenant_id, ledger_import_id, bank_account_id, entry_no, entry_date, amount_minor, direction, reference, description, source_ref, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING ${LEDGER_ENTRY_COLS}`,
      [
        i.tenantId,
        i.ledgerImportId,
        i.bankAccountId,
        i.entryNo,
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
    return firstRow(r.rows, 'insert ledger entry');
  }
  async findLedgerEntry(tx: Tx, id: string): Promise<LedgerEntryRow | null> {
    const r = await tx.query<LedgerEntryRow>(
      `SELECT ${LEDGER_ENTRY_COLS} FROM recon_ledger_entry WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async listLedgerEntriesByImport(tx: Tx, ledgerImportId: string): Promise<LedgerEntryRow[]> {
    const r = await tx.query<LedgerEntryRow>(
      `SELECT ${LEDGER_ENTRY_COLS} FROM recon_ledger_entry WHERE ledger_import_id=$1 ORDER BY entry_no NULLS LAST, id`,
      [ledgerImportId],
    );
    return r.rows;
  }
  /** Unmatched ledger entries for an account — the matching engine's right input (deterministic order). */
  async listUnmatchedLedgerEntries(tx: Tx, bankAccountId: string): Promise<LedgerEntryRow[]> {
    const r = await tx.query<LedgerEntryRow>(
      `SELECT ${LEDGER_ENTRY_COLS} FROM recon_ledger_entry WHERE bank_account_id=$1 AND status='unmatched' ORDER BY entry_date, id`,
      [bankAccountId],
    );
    return r.rows;
  }
  async setLedgerEntryStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; toStatus: string; by: string | null },
  ): Promise<LedgerEntryRow | null> {
    const r = await tx.query<LedgerEntryRow>(
      `UPDATE recon_ledger_entry SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${LEDGER_ENTRY_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }

  // --- reconciliation run -----------------------------------------------------------------------
  async insertRun(
    tx: Tx,
    i: {
      tenantId: string;
      bankAccountId: string;
      rulesetId: string | null;
      periodStart: string | null;
      periodEnd: string | null;
      openingBalanceMinor: number | null;
      closingBalanceMinor: number | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<RunRow> {
    const r = await tx.query<RunRow>(
      `INSERT INTO recon_run (tenant_id, bank_account_id, ruleset_id, period_start, period_end, opening_balance_minor, closing_balance_minor, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$8,$9,$9) RETURNING ${RUN_COLS}`,
      [
        i.tenantId,
        i.bankAccountId,
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
  async findRun(tx: Tx, id: string): Promise<RunRow | null> {
    const r = await tx.query<RunRow>(`SELECT ${RUN_COLS} FROM recon_run WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async transitionRun(
    tx: Tx,
    i: { id: string; expectedVersion: number; toStatus: string; by: string | null },
  ): Promise<RunRow | null> {
    const r = await tx.query<RunRow>(
      `UPDATE recon_run SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${RUN_COLS}`,
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
      by: string | null;
    },
  ): Promise<RunRow | null> {
    const r = await tx.query<RunRow>(
      `UPDATE recon_run SET matched_count=$3, unmatched_count=$4, exception_count=$5, updated_by=$6, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${RUN_COLS}`,
      [i.id, i.expectedVersion, i.matchedCount, i.unmatchedCount, i.exceptionCount, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listRuns(tx: Tx, i: { bankAccountId?: string; status?: string }): Promise<RunRow[]> {
    const r = await tx.query<RunRow>(
      `SELECT ${RUN_COLS} FROM recon_run WHERE ($1::uuid IS NULL OR bank_account_id=$1) AND ($2::text IS NULL OR status=$2) ORDER BY created_at DESC`,
      [i.bankAccountId ?? null, i.status ?? null],
    );
    return r.rows;
  }

  // --- run status history (append-only) ---------------------------------------------------------
  async insertStatusHistory(
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
      `INSERT INTO recon_status_history (tenant_id, run_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.runId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }
  async listStatusHistory(tx: Tx, runId: string): Promise<StatusHistoryRow[]> {
    const r = await tx.query<StatusHistoryRow>(
      `SELECT ${STATUS_HISTORY_COLS} FROM recon_status_history WHERE run_id=$1 ORDER BY created_at`,
      [runId],
    );
    return r.rows;
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
  ): Promise<MatchRow> {
    const r = await tx.query<MatchRow>(
      `INSERT INTO recon_match (tenant_id, run_id, match_type, status, confidence_band, colour_status, score, amount_variance_minor, matched_by, ruleset_id, ruleset_version, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING ${MATCH_COLS}`,
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
  async findMatch(tx: Tx, id: string): Promise<MatchRow | null> {
    const r = await tx.query<MatchRow>(`SELECT ${MATCH_COLS} FROM recon_match WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findMatchByIdempotencyKey(tx: Tx, key: string): Promise<MatchRow | null> {
    const r = await tx.query<MatchRow>(`SELECT ${MATCH_COLS} FROM recon_match WHERE idempotency_key=$1`, [
      key,
    ]);
    return r.rows[0] ?? null;
  }
  async transitionMatch(
    tx: Tx,
    i: { id: string; expectedVersion: number; toStatus: string; by: string | null },
  ): Promise<MatchRow | null> {
    const r = await tx.query<MatchRow>(
      `UPDATE recon_match SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${MATCH_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listMatchesByRun(tx: Tx, i: { runId: string; status?: string }): Promise<MatchRow[]> {
    const r = await tx.query<MatchRow>(
      `SELECT ${MATCH_COLS} FROM recon_match WHERE run_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY created_at`,
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
      statementLineId: string | null;
      ledgerEntryId: string | null;
      amountMinor: number;
      correlationId: string;
      by: string | null;
    },
  ): Promise<MatchLineRow> {
    const r = await tx.query<MatchLineRow>(
      `INSERT INTO recon_match_line (tenant_id, match_id, side, statement_line_id, ledger_entry_id, amount_minor, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${MATCH_LINE_COLS}`,
      [
        i.tenantId,
        i.matchId,
        i.side,
        i.statementLineId,
        i.ledgerEntryId,
        i.amountMinor,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert match line');
  }
  async listMatchLinesByMatch(tx: Tx, matchId: string): Promise<MatchLineRow[]> {
    const r = await tx.query<MatchLineRow>(
      `SELECT ${MATCH_LINE_COLS} FROM recon_match_line WHERE match_id=$1 ORDER BY side, created_at`,
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
      statementLineId: string | null;
      ledgerEntryId: string | null;
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
  ): Promise<MatchCandidateRow> {
    const r = await tx.query<MatchCandidateRow>(
      `INSERT INTO recon_match_candidate (tenant_id, run_id, statement_line_id, ledger_entry_id, score, confidence_band, colour_status, amount_variance_minor, date_variance_days, reference_match, description_score, direction_compatible, reason_codes, rule_codes, ruleset_id, ruleset_version, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::numeric,$12,$13,$14,$15,$16,$17) RETURNING ${MATCH_CANDIDATE_COLS}`,
      [
        i.tenantId,
        i.runId,
        i.statementLineId,
        i.ledgerEntryId,
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
  async listMatchCandidatesByRun(tx: Tx, runId: string): Promise<MatchCandidateRow[]> {
    const r = await tx.query<MatchCandidateRow>(
      `SELECT ${MATCH_CANDIDATE_COLS} FROM recon_match_candidate WHERE run_id=$1 ORDER BY created_at`,
      [runId],
    );
    return r.rows;
  }

  // --- exception --------------------------------------------------------------------------------
  async insertException(
    tx: Tx,
    i: {
      tenantId: string;
      runId: string;
      statementLineId: string | null;
      ledgerEntryId: string | null;
      exceptionType: string;
      ageDays: number;
      reason: string | null;
      required: boolean;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ExceptionRow> {
    const r = await tx.query<ExceptionRow>(
      `INSERT INTO recon_exception (tenant_id, run_id, statement_line_id, ledger_entry_id, exception_type, age_days, reason, required, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING ${EXCEPTION_COLS}`,
      [
        i.tenantId,
        i.runId,
        i.statementLineId,
        i.ledgerEntryId,
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
  async findException(tx: Tx, id: string): Promise<ExceptionRow | null> {
    const r = await tx.query<ExceptionRow>(`SELECT ${EXCEPTION_COLS} FROM recon_exception WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  /** Status transition; stamps resolved_by / resolved_at when leaving `open`. CAS on version. */
  async transitionException(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      resolvedBy: string | null;
      by: string | null;
    },
  ): Promise<ExceptionRow | null> {
    const r = await tx.query<ExceptionRow>(
      `UPDATE recon_exception SET status=$3, resolved_by=COALESCE($4,resolved_by), resolved_at=CASE WHEN $3 IN ('resolved','waived') THEN now() ELSE resolved_at END, updated_by=$5, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${EXCEPTION_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.resolvedBy, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listExceptionsByRun(tx: Tx, i: { runId: string; status?: string }): Promise<ExceptionRow[]> {
    const r = await tx.query<ExceptionRow>(
      `SELECT ${EXCEPTION_COLS} FROM recon_exception WHERE run_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY created_at`,
      [i.runId, i.status ?? null],
    );
    return r.rows;
  }
  /** Fail-closed completion gate: the count of still-open REQUIRED exceptions for a run. */
  async countOpenRequiredExceptions(tx: Tx, runId: string): Promise<number> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM recon_exception WHERE run_id=$1 AND status='open' AND required=true`,
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
      statementLineId: string | null;
      ledgerEntryId: string | null;
      exceptionId: string | null;
      reason: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<ManualDecisionRow> {
    const r = await tx.query<ManualDecisionRow>(
      `INSERT INTO recon_manual_decision (tenant_id, run_id, decision_type, match_id, statement_line_id, ledger_entry_id, exception_id, by_user, reason, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${MANUAL_DECISION_COLS}`,
      [
        i.tenantId,
        i.runId,
        i.decisionType,
        i.matchId,
        i.statementLineId,
        i.ledgerEntryId,
        i.exceptionId,
        i.by,
        i.reason,
        i.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert manual decision');
  }
  async listManualDecisionsByRun(tx: Tx, runId: string): Promise<ManualDecisionRow[]> {
    const r = await tx.query<ManualDecisionRow>(
      `SELECT ${MANUAL_DECISION_COLS} FROM recon_manual_decision WHERE run_id=$1 ORDER BY created_at`,
      [runId],
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
      /** Certified minor-unit totals — passed as STRINGS straight to bigint, never through a float (ADR-007). */
      matchedAmountMinor: string;
      unmatchedAmountMinor: string;
      colourStatus: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<RunSummaryRow> {
    const r = await tx.query<RunSummaryRow>(
      `INSERT INTO recon_run_summary (tenant_id, run_id, matched_count, unmatched_count, exception_count, matched_amount_minor, unmatched_amount_minor, colour_status, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${RUN_SUMMARY_COLS}`,
      [
        i.tenantId,
        i.runId,
        i.matchedCount,
        i.unmatchedCount,
        i.exceptionCount,
        i.matchedAmountMinor,
        i.unmatchedAmountMinor,
        i.colourStatus,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert run summary');
  }
  async listRunSummariesByRun(tx: Tx, runId: string): Promise<RunSummaryRow[]> {
    const r = await tx.query<RunSummaryRow>(
      `SELECT ${RUN_SUMMARY_COLS} FROM recon_run_summary WHERE run_id=$1 ORDER BY created_at`,
      [runId],
    );
    return r.rows;
  }
  /**
   * Certified minor-unit totals for a run summary. matched = sum of the STATEMENT side of every proposed/confirmed
   * match; unmatched = sum of statement lines behind this run's exceptions. Both stay in INTEGER MINOR UNITS (a
   * bigint SUM projected `::text`) — never a float.
   */
  async computeRunSummaryAmounts(
    tx: Tx,
    runId: string,
  ): Promise<{ matchedMinor: string; unmatchedMinor: string }> {
    const r = await tx.query<{ matched_minor: string; unmatched_minor: string }>(
      `SELECT
         (SELECT COALESCE(SUM(ml.amount_minor),0) FROM recon_match_line ml JOIN recon_match m ON ml.tenant_id=m.tenant_id AND ml.match_id=m.id WHERE m.run_id=$1 AND m.status IN ('proposed','confirmed') AND ml.side='statement')::text AS matched_minor,
         (SELECT COALESCE(SUM(sl.amount_minor),0) FROM recon_exception e JOIN recon_statement_line sl ON e.tenant_id=sl.tenant_id AND e.statement_line_id=sl.id WHERE e.run_id=$1)::text AS unmatched_minor`,
      [runId],
    );
    const row = firstRow(r.rows, 'compute run summary amounts');
    return { matchedMinor: row.matched_minor, unmatchedMinor: row.unmatched_minor };
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
  ): Promise<NoteRow> {
    const r = await tx.query<NoteRow>(
      `INSERT INTO recon_note (tenant_id, run_id, note_type, content, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${NOTE_COLS}`,
      [i.tenantId, i.runId, i.noteType, i.content, i.by, i.correlationId],
    );
    return firstRow(r.rows, 'insert note');
  }
  async listNotesByRun(tx: Tx, runId: string): Promise<NoteRow[]> {
    const r = await tx.query<NoteRow>(
      `SELECT ${NOTE_COLS} FROM recon_note WHERE run_id=$1 ORDER BY created_at`,
      [runId],
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
      `INSERT INTO recon_import_error (tenant_id, import_id, import_kind, line_no, error_code, detail, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [i.tenantId, i.importId, i.importKind, i.lineNo, i.errorCode, i.detail, i.correlationId],
    );
  }
  async listImportErrors(tx: Tx, importId: string): Promise<ImportErrorRow[]> {
    const r = await tx.query<ImportErrorRow>(
      `SELECT ${IMPORT_ERROR_COLS} FROM recon_import_error WHERE import_id=$1 ORDER BY created_at`,
      [importId],
    );
    return r.rows;
  }
}
