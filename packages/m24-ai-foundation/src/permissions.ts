/**
 * M24 permission catalogue — the `ai.*` namespace. Consumed by controllers' `@Endpoint` decorators and enforced
 * server-side in every service (default deny). Three-segment `ai.<entity>.<action>`; registered in
 * manifests/permission-registry.yaml + seeded (migration 0001). Registry manage/publish, provider approve, DLP manage,
 * the HUMAN output review, governance manage and platform admin are privileged; there is no vague `ai.admin`. Recording
 * an AI request/output is permissioned but NEVER a controlled action — AI assists; a human approves.
 */
export const M24_PERMISSIONS = {
  providerRead: 'ai.provider.read',
  providerManage: 'ai.provider.manage',
  providerApprove: 'ai.provider.approve',
  modelRead: 'ai.model.read',
  modelManage: 'ai.model.manage',
  promptRead: 'ai.prompt.read',
  promptManage: 'ai.prompt.manage',
  promptPublish: 'ai.prompt.publish',
  configRead: 'ai.config.read',
  configManage: 'ai.config.manage',
  dlpRead: 'ai.dlp.read',
  dlpManage: 'ai.dlp.manage',
  requestRead: 'ai.request.read',
  requestCreate: 'ai.request.create',
  requestCancel: 'ai.request.cancel',
  outputRead: 'ai.output.read',
  outputReview: 'ai.output.review',
  citationAdd: 'ai.citation.add',
  usageRead: 'ai.usage.read',
  governanceRead: 'ai.governance.read',
  governanceManage: 'ai.governance.manage',
  analyticsRead: 'ai.analytics.read',
  platformAdminister: 'ai.platform.administer',
} as const;

export type M24Permission = (typeof M24_PERMISSIONS)[keyof typeof M24_PERMISSIONS];
export const ALL_M24_PERMISSIONS: readonly M24Permission[] = Object.values(M24_PERMISSIONS);

/** The privileged subset — registry manage/publish, provider approve, DLP manage, human review, governance, admin. */
export const M24_PRIVILEGED_PERMISSIONS: readonly M24Permission[] = [
  M24_PERMISSIONS.providerManage,
  M24_PERMISSIONS.providerApprove,
  M24_PERMISSIONS.modelManage,
  M24_PERMISSIONS.promptManage,
  M24_PERMISSIONS.promptPublish,
  M24_PERMISSIONS.configManage,
  M24_PERMISSIONS.dlpManage,
  M24_PERMISSIONS.outputReview,
  M24_PERMISSIONS.governanceManage,
  M24_PERMISSIONS.platformAdminister,
];
