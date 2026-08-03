/**
 * M21 repository — ALL SQL for the journal engine across its 18 tables. Every query is parameterized; every mutating
 * UPDATE on a mutable aggregate is optimistic-lock guarded (`WHERE id=$1 AND version=$expected`) so a stale command
 * changes zero rows and the caller reacts (single-winner). Queries carry NO tenant_id predicate: RLS FORCE is the
 * isolation guarantee. All methods take the caller's `Tx` so the row write, its append-only evidence, audit and
 * outbox commit atomically. Recommendation lines/history, draft status history, draft-balance evidence, notes,
 * validation + findings, posting-request/result history and the posting idempotency ledger are append-only
 * (INSERT + SELECT). A draft has exactly one type/config version active per code/scope; a posting request/result is
 * idempotency-keyed; the posting idempotency ledger is unique per key (no duplicate posting).
 *
 * MONEY IS INTEGER MINOR UNITS (bigint). Every `*_minor` column is PROJECTED `::text` and carried in the Row types as
 * a STRING — never parsed into a binary float (ADR-007, CLAUDE.md money rule). INSERTs accept an integer `number`
 * (validated by callers / the engine); the driver serialises it losslessly to bigint. m21 owns only its 18 tables; it
 * NEVER reads another module's tables (entity/period/account/currency/source/handoff/approval refs are OPAQUE ids).
 * It never posts a journal or approves one.
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m21 repository: expected a row from ${what}`);
  return row;
}

// --- row types (raw DB shape; snake_case columns as SELECTed) ------------------------------------
export interface JournalTypeRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly code: string;
  readonly version_number: number;
  readonly name: string | null;
  readonly kind: string;
  readonly status: string;
  readonly requires_balance: boolean;
  readonly version: number;
  readonly correlation_id: string;
}
export interface JournalConfigRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly version_number: number;
  readonly name: string | null;
  readonly status: string;
  readonly require_balanced: boolean;
  readonly allow_manual_draft: boolean;
  readonly max_lines: number;
  readonly content_hash: string | null;
  readonly idempotency_key: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface JournalReasonCodeRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly code: string;
  readonly category: string;
  readonly severity: string;
  readonly description: string | null;
  readonly active: boolean;
  readonly version: number;
  readonly correlation_id: string;
}
export interface JournalRecommendationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly source_type: string;
  readonly source_ref: string | null;
  readonly handoff_ref: string | null;
  readonly entity_ref: string | null;
  readonly currency_ref: string | null;
  /** INTEGER MINOR UNITS — read/written as a STRING, never a float (ADR-007). */
  readonly amount_minor: string;
  readonly description: string | null;
  readonly reason_code: string | null;
  readonly confidence_band: string | null;
  readonly status: string;
  readonly draft_id: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface JournalRecommendationLineRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly recommendation_id: string;
  readonly line_no: number;
  readonly account_ref: string | null;
  readonly direction: string;
  readonly amount_minor: string;
  readonly currency_ref: string | null;
  readonly description: string | null;
  readonly correlation_id: string;
}
export interface JournalRecommendationHistoryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly recommendation_id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly reason: string | null;
  readonly reason_code: string | null;
  readonly by_user: string | null;
  readonly correlation_id: string;
}
export interface JournalDraftRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly journal_type_id: string | null;
  readonly entity_ref: string | null;
  readonly period_ref: string | null;
  readonly period_status: string;
  readonly currency_ref: string | null;
  readonly journal_date: string | null;
  readonly description: string | null;
  readonly source_type: string;
  readonly source_ref: string | null;
  readonly recommendation_id: string | null;
  readonly reference: string | null;
  /** INTEGER MINOR UNITS — read/written as STRINGS, never a float (ADR-007). */
  readonly total_debits_minor: string;
  readonly total_credits_minor: string;
  readonly is_balanced: boolean;
  readonly line_count: number;
  readonly status: string;
  readonly requested_by: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface JournalLineRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly draft_id: string;
  readonly line_no: number;
  readonly account_ref: string | null;
  readonly direction: string;
  readonly amount_minor: string;
  readonly currency_ref: string | null;
  readonly cost_centre_ref: string | null;
  readonly dimension_ref: string | null;
  readonly tax_code_ref: string | null;
  readonly description: string | null;
  readonly status: string;
  readonly version: number;
  readonly correlation_id: string;
}
export interface JournalStatusHistoryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly draft_id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly reason: string | null;
  readonly reason_code: string | null;
  readonly by_user: string | null;
  readonly correlation_id: string;
}
export interface JournalDraftBalanceRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly draft_id: string;
  readonly debits_minor: string;
  readonly credits_minor: string;
  readonly variance_minor: string;
  readonly balanced: boolean;
  readonly line_count: number;
  readonly correlation_id: string;
}
export interface JournalNoteRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly draft_id: string;
  readonly note_type: string;
  readonly content: string;
  readonly by_user: string | null;
  readonly correlation_id: string;
}
export interface JournalValidationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly draft_id: string;
  readonly is_valid: boolean;
  readonly debits_minor: string;
  readonly credits_minor: string;
  readonly balanced: boolean;
  readonly error_count: number;
  readonly warning_count: number;
  readonly by_user: string | null;
  readonly correlation_id: string;
}
export interface JournalValidationFindingRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly validation_id: string;
  readonly draft_id: string;
  readonly line_ref: string | null;
  readonly severity: string;
  readonly reason_code: string;
  readonly detail: string | null;
  readonly correlation_id: string;
}
export interface PostingRequestRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly draft_id: string;
  readonly status: string;
  readonly approval_ref: string | null;
  readonly approved_by: string | null;
  readonly requested_by: string | null;
  readonly period_status: string;
  readonly amount_minor: string;
  readonly external_system: string | null;
  readonly idempotency_key: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface PostingRequestHistoryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly posting_request_id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly reason: string | null;
  readonly reason_code: string | null;
  readonly by_user: string | null;
  readonly correlation_id: string;
}
export interface PostingResultRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly posting_request_id: string;
  readonly status: string;
  readonly external_system: string | null;
  readonly external_ref: string | null;
  readonly idempotency_key: string | null;
  readonly message: string | null;
  readonly reason_code: string | null;
  readonly recorded_by: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface PostingResultHistoryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly posting_result_id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly reason: string | null;
  readonly by_user: string | null;
  readonly correlation_id: string;
}
export interface PostingIdempotencyRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly idempotency_key: string;
  readonly posting_request_id: string | null;
  readonly draft_id: string | null;
  readonly correlation_id: string;
}

// --- projected column lists (money as ::text) ---------------------------------------------------
const TYPE_COLS = `tenant_id, id, code, version_number, name, kind, status, requires_balance, version, correlation_id`;
const CONFIG_COLS = `tenant_id, id, scope, version_number, name, status, require_balanced, allow_manual_draft, max_lines, content_hash, idempotency_key, version, correlation_id`;
const REASON_COLS = `tenant_id, id, code, category, severity, description, active, version, correlation_id`;
const REC_COLS = `tenant_id, id, source_type, source_ref, handoff_ref, entity_ref, currency_ref, amount_minor::text AS amount_minor, description, reason_code, confidence_band, status, draft_id, version, correlation_id`;
const REC_LINE_COLS = `tenant_id, id, recommendation_id, line_no, account_ref, direction, amount_minor::text AS amount_minor, currency_ref, description, correlation_id`;
const REC_HIST_COLS = `tenant_id, id, recommendation_id, from_status, to_status, reason, reason_code, by_user, correlation_id`;
const DRAFT_COLS = `tenant_id, id, journal_type_id, entity_ref, period_ref, period_status, currency_ref, journal_date::text AS journal_date, description, source_type, source_ref, recommendation_id, reference, total_debits_minor::text AS total_debits_minor, total_credits_minor::text AS total_credits_minor, is_balanced, line_count, status, requested_by, version, correlation_id`;
const LINE_COLS = `tenant_id, id, draft_id, line_no, account_ref, direction, amount_minor::text AS amount_minor, currency_ref, cost_centre_ref, dimension_ref, tax_code_ref, description, status, version, correlation_id`;
const STATUS_HIST_COLS = `tenant_id, id, draft_id, from_status, to_status, reason, reason_code, by_user, correlation_id`;
const BALANCE_COLS = `tenant_id, id, draft_id, debits_minor::text AS debits_minor, credits_minor::text AS credits_minor, variance_minor::text AS variance_minor, balanced, line_count, correlation_id`;
const NOTE_COLS = `tenant_id, id, draft_id, note_type, content, by_user, correlation_id`;
const VAL_COLS = `tenant_id, id, draft_id, is_valid, debits_minor::text AS debits_minor, credits_minor::text AS credits_minor, balanced, error_count, warning_count, by_user, correlation_id`;
const VAL_FIND_COLS = `tenant_id, id, validation_id, draft_id, line_ref, severity, reason_code, detail, correlation_id`;
const PREQ_COLS = `tenant_id, id, draft_id, status, approval_ref, approved_by, requested_by, period_status, amount_minor::text AS amount_minor, external_system, idempotency_key, version, correlation_id`;
const PREQ_HIST_COLS = `tenant_id, id, posting_request_id, from_status, to_status, reason, reason_code, by_user, correlation_id`;
const PRES_COLS = `tenant_id, id, posting_request_id, status, external_system, external_ref, idempotency_key, message, reason_code, recorded_by, version, correlation_id`;
const PRES_HIST_COLS = `tenant_id, id, posting_result_id, from_status, to_status, reason, by_user, correlation_id`;
const IDEM_COLS = `tenant_id, id, idempotency_key, posting_request_id, draft_id, correlation_id`;

export class JournalRepository {
  // --- journal type ---------------------------------------------------------------------------
  async insertType(
    tx: Tx,
    i: {
      tenantId: string;
      code: string;
      name: string | null;
      kind: string;
      requiresBalance: boolean;
      correlationId: string;
      by: string | null;
    },
  ): Promise<JournalTypeRow> {
    const r = await tx.query<JournalTypeRow>(
      `INSERT INTO journal_type (tenant_id, code, name, kind, requires_balance, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING ${TYPE_COLS}`,
      [i.tenantId, i.code, i.name, i.kind, i.requiresBalance, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert type');
  }
  async findType(tx: Tx, id: string): Promise<JournalTypeRow | null> {
    const r = await tx.query<JournalTypeRow>(`SELECT ${TYPE_COLS} FROM journal_type WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async setTypeStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; by: string | null },
  ): Promise<JournalTypeRow | null> {
    const r = await tx.query<JournalTypeRow>(
      `UPDATE journal_type SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${TYPE_COLS}`,
      [i.id, i.expectedVersion, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listTypes(tx: Tx): Promise<JournalTypeRow[]> {
    const r = await tx.query<JournalTypeRow>(
      `SELECT ${TYPE_COLS} FROM journal_type ORDER BY code, version_number`,
    );
    return r.rows;
  }

  // --- journal config -------------------------------------------------------------------------
  async insertConfig(
    tx: Tx,
    i: {
      tenantId: string;
      scope: string;
      name: string | null;
      maxLines: number;
      allowManualDraft: boolean;
      contentHash: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<JournalConfigRow> {
    const r = await tx.query<JournalConfigRow>(
      `INSERT INTO journal_config (tenant_id, scope, name, max_lines, allow_manual_draft, content_hash, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING ${CONFIG_COLS}`,
      [
        i.tenantId,
        i.scope,
        i.name,
        i.maxLines,
        i.allowManualDraft,
        i.contentHash,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert config');
  }
  async findConfig(tx: Tx, id: string): Promise<JournalConfigRow | null> {
    const r = await tx.query<JournalConfigRow>(`SELECT ${CONFIG_COLS} FROM journal_config WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findConfigByIdempotencyKey(tx: Tx, key: string): Promise<JournalConfigRow | null> {
    const r = await tx.query<JournalConfigRow>(
      `SELECT ${CONFIG_COLS} FROM journal_config WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async setConfigStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; by: string | null },
  ): Promise<JournalConfigRow | null> {
    const r = await tx.query<JournalConfigRow>(
      `UPDATE journal_config SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${CONFIG_COLS}`,
      [i.id, i.expectedVersion, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listConfigs(tx: Tx): Promise<JournalConfigRow[]> {
    const r = await tx.query<JournalConfigRow>(
      `SELECT ${CONFIG_COLS} FROM journal_config ORDER BY scope, version_number`,
    );
    return r.rows;
  }

  // --- reason code ----------------------------------------------------------------------------
  async insertReasonCode(
    tx: Tx,
    i: {
      tenantId: string;
      code: string;
      category: string;
      severity: string;
      description: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<JournalReasonCodeRow> {
    const r = await tx.query<JournalReasonCodeRow>(
      `INSERT INTO journal_reason_code (tenant_id, code, category, severity, description, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING ${REASON_COLS}`,
      [i.tenantId, i.code, i.category, i.severity, i.description, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert reason code');
  }
  async findReasonCode(tx: Tx, code: string): Promise<JournalReasonCodeRow | null> {
    const r = await tx.query<JournalReasonCodeRow>(
      `SELECT ${REASON_COLS} FROM journal_reason_code WHERE code=$1`,
      [code],
    );
    return r.rows[0] ?? null;
  }
  async listReasonCodes(tx: Tx): Promise<JournalReasonCodeRow[]> {
    const r = await tx.query<JournalReasonCodeRow>(
      `SELECT ${REASON_COLS} FROM journal_reason_code ORDER BY category, code`,
    );
    return r.rows;
  }

  // --- recommendation -------------------------------------------------------------------------
  async insertRecommendation(
    tx: Tx,
    i: {
      tenantId: string;
      sourceType: string;
      sourceRef: string | null;
      handoffRef: string | null;
      entityRef: string | null;
      currencyRef: string | null;
      amountMinor: number;
      description: string | null;
      reasonCode: string | null;
      confidenceBand: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<JournalRecommendationRow> {
    const r = await tx.query<JournalRecommendationRow>(
      `INSERT INTO journal_recommendation (tenant_id, source_type, source_ref, handoff_ref, entity_ref, currency_ref, amount_minor, description, reason_code, confidence_band, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING ${REC_COLS}`,
      [
        i.tenantId,
        i.sourceType,
        i.sourceRef,
        i.handoffRef,
        i.entityRef,
        i.currencyRef,
        i.amountMinor,
        i.description,
        i.reasonCode,
        i.confidenceBand,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert recommendation');
  }
  async findRecommendation(tx: Tx, id: string): Promise<JournalRecommendationRow | null> {
    const r = await tx.query<JournalRecommendationRow>(
      `SELECT ${REC_COLS} FROM journal_recommendation WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async findRecommendationByHandoff(tx: Tx, handoffRef: string): Promise<JournalRecommendationRow | null> {
    const r = await tx.query<JournalRecommendationRow>(
      `SELECT ${REC_COLS} FROM journal_recommendation WHERE handoff_ref=$1`,
      [handoffRef],
    );
    return r.rows[0] ?? null;
  }
  async setRecommendationStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; toStatus: string; draftId: string | null; by: string | null },
  ): Promise<JournalRecommendationRow | null> {
    const r = await tx.query<JournalRecommendationRow>(
      `UPDATE journal_recommendation SET status=$3, draft_id=COALESCE($4, draft_id), updated_by=$5, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${REC_COLS}`,
      [i.id, i.expectedVersion, i.toStatus, i.draftId, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listRecommendations(tx: Tx, status?: string): Promise<JournalRecommendationRow[]> {
    if (status !== undefined) {
      const r = await tx.query<JournalRecommendationRow>(
        `SELECT ${REC_COLS} FROM journal_recommendation WHERE status=$1 ORDER BY created_at DESC`,
        [status],
      );
      return r.rows;
    }
    const r = await tx.query<JournalRecommendationRow>(
      `SELECT ${REC_COLS} FROM journal_recommendation ORDER BY created_at DESC`,
    );
    return r.rows;
  }
  async insertRecommendationLine(
    tx: Tx,
    i: {
      tenantId: string;
      recommendationId: string;
      lineNo: number;
      accountRef: string | null;
      direction: string;
      amountMinor: number;
      currencyRef: string | null;
      description: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<JournalRecommendationLineRow> {
    const r = await tx.query<JournalRecommendationLineRow>(
      `INSERT INTO journal_recommendation_line (tenant_id, recommendation_id, line_no, account_ref, direction, amount_minor, currency_ref, description, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${REC_LINE_COLS}`,
      [
        i.tenantId,
        i.recommendationId,
        i.lineNo,
        i.accountRef,
        i.direction,
        i.amountMinor,
        i.currencyRef,
        i.description,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert recommendation line');
  }
  async listRecommendationLines(tx: Tx, recommendationId: string): Promise<JournalRecommendationLineRow[]> {
    const r = await tx.query<JournalRecommendationLineRow>(
      `SELECT ${REC_LINE_COLS} FROM journal_recommendation_line WHERE recommendation_id=$1 ORDER BY line_no`,
      [recommendationId],
    );
    return r.rows;
  }
  async insertRecommendationHistory(
    tx: Tx,
    i: {
      tenantId: string;
      recommendationId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO journal_recommendation_history (tenant_id, recommendation_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        i.tenantId,
        i.recommendationId,
        i.fromStatus,
        i.toStatus,
        i.reason,
        i.reasonCode,
        i.by,
        i.correlationId,
      ],
    );
  }
  async listRecommendationHistory(
    tx: Tx,
    recommendationId: string,
  ): Promise<JournalRecommendationHistoryRow[]> {
    const r = await tx.query<JournalRecommendationHistoryRow>(
      `SELECT ${REC_HIST_COLS} FROM journal_recommendation_history WHERE recommendation_id=$1 ORDER BY created_at`,
      [recommendationId],
    );
    return r.rows;
  }

  // --- draft ----------------------------------------------------------------------------------
  async insertDraft(
    tx: Tx,
    i: {
      tenantId: string;
      journalTypeId: string | null;
      entityRef: string | null;
      periodRef: string | null;
      periodStatus: string;
      currencyRef: string | null;
      journalDate: string | null;
      description: string | null;
      sourceType: string;
      sourceRef: string | null;
      recommendationId: string | null;
      reference: string | null;
      requestedBy: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<JournalDraftRow> {
    const r = await tx.query<JournalDraftRow>(
      `INSERT INTO journal_draft (tenant_id, journal_type_id, entity_ref, period_ref, period_status, currency_ref, journal_date, description, source_type, source_ref, recommendation_id, reference, requested_by, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING ${DRAFT_COLS}`,
      [
        i.tenantId,
        i.journalTypeId,
        i.entityRef,
        i.periodRef,
        i.periodStatus,
        i.currencyRef,
        i.journalDate,
        i.description,
        i.sourceType,
        i.sourceRef,
        i.recommendationId,
        i.reference,
        i.requestedBy,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert draft');
  }
  async findDraft(tx: Tx, id: string): Promise<JournalDraftRow | null> {
    const r = await tx.query<JournalDraftRow>(`SELECT ${DRAFT_COLS} FROM journal_draft WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  /** Recompute + persist the draft totals from its ACTIVE lines. Optimistic-lock guarded. */
  async updateDraftTotals(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      totalDebitsMinor: number;
      totalCreditsMinor: number;
      isBalanced: boolean;
      lineCount: number;
      by: string | null;
    },
  ): Promise<JournalDraftRow | null> {
    const r = await tx.query<JournalDraftRow>(
      `UPDATE journal_draft SET total_debits_minor=$3, total_credits_minor=$4, is_balanced=$5, line_count=$6, updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${DRAFT_COLS}`,
      [i.id, i.expectedVersion, i.totalDebitsMinor, i.totalCreditsMinor, i.isBalanced, i.lineCount, i.by],
    );
    return r.rows[0] ?? null;
  }
  async updateDraftHeader(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      journalTypeId: string | null;
      entityRef: string | null;
      periodRef: string | null;
      periodStatus: string;
      currencyRef: string | null;
      journalDate: string | null;
      description: string | null;
      reference: string | null;
      by: string | null;
    },
  ): Promise<JournalDraftRow | null> {
    const r = await tx.query<JournalDraftRow>(
      `UPDATE journal_draft SET journal_type_id=$3, entity_ref=$4, period_ref=$5, period_status=$6, currency_ref=$7, journal_date=$8::date, description=$9, reference=$10, updated_by=$11, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status IN ('draft','validated') RETURNING ${DRAFT_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.journalTypeId,
        i.entityRef,
        i.periodRef,
        i.periodStatus,
        i.currencyRef,
        i.journalDate,
        i.description,
        i.reference,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async setDraftStatus(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      status: string;
      periodStatus?: string | null;
      by: string | null;
    },
  ): Promise<JournalDraftRow | null> {
    const r = await tx.query<JournalDraftRow>(
      `UPDATE journal_draft SET status=$3, period_status=COALESCE($4, period_status), updated_by=$5, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${DRAFT_COLS}`,
      [i.id, i.expectedVersion, i.status, i.periodStatus ?? null, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listDrafts(tx: Tx, status?: string): Promise<JournalDraftRow[]> {
    if (status !== undefined) {
      const r = await tx.query<JournalDraftRow>(
        `SELECT ${DRAFT_COLS} FROM journal_draft WHERE status=$1 ORDER BY created_at DESC`,
        [status],
      );
      return r.rows;
    }
    const r = await tx.query<JournalDraftRow>(
      `SELECT ${DRAFT_COLS} FROM journal_draft ORDER BY created_at DESC`,
    );
    return r.rows;
  }

  // --- line -----------------------------------------------------------------------------------
  async insertLine(
    tx: Tx,
    i: {
      tenantId: string;
      draftId: string;
      lineNo: number;
      accountRef: string | null;
      direction: string;
      amountMinor: number;
      currencyRef: string | null;
      costCentreRef: string | null;
      dimensionRef: string | null;
      taxCodeRef: string | null;
      description: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<JournalLineRow> {
    const r = await tx.query<JournalLineRow>(
      `INSERT INTO journal_line (tenant_id, draft_id, line_no, account_ref, direction, amount_minor, currency_ref, cost_centre_ref, dimension_ref, tax_code_ref, description, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING ${LINE_COLS}`,
      [
        i.tenantId,
        i.draftId,
        i.lineNo,
        i.accountRef,
        i.direction,
        i.amountMinor,
        i.currencyRef,
        i.costCentreRef,
        i.dimensionRef,
        i.taxCodeRef,
        i.description,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert line');
  }
  async findLine(tx: Tx, id: string): Promise<JournalLineRow | null> {
    const r = await tx.query<JournalLineRow>(`SELECT ${LINE_COLS} FROM journal_line WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async updateLine(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      accountRef: string | null;
      direction: string;
      amountMinor: number;
      currencyRef: string | null;
      description: string | null;
      by: string | null;
    },
  ): Promise<JournalLineRow | null> {
    const r = await tx.query<JournalLineRow>(
      `UPDATE journal_line SET account_ref=$3, direction=$4, amount_minor=$5, currency_ref=$6, description=$7, updated_by=$8, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status='active' RETURNING ${LINE_COLS}`,
      [i.id, i.expectedVersion, i.accountRef, i.direction, i.amountMinor, i.currencyRef, i.description, i.by],
    );
    return r.rows[0] ?? null;
  }
  async removeLine(
    tx: Tx,
    i: { id: string; expectedVersion: number; by: string | null },
  ): Promise<JournalLineRow | null> {
    const r = await tx.query<JournalLineRow>(
      `UPDATE journal_line SET status='removed', updated_by=$3, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status='active' RETURNING ${LINE_COLS}`,
      [i.id, i.expectedVersion, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listLines(tx: Tx, draftId: string, onlyActive: boolean): Promise<JournalLineRow[]> {
    const sql = onlyActive
      ? `SELECT ${LINE_COLS} FROM journal_line WHERE draft_id=$1 AND status='active' ORDER BY line_no`
      : `SELECT ${LINE_COLS} FROM journal_line WHERE draft_id=$1 ORDER BY line_no`;
    const r = await tx.query<JournalLineRow>(sql, [draftId]);
    return r.rows;
  }
  async nextLineNo(tx: Tx, draftId: string): Promise<number> {
    const r = await tx.query<{ next: string }>(
      `SELECT COALESCE(MAX(line_no),0)+1 AS next FROM journal_line WHERE draft_id=$1`,
      [draftId],
    );
    return Number(r.rows[0]?.next ?? 1);
  }

  // --- draft evidence (append-only) -----------------------------------------------------------
  async insertStatusHistory(
    tx: Tx,
    i: {
      tenantId: string;
      draftId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO journal_status_history (tenant_id, draft_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.draftId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }
  async listStatusHistory(tx: Tx, draftId: string): Promise<JournalStatusHistoryRow[]> {
    const r = await tx.query<JournalStatusHistoryRow>(
      `SELECT ${STATUS_HIST_COLS} FROM journal_status_history WHERE draft_id=$1 ORDER BY created_at`,
      [draftId],
    );
    return r.rows;
  }
  async insertDraftBalance(
    tx: Tx,
    i: {
      tenantId: string;
      draftId: string;
      debitsMinor: number;
      creditsMinor: number;
      varianceMinor: number;
      balanced: boolean;
      lineCount: number;
      correlationId: string;
      by: string | null;
    },
  ): Promise<JournalDraftBalanceRow> {
    const r = await tx.query<JournalDraftBalanceRow>(
      `INSERT INTO journal_draft_balance (tenant_id, draft_id, debits_minor, credits_minor, variance_minor, balanced, line_count, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${BALANCE_COLS}`,
      [
        i.tenantId,
        i.draftId,
        i.debitsMinor,
        i.creditsMinor,
        i.varianceMinor,
        i.balanced,
        i.lineCount,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert draft balance');
  }
  async listDraftBalances(tx: Tx, draftId: string): Promise<JournalDraftBalanceRow[]> {
    const r = await tx.query<JournalDraftBalanceRow>(
      `SELECT ${BALANCE_COLS} FROM journal_draft_balance WHERE draft_id=$1 ORDER BY created_at`,
      [draftId],
    );
    return r.rows;
  }
  async insertNote(
    tx: Tx,
    i: {
      tenantId: string;
      draftId: string;
      noteType: string;
      content: string;
      by: string | null;
      correlationId: string;
    },
  ): Promise<JournalNoteRow> {
    const r = await tx.query<JournalNoteRow>(
      `INSERT INTO journal_note (tenant_id, draft_id, note_type, content, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${NOTE_COLS}`,
      [i.tenantId, i.draftId, i.noteType, i.content, i.by, i.correlationId],
    );
    return firstRow(r.rows, 'insert note');
  }
  async listNotes(tx: Tx, draftId: string): Promise<JournalNoteRow[]> {
    const r = await tx.query<JournalNoteRow>(
      `SELECT ${NOTE_COLS} FROM journal_note WHERE draft_id=$1 ORDER BY created_at`,
      [draftId],
    );
    return r.rows;
  }

  // --- validation (append-only) ---------------------------------------------------------------
  async insertValidation(
    tx: Tx,
    i: {
      tenantId: string;
      draftId: string;
      isValid: boolean;
      debitsMinor: number;
      creditsMinor: number;
      balanced: boolean;
      errorCount: number;
      warningCount: number;
      by: string | null;
      correlationId: string;
    },
  ): Promise<JournalValidationRow> {
    const r = await tx.query<JournalValidationRow>(
      `INSERT INTO journal_validation (tenant_id, draft_id, is_valid, debits_minor, credits_minor, balanced, error_count, warning_count, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${VAL_COLS}`,
      [
        i.tenantId,
        i.draftId,
        i.isValid,
        i.debitsMinor,
        i.creditsMinor,
        i.balanced,
        i.errorCount,
        i.warningCount,
        i.by,
        i.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert validation');
  }
  async insertValidationFinding(
    tx: Tx,
    i: {
      tenantId: string;
      validationId: string;
      draftId: string;
      lineRef: string | null;
      severity: string;
      reasonCode: string;
      detail: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO journal_validation_finding (tenant_id, validation_id, draft_id, line_ref, severity, reason_code, detail, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.validationId, i.draftId, i.lineRef, i.severity, i.reasonCode, i.detail, i.correlationId],
    );
  }
  async findValidation(tx: Tx, id: string): Promise<JournalValidationRow | null> {
    const r = await tx.query<JournalValidationRow>(`SELECT ${VAL_COLS} FROM journal_validation WHERE id=$1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }
  async listValidations(tx: Tx, draftId: string): Promise<JournalValidationRow[]> {
    const r = await tx.query<JournalValidationRow>(
      `SELECT ${VAL_COLS} FROM journal_validation WHERE draft_id=$1 ORDER BY created_at DESC`,
      [draftId],
    );
    return r.rows;
  }
  async listValidationFindings(tx: Tx, validationId: string): Promise<JournalValidationFindingRow[]> {
    const r = await tx.query<JournalValidationFindingRow>(
      `SELECT ${VAL_FIND_COLS} FROM journal_validation_finding WHERE validation_id=$1 ORDER BY created_at`,
      [validationId],
    );
    return r.rows;
  }

  // --- posting request ------------------------------------------------------------------------
  async insertPostingRequest(
    tx: Tx,
    i: {
      tenantId: string;
      draftId: string;
      requestedBy: string | null;
      periodStatus: string;
      amountMinor: number;
      externalSystem: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<PostingRequestRow> {
    const r = await tx.query<PostingRequestRow>(
      `INSERT INTO posting_request (tenant_id, draft_id, requested_by, period_status, amount_minor, external_system, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING ${PREQ_COLS}`,
      [
        i.tenantId,
        i.draftId,
        i.requestedBy,
        i.periodStatus,
        i.amountMinor,
        i.externalSystem,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert posting request');
  }
  async findPostingRequest(tx: Tx, id: string): Promise<PostingRequestRow | null> {
    const r = await tx.query<PostingRequestRow>(`SELECT ${PREQ_COLS} FROM posting_request WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findPostingRequestByIdempotencyKey(tx: Tx, key: string): Promise<PostingRequestRow | null> {
    const r = await tx.query<PostingRequestRow>(
      `SELECT ${PREQ_COLS} FROM posting_request WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async setPostingRequestStatus(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      status: string;
      approvalRef?: string | null;
      approvedBy?: string | null;
      periodStatus?: string | null;
      by: string | null;
    },
  ): Promise<PostingRequestRow | null> {
    const r = await tx.query<PostingRequestRow>(
      `UPDATE posting_request SET status=$3, approval_ref=COALESCE($4, approval_ref), approved_by=COALESCE($5, approved_by), period_status=COALESCE($6, period_status), updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${PREQ_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.status,
        i.approvalRef ?? null,
        i.approvedBy ?? null,
        i.periodStatus ?? null,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async listPostingRequests(tx: Tx, draftId: string): Promise<PostingRequestRow[]> {
    const r = await tx.query<PostingRequestRow>(
      `SELECT ${PREQ_COLS} FROM posting_request WHERE draft_id=$1 ORDER BY created_at DESC`,
      [draftId],
    );
    return r.rows;
  }
  async insertPostingRequestHistory(
    tx: Tx,
    i: {
      tenantId: string;
      postingRequestId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO posting_request_history (tenant_id, posting_request_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        i.tenantId,
        i.postingRequestId,
        i.fromStatus,
        i.toStatus,
        i.reason,
        i.reasonCode,
        i.by,
        i.correlationId,
      ],
    );
  }
  async listPostingRequestHistory(tx: Tx, postingRequestId: string): Promise<PostingRequestHistoryRow[]> {
    const r = await tx.query<PostingRequestHistoryRow>(
      `SELECT ${PREQ_HIST_COLS} FROM posting_request_history WHERE posting_request_id=$1 ORDER BY created_at`,
      [postingRequestId],
    );
    return r.rows;
  }

  // --- posting result -------------------------------------------------------------------------
  async insertPostingResult(
    tx: Tx,
    i: {
      tenantId: string;
      postingRequestId: string;
      status: string;
      externalSystem: string | null;
      externalRef: string | null;
      idempotencyKey: string | null;
      message: string | null;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<PostingResultRow> {
    const r = await tx.query<PostingResultRow>(
      `INSERT INTO posting_result (tenant_id, posting_request_id, status, external_system, external_ref, idempotency_key, message, reason_code, recorded_by, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9,$9) RETURNING ${PRES_COLS}`,
      [
        i.tenantId,
        i.postingRequestId,
        i.status,
        i.externalSystem,
        i.externalRef,
        i.idempotencyKey,
        i.message,
        i.reasonCode,
        i.by,
        i.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert posting result');
  }
  async findPostingResult(tx: Tx, id: string): Promise<PostingResultRow | null> {
    const r = await tx.query<PostingResultRow>(`SELECT ${PRES_COLS} FROM posting_result WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async setPostingResultStatus(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      status: string;
      externalRef?: string | null;
      message?: string | null;
      reasonCode?: string | null;
      by: string | null;
    },
  ): Promise<PostingResultRow | null> {
    const r = await tx.query<PostingResultRow>(
      `UPDATE posting_result SET status=$3, external_ref=COALESCE($4, external_ref), message=COALESCE($5, message), reason_code=COALESCE($6, reason_code), updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${PRES_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.status,
        i.externalRef ?? null,
        i.message ?? null,
        i.reasonCode ?? null,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async listPostingResults(tx: Tx, postingRequestId: string): Promise<PostingResultRow[]> {
    const r = await tx.query<PostingResultRow>(
      `SELECT ${PRES_COLS} FROM posting_result WHERE posting_request_id=$1 ORDER BY created_at DESC`,
      [postingRequestId],
    );
    return r.rows;
  }
  async insertPostingResultHistory(
    tx: Tx,
    i: {
      tenantId: string;
      postingResultId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO posting_result_history (tenant_id, posting_result_id, from_status, to_status, reason, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [i.tenantId, i.postingResultId, i.fromStatus, i.toStatus, i.reason, i.by, i.correlationId],
    );
  }
  async listPostingResultHistory(tx: Tx, postingResultId: string): Promise<PostingResultHistoryRow[]> {
    const r = await tx.query<PostingResultHistoryRow>(
      `SELECT ${PRES_HIST_COLS} FROM posting_result_history WHERE posting_result_id=$1 ORDER BY created_at`,
      [postingResultId],
    );
    return r.rows;
  }

  // --- posting idempotency ledger (no duplicate posting) --------------------------------------
  async insertPostingIdempotency(
    tx: Tx,
    i: {
      tenantId: string;
      idempotencyKey: string;
      postingRequestId: string | null;
      draftId: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<PostingIdempotencyRow> {
    const r = await tx.query<PostingIdempotencyRow>(
      `INSERT INTO posting_idempotency (tenant_id, idempotency_key, posting_request_id, draft_id, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${IDEM_COLS}`,
      [i.tenantId, i.idempotencyKey, i.postingRequestId, i.draftId, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert posting idempotency');
  }
  async findPostingIdempotency(tx: Tx, key: string): Promise<PostingIdempotencyRow | null> {
    const r = await tx.query<PostingIdempotencyRow>(
      `SELECT ${IDEM_COLS} FROM posting_idempotency WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }

  /** True if a succeeded posting result already exists for this draft — the "no duplicate posting" read. */
  async draftHasSuccessfulPosting(tx: Tx, draftId: string): Promise<boolean> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM posting_result pr JOIN posting_request req ON req.id = pr.posting_request_id WHERE req.draft_id=$1 AND pr.status='succeeded'`,
      [draftId],
    );
    return Number(r.rows[0]?.c ?? '0') > 0;
  }
}
