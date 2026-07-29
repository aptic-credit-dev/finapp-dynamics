import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The `legaldocs.lifecycle` event family — owned by m18-legaldocs (Stage 4.4).
 *
 * Registered in manifests/event-registry.yaml alongside this declaration and the module that emits it.
 * Delivered through the SINGLE transactional outbox that m06 owns (ADR-004/023) — m18 owns no outbox.
 * Classification `confidential`. Payloads carry IDENTIFIERS, STATES, DATES, REASON CODES and SAFE ANALYTICS
 * DIMENSIONS ONLY — never privileged legal advice, confidential clause/opinion/analysis text, full document
 * contents, drafting strategy, or personal data beyond approved identifiers (ADR-076). A consumer that needs
 * detail reads it back through the legal-knowledge API under its own permissions. m18 references m09 documents,
 * m14 matters, m16 proceedings and m17 recoveries through opaque ids / governed contracts — it never reads their
 * private tables. m18 owns no storage: bytes live in m09.
 */

export const LEGALDOCS_LIFECYCLE_FAMILY = 'legaldocs.lifecycle';
export const LEGALDOCS_LIFECYCLE_VERSION = 1;

export type LegalDocsLifecycleEventType =
  | 'KnowledgeCreated'
  | 'KnowledgeAssigned'
  | 'KnowledgeSubmitted'
  | 'KnowledgeReviewed'
  | 'KnowledgeChangesRequested'
  | 'KnowledgeApproved'
  | 'KnowledgePublished'
  | 'KnowledgeSuperseded'
  | 'KnowledgeWithdrawn'
  | 'KnowledgeArchived'
  | 'KnowledgeReopened'
  | 'KnowledgeVersionCreated'
  | 'AuthorityRegistered'
  | 'AuthorityTreated'
  | 'PrecedentRegistered'
  | 'OpinionRegistered'
  | 'OpinionApproved'
  | 'ResearchRegistered'
  | 'TemplateCreated'
  | 'TemplateApproved'
  | 'TemplatePublished'
  | 'TemplateSuperseded'
  | 'TemplateWithdrawn'
  | 'ClauseCreated'
  | 'ClauseApproved'
  | 'ClausePublished'
  | 'ClauseSuperseded'
  | 'ClauseWithdrawn'
  | 'DocumentLinked'
  | 'ReferenceLinked'
  | 'RelationshipCreated'
  | 'ReviewScheduled'
  | 'ReviewCompleted'
  | 'ClassificationChanged'
  | 'CitationAdded'
  | 'KnowledgeEscalated';

export const LEGALDOCS_LIFECYCLE_EVENT_TYPES: readonly LegalDocsLifecycleEventType[] = [
  'KnowledgeCreated',
  'KnowledgeAssigned',
  'KnowledgeSubmitted',
  'KnowledgeReviewed',
  'KnowledgeChangesRequested',
  'KnowledgeApproved',
  'KnowledgePublished',
  'KnowledgeSuperseded',
  'KnowledgeWithdrawn',
  'KnowledgeArchived',
  'KnowledgeReopened',
  'KnowledgeVersionCreated',
  'AuthorityRegistered',
  'AuthorityTreated',
  'PrecedentRegistered',
  'OpinionRegistered',
  'OpinionApproved',
  'ResearchRegistered',
  'TemplateCreated',
  'TemplateApproved',
  'TemplatePublished',
  'TemplateSuperseded',
  'TemplateWithdrawn',
  'ClauseCreated',
  'ClauseApproved',
  'ClausePublished',
  'ClauseSuperseded',
  'ClauseWithdrawn',
  'DocumentLinked',
  'ReferenceLinked',
  'RelationshipCreated',
  'ReviewScheduled',
  'ReviewCompleted',
  'ClassificationChanged',
  'CitationAdded',
  'KnowledgeEscalated',
];

/** A legal-knowledge lifecycle / sub-entity transition. Ids, states, dates, reason codes + safe dimensions only. */
export interface LegalDocsLifecyclePayload {
  readonly recordId: string;
  readonly recordType?: string;
  readonly knowledgeType?: string;
  readonly practiceArea?: string;
  readonly jurisdiction?: string;
  readonly authorityLevel?: string;
  readonly confidentiality?: string;
  readonly privileged?: boolean;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly refType?: string;
  readonly versionNumber?: number;
  readonly fromStatus?: string;
  readonly toStatus?: string;
  readonly reasonCode?: string;
  readonly dueAt?: string;
  readonly ruleEvaluationId?: string;
}

export type LegalDocsLifecycleEvent = DomainEventEnvelope<
  typeof LEGALDOCS_LIFECYCLE_FAMILY,
  LegalDocsLifecycleEventType,
  LegalDocsLifecyclePayload
>;
