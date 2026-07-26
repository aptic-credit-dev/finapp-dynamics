/**
 * M08 permission catalogue — the authoritative constant map consumed by controllers' `@Endpoint` decorators
 * and enforced server-side inside the services (default deny). Every code is three segments
 * `notifications.<entity>.<action>` (the kernel `@Endpoint` validator rejects anything else) and MUST be listed
 * in manifests/permission-registry.yaml under the `notifications.*` namespace AND seeded into the `permissions`
 * catalogue. `notifications.platform.administer` is the platform-authority capability (platform-scoped templates
 * and escalation policies, ADR-042); there is deliberately no vague `notifications.admin`.
 */
export const M08_PERMISSIONS = {
  templateView: 'notifications.template.view',
  templateAuthor: 'notifications.template.author',
  templateValidate: 'notifications.template.validate',
  templatePublish: 'notifications.template.publish',
  templateActivate: 'notifications.template.activate',
  templateRetire: 'notifications.template.retire',
  requestView: 'notifications.request.view',
  requestCreate: 'notifications.request.create',
  requestCancel: 'notifications.request.cancel',
  requestRetry: 'notifications.request.retry',
  deliveryView: 'notifications.delivery.view',
  escalationView: 'notifications.escalation.view',
  escalationManage: 'notifications.escalation.manage',
  escalationAcknowledge: 'notifications.escalation.acknowledge',
  escalationResolve: 'notifications.escalation.resolve',
  preferenceView: 'notifications.preference.view',
  preferenceUpdate: 'notifications.preference.update',
  inboxView: 'notifications.inbox.view',
  inboxManage: 'notifications.inbox.manage',
  suppressionManage: 'notifications.suppression.manage',
  platformAdminister: 'notifications.platform.administer',
} as const;

export type M08Permission = (typeof M08_PERMISSIONS)[keyof typeof M08_PERMISSIONS];

export const ALL_M08_PERMISSIONS: readonly M08Permission[] = Object.values(M08_PERMISSIONS);
