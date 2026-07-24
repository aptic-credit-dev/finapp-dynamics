/**
 * M06 permission catalogue — the authoritative constant map consumed by controllers' `@Endpoint` decorators
 * and enforced server-side inside the services (default deny). Every code is three segments
 * `workflow.<entity>.<action>` (the kernel `@Endpoint` validator rejects anything else) and MUST be listed in
 * manifests/permission-registry.yaml under the `workflow.*` namespace. `workflow.engine.administer` is the
 * privileged admin capability (there is deliberately no two-segment `workflow.admin`).
 */
export const M06_PERMISSIONS = {
  definitionCreate: 'workflow.definition.create',
  definitionView: 'workflow.definition.view',
  definitionEdit: 'workflow.definition.edit',
  definitionValidate: 'workflow.definition.validate',
  definitionPublish: 'workflow.definition.publish',
  definitionActivate: 'workflow.definition.activate',
  definitionRetire: 'workflow.definition.retire',
  instanceStart: 'workflow.instance.start',
  instanceView: 'workflow.instance.view',
  instanceSuspend: 'workflow.instance.suspend',
  instanceResume: 'workflow.instance.resume',
  instanceCancel: 'workflow.instance.cancel',
  instanceRetry: 'workflow.instance.retry',
  taskView: 'workflow.task.view',
  taskClaim: 'workflow.task.claim',
  taskAssign: 'workflow.task.assign',
  taskReassign: 'workflow.task.reassign',
  taskComplete: 'workflow.task.complete',
  taskReject: 'workflow.task.reject',
  taskDelegate: 'workflow.task.delegate',
  taskEscalate: 'workflow.task.escalate',
  incidentView: 'workflow.incident.view',
  incidentResolve: 'workflow.incident.resolve',
  engineAdminister: 'workflow.engine.administer',
} as const;

export type M06Permission = (typeof M06_PERMISSIONS)[keyof typeof M06_PERMISSIONS];

export const ALL_M06_PERMISSIONS: readonly M06Permission[] = Object.values(M06_PERMISSIONS);
