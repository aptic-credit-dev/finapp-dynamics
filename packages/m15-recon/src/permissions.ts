/**
 * M15 permission catalogue — consumed by controllers' `@Endpoint` decorators and enforced server-side in the
 * services (default deny). Three-segment `reconciliation.<entity>.<action>`; registered in
 * manifests/permission-registry.yaml + seeded (migration 0001). Manual override, unmatch, ruleset publish, run
 * reopen, exception waive and analytics export are privileged; there is no vague `reconciliation.admin`.
 */
export const M15_PERMISSIONS = {
  bankAccountRead: 'reconciliation.bank_account.read',
  bankAccountManage: 'reconciliation.bank_account.manage',
  bankAccountDeactivate: 'reconciliation.bank_account.deactivate',
  statementImport: 'reconciliation.statement.import',
  statementRead: 'reconciliation.statement.read',
  ledgerImport: 'reconciliation.ledger.import',
  ledgerRead: 'reconciliation.ledger.read',
  runRead: 'reconciliation.run.read',
  runCreate: 'reconciliation.run.create',
  runStart: 'reconciliation.run.start',
  runReview: 'reconciliation.run.review',
  runComplete: 'reconciliation.run.complete',
  runReopen: 'reconciliation.run.reopen',
  matchRead: 'reconciliation.match.read',
  matchRun: 'reconciliation.match.run',
  matchConfirm: 'reconciliation.match.confirm',
  matchReject: 'reconciliation.match.reject',
  matchUnmatch: 'reconciliation.match.unmatch',
  rulesetRead: 'reconciliation.ruleset.read',
  rulesetManage: 'reconciliation.ruleset.manage',
  rulesetPublish: 'reconciliation.ruleset.publish',
  exceptionRead: 'reconciliation.exception.read',
  exceptionResolve: 'reconciliation.exception.resolve',
  exceptionWaive: 'reconciliation.exception.waive',
  manualMatch: 'reconciliation.manual.match',
  manualGroup: 'reconciliation.manual.group',
  analyticsRead: 'reconciliation.analytics.read',
  analyticsExport: 'reconciliation.analytics.export',
  platformAdminister: 'reconciliation.platform.administer',
} as const;

export type M15Permission = (typeof M15_PERMISSIONS)[keyof typeof M15_PERMISSIONS];
export const ALL_M15_PERMISSIONS: readonly M15Permission[] = Object.values(M15_PERMISSIONS);

/** The privileged subset — manual override, unmatch, ruleset publish/manage, run reopen, waive, config, export. */
export const M15_PRIVILEGED_PERMISSIONS: readonly M15Permission[] = [
  M15_PERMISSIONS.bankAccountManage,
  M15_PERMISSIONS.bankAccountDeactivate,
  M15_PERMISSIONS.runReopen,
  M15_PERMISSIONS.matchUnmatch,
  M15_PERMISSIONS.rulesetManage,
  M15_PERMISSIONS.rulesetPublish,
  M15_PERMISSIONS.exceptionWaive,
  M15_PERMISSIONS.manualMatch,
  M15_PERMISSIONS.manualGroup,
  M15_PERMISSIONS.analyticsExport,
  M15_PERMISSIONS.platformAdminister,
];
