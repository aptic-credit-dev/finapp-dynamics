import {
  redactKnowledge,
  type TaxonomyRow,
  type KnowledgeRow,
  type AuthorityRow,
  type AuthorityTreatmentRow,
  type PrecedentRow,
  type OpinionRow,
  type ResearchRow,
  type TemplateRow,
  type ClauseRow,
  type ClauseRelationRow,
  type ReferenceRow,
  type RelationshipRow,
  type ReviewRow,
  type TagRow,
  type CitationRow,
  type NoteRow,
  type UsageRow,
} from '@finapp/m18-legaldocs';

/**
 * Response shapes for the legal-documents & knowledge API (m18). Persistence rows are snake_case; these map to
 * camelCase DTOs. The tenant is implicit (x-tenant-id + RLS), never re-exposed. Deliberate REDACTIONS (ADR-076):
 * privileged/confidential legal analysis is stripped on read unless the caller holds the matching privileged
 * permission — knowledge `abstract` and authority `notes` need `legaldocs.confidential.read`; precedent
 * `holding`/`principle` and research `findings` and template/clause `content_ref`/`guidance` need
 * `legaldocs.confidential.read`; opinion `question`/`conclusion`/`recommendation` and restricted note bodies need
 * `legaldocs.privileged.read`. A list view NEVER emits privileged content — the controllers pass `false` there.
 * Every mutable view carries `version`.
 */
const REDACTED = '[redacted]';
function redactIf(hidden: boolean, value: string | null): string | null {
  return hidden ? (value === null ? null : REDACTED) : value;
}

export function taxonomyView(row: TaxonomyRow) {
  return {
    id: row.id,
    kind: row.kind,
    code: row.code,
    label: row.label,
    parentCode: row.parent_code,
    jurisdiction: row.jurisdiction,
    description: row.description,
    active: row.active,
    version: row.version,
  };
}

export function knowledgeView(row: KnowledgeRow, canReadConfidential: boolean) {
  // Reuse the m18 package's fail-closed redaction of the sensitive `abstract` (legal analysis).
  const r = redactKnowledge(row, canReadConfidential);
  return {
    id: r.id,
    knowledgeNumber: r.knowledge_number,
    knowledgeCode: r.knowledge_code,
    versionNumber: r.version_number,
    knowledgeType: r.knowledge_type,
    title: r.title,
    summary: r.summary,
    abstract: r.abstract,
    practiceArea: r.practice_area,
    jurisdiction: r.jurisdiction,
    authorityLevel: r.authority_level,
    confidentiality: r.confidentiality,
    privileged: r.privileged,
    privilegeLevel: r.privilege_level,
    riskLevel: r.risk_level,
    source: r.source,
    sourceReference: r.source_reference,
    owner: r.owner,
    reviewer: r.reviewer,
    approver: r.approver,
    publicationDate: r.publication_date,
    effectiveDate: r.effective_date,
    reviewDate: r.review_date,
    expiryDate: r.expiry_date,
    status: r.status,
    supersedesId: r.supersedes_id,
    supersededById: r.superseded_by_id,
    submittedBy: r.submitted_by,
    submittedAt: r.submitted_at,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    publishedAt: r.published_at,
    contentHash: r.content_hash,
    escalationRef: r.escalation_ref,
    workflowInstanceRef: r.workflow_instance_ref,
    version: r.version,
  };
}

export function authorityView(row: AuthorityRow, canReadConfidential: boolean) {
  const hide = row.confidentiality !== 'standard' && !canReadConfidential;
  return {
    id: row.id,
    authorityType: row.authority_type,
    title: row.title,
    citation: row.citation,
    jurisdiction: row.jurisdiction,
    issuingBody: row.issuing_body,
    court: row.court,
    decisionDate: row.decision_date,
    effectiveDate: row.effective_date,
    authorityLevel: row.authority_level,
    status: row.status,
    treatment: row.treatment,
    relevance: row.relevance,
    sourceReference: row.source_reference,
    documentRef: row.document_ref,
    notes: redactIf(hide, row.notes),
    confidentiality: row.confidentiality,
    version: row.version,
  };
}

export function treatmentView(row: AuthorityTreatmentRow) {
  return {
    id: row.id,
    authorityId: row.authority_id,
    treatment: row.treatment,
    byAuthorityRef: row.by_authority_ref,
    treatedBy: row.treated_by,
    note: row.note,
  };
}

export function precedentView(row: PrecedentRow, canReadConfidential: boolean) {
  const hide = row.confidentiality !== 'standard' && !canReadConfidential;
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    court: row.court,
    decisionDate: row.decision_date,
    holding: redactIf(hide, row.holding),
    principle: redactIf(hide, row.principle),
    jurisdiction: row.jurisdiction,
    documentRef: row.document_ref,
    relatedAuthority: row.related_authority,
    status: row.status,
    confidentiality: row.confidentiality,
    version: row.version,
  };
}

export function opinionView(row: OpinionRow, canReadPrivileged: boolean) {
  // Opinions default to privileged (attorney-client) — question/conclusion/recommendation are privileged advice.
  const hide = !canReadPrivileged;
  return {
    id: row.id,
    title: row.title,
    question: redactIf(hide, row.question),
    conclusion: redactIf(hide, row.conclusion),
    riskRating: row.risk_rating,
    recommendation: redactIf(hide, row.recommendation),
    jurisdiction: row.jurisdiction,
    author: row.author,
    approvalStatus: row.approval_status,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    documentRef: row.document_ref,
    relatedMatter: row.related_matter,
    confidentiality: row.confidentiality,
    privilegeLevel: row.privilege_level,
    version: row.version,
  };
}

export function researchView(row: ResearchRow, canReadConfidential: boolean) {
  const hide = row.confidentiality !== 'standard' && !canReadConfidential;
  return {
    id: row.id,
    title: row.title,
    question: row.question,
    findings: redactIf(hide, row.findings),
    author: row.author,
    jurisdiction: row.jurisdiction,
    practiceArea: row.practice_area,
    documentRef: row.document_ref,
    status: row.status,
    confidentiality: row.confidentiality,
    version: row.version,
  };
}

export function templateView(row: TemplateRow, canReadConfidential: boolean) {
  const hide = row.confidentiality !== 'standard' && !canReadConfidential;
  return {
    id: row.id,
    templateCode: row.template_code,
    versionNumber: row.version_number,
    category: row.category,
    title: row.title,
    description: row.description,
    jurisdiction: row.jurisdiction,
    practiceArea: row.practice_area,
    contentRef: redactIf(hide, row.content_ref),
    guidance: redactIf(hide, row.guidance),
    status: row.status,
    contentHash: row.content_hash,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    publishedAt: row.published_at,
    supersedesId: row.supersedes_id,
    supersededById: row.superseded_by_id,
    confidentiality: row.confidentiality,
    version: row.version,
  };
}

export function clauseView(row: ClauseRow, canReadConfidential: boolean) {
  const hide = row.confidentiality !== 'standard' && !canReadConfidential;
  return {
    id: row.id,
    clauseCode: row.clause_code,
    versionNumber: row.version_number,
    clauseKind: row.clause_kind,
    title: row.title,
    category: row.category,
    jurisdiction: row.jurisdiction,
    practiceArea: row.practice_area,
    guidance: redactIf(hide, row.guidance),
    contentRef: redactIf(hide, row.content_ref),
    status: row.status,
    contentHash: row.content_hash,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    publishedAt: row.published_at,
    supersedesId: row.supersedes_id,
    supersededById: row.superseded_by_id,
    confidentiality: row.confidentiality,
    version: row.version,
  };
}

export function clauseRelationView(row: ClauseRelationRow) {
  return {
    id: row.id,
    fromClauseId: row.from_clause_id,
    toClauseId: row.to_clause_id,
    kind: row.kind,
    status: row.status,
    version: row.version,
  };
}

export function referenceView(row: ReferenceRow) {
  return {
    id: row.id,
    knowledgeId: row.knowledge_id,
    refType: row.ref_type,
    targetId: row.target_id,
    label: row.label,
    status: row.status,
    version: row.version,
  };
}

export function relationshipView(row: RelationshipRow) {
  return {
    id: row.id,
    fromKnowledgeId: row.from_knowledge_id,
    toKnowledgeId: row.to_knowledge_id,
    kind: row.kind,
    status: row.status,
    version: row.version,
  };
}

export function reviewView(row: ReviewRow) {
  return {
    id: row.id,
    knowledgeId: row.knowledge_id,
    reviewType: row.review_type,
    startAt: row.start_at,
    dueAt: row.due_at,
    rule: row.rule,
    warnWindowMs: row.warn_window_ms,
    status: row.status,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    outcome: row.outcome,
    version: row.version,
  };
}

export function tagView(row: TagRow) {
  return {
    id: row.id,
    knowledgeId: row.knowledge_id,
    taxonomyKind: row.taxonomy_kind,
    taxonomyCode: row.taxonomy_code,
    label: row.label,
    active: row.active,
  };
}

export function citationView(row: CitationRow) {
  return {
    id: row.id,
    knowledgeId: row.knowledge_id,
    authorityRef: row.authority_ref,
    externalCitation: row.external_citation,
    pinpoint: row.pinpoint,
    note: row.note,
    version: row.version,
  };
}

export function noteView(row: NoteRow, canReadPrivileged: boolean) {
  const hide = row.privileged && !canReadPrivileged;
  return {
    id: row.id,
    knowledgeId: row.knowledge_id,
    noteType: row.note_type,
    headline: row.headline,
    content: hide ? REDACTED : row.content,
    confidentiality: row.confidentiality,
    privileged: row.privileged,
  };
}

export function usageView(row: UsageRow) {
  return {
    id: row.id,
    knowledgeId: row.knowledge_id,
    usageType: row.usage_type,
    actorRef: row.actor_ref,
    contextRef: row.context_ref,
    note: row.note,
  };
}
