/**
 * M20 permission catalogue — consumed by controllers' `@Endpoint` decorators and enforced server-side in the
 * services (default deny). Three-segment `gl_reconciliation.<entity>.<action>`; registered in
 * manifests/permission-registry.yaml + seeded (migration 0001). Account manage/deactivate, ruleset manage/publish,
 * run reopen, manual match, unmatch, exception waive, certification override, analytics export and platform admin are
 * privileged; there is no vague `gl_reconciliation.admin`.
 */
export const M20_PERMISSIONS = {
  accountRead: 'gl_reconciliation.account.read',
  accountManage: 'gl_reconciliation.account.manage',
  accountDeactivate: 'gl_reconciliation.account.deactivate',
  importCreate: 'gl_reconciliation.import.create',
  importRead: 'gl_reconciliation.import.read',
  importValidate: 'gl_reconciliation.import.validate',
  importAccept: 'gl_reconciliation.import.accept',
  importReject: 'gl_reconciliation.import.reject',
  sourceImport: 'gl_reconciliation.source.import',
  rulesetRead: 'gl_reconciliation.ruleset.read',
  rulesetManage: 'gl_reconciliation.ruleset.manage',
  rulesetPublish: 'gl_reconciliation.ruleset.publish',
  runRead: 'gl_reconciliation.run.read',
  runCreate: 'gl_reconciliation.run.create',
  runExecute: 'gl_reconciliation.run.execute',
  runReopen: 'gl_reconciliation.run.reopen',
  matchRead: 'gl_reconciliation.match.read',
  matchReview: 'gl_reconciliation.match.review',
  matchManual: 'gl_reconciliation.match.manual',
  matchUnmatch: 'gl_reconciliation.match.unmatch',
  itemRead: 'gl_reconciliation.item.read',
  itemManage: 'gl_reconciliation.item.manage',
  exceptionRead: 'gl_reconciliation.exception.read',
  exceptionAssign: 'gl_reconciliation.exception.assign',
  exceptionResolve: 'gl_reconciliation.exception.resolve',
  exceptionWaive: 'gl_reconciliation.exception.waive',
  certificationRead: 'gl_reconciliation.certification.read',
  certificationCreate: 'gl_reconciliation.certification.create',
  certificationOverride: 'gl_reconciliation.certification.override',
  recommendationRead: 'gl_reconciliation.recommendation.read',
  recommendationCreate: 'gl_reconciliation.recommendation.create',
  recommendationWithdraw: 'gl_reconciliation.recommendation.withdraw',
  analyticsRead: 'gl_reconciliation.analytics.read',
  analyticsExport: 'gl_reconciliation.analytics.export',
  platformAdminister: 'gl_reconciliation.platform.administer',
} as const;

export type M20Permission = (typeof M20_PERMISSIONS)[keyof typeof M20_PERMISSIONS];
export const ALL_M20_PERMISSIONS: readonly M20Permission[] = Object.values(M20_PERMISSIONS);

/** The privileged subset — account manage/deactivate, ruleset manage/publish, run reopen, manual match, unmatch,
 * exception waive, certification override, analytics export and platform administration. */
export const M20_PRIVILEGED_PERMISSIONS: readonly M20Permission[] = [
  M20_PERMISSIONS.accountManage,
  M20_PERMISSIONS.accountDeactivate,
  M20_PERMISSIONS.rulesetManage,
  M20_PERMISSIONS.rulesetPublish,
  M20_PERMISSIONS.runReopen,
  M20_PERMISSIONS.matchManual,
  M20_PERMISSIONS.matchUnmatch,
  M20_PERMISSIONS.exceptionWaive,
  M20_PERMISSIONS.certificationOverride,
  M20_PERMISSIONS.analyticsExport,
  M20_PERMISSIONS.platformAdminister,
];
