/**
 * M06 audit codes — the authoritative constant map. Every controlled workflow mutation records one of these
 * through the kernel `AUDIT` port in the SAME transaction as the state change (ADR-023). Codes are
 * SCREAMING_SNAKE `WORKFLOW_<ENTITY>_<ACTION>` and MUST be registered in manifests/audit-code-registry.yaml
 * (unregistered codes fail CI, ADR-005). `COMPENSATION_*` are reserved for the deferred COMPENSATION node.
 */
export const M06_AUDIT_CODES = {
  definitionCreated: 'WORKFLOW_DEFINITION_CREATED',
  definitionUpdated: 'WORKFLOW_DEFINITION_UPDATED',
  definitionValidated: 'WORKFLOW_DEFINITION_VALIDATED',
  definitionPublished: 'WORKFLOW_DEFINITION_PUBLISHED',
  definitionActivated: 'WORKFLOW_DEFINITION_ACTIVATED',
  definitionRetired: 'WORKFLOW_DEFINITION_RETIRED',
  instanceStarted: 'WORKFLOW_INSTANCE_STARTED',
  instanceSuspended: 'WORKFLOW_INSTANCE_SUSPENDED',
  instanceResumed: 'WORKFLOW_INSTANCE_RESUMED',
  instanceCompleted: 'WORKFLOW_INSTANCE_COMPLETED',
  instanceCancelled: 'WORKFLOW_INSTANCE_CANCELLED',
  instanceFailed: 'WORKFLOW_INSTANCE_FAILED',
  taskCreated: 'WORKFLOW_TASK_CREATED',
  taskAssigned: 'WORKFLOW_TASK_ASSIGNED',
  taskClaimed: 'WORKFLOW_TASK_CLAIMED',
  taskReassigned: 'WORKFLOW_TASK_REASSIGNED',
  taskCompleted: 'WORKFLOW_TASK_COMPLETED',
  taskRejected: 'WORKFLOW_TASK_REJECTED',
  taskDelegated: 'WORKFLOW_TASK_DELEGATED',
  taskEscalated: 'WORKFLOW_TASK_ESCALATED',
  taskExpired: 'WORKFLOW_TASK_EXPIRED',
  transitionExecuted: 'WORKFLOW_TRANSITION_EXECUTED',
  timerScheduled: 'WORKFLOW_TIMER_SCHEDULED',
  timerFired: 'WORKFLOW_TIMER_FIRED',
  slaWarning: 'WORKFLOW_SLA_WARNING',
  slaBreached: 'WORKFLOW_SLA_BREACHED',
  incidentCreated: 'WORKFLOW_INCIDENT_CREATED',
  incidentResolved: 'WORKFLOW_INCIDENT_RESOLVED',
  compensationStarted: 'WORKFLOW_COMPENSATION_STARTED',
  compensationCompleted: 'WORKFLOW_COMPENSATION_COMPLETED',
  compensationFailed: 'WORKFLOW_COMPENSATION_FAILED',
} as const;

export type M06AuditCode = (typeof M06_AUDIT_CODES)[keyof typeof M06_AUDIT_CODES];

export const ALL_M06_AUDIT_CODES: readonly M06AuditCode[] = Object.values(M06_AUDIT_CODES);

export const WORKFLOW_AUDIT_PREFIX = 'WORKFLOW_';
