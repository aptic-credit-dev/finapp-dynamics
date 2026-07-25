/**
 * M07 permission catalogue — the authoritative constant map consumed by controllers' `@Endpoint` decorators
 * and enforced server-side inside the services (default deny). Every code is three segments
 * `rules.<entity>.<action>` (the kernel `@Endpoint` validator rejects anything else) and MUST be listed in
 * manifests/permission-registry.yaml under the `rules.*` namespace AND seeded into the `permissions` catalogue.
 * `rules.platform.administer` is the platform-authority capability (global rule sets, ADR-037); there is
 * deliberately no vague `rules.admin`.
 */
export const M07_PERMISSIONS = {
  engineView: 'rules.engine.view',
  engineAuthor: 'rules.engine.author',
  engineValidate: 'rules.engine.validate',
  enginePublish: 'rules.engine.publish',
  engineActivate: 'rules.engine.activate',
  engineRetire: 'rules.engine.retire',
  engineEvaluate: 'rules.engine.evaluate',
  engineSimulate: 'rules.engine.simulate',
  engineTest: 'rules.engine.test',
  evaluationView: 'rules.evaluation.view',
  evaluationReplay: 'rules.evaluation.replay',
  evaluationExport: 'rules.evaluation.export',
  platformAdminister: 'rules.platform.administer',
} as const;

export type M07Permission = (typeof M07_PERMISSIONS)[keyof typeof M07_PERMISSIONS];

export const ALL_M07_PERMISSIONS: readonly M07Permission[] = Object.values(M07_PERMISSIONS);
