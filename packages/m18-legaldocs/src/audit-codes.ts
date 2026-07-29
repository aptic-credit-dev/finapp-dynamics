/**
 * M18 audit codes — the authoritative constant map. Every controlled legal-knowledge mutation records one of these
 * through the kernel `AUDIT` port (m03 AuditService) in the SAME transaction as the state change. Codes are
 * SCREAMING_SNAKE `LEGALDOC_<ENTITY>_<ACTION>` (>= 3 segments) and MUST be registered in
 * manifests/audit-code-registry.yaml (unregistered codes fail CI, ADR-005). Payloads never carry privileged legal
 * advice, confidential clause/opinion/analysis text, full document contents, drafting strategy, personal data
 * beyond approved identifiers, secrets, or notification destinations (ADR-076).
 */
export const M18_AUDIT_CODES = {
  taxonomyCreated: 'LEGALDOC_TAXONOMY_CREATED',
  taxonomyUpdated: 'LEGALDOC_TAXONOMY_UPDATED',
  taxonomyRetired: 'LEGALDOC_TAXONOMY_RETIRED',
  knowledgeCreated: 'LEGALDOC_KNOWLEDGE_CREATED',
  knowledgeUpdated: 'LEGALDOC_KNOWLEDGE_UPDATED',
  knowledgeAssigned: 'LEGALDOC_KNOWLEDGE_ASSIGNED',
  knowledgeSubmitted: 'LEGALDOC_KNOWLEDGE_SUBMITTED',
  knowledgeReviewed: 'LEGALDOC_KNOWLEDGE_REVIEWED',
  knowledgeChangesRequested: 'LEGALDOC_KNOWLEDGE_CHANGES_REQUESTED',
  knowledgeApproved: 'LEGALDOC_KNOWLEDGE_APPROVED',
  knowledgePublished: 'LEGALDOC_KNOWLEDGE_PUBLISHED',
  knowledgeSuperseded: 'LEGALDOC_KNOWLEDGE_SUPERSEDED',
  knowledgeWithdrawn: 'LEGALDOC_KNOWLEDGE_WITHDRAWN',
  knowledgeArchived: 'LEGALDOC_KNOWLEDGE_ARCHIVED',
  knowledgeReopened: 'LEGALDOC_KNOWLEDGE_REOPENED',
  knowledgeVersioned: 'LEGALDOC_KNOWLEDGE_VERSIONED',
  classificationChanged: 'LEGALDOC_CLASSIFICATION_CHANGED',
  authorityRegistered: 'LEGALDOC_AUTHORITY_REGISTERED',
  authorityUpdated: 'LEGALDOC_AUTHORITY_UPDATED',
  authorityTreated: 'LEGALDOC_AUTHORITY_TREATED',
  precedentRegistered: 'LEGALDOC_PRECEDENT_REGISTERED',
  precedentUpdated: 'LEGALDOC_PRECEDENT_UPDATED',
  opinionRegistered: 'LEGALDOC_OPINION_REGISTERED',
  opinionApproved: 'LEGALDOC_OPINION_APPROVED',
  researchRegistered: 'LEGALDOC_RESEARCH_REGISTERED',
  researchUpdated: 'LEGALDOC_RESEARCH_UPDATED',
  templateCreated: 'LEGALDOC_TEMPLATE_CREATED',
  templateSubmitted: 'LEGALDOC_TEMPLATE_SUBMITTED',
  templateApproved: 'LEGALDOC_TEMPLATE_APPROVED',
  templatePublished: 'LEGALDOC_TEMPLATE_PUBLISHED',
  templateSuperseded: 'LEGALDOC_TEMPLATE_SUPERSEDED',
  templateWithdrawn: 'LEGALDOC_TEMPLATE_WITHDRAWN',
  clauseCreated: 'LEGALDOC_CLAUSE_CREATED',
  clauseSubmitted: 'LEGALDOC_CLAUSE_SUBMITTED',
  clauseApproved: 'LEGALDOC_CLAUSE_APPROVED',
  clausePublished: 'LEGALDOC_CLAUSE_PUBLISHED',
  clauseSuperseded: 'LEGALDOC_CLAUSE_SUPERSEDED',
  clauseWithdrawn: 'LEGALDOC_CLAUSE_WITHDRAWN',
  clauseRelationCreated: 'LEGALDOC_CLAUSE_RELATION_CREATED',
  documentLinked: 'LEGALDOC_DOCUMENT_LINKED',
  referenceLinked: 'LEGALDOC_REFERENCE_LINKED',
  relationshipCreated: 'LEGALDOC_RELATIONSHIP_CREATED',
  relationshipRetired: 'LEGALDOC_RELATIONSHIP_RETIRED',
  reviewScheduled: 'LEGALDOC_REVIEW_SCHEDULED',
  reviewCompleted: 'LEGALDOC_REVIEW_COMPLETED',
  reviewOverdue: 'LEGALDOC_REVIEW_OVERDUE',
  tagAdded: 'LEGALDOC_TAG_ADDED',
  tagRemoved: 'LEGALDOC_TAG_REMOVED',
  citationAdded: 'LEGALDOC_CITATION_ADDED',
  noteAdded: 'LEGALDOC_NOTE_ADDED',
  usageRecorded: 'LEGALDOC_USAGE_RECORDED',
  privilegedAccessed: 'LEGALDOC_PRIVILEGED_ACCESSED',
  confidentialAccessed: 'LEGALDOC_CONFIDENTIAL_ACCESSED',
  exportRequested: 'LEGALDOC_EXPORT_REQUESTED',
  knowledgeEscalated: 'LEGALDOC_KNOWLEDGE_ESCALATED',
} as const;

export type M18AuditCode = (typeof M18_AUDIT_CODES)[keyof typeof M18_AUDIT_CODES];

export const ALL_M18_AUDIT_CODES: readonly M18AuditCode[] = Object.values(M18_AUDIT_CODES);

export const LEGALDOC_AUDIT_PREFIX = 'LEGALDOC_';
