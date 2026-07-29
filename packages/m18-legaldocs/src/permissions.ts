/**
 * M18 permission catalogue — the authoritative constant map consumed by controllers' `@Endpoint` decorators and
 * enforced server-side inside the services (default deny). Every code is three segments
 * `legaldocs.<entity>.<action>` (the kernel `@Endpoint` validator rejects anything else) and MUST be listed in
 * manifests/permission-registry.yaml under the `legaldocs.*` namespace AND seeded into the `permissions`
 * catalogue. Privileged/confidential access (legal advice, privileged opinions, drafting strategy, approval/publish
 * actions, configuration) is gated by dedicated privileged permissions; there is no vague `legaldocs.admin`
 * (ADR-076). Ethical walls are enforced by RLS FORCE + these access rules.
 */
export const M18_PERMISSIONS = {
  // core knowledge record
  knowledgeRead: 'legaldocs.knowledge.read',
  knowledgeCreate: 'legaldocs.knowledge.create',
  knowledgeUpdate: 'legaldocs.knowledge.update',
  knowledgeAssign: 'legaldocs.knowledge.assign',
  knowledgeSubmit: 'legaldocs.knowledge.submit',
  knowledgeReview: 'legaldocs.knowledge.review',
  knowledgeApprove: 'legaldocs.knowledge.approve',
  knowledgePublish: 'legaldocs.knowledge.publish',
  knowledgeSupersede: 'legaldocs.knowledge.supersede',
  knowledgeWithdraw: 'legaldocs.knowledge.withdraw',
  knowledgeArchive: 'legaldocs.knowledge.archive',
  knowledgeReopen: 'legaldocs.knowledge.reopen',
  // taxonomy / classification
  taxonomyRead: 'legaldocs.taxonomy.read',
  taxonomyManage: 'legaldocs.taxonomy.manage',
  // authorities + citations
  authorityRead: 'legaldocs.authority.read',
  authorityManage: 'legaldocs.authority.manage',
  authorityTreat: 'legaldocs.authority.treat',
  citationManage: 'legaldocs.citation.manage',
  // precedents
  precedentRead: 'legaldocs.precedent.read',
  precedentManage: 'legaldocs.precedent.manage',
  // opinions
  opinionRead: 'legaldocs.opinion.read',
  opinionManage: 'legaldocs.opinion.manage',
  opinionApprove: 'legaldocs.opinion.approve',
  // research
  researchRead: 'legaldocs.research.read',
  researchManage: 'legaldocs.research.manage',
  // templates
  templateRead: 'legaldocs.template.read',
  templateManage: 'legaldocs.template.manage',
  templateApprove: 'legaldocs.template.approve',
  templatePublish: 'legaldocs.template.publish',
  // clauses
  clauseRead: 'legaldocs.clause.read',
  clauseManage: 'legaldocs.clause.manage',
  clauseApprove: 'legaldocs.clause.approve',
  clausePublish: 'legaldocs.clause.publish',
  // references + relationships
  referenceRead: 'legaldocs.reference.read',
  referenceManage: 'legaldocs.reference.manage',
  relationshipRead: 'legaldocs.relationship.read',
  relationshipManage: 'legaldocs.relationship.manage',
  // reviews + deadlines
  reviewRead: 'legaldocs.review.read',
  reviewManage: 'legaldocs.review.manage',
  // tags
  tagManage: 'legaldocs.tag.manage',
  // privilege
  confidentialRead: 'legaldocs.confidential.read',
  privilegedRead: 'legaldocs.privileged.read',
  privilegedCreate: 'legaldocs.privileged.create',
  // reporting
  analyticsRead: 'legaldocs.analytics.read',
  analyticsExport: 'legaldocs.analytics.export',
  // platform
  platformAdminister: 'legaldocs.platform.administer',
} as const;

export type M18Permission = (typeof M18_PERMISSIONS)[keyof typeof M18_PERMISSIONS];

export const ALL_M18_PERMISSIONS: readonly M18Permission[] = Object.values(M18_PERMISSIONS);

/** The privileged subset — sensitive reads + controlling/approval/publish actions + configuration (seeded privileged). */
export const M18_PRIVILEGED_PERMISSIONS: readonly M18Permission[] = [
  M18_PERMISSIONS.knowledgeApprove,
  M18_PERMISSIONS.knowledgePublish,
  M18_PERMISSIONS.knowledgeSupersede,
  M18_PERMISSIONS.knowledgeWithdraw,
  M18_PERMISSIONS.knowledgeArchive,
  M18_PERMISSIONS.knowledgeReopen,
  M18_PERMISSIONS.taxonomyManage,
  M18_PERMISSIONS.authorityManage,
  M18_PERMISSIONS.opinionManage,
  M18_PERMISSIONS.opinionApprove,
  M18_PERMISSIONS.templateApprove,
  M18_PERMISSIONS.templatePublish,
  M18_PERMISSIONS.clauseApprove,
  M18_PERMISSIONS.clausePublish,
  M18_PERMISSIONS.confidentialRead,
  M18_PERMISSIONS.privilegedRead,
  M18_PERMISSIONS.privilegedCreate,
  M18_PERMISSIONS.analyticsExport,
  M18_PERMISSIONS.platformAdminister,
];
