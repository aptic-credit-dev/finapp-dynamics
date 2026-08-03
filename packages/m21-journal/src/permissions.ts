/**
 * M21 permission catalogue — consumed by controllers' `@Endpoint` decorators and enforced server-side in the
 * services (default deny). Three-segment `journals.<entity>.<action>`; registered in
 * manifests/permission-registry.yaml + seeded (migration 0001). Type/config manage/publish, posting-request
 * create/authorize/cancel, posting-result record, reason-code manage and platform admin are privileged; there is no
 * vague `journals.admin`. Posting-related permissions are privileged AND draft-first (posting is deferred to m23/m33).
 */
export const M21_PERMISSIONS = {
  recommendationRead: 'journals.recommendation.read',
  recommendationIngest: 'journals.recommendation.ingest',
  recommendationManage: 'journals.recommendation.manage',
  draftRead: 'journals.draft.read',
  draftCreate: 'journals.draft.create',
  draftEdit: 'journals.draft.edit',
  draftSubmit: 'journals.draft.submit',
  draftWithdraw: 'journals.draft.withdraw',
  lineManage: 'journals.line.manage',
  validationRead: 'journals.validation.read',
  validationRun: 'journals.validation.run',
  typeRead: 'journals.type.read',
  typeManage: 'journals.type.manage',
  configRead: 'journals.config.read',
  configManage: 'journals.config.manage',
  configPublish: 'journals.config.publish',
  postingRequestRead: 'journals.posting_request.read',
  postingRequestCreate: 'journals.posting_request.create',
  postingRequestAuthorize: 'journals.posting_request.authorize',
  postingRequestCancel: 'journals.posting_request.cancel',
  postingResultRead: 'journals.posting_result.read',
  postingResultRecord: 'journals.posting_result.record',
  reasonCodeRead: 'journals.reason_code.read',
  reasonCodeManage: 'journals.reason_code.manage',
  noteAdd: 'journals.note.add',
  analyticsRead: 'journals.analytics.read',
  platformAdminister: 'journals.platform.administer',
} as const;

export type M21Permission = (typeof M21_PERMISSIONS)[keyof typeof M21_PERMISSIONS];
export const ALL_M21_PERMISSIONS: readonly M21Permission[] = Object.values(M21_PERMISSIONS);

/** The privileged subset — type manage, config manage/publish, posting-request create/authorize/cancel,
 * posting-result record, reason-code manage and platform administration. */
export const M21_PRIVILEGED_PERMISSIONS: readonly M21Permission[] = [
  M21_PERMISSIONS.typeManage,
  M21_PERMISSIONS.configManage,
  M21_PERMISSIONS.configPublish,
  M21_PERMISSIONS.postingRequestCreate,
  M21_PERMISSIONS.postingRequestAuthorize,
  M21_PERMISSIONS.postingRequestCancel,
  M21_PERMISSIONS.postingResultRecord,
  M21_PERMISSIONS.reasonCodeManage,
  M21_PERMISSIONS.platformAdminister,
];
