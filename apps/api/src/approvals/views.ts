import type {
  ApprovalPolicyRow,
  ApprovalPolicyStepRow,
  ApprovalConfigRow,
  ApprovalReasonCodeRow,
  ApprovalRequestRow,
  ApprovalRequestStepRow,
  ApprovalDecisionRow,
  ApprovalDelegationRow,
  ApprovalEscalationRow,
  ApprovalOutcomeRow,
} from '@finapp/m22-approval';

/**
 * Response shapes for the approvals API (m22). Persistence rows are snake_case; these map to camelCase DTOs. The tenant
 * is implicit (x-tenant-id + RLS FORCE), never re-exposed, and neither is `correlation_id`.
 *
 * MONEY IS INTEGER MINOR UNITS. `amountMinor` / `thresholdMinor` arrive from the repository as STRINGS (`::text`) and
 * are emitted AS STRINGS — never coerced to a float (ADR-007, CLAUDE.md money rule). Every mutable view carries
 * `version` for optimistic concurrency. Subject/workflow/timer/notification/document refs are opaque ids — echoed
 * as-is, never resolved. m22 never approves on behalf of a human and never posts.
 */
export function policyView(row: ApprovalPolicyRow) {
  return {
    id: row.id,
    subjectType: row.subject_type,
    scope: row.scope,
    versionNumber: row.version_number,
    name: row.name,
    status: row.status,
    requiredApprovals: row.required_approvals,
    minLevels: row.min_levels,
    sodMode: row.sod_mode,
    escalationEnabled: row.escalation_enabled,
    thresholdMinor: row.threshold_minor,
    version: row.version,
  };
}
export function policyStepView(row: ApprovalPolicyStepRow) {
  return {
    id: row.id,
    policyId: row.policy_id,
    level: row.level,
    requiredPermission: row.required_permission,
    sodConstraint: row.sod_constraint,
    escalationAfterSeconds: row.escalation_after_seconds,
    escalationTarget: row.escalation_target,
    escalationMode: row.escalation_mode,
  };
}
export function configView(row: ApprovalConfigRow) {
  return {
    id: row.id,
    scope: row.scope,
    versionNumber: row.version_number,
    name: row.name,
    status: row.status,
    enforceSod: row.enforce_sod,
    maxEscalationDepth: row.max_escalation_depth,
    version: row.version,
  };
}
export function reasonCodeView(row: ApprovalReasonCodeRow) {
  return {
    id: row.id,
    code: row.code,
    category: row.category,
    severity: row.severity,
    description: row.description,
    active: row.active,
    version: row.version,
  };
}
export function requestView(row: ApprovalRequestRow) {
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectRef: row.subject_ref,
    policyId: row.policy_id,
    scope: row.scope,
    title: row.title,
    amountMinor: row.amount_minor,
    currencyRef: row.currency_ref,
    requestedBy: row.requested_by,
    preparedBy: row.prepared_by,
    currentLevel: row.current_level,
    requiredApprovals: row.required_approvals,
    approvalsCount: row.approvals_count,
    finalApprover: row.final_approver,
    status: row.status,
    escalationDepth: row.escalation_depth,
    version: row.version,
  };
}
export function requestStepView(row: ApprovalRequestStepRow) {
  return {
    id: row.id,
    requestId: row.request_id,
    level: row.level,
    requiredPermission: row.required_permission,
    sodConstraint: row.sod_constraint,
    status: row.status,
    decidedBy: row.decided_by,
    decidedReasonCode: row.decided_reason_code,
    version: row.version,
  };
}
export function decisionView(row: ApprovalDecisionRow) {
  return {
    id: row.id,
    requestId: row.request_id,
    stepId: row.step_id,
    level: row.level,
    decision: row.decision,
    actor: row.actor,
    onBehalfOf: row.on_behalf_of,
    reasonCode: row.reason_code,
    reason: row.reason,
    isFinal: row.is_final,
  };
}
export function delegationView(row: ApprovalDelegationRow) {
  return {
    id: row.id,
    delegator: row.delegator,
    delegate: row.delegate,
    subjectType: row.subject_type,
    scope: row.scope,
    status: row.status,
    reason: row.reason,
    version: row.version,
  };
}
export function escalationView(row: ApprovalEscalationRow) {
  return {
    id: row.id,
    requestId: row.request_id,
    stepId: row.step_id,
    fromLevel: row.from_level,
    toLevel: row.to_level,
    targetRef: row.target_ref,
    mode: row.mode,
    depth: row.depth,
    timerRef: row.timer_ref,
    reasonCode: row.reason_code,
  };
}
export function outcomeView(row: ApprovalOutcomeRow) {
  return {
    id: row.id,
    requestId: row.request_id,
    outcome: row.outcome,
    subjectType: row.subject_type,
    subjectRef: row.subject_ref,
    finalApprover: row.final_approver,
    released: row.released,
    reasonCode: row.reason_code,
  };
}
