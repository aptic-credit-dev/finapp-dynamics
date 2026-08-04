/**
 * M22 repository — ALL SQL for the approval workflow across its 24 tables. Every query is parameterized; every mutating
 * UPDATE on a mutable aggregate is optimistic-lock guarded (`WHERE id=$1 AND version=$expected`) so a stale command
 * changes zero rows and the caller reacts (single-winner / stale-version rejection). Queries carry NO tenant_id
 * predicate: RLS FORCE is the isolation guarantee. All methods take the caller's `Tx` so the row write, its append-only
 * evidence, audit and outbox commit atomically. Policy steps, all *_history, decisions, assignments, SoD checks,
 * participants, escalations, timers, notifications, workflow links, the idempotency ledger, notes, evidence, outcomes
 * and overrides are append-only (INSERT + SELECT). Money is INTEGER MINOR UNITS (bigint): `amount_minor` /
 * `threshold_minor` are PROJECTED `::text` and carried as STRINGS, never parsed into a binary float (ADR-007). m22 owns
 * only its 24 tables; subject/workflow/timer/notification/document refs are OPAQUE ids (no FK). It never approves on
 * behalf of a human and never posts.
 */
import type { Tx } from '@finapp/kernel';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m22 repository: expected a row from ${what}`);
  return row;
}

// --- row types (raw DB shape; snake_case columns as SELECTed) ------------------------------------
export interface ApprovalPolicyRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly subject_type: string;
  readonly scope: string;
  readonly version_number: number;
  readonly name: string | null;
  readonly status: string;
  readonly required_approvals: number;
  readonly min_levels: number;
  readonly sod_mode: string;
  readonly escalation_enabled: boolean;
  /** INTEGER MINOR UNITS — read/written as a STRING, never a float (ADR-007). */
  readonly threshold_minor: string;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ApprovalPolicyStepRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly policy_id: string;
  readonly level: number;
  readonly required_permission: string | null;
  readonly sod_constraint: string;
  readonly escalation_after_seconds: number | null;
  readonly escalation_target: string | null;
  readonly escalation_mode: string;
  readonly correlation_id: string;
}
export interface ApprovalConfigRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly scope: string;
  readonly version_number: number;
  readonly name: string | null;
  readonly status: string;
  readonly enforce_sod: boolean;
  readonly max_escalation_depth: number;
  readonly content_hash: string | null;
  readonly idempotency_key: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ApprovalReasonCodeRow {
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
export interface ApprovalRequestRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly subject_type: string;
  readonly subject_ref: string | null;
  readonly policy_id: string | null;
  readonly scope: string;
  readonly title: string | null;
  /** INTEGER MINOR UNITS — read/written as a STRING, never a float (ADR-007). */
  readonly amount_minor: string;
  readonly currency_ref: string | null;
  readonly requested_by: string | null;
  readonly prepared_by: string | null;
  readonly current_level: number;
  readonly required_approvals: number;
  readonly approvals_count: number;
  readonly final_approver: string | null;
  readonly status: string;
  readonly escalation_depth: number;
  readonly idempotency_key: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ApprovalRequestStepRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly request_id: string;
  readonly level: number;
  readonly required_permission: string | null;
  readonly sod_constraint: string;
  readonly status: string;
  readonly decided_by: string | null;
  readonly decided_reason_code: string | null;
  readonly escalation_target: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ApprovalDecisionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly request_id: string;
  readonly step_id: string | null;
  readonly level: number;
  readonly decision: string;
  readonly actor: string;
  readonly maker: string | null;
  readonly on_behalf_of: string | null;
  readonly reason_code: string | null;
  readonly reason: string | null;
  readonly is_final: boolean;
  readonly correlation_id: string;
}
export interface ApprovalHistoryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly reason: string | null;
  readonly reason_code: string | null;
  readonly by_user: string | null;
  readonly correlation_id: string;
}
export interface ApprovalDelegationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly delegator: string;
  readonly delegate: string;
  readonly subject_type: string;
  readonly scope: string;
  readonly status: string;
  readonly reason: string | null;
  readonly version: number;
  readonly correlation_id: string;
}
export interface ApprovalSodCheckRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly request_id: string;
  readonly decision_id: string | null;
  readonly actor: string;
  readonly maker: string | null;
  readonly rule: string;
  readonly verdict: string;
  readonly reason_code: string | null;
  readonly correlation_id: string;
}
export interface ApprovalParticipantRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly request_id: string;
  readonly actor: string;
  readonly role: string;
  readonly correlation_id: string;
}
export interface ApprovalAssignmentRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly request_id: string;
  readonly step_id: string | null;
  readonly level: number;
  readonly assignee_ref: string;
  readonly assignment_type: string;
  readonly source_delegation_id: string | null;
  readonly correlation_id: string;
}
export interface ApprovalEscalationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly request_id: string;
  readonly step_id: string | null;
  readonly from_level: number;
  readonly to_level: number;
  readonly target_ref: string | null;
  readonly mode: string;
  readonly depth: number;
  readonly timer_ref: string | null;
  readonly reason_code: string | null;
  readonly correlation_id: string;
}
export interface ApprovalTimerRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly request_id: string;
  readonly step_id: string | null;
  readonly timer_ref: string | null;
  readonly purpose: string;
  readonly deadline_at: string | null;
  readonly fired: boolean;
  readonly correlation_id: string;
}
export interface ApprovalNotificationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly request_id: string;
  readonly notification_ref: string | null;
  readonly channel: string;
  readonly template_key: string | null;
  readonly recipient_ref: string | null;
  readonly event_type: string | null;
  readonly correlation_id: string;
}
export interface ApprovalWorkflowLinkRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly request_id: string;
  readonly workflow_ref: string | null;
  readonly workflow_family: string | null;
  readonly note: string | null;
  readonly correlation_id: string;
}
export interface ApprovalIdempotencyRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly idempotency_key: string;
  readonly purpose: string;
  readonly request_id: string | null;
  readonly decision_id: string | null;
  readonly correlation_id: string;
}
export interface ApprovalNoteRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly request_id: string;
  readonly note_type: string;
  readonly content: string;
  readonly by_user: string | null;
  readonly correlation_id: string;
}
export interface ApprovalEvidenceRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly request_id: string;
  readonly evidence_type: string;
  readonly document_ref: string | null;
  readonly description: string | null;
  readonly correlation_id: string;
}
export interface ApprovalOutcomeRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly request_id: string;
  readonly outcome: string;
  readonly subject_type: string;
  readonly subject_ref: string | null;
  readonly final_approver: string | null;
  readonly released: boolean;
  readonly reason_code: string | null;
  readonly correlation_id: string;
}
export interface ApprovalOverrideRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly request_id: string;
  readonly decision_id: string | null;
  readonly override_type: string;
  readonly actor: string;
  readonly maker: string | null;
  readonly justification: string;
  readonly reason_code: string | null;
  readonly correlation_id: string;
}

// --- projected column lists (money as ::text) ---------------------------------------------------
const POLICY_COLS = `tenant_id, id, subject_type, scope, version_number, name, status, required_approvals, min_levels, sod_mode, escalation_enabled, threshold_minor::text AS threshold_minor, version, correlation_id`;
const POLICY_STEP_COLS = `tenant_id, id, policy_id, level, required_permission, sod_constraint, escalation_after_seconds, escalation_target, escalation_mode, correlation_id`;
const CONFIG_COLS = `tenant_id, id, scope, version_number, name, status, enforce_sod, max_escalation_depth, content_hash, idempotency_key, version, correlation_id`;
const REASON_COLS = `tenant_id, id, code, category, severity, description, active, version, correlation_id`;
const REQ_COLS = `tenant_id, id, subject_type, subject_ref, policy_id, scope, title, amount_minor::text AS amount_minor, currency_ref, requested_by, prepared_by, current_level, required_approvals, approvals_count, final_approver, status, escalation_depth, idempotency_key, version, correlation_id`;
const STEP_COLS = `tenant_id, id, request_id, level, required_permission, sod_constraint, status, decided_by, decided_reason_code, escalation_target, version, correlation_id`;
const DECISION_COLS = `tenant_id, id, request_id, step_id, level, decision, actor, maker, on_behalf_of, reason_code, reason, is_final, correlation_id`;
const HIST_COLS = `tenant_id, id, from_status, to_status, reason, reason_code, by_user, correlation_id`;
const DELEG_COLS = `tenant_id, id, delegator, delegate, subject_type, scope, status, reason, version, correlation_id`;
const SOD_COLS = `tenant_id, id, request_id, decision_id, actor, maker, rule, verdict, reason_code, correlation_id`;
const PART_COLS = `tenant_id, id, request_id, actor, role, correlation_id`;
const ASSIGN_COLS = `tenant_id, id, request_id, step_id, level, assignee_ref, assignment_type, source_delegation_id, correlation_id`;
const ESC_COLS = `tenant_id, id, request_id, step_id, from_level, to_level, target_ref, mode, depth, timer_ref, reason_code, correlation_id`;
const TIMER_COLS = `tenant_id, id, request_id, step_id, timer_ref, purpose, deadline_at::text AS deadline_at, fired, correlation_id`;
const NOTIF_COLS = `tenant_id, id, request_id, notification_ref, channel, template_key, recipient_ref, event_type, correlation_id`;
const WFLINK_COLS = `tenant_id, id, request_id, workflow_ref, workflow_family, note, correlation_id`;
const IDEM_COLS = `tenant_id, id, idempotency_key, purpose, request_id, decision_id, correlation_id`;
const NOTE_COLS = `tenant_id, id, request_id, note_type, content, by_user, correlation_id`;
const EVID_COLS = `tenant_id, id, request_id, evidence_type, document_ref, description, correlation_id`;
const OUTCOME_COLS = `tenant_id, id, request_id, outcome, subject_type, subject_ref, final_approver, released, reason_code, correlation_id`;
const OVERRIDE_COLS = `tenant_id, id, request_id, decision_id, override_type, actor, maker, justification, reason_code, correlation_id`;

export class ApprovalRepository {
  // --- policy ---------------------------------------------------------------------------------
  async insertPolicy(
    tx: Tx,
    i: {
      tenantId: string;
      subjectType: string;
      scope: string;
      name: string | null;
      requiredApprovals: number;
      minLevels: number;
      sodMode: string;
      escalationEnabled: boolean;
      thresholdMinor: number;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ApprovalPolicyRow> {
    const r = await tx.query<ApprovalPolicyRow>(
      `INSERT INTO approval_policy (tenant_id, subject_type, scope, name, required_approvals, min_levels, sod_mode, escalation_enabled, threshold_minor, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING ${POLICY_COLS}`,
      [
        i.tenantId,
        i.subjectType,
        i.scope,
        i.name,
        i.requiredApprovals,
        i.minLevels,
        i.sodMode,
        i.escalationEnabled,
        i.thresholdMinor,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert policy');
  }
  async findPolicy(tx: Tx, id: string): Promise<ApprovalPolicyRow | null> {
    const r = await tx.query<ApprovalPolicyRow>(`SELECT ${POLICY_COLS} FROM approval_policy WHERE id=$1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }
  async findActivePolicy(tx: Tx, subjectType: string, scope: string): Promise<ApprovalPolicyRow | null> {
    const r = await tx.query<ApprovalPolicyRow>(
      `SELECT ${POLICY_COLS} FROM approval_policy WHERE subject_type=$1 AND scope=$2 AND status='active'`,
      [subjectType, scope],
    );
    return r.rows[0] ?? null;
  }
  async setPolicyStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; by: string | null },
  ): Promise<ApprovalPolicyRow | null> {
    const r = await tx.query<ApprovalPolicyRow>(
      `UPDATE approval_policy SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${POLICY_COLS}`,
      [i.id, i.expectedVersion, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listPolicies(tx: Tx): Promise<ApprovalPolicyRow[]> {
    const r = await tx.query<ApprovalPolicyRow>(
      `SELECT ${POLICY_COLS} FROM approval_policy ORDER BY subject_type, scope, version_number`,
    );
    return r.rows;
  }
  async insertPolicyStep(
    tx: Tx,
    i: {
      tenantId: string;
      policyId: string;
      level: number;
      requiredPermission: string | null;
      sodConstraint: string;
      escalationAfterSeconds: number | null;
      escalationTarget: string | null;
      escalationMode: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ApprovalPolicyStepRow> {
    const r = await tx.query<ApprovalPolicyStepRow>(
      `INSERT INTO approval_policy_step (tenant_id, policy_id, level, required_permission, sod_constraint, escalation_after_seconds, escalation_target, escalation_mode, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${POLICY_STEP_COLS}`,
      [
        i.tenantId,
        i.policyId,
        i.level,
        i.requiredPermission,
        i.sodConstraint,
        i.escalationAfterSeconds,
        i.escalationTarget,
        i.escalationMode,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert policy step');
  }
  async listPolicySteps(tx: Tx, policyId: string): Promise<ApprovalPolicyStepRow[]> {
    const r = await tx.query<ApprovalPolicyStepRow>(
      `SELECT ${POLICY_STEP_COLS} FROM approval_policy_step WHERE policy_id=$1 ORDER BY level`,
      [policyId],
    );
    return r.rows;
  }
  async insertPolicyHistory(tx: Tx, i: HistoryInsert & { policyId: string }): Promise<void> {
    await tx.query(
      `INSERT INTO approval_policy_history (tenant_id, policy_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.policyId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }

  // --- config ---------------------------------------------------------------------------------
  async insertConfig(
    tx: Tx,
    i: {
      tenantId: string;
      scope: string;
      name: string | null;
      maxEscalationDepth: number;
      contentHash: string | null;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ApprovalConfigRow> {
    const r = await tx.query<ApprovalConfigRow>(
      `INSERT INTO approval_config (tenant_id, scope, name, max_escalation_depth, content_hash, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING ${CONFIG_COLS}`,
      [
        i.tenantId,
        i.scope,
        i.name,
        i.maxEscalationDepth,
        i.contentHash,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert config');
  }
  async findConfig(tx: Tx, id: string): Promise<ApprovalConfigRow | null> {
    const r = await tx.query<ApprovalConfigRow>(`SELECT ${CONFIG_COLS} FROM approval_config WHERE id=$1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }
  async findConfigByIdempotencyKey(tx: Tx, key: string): Promise<ApprovalConfigRow | null> {
    const r = await tx.query<ApprovalConfigRow>(
      `SELECT ${CONFIG_COLS} FROM approval_config WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async setConfigStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; by: string | null },
  ): Promise<ApprovalConfigRow | null> {
    const r = await tx.query<ApprovalConfigRow>(
      `UPDATE approval_config SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${CONFIG_COLS}`,
      [i.id, i.expectedVersion, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listConfigs(tx: Tx): Promise<ApprovalConfigRow[]> {
    const r = await tx.query<ApprovalConfigRow>(
      `SELECT ${CONFIG_COLS} FROM approval_config ORDER BY scope, version_number`,
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
  ): Promise<ApprovalReasonCodeRow> {
    const r = await tx.query<ApprovalReasonCodeRow>(
      `INSERT INTO approval_reason_code (tenant_id, code, category, severity, description, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING ${REASON_COLS}`,
      [i.tenantId, i.code, i.category, i.severity, i.description, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert reason code');
  }
  async findReasonCode(tx: Tx, code: string): Promise<ApprovalReasonCodeRow | null> {
    const r = await tx.query<ApprovalReasonCodeRow>(
      `SELECT ${REASON_COLS} FROM approval_reason_code WHERE code=$1`,
      [code],
    );
    return r.rows[0] ?? null;
  }
  async listReasonCodes(tx: Tx): Promise<ApprovalReasonCodeRow[]> {
    const r = await tx.query<ApprovalReasonCodeRow>(
      `SELECT ${REASON_COLS} FROM approval_reason_code ORDER BY category, code`,
    );
    return r.rows;
  }

  // --- request --------------------------------------------------------------------------------
  async insertRequest(
    tx: Tx,
    i: {
      tenantId: string;
      subjectType: string;
      subjectRef: string | null;
      policyId: string | null;
      scope: string;
      title: string | null;
      amountMinor: number;
      currencyRef: string | null;
      requestedBy: string | null;
      preparedBy: string | null;
      requiredApprovals: number;
      idempotencyKey: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ApprovalRequestRow> {
    const r = await tx.query<ApprovalRequestRow>(
      `INSERT INTO approval_request (tenant_id, subject_type, subject_ref, policy_id, scope, title, amount_minor, currency_ref, requested_by, prepared_by, required_approvals, idempotency_key, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING ${REQ_COLS}`,
      [
        i.tenantId,
        i.subjectType,
        i.subjectRef,
        i.policyId,
        i.scope,
        i.title,
        i.amountMinor,
        i.currencyRef,
        i.requestedBy,
        i.preparedBy,
        i.requiredApprovals,
        i.idempotencyKey,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert request');
  }
  async findRequest(tx: Tx, id: string): Promise<ApprovalRequestRow | null> {
    const r = await tx.query<ApprovalRequestRow>(`SELECT ${REQ_COLS} FROM approval_request WHERE id=$1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }
  async findRequestByIdempotencyKey(tx: Tx, key: string): Promise<ApprovalRequestRow | null> {
    const r = await tx.query<ApprovalRequestRow>(
      `SELECT ${REQ_COLS} FROM approval_request WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  /** CAS a request's status (+ optional quorum/level/approver bookkeeping). Optimistic-lock guarded. */
  async updateRequest(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      status: string;
      approvalsCount?: number | null;
      currentLevel?: number | null;
      finalApprover?: string | null;
      escalationDepth?: number | null;
      by: string | null;
    },
  ): Promise<ApprovalRequestRow | null> {
    const r = await tx.query<ApprovalRequestRow>(
      `UPDATE approval_request SET status=$3, approvals_count=COALESCE($4, approvals_count), current_level=COALESCE($5, current_level), final_approver=COALESCE($6, final_approver), escalation_depth=COALESCE($7, escalation_depth), updated_by=$8, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${REQ_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.status,
        i.approvalsCount ?? null,
        i.currentLevel ?? null,
        i.finalApprover ?? null,
        i.escalationDepth ?? null,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async listRequests(tx: Tx, status?: string): Promise<ApprovalRequestRow[]> {
    if (status !== undefined) {
      const r = await tx.query<ApprovalRequestRow>(
        `SELECT ${REQ_COLS} FROM approval_request WHERE status=$1 ORDER BY created_at DESC`,
        [status],
      );
      return r.rows;
    }
    const r = await tx.query<ApprovalRequestRow>(
      `SELECT ${REQ_COLS} FROM approval_request ORDER BY created_at DESC`,
    );
    return r.rows;
  }
  async countDistinctApprovers(tx: Tx, requestId: string): Promise<number> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(DISTINCT actor)::text AS c FROM approval_decision WHERE request_id=$1 AND decision IN ('approve','override_approve')`,
      [requestId],
    );
    return Number(r.rows[0]?.c ?? '0');
  }
  async priorApprovers(tx: Tx, requestId: string): Promise<string[]> {
    const r = await tx.query<{ actor: string }>(
      `SELECT DISTINCT actor FROM approval_decision WHERE request_id=$1 AND decision IN ('approve','override_approve')`,
      [requestId],
    );
    return r.rows.map((row) => row.actor);
  }

  // --- request step ---------------------------------------------------------------------------
  async insertRequestStep(
    tx: Tx,
    i: {
      tenantId: string;
      requestId: string;
      level: number;
      requiredPermission: string | null;
      sodConstraint: string;
      escalationTarget: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ApprovalRequestStepRow> {
    const r = await tx.query<ApprovalRequestStepRow>(
      `INSERT INTO approval_request_step (tenant_id, request_id, level, required_permission, sod_constraint, escalation_target, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING ${STEP_COLS}`,
      [
        i.tenantId,
        i.requestId,
        i.level,
        i.requiredPermission,
        i.sodConstraint,
        i.escalationTarget,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert request step');
  }
  async findRequestStep(tx: Tx, id: string): Promise<ApprovalRequestStepRow | null> {
    const r = await tx.query<ApprovalRequestStepRow>(
      `SELECT ${STEP_COLS} FROM approval_request_step WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async findStepByLevel(tx: Tx, requestId: string, level: number): Promise<ApprovalRequestStepRow | null> {
    const r = await tx.query<ApprovalRequestStepRow>(
      `SELECT ${STEP_COLS} FROM approval_request_step WHERE request_id=$1 AND level=$2`,
      [requestId, level],
    );
    return r.rows[0] ?? null;
  }
  async setStepStatus(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      status: string;
      decidedBy?: string | null;
      decidedReasonCode?: string | null;
      by: string | null;
    },
  ): Promise<ApprovalRequestStepRow | null> {
    const r = await tx.query<ApprovalRequestStepRow>(
      `UPDATE approval_request_step SET status=$3, decided_by=COALESCE($4, decided_by), decided_reason_code=COALESCE($5, decided_reason_code), updated_by=$6, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${STEP_COLS}`,
      [i.id, i.expectedVersion, i.status, i.decidedBy ?? null, i.decidedReasonCode ?? null, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listRequestSteps(tx: Tx, requestId: string): Promise<ApprovalRequestStepRow[]> {
    const r = await tx.query<ApprovalRequestStepRow>(
      `SELECT ${STEP_COLS} FROM approval_request_step WHERE request_id=$1 ORDER BY level`,
      [requestId],
    );
    return r.rows;
  }

  // --- decision (append-only) -----------------------------------------------------------------
  async insertDecision(
    tx: Tx,
    i: {
      tenantId: string;
      requestId: string;
      stepId: string | null;
      level: number;
      decision: string;
      actor: string;
      maker: string | null;
      onBehalfOf: string | null;
      reasonCode: string | null;
      reason: string | null;
      isFinal: boolean;
      correlationId: string;
    },
  ): Promise<ApprovalDecisionRow> {
    const r = await tx.query<ApprovalDecisionRow>(
      `INSERT INTO approval_decision (tenant_id, request_id, step_id, level, decision, actor, maker, on_behalf_of, reason_code, reason, is_final, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${DECISION_COLS}`,
      [
        i.tenantId,
        i.requestId,
        i.stepId,
        i.level,
        i.decision,
        i.actor,
        i.maker,
        i.onBehalfOf,
        i.reasonCode,
        i.reason,
        i.isFinal,
        i.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert decision');
  }
  async listDecisions(tx: Tx, requestId: string): Promise<ApprovalDecisionRow[]> {
    const r = await tx.query<ApprovalDecisionRow>(
      `SELECT ${DECISION_COLS} FROM approval_decision WHERE request_id=$1 ORDER BY created_at`,
      [requestId],
    );
    return r.rows;
  }

  // --- history (append-only) ------------------------------------------------------------------
  async insertStatusHistory(tx: Tx, i: HistoryInsert & { requestId: string }): Promise<void> {
    await tx.query(
      `INSERT INTO approval_status_history (tenant_id, request_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.requestId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }
  async listStatusHistory(tx: Tx, requestId: string): Promise<ApprovalHistoryRow[]> {
    const r = await tx.query<ApprovalHistoryRow>(
      `SELECT ${HIST_COLS} FROM approval_status_history WHERE request_id=$1 ORDER BY created_at`,
      [requestId],
    );
    return r.rows;
  }
  async insertStepHistory(tx: Tx, i: HistoryInsert & { stepId: string; requestId: string }): Promise<void> {
    await tx.query(
      `INSERT INTO approval_step_history (tenant_id, step_id, request_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        i.tenantId,
        i.stepId,
        i.requestId,
        i.fromStatus,
        i.toStatus,
        i.reason,
        i.reasonCode,
        i.by,
        i.correlationId,
      ],
    );
  }

  // --- delegation -----------------------------------------------------------------------------
  async insertDelegation(
    tx: Tx,
    i: {
      tenantId: string;
      delegator: string;
      delegate: string;
      subjectType: string;
      scope: string;
      reason: string | null;
      endsAt: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ApprovalDelegationRow> {
    const r = await tx.query<ApprovalDelegationRow>(
      `INSERT INTO approval_delegation (tenant_id, delegator, delegate, subject_type, scope, reason, ends_at, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9,$9) RETURNING ${DELEG_COLS}`,
      [
        i.tenantId,
        i.delegator,
        i.delegate,
        i.subjectType,
        i.scope,
        i.reason,
        i.endsAt,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert delegation');
  }
  async findDelegation(tx: Tx, id: string): Promise<ApprovalDelegationRow | null> {
    const r = await tx.query<ApprovalDelegationRow>(
      `SELECT ${DELEG_COLS} FROM approval_delegation WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  /** The active delegation (if any) under which `delegate` may act for a subject_type+scope. */
  async findActiveDelegationFor(
    tx: Tx,
    delegate: string,
    subjectType: string,
    scope: string,
  ): Promise<ApprovalDelegationRow | null> {
    const r = await tx.query<ApprovalDelegationRow>(
      `SELECT ${DELEG_COLS} FROM approval_delegation WHERE delegate=$1 AND subject_type=$2 AND scope=$3 AND status='active' AND (ends_at IS NULL OR ends_at > now()) ORDER BY created_at DESC LIMIT 1`,
      [delegate, subjectType, scope],
    );
    return r.rows[0] ?? null;
  }
  async setDelegationStatus(
    tx: Tx,
    i: { id: string; expectedVersion: number; status: string; by: string | null },
  ): Promise<ApprovalDelegationRow | null> {
    const r = await tx.query<ApprovalDelegationRow>(
      `UPDATE approval_delegation SET status=$3, updated_by=$4, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${DELEG_COLS}`,
      [i.id, i.expectedVersion, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listDelegations(tx: Tx, delegate?: string): Promise<ApprovalDelegationRow[]> {
    if (delegate !== undefined) {
      const r = await tx.query<ApprovalDelegationRow>(
        `SELECT ${DELEG_COLS} FROM approval_delegation WHERE delegate=$1 ORDER BY created_at DESC`,
        [delegate],
      );
      return r.rows;
    }
    const r = await tx.query<ApprovalDelegationRow>(
      `SELECT ${DELEG_COLS} FROM approval_delegation ORDER BY created_at DESC`,
    );
    return r.rows;
  }
  async insertDelegationHistory(
    tx: Tx,
    i: {
      tenantId: string;
      delegationId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO approval_delegation_history (tenant_id, delegation_id, from_status, to_status, reason, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [i.tenantId, i.delegationId, i.fromStatus, i.toStatus, i.reason, i.by, i.correlationId],
    );
  }

  // --- SoD check (append-only) ----------------------------------------------------------------
  async insertSodCheck(
    tx: Tx,
    i: {
      tenantId: string;
      requestId: string;
      decisionId: string | null;
      actor: string;
      maker: string | null;
      rule: string;
      verdict: string;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO approval_sod_check (tenant_id, request_id, decision_id, actor, maker, rule, verdict, reason_code, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        i.tenantId,
        i.requestId,
        i.decisionId,
        i.actor,
        i.maker,
        i.rule,
        i.verdict,
        i.reasonCode,
        i.correlationId,
      ],
    );
  }
  async listSodChecks(tx: Tx, requestId: string): Promise<ApprovalSodCheckRow[]> {
    const r = await tx.query<ApprovalSodCheckRow>(
      `SELECT ${SOD_COLS} FROM approval_sod_check WHERE request_id=$1 ORDER BY created_at`,
      [requestId],
    );
    return r.rows;
  }

  // --- participant (append-only; distinct per role) -------------------------------------------
  async recordParticipant(
    tx: Tx,
    i: {
      tenantId: string;
      requestId: string;
      actor: string;
      role: string;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO approval_participant (tenant_id, request_id, actor, role, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id, request_id, actor, role) DO NOTHING`,
      [i.tenantId, i.requestId, i.actor, i.role, i.by, i.correlationId],
    );
  }
  async listParticipants(tx: Tx, requestId: string): Promise<ApprovalParticipantRow[]> {
    const r = await tx.query<ApprovalParticipantRow>(
      `SELECT ${PART_COLS} FROM approval_participant WHERE request_id=$1 ORDER BY created_at`,
      [requestId],
    );
    return r.rows;
  }
  async participantHasRole(tx: Tx, requestId: string, actor: string, role: string): Promise<boolean> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM approval_participant WHERE request_id=$1 AND actor=$2 AND role=$3`,
      [requestId, actor, role],
    );
    return Number(r.rows[0]?.c ?? '0') > 0;
  }

  // --- assignment (append-only) ---------------------------------------------------------------
  async insertAssignment(
    tx: Tx,
    i: {
      tenantId: string;
      requestId: string;
      stepId: string | null;
      level: number;
      assigneeRef: string;
      assignmentType: string;
      sourceDelegationId: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO approval_assignment (tenant_id, request_id, step_id, level, assignee_ref, assignment_type, source_delegation_id, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        i.tenantId,
        i.requestId,
        i.stepId,
        i.level,
        i.assigneeRef,
        i.assignmentType,
        i.sourceDelegationId,
        i.by,
        i.correlationId,
      ],
    );
  }
  async listAssignments(tx: Tx, requestId: string): Promise<ApprovalAssignmentRow[]> {
    const r = await tx.query<ApprovalAssignmentRow>(
      `SELECT ${ASSIGN_COLS} FROM approval_assignment WHERE request_id=$1 ORDER BY level, created_at`,
      [requestId],
    );
    return r.rows;
  }

  // --- escalation (append-only; single-fire) --------------------------------------------------
  async insertEscalation(
    tx: Tx,
    i: {
      tenantId: string;
      requestId: string;
      stepId: string | null;
      fromLevel: number;
      toLevel: number;
      targetRef: string | null;
      mode: string;
      depth: number;
      timerRef: string | null;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<ApprovalEscalationRow> {
    const r = await tx.query<ApprovalEscalationRow>(
      `INSERT INTO approval_escalation (tenant_id, request_id, step_id, from_level, to_level, target_ref, mode, depth, timer_ref, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${ESC_COLS}`,
      [
        i.tenantId,
        i.requestId,
        i.stepId,
        i.fromLevel,
        i.toLevel,
        i.targetRef,
        i.mode,
        i.depth,
        i.timerRef,
        i.reasonCode,
        i.by,
        i.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert escalation');
  }
  async listEscalations(tx: Tx, requestId: string): Promise<ApprovalEscalationRow[]> {
    const r = await tx.query<ApprovalEscalationRow>(
      `SELECT ${ESC_COLS} FROM approval_escalation WHERE request_id=$1 ORDER BY created_at`,
      [requestId],
    );
    return r.rows;
  }

  // --- timer / notification / workflow-link (append-only m06/m08 evidence) --------------------
  async insertTimer(
    tx: Tx,
    i: {
      tenantId: string;
      requestId: string;
      stepId: string | null;
      timerRef: string | null;
      purpose: string;
      deadlineAt: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<ApprovalTimerRow> {
    const r = await tx.query<ApprovalTimerRow>(
      `INSERT INTO approval_timer (tenant_id, request_id, step_id, timer_ref, purpose, deadline_at, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8) RETURNING ${TIMER_COLS}`,
      [i.tenantId, i.requestId, i.stepId, i.timerRef, i.purpose, i.deadlineAt, i.by, i.correlationId],
    );
    return firstRow(r.rows, 'insert timer');
  }
  async listTimers(tx: Tx, requestId: string): Promise<ApprovalTimerRow[]> {
    const r = await tx.query<ApprovalTimerRow>(
      `SELECT ${TIMER_COLS} FROM approval_timer WHERE request_id=$1 ORDER BY created_at`,
      [requestId],
    );
    return r.rows;
  }
  async insertNotification(
    tx: Tx,
    i: {
      tenantId: string;
      requestId: string;
      notificationRef: string | null;
      channel: string;
      templateKey: string | null;
      recipientRef: string | null;
      eventType: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<ApprovalNotificationRow> {
    const r = await tx.query<ApprovalNotificationRow>(
      `INSERT INTO approval_notification (tenant_id, request_id, notification_ref, channel, template_key, recipient_ref, event_type, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${NOTIF_COLS}`,
      [
        i.tenantId,
        i.requestId,
        i.notificationRef,
        i.channel,
        i.templateKey,
        i.recipientRef,
        i.eventType,
        i.by,
        i.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert notification');
  }
  async listNotifications(tx: Tx, requestId: string): Promise<ApprovalNotificationRow[]> {
    const r = await tx.query<ApprovalNotificationRow>(
      `SELECT ${NOTIF_COLS} FROM approval_notification WHERE request_id=$1 ORDER BY created_at`,
      [requestId],
    );
    return r.rows;
  }
  async insertWorkflowLink(
    tx: Tx,
    i: {
      tenantId: string;
      requestId: string;
      workflowRef: string | null;
      workflowFamily: string | null;
      note: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO approval_workflow_link (tenant_id, request_id, workflow_ref, workflow_family, note, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [i.tenantId, i.requestId, i.workflowRef, i.workflowFamily, i.note, i.by, i.correlationId],
    );
  }
  async listWorkflowLinks(tx: Tx, requestId: string): Promise<ApprovalWorkflowLinkRow[]> {
    const r = await tx.query<ApprovalWorkflowLinkRow>(
      `SELECT ${WFLINK_COLS} FROM approval_workflow_link WHERE request_id=$1 ORDER BY created_at`,
      [requestId],
    );
    return r.rows;
  }

  // --- idempotency (append-only; unique per key) ----------------------------------------------
  async insertIdempotency(
    tx: Tx,
    i: {
      tenantId: string;
      idempotencyKey: string;
      purpose: string;
      requestId: string | null;
      decisionId: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ApprovalIdempotencyRow> {
    const r = await tx.query<ApprovalIdempotencyRow>(
      `INSERT INTO approval_idempotency (tenant_id, idempotency_key, purpose, request_id, decision_id, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${IDEM_COLS}`,
      [i.tenantId, i.idempotencyKey, i.purpose, i.requestId, i.decisionId, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert idempotency');
  }
  async findIdempotency(tx: Tx, key: string): Promise<ApprovalIdempotencyRow | null> {
    const r = await tx.query<ApprovalIdempotencyRow>(
      `SELECT ${IDEM_COLS} FROM approval_idempotency WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }

  // --- note / evidence (append-only) ----------------------------------------------------------
  async insertNote(
    tx: Tx,
    i: {
      tenantId: string;
      requestId: string;
      noteType: string;
      content: string;
      by: string | null;
      correlationId: string;
    },
  ): Promise<ApprovalNoteRow> {
    const r = await tx.query<ApprovalNoteRow>(
      `INSERT INTO approval_note (tenant_id, request_id, note_type, content, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${NOTE_COLS}`,
      [i.tenantId, i.requestId, i.noteType, i.content, i.by, i.correlationId],
    );
    return firstRow(r.rows, 'insert note');
  }
  async listNotes(tx: Tx, requestId: string): Promise<ApprovalNoteRow[]> {
    const r = await tx.query<ApprovalNoteRow>(
      `SELECT ${NOTE_COLS} FROM approval_note WHERE request_id=$1 ORDER BY created_at`,
      [requestId],
    );
    return r.rows;
  }
  async insertEvidence(
    tx: Tx,
    i: {
      tenantId: string;
      requestId: string;
      evidenceType: string;
      documentRef: string | null;
      description: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<ApprovalEvidenceRow> {
    const r = await tx.query<ApprovalEvidenceRow>(
      `INSERT INTO approval_evidence (tenant_id, request_id, evidence_type, document_ref, description, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${EVID_COLS}`,
      [i.tenantId, i.requestId, i.evidenceType, i.documentRef, i.description, i.by, i.correlationId],
    );
    return firstRow(r.rows, 'insert evidence');
  }
  async listEvidence(tx: Tx, requestId: string): Promise<ApprovalEvidenceRow[]> {
    const r = await tx.query<ApprovalEvidenceRow>(
      `SELECT ${EVID_COLS} FROM approval_evidence WHERE request_id=$1 ORDER BY created_at`,
      [requestId],
    );
    return r.rows;
  }

  // --- outcome (append-only; one terminal per request) ----------------------------------------
  async insertOutcome(
    tx: Tx,
    i: {
      tenantId: string;
      requestId: string;
      outcome: string;
      subjectType: string;
      subjectRef: string | null;
      finalApprover: string | null;
      released: boolean;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<ApprovalOutcomeRow> {
    const r = await tx.query<ApprovalOutcomeRow>(
      `INSERT INTO approval_outcome (tenant_id, request_id, outcome, subject_type, subject_ref, final_approver, released, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${OUTCOME_COLS}`,
      [
        i.tenantId,
        i.requestId,
        i.outcome,
        i.subjectType,
        i.subjectRef,
        i.finalApprover,
        i.released,
        i.reasonCode,
        i.by,
        i.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert outcome');
  }
  async findOutcome(tx: Tx, requestId: string): Promise<ApprovalOutcomeRow | null> {
    const r = await tx.query<ApprovalOutcomeRow>(
      `SELECT ${OUTCOME_COLS} FROM approval_outcome WHERE request_id=$1`,
      [requestId],
    );
    return r.rows[0] ?? null;
  }

  // --- override (append-only) -----------------------------------------------------------------
  async insertOverride(
    tx: Tx,
    i: {
      tenantId: string;
      requestId: string;
      decisionId: string | null;
      overrideType: string;
      actor: string;
      maker: string | null;
      justification: string;
      reasonCode: string | null;
      correlationId: string;
    },
  ): Promise<ApprovalOverrideRow> {
    const r = await tx.query<ApprovalOverrideRow>(
      `INSERT INTO approval_override (tenant_id, request_id, decision_id, override_type, actor, maker, justification, reason_code, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${OVERRIDE_COLS}`,
      [
        i.tenantId,
        i.requestId,
        i.decisionId,
        i.overrideType,
        i.actor,
        i.maker,
        i.justification,
        i.reasonCode,
        i.correlationId,
      ],
    );
    return firstRow(r.rows, 'insert override');
  }
  async listOverrides(tx: Tx, requestId: string): Promise<ApprovalOverrideRow[]> {
    const r = await tx.query<ApprovalOverrideRow>(
      `SELECT ${OVERRIDE_COLS} FROM approval_override WHERE request_id=$1 ORDER BY created_at`,
      [requestId],
    );
    return r.rows;
  }
}

/** Shared shape for the append-only *_history inserts. */
interface HistoryInsert {
  readonly tenantId: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly reason: string | null;
  readonly reasonCode: string | null;
  readonly by: string | null;
  readonly correlationId: string;
}
