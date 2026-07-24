import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The `workflow.lifecycle` event family — owned by m06-workflow (Stage 2.2).
 *
 * Registered in manifests/event-registry.yaml alongside this declaration and the engine that emits it
 * (GAP-1 discipline: this closes m06's GAP-1). Delivered through the SINGLE transactional outbox that
 * m06 owns (ADR-004/023). Classification `confidential`.
 *
 * Payloads carry IDENTIFIERS AND TRANSITIONS ONLY — never workflow variable values, task payloads, secrets,
 * or personal data. A consumer that needs detail reads it back through the workflow API under its own
 * permissions. Ordering is per-aggregate (aggregate id is the ordering key); consumers dedupe on
 * (type, aggregateId, version) since delivery is at-least-once.
 */

export const WORKFLOW_LIFECYCLE_FAMILY = 'workflow.lifecycle';
export const WORKFLOW_LIFECYCLE_VERSION = 1;

export type WorkflowLifecycleEventType =
  | 'WorkflowDefinitionPublished'
  | 'WorkflowInstanceStarted'
  | 'WorkflowInstanceCompleted'
  | 'WorkflowInstanceCancelled'
  | 'WorkflowInstanceFailed'
  | 'WorkflowTaskCreated'
  | 'WorkflowTaskAssigned'
  | 'WorkflowTaskCompleted'
  | 'WorkflowTaskRejected'
  | 'WorkflowTaskEscalated'
  | 'WorkflowSlaWarning'
  | 'WorkflowSlaBreached'
  | 'WorkflowIncidentCreated'
  | 'WorkflowIncidentResolved';

export const WORKFLOW_LIFECYCLE_EVENT_TYPES: readonly WorkflowLifecycleEventType[] = [
  'WorkflowDefinitionPublished',
  'WorkflowInstanceStarted',
  'WorkflowInstanceCompleted',
  'WorkflowInstanceCancelled',
  'WorkflowInstanceFailed',
  'WorkflowTaskCreated',
  'WorkflowTaskAssigned',
  'WorkflowTaskCompleted',
  'WorkflowTaskRejected',
  'WorkflowTaskEscalated',
  'WorkflowSlaWarning',
  'WorkflowSlaBreached',
  'WorkflowIncidentCreated',
  'WorkflowIncidentResolved',
];

/** A definition version became published/active. Identifiers only. */
export interface WorkflowDefinitionPayload {
  readonly definitionId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly code: string;
}

/** A workflow instance transition. Identifiers only. */
export interface WorkflowInstancePayload {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly versionId: string;
  /** The business record the instance governs, e.g. a feedback or case id. */
  readonly subjectType?: string;
  readonly subjectId?: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
  readonly reason?: string;
}

/** A task transition. Identifiers only — never the task payload/variables. */
export interface WorkflowTaskPayload {
  readonly taskId: string;
  readonly instanceId: string;
  readonly nodeKey: string;
  readonly taskType?: string;
  /** Assignee reference (user/role/queue id) — an identifier, never PII. */
  readonly assigneeRef?: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
  readonly reason?: string;
}

/** An SLA warning or breach on an instance/task. */
export interface WorkflowSlaPayload {
  readonly instanceId: string;
  readonly taskId?: string;
  readonly slaType: string;
  readonly threshold: 'warning' | 'breach';
}

/** A recoverable execution failure raised or resolved. */
export interface WorkflowIncidentPayload {
  readonly incidentId: string;
  readonly instanceId?: string;
  readonly taskId?: string;
  readonly errorCode: string;
}

export type WorkflowLifecyclePayload =
  | WorkflowDefinitionPayload
  | WorkflowInstancePayload
  | WorkflowTaskPayload
  | WorkflowSlaPayload
  | WorkflowIncidentPayload;

export type WorkflowLifecycleEvent = DomainEventEnvelope<
  typeof WORKFLOW_LIFECYCLE_FAMILY,
  WorkflowLifecycleEventType,
  WorkflowLifecyclePayload
>;
