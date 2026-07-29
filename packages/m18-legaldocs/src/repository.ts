/**
 * M18 repository — ALL SQL for legal documents & knowledge management. Every query is parameterized; every mutating
 * UPDATE is optimistic-lock guarded (`WHERE id=$1 AND version=$expected`) or a compare-and-set claim, so a
 * stale/losing command changes zero rows and the caller reacts (single-winner). Queries carry NO tenant_id
 * predicate: RLS FORCE is the isolation guarantee. All methods take the caller's `Tx` so state, status/assignment/
 * approval histories, treatments, references, relationships, reviews, tags, citations, notes, usage, audit and
 * outbox commit atomically. Status/assignment/approval histories, authority treatments, notes and usage are
 * append-only (INSERT + SELECT). Knowledge records, templates and clauses are PUBLISHABLE: published content is
 * immutable — a change is a NEW version (supersession), content_hash frozen at publish (ADR-074). m18 NEVER reads
 * m09/m14/m16/m17 tables — cross-module targets are OPAQUE ids on legaldoc_reference. Privileged/confidential text
 * (abstract, opinion conclusion/recommendation, research findings, holdings, clause/template body, restricted
 * notes) is RLS-stored and redacted by the services; it never reaches events/audit (ADR-076).
 */
import type { Tx } from '@finapp/kernel';

// --- row types (raw DB shape; snake_case columns as SELECTed) -----------------------------------
export interface TaxonomyRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly kind: string;
  readonly code: string;
  readonly label: string;
  readonly parent_code: string | null;
  readonly jurisdiction: string | null;
  readonly description: string | null;
  readonly active: boolean;
  readonly version: number;
}

export interface KnowledgeRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly knowledge_number: string;
  readonly knowledge_code: string;
  readonly version_number: number;
  readonly knowledge_type: string;
  readonly title: string;
  readonly summary: string | null;
  readonly abstract: string | null;
  readonly practice_area: string | null;
  readonly jurisdiction: string | null;
  readonly authority_level: string | null;
  readonly confidentiality: string;
  readonly privileged: boolean;
  readonly privilege_level: string;
  readonly risk_level: string | null;
  readonly source: string | null;
  readonly source_reference: string | null;
  readonly owner: string | null;
  readonly reviewer: string | null;
  readonly approver: string | null;
  readonly publication_date: string | null;
  readonly effective_date: string | null;
  readonly review_date: string | null;
  readonly expiry_date: string | null;
  readonly status: string;
  readonly supersedes_id: string | null;
  readonly superseded_by_id: string | null;
  readonly submitted_by: string | null;
  readonly submitted_at: string | null;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly published_at: string | null;
  readonly content_hash: string | null;
  readonly escalation_ref: string | null;
  readonly workflow_instance_ref: string | null;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly idempotency_key: string | null;
  readonly version: number;
}

export interface StatusHistoryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly knowledge_id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly reason: string | null;
  readonly reason_code: string | null;
  readonly by_user: string | null;
  readonly correlation_id: string;
}

export interface AssignmentHistoryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly knowledge_id: string;
  readonly kind: string;
  readonly ref: string | null;
  readonly reason: string | null;
  readonly by_user: string | null;
  readonly correlation_id: string;
}

export interface AuthorityRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly authority_type: string;
  readonly title: string;
  readonly citation: string | null;
  readonly jurisdiction: string | null;
  readonly issuing_body: string | null;
  readonly court: string | null;
  readonly decision_date: string | null;
  readonly effective_date: string | null;
  readonly authority_level: string | null;
  readonly status: string;
  readonly treatment: string | null;
  readonly relevance: string | null;
  readonly source_reference: string | null;
  readonly document_ref: string | null;
  readonly notes: string | null;
  readonly confidentiality: string;
  readonly version: number;
}

export interface AuthorityTreatmentRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly authority_id: string;
  readonly treatment: string;
  readonly by_authority_ref: string | null;
  readonly treated_by: string | null;
  readonly note: string | null;
  readonly correlation_id: string;
}

export interface PrecedentRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly title: string;
  readonly summary: string | null;
  readonly court: string | null;
  readonly decision_date: string | null;
  readonly holding: string | null;
  readonly principle: string | null;
  readonly jurisdiction: string | null;
  readonly document_ref: string | null;
  readonly related_authority: string | null;
  readonly status: string;
  readonly confidentiality: string;
  readonly version: number;
}

export interface OpinionRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly title: string;
  readonly question: string | null;
  readonly conclusion: string | null;
  readonly risk_rating: string | null;
  readonly recommendation: string | null;
  readonly jurisdiction: string | null;
  readonly author: string | null;
  readonly approval_status: string;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly document_ref: string | null;
  readonly related_matter: string | null;
  readonly confidentiality: string;
  readonly privilege_level: string;
  readonly correlation_id: string;
  readonly version: number;
}

export interface ResearchRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly title: string;
  readonly question: string | null;
  readonly findings: string | null;
  readonly author: string | null;
  readonly jurisdiction: string | null;
  readonly practice_area: string | null;
  readonly document_ref: string | null;
  readonly status: string;
  readonly confidentiality: string;
  readonly version: number;
}

export interface TemplateRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly template_code: string;
  readonly version_number: number;
  readonly category: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly jurisdiction: string | null;
  readonly practice_area: string | null;
  readonly content_ref: string | null;
  readonly guidance: string | null;
  readonly status: string;
  readonly content_hash: string | null;
  readonly submitted_by: string | null;
  readonly submitted_at: string | null;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly published_at: string | null;
  readonly supersedes_id: string | null;
  readonly superseded_by_id: string | null;
  readonly confidentiality: string;
  readonly correlation_id: string;
  readonly version: number;
}

export interface ClauseRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly clause_code: string;
  readonly version_number: number;
  readonly clause_kind: string;
  readonly title: string;
  readonly category: string | null;
  readonly jurisdiction: string | null;
  readonly practice_area: string | null;
  readonly guidance: string | null;
  readonly content_ref: string | null;
  readonly status: string;
  readonly content_hash: string | null;
  readonly submitted_by: string | null;
  readonly submitted_at: string | null;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly published_at: string | null;
  readonly supersedes_id: string | null;
  readonly superseded_by_id: string | null;
  readonly confidentiality: string;
  readonly correlation_id: string;
  readonly version: number;
}

export interface ClauseRelationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly from_clause_id: string;
  readonly to_clause_id: string;
  readonly kind: string;
  readonly status: string;
  readonly correlation_id: string;
  readonly version: number;
}

export interface ReferenceRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly knowledge_id: string;
  readonly ref_type: string;
  readonly target_id: string;
  readonly label: string | null;
  readonly status: string;
  readonly correlation_id: string;
  readonly version: number;
}

export interface RelationshipRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly from_knowledge_id: string;
  readonly to_knowledge_id: string;
  readonly kind: string;
  readonly status: string;
  readonly correlation_id: string;
  readonly version: number;
}

export interface ReviewRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly knowledge_id: string;
  readonly review_type: string;
  readonly start_at: string | null;
  readonly due_at: string;
  readonly rule: unknown;
  readonly warn_window_ms: string | null;
  readonly status: string;
  readonly completed_at: string | null;
  readonly completed_by: string | null;
  readonly outcome: string | null;
  readonly correlation_id: string;
  readonly version: number;
}

export interface TagRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly knowledge_id: string;
  readonly taxonomy_kind: string;
  readonly taxonomy_code: string;
  readonly label: string | null;
  readonly active: boolean;
}

export interface CitationRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly knowledge_id: string;
  readonly authority_ref: string | null;
  readonly external_citation: string | null;
  readonly pinpoint: string | null;
  readonly note: string | null;
  readonly correlation_id: string;
  readonly version: number;
}

export interface NoteRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly knowledge_id: string;
  readonly note_type: string;
  readonly headline: string | null;
  readonly content: string;
  readonly confidentiality: string;
  readonly privileged: boolean;
  readonly correlation_id: string;
}

export interface UsageRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly knowledge_id: string;
  readonly usage_type: string;
  readonly actor_ref: string | null;
  readonly context_ref: string | null;
  readonly note: string | null;
  readonly correlation_id: string;
}

export interface ApprovalHistoryRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly action: string;
  readonly decision: string | null;
  readonly by_user: string | null;
  readonly note: string | null;
  readonly correlation_id: string;
}

// --- column projections (kept in one place so SELECT/INSERT/UPDATE stay in lock-step) ------------
const TAXONOMY_COLS =
  'tenant_id, id, kind, code, label, parent_code, jurisdiction, description, active, version';
const KNOWLEDGE_COLS =
  'tenant_id, id, knowledge_number, knowledge_code, version_number, knowledge_type, title, summary, abstract, ' +
  'practice_area, jurisdiction, authority_level, confidentiality, privileged, privilege_level, risk_level, source, ' +
  'source_reference, owner, reviewer, approver, publication_date, effective_date, review_date, expiry_date, status, ' +
  'supersedes_id, superseded_by_id, submitted_by, submitted_at, approved_by, approved_at, published_at, content_hash, ' +
  'escalation_ref, workflow_instance_ref, correlation_id, causation_id, idempotency_key, version';
const STATUS_HISTORY_COLS =
  'tenant_id, id, knowledge_id, from_status, to_status, reason, reason_code, by_user, correlation_id';
const ASSIGNMENT_HISTORY_COLS = 'tenant_id, id, knowledge_id, kind, ref, reason, by_user, correlation_id';
const AUTHORITY_COLS =
  'tenant_id, id, authority_type, title, citation, jurisdiction, issuing_body, court, decision_date, effective_date, ' +
  'authority_level, status, treatment, relevance, source_reference, document_ref, notes, confidentiality, version';
const AUTHORITY_TREATMENT_COLS =
  'tenant_id, id, authority_id, treatment, by_authority_ref, treated_by, note, correlation_id';
const PRECEDENT_COLS =
  'tenant_id, id, title, summary, court, decision_date, holding, principle, jurisdiction, document_ref, ' +
  'related_authority, status, confidentiality, version';
const OPINION_COLS =
  'tenant_id, id, title, question, conclusion, risk_rating, recommendation, jurisdiction, author, approval_status, ' +
  'approved_by, approved_at, document_ref, related_matter, confidentiality, privilege_level, correlation_id, version';
const RESEARCH_COLS =
  'tenant_id, id, title, question, findings, author, jurisdiction, practice_area, document_ref, status, ' +
  'confidentiality, version';
const TEMPLATE_COLS =
  'tenant_id, id, template_code, version_number, category, title, description, jurisdiction, practice_area, ' +
  'content_ref, guidance, status, content_hash, submitted_by, submitted_at, approved_by, approved_at, published_at, ' +
  'supersedes_id, superseded_by_id, confidentiality, correlation_id, version';
const CLAUSE_COLS =
  'tenant_id, id, clause_code, version_number, clause_kind, title, category, jurisdiction, practice_area, guidance, ' +
  'content_ref, status, content_hash, submitted_by, submitted_at, approved_by, approved_at, published_at, ' +
  'supersedes_id, superseded_by_id, confidentiality, correlation_id, version';
const CLAUSE_RELATION_COLS =
  'tenant_id, id, from_clause_id, to_clause_id, kind, status, correlation_id, version';
const REFERENCE_COLS =
  'tenant_id, id, knowledge_id, ref_type, target_id, label, status, correlation_id, version';
const RELATIONSHIP_COLS =
  'tenant_id, id, from_knowledge_id, to_knowledge_id, kind, status, correlation_id, version';
const REVIEW_COLS =
  'tenant_id, id, knowledge_id, review_type, start_at, due_at, rule, warn_window_ms, status, completed_at, ' +
  'completed_by, outcome, correlation_id, version';
const TAG_COLS = 'tenant_id, id, knowledge_id, taxonomy_kind, taxonomy_code, label, active';
const CITATION_COLS =
  'tenant_id, id, knowledge_id, authority_ref, external_citation, pinpoint, note, correlation_id, version';
const NOTE_COLS =
  'tenant_id, id, knowledge_id, note_type, headline, content, confidentiality, privileged, correlation_id';
const USAGE_COLS = 'tenant_id, id, knowledge_id, usage_type, actor_ref, context_ref, note, correlation_id';
const APPROVAL_HISTORY_COLS =
  'tenant_id, id, entity_type, entity_id, action, decision, by_user, note, correlation_id';

function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`m18 repository: expected a row from ${what}`);
  return row;
}
function count(rows: { c: string }[]): number {
  return Number(rows[0]?.c ?? '0');
}

export class LegalDocsRepository {
  // --- taxonomy (configurable classification; active/retired flag) ------------------------------
  async insertTaxonomy(
    tx: Tx,
    i: {
      tenantId: string;
      kind: string;
      code: string;
      label: string;
      parentCode: string | null;
      jurisdiction: string | null;
      description: string | null;
      by: string | null;
    },
  ): Promise<TaxonomyRow> {
    const r = await tx.query<TaxonomyRow>(
      `INSERT INTO legaldoc_taxonomy (tenant_id, kind, code, label, parent_code, jurisdiction, description, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING ${TAXONOMY_COLS}`,
      [i.tenantId, i.kind, i.code, i.label, i.parentCode, i.jurisdiction, i.description, i.by],
    );
    return firstRow(r.rows, 'insert taxonomy');
  }
  async findTaxonomy(tx: Tx, id: string): Promise<TaxonomyRow | null> {
    const r = await tx.query<TaxonomyRow>(`SELECT ${TAXONOMY_COLS} FROM legaldoc_taxonomy WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async findActiveTaxonomy(tx: Tx, kind: string, code: string): Promise<TaxonomyRow | null> {
    const r = await tx.query<TaxonomyRow>(
      `SELECT ${TAXONOMY_COLS} FROM legaldoc_taxonomy WHERE kind=$1 AND code=$2 AND active=true`,
      [kind, code],
    );
    return r.rows[0] ?? null;
  }
  async updateTaxonomy(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      label: string | null;
      parentCode: string | null;
      jurisdiction: string | null;
      description: string | null;
      by: string | null;
    },
  ): Promise<TaxonomyRow | null> {
    const r = await tx.query<TaxonomyRow>(
      `UPDATE legaldoc_taxonomy SET label=COALESCE($3,label), parent_code=COALESCE($4,parent_code), jurisdiction=COALESCE($5,jurisdiction), description=COALESCE($6,description), updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND active=true RETURNING ${TAXONOMY_COLS}`,
      [i.id, i.expectedVersion, i.label, i.parentCode, i.jurisdiction, i.description, i.by],
    );
    return r.rows[0] ?? null;
  }
  async retireTaxonomy(
    tx: Tx,
    i: { id: string; expectedVersion: number; by: string | null },
  ): Promise<TaxonomyRow | null> {
    const r = await tx.query<TaxonomyRow>(
      `UPDATE legaldoc_taxonomy SET active=false, updated_by=$3, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND active=true RETURNING ${TAXONOMY_COLS}`,
      [i.id, i.expectedVersion, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listTaxonomy(tx: Tx, kind: string): Promise<TaxonomyRow[]> {
    const r = await tx.query<TaxonomyRow>(
      `SELECT ${TAXONOMY_COLS} FROM legaldoc_taxonomy WHERE kind=$1 AND active=true ORDER BY code`,
      [kind],
    );
    return r.rows;
  }

  // --- knowledge record -------------------------------------------------------------------------
  async insertKnowledge(
    tx: Tx,
    i: {
      tenantId: string;
      knowledgeNumber: string;
      knowledgeCode: string;
      versionNumber: number;
      knowledgeType: string;
      title: string;
      summary: string | null;
      abstract: string | null;
      practiceArea: string | null;
      jurisdiction: string | null;
      authorityLevel: string | null;
      confidentiality: string;
      privileged: boolean;
      privilegeLevel: string;
      riskLevel: string | null;
      source: string | null;
      sourceReference: string | null;
      owner: string | null;
      effectiveDate: string | null;
      reviewDate: string | null;
      expiryDate: string | null;
      status: string;
      supersedesId: string | null;
      contentHash: string | null;
      publicationDate: string | null;
      submittedBy: string | null;
      approvedBy: string | null;
      correlationId: string;
      causationId: string | null;
      idempotencyKey: string | null;
      by: string | null;
    },
  ): Promise<KnowledgeRow> {
    const r = await tx.query<KnowledgeRow>(
      `INSERT INTO legaldoc_knowledge (tenant_id, knowledge_number, knowledge_code, version_number, knowledge_type, title, summary, abstract, practice_area, jurisdiction, authority_level, confidentiality, privileged, privilege_level, risk_level, source, source_reference, owner, effective_date, review_date, expiry_date, status, supersedes_id, content_hash, publication_date, submitted_by, submitted_at, approved_by, approved_at, published_at, correlation_id, causation_id, idempotency_key, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26, CASE WHEN $26::uuid IS NOT NULL THEN now() ELSE NULL END, $27, CASE WHEN $27::uuid IS NOT NULL THEN now() ELSE NULL END, CASE WHEN $22='published' THEN now() ELSE NULL END, $28,$29,$30,$31,$31) RETURNING ${KNOWLEDGE_COLS}`,
      [
        i.tenantId,
        i.knowledgeNumber,
        i.knowledgeCode,
        i.versionNumber,
        i.knowledgeType,
        i.title,
        i.summary,
        i.abstract,
        i.practiceArea,
        i.jurisdiction,
        i.authorityLevel,
        i.confidentiality,
        i.privileged,
        i.privilegeLevel,
        i.riskLevel,
        i.source,
        i.sourceReference,
        i.owner,
        i.effectiveDate,
        i.reviewDate,
        i.expiryDate,
        i.status,
        i.supersedesId,
        i.contentHash,
        i.publicationDate,
        i.submittedBy,
        i.approvedBy,
        i.correlationId,
        i.causationId,
        i.idempotencyKey,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert knowledge');
  }
  async findKnowledge(tx: Tx, id: string): Promise<KnowledgeRow | null> {
    const r = await tx.query<KnowledgeRow>(`SELECT ${KNOWLEDGE_COLS} FROM legaldoc_knowledge WHERE id=$1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }
  async findKnowledgeByIdempotencyKey(tx: Tx, key: string): Promise<KnowledgeRow | null> {
    const r = await tx.query<KnowledgeRow>(
      `SELECT ${KNOWLEDGE_COLS} FROM legaldoc_knowledge WHERE idempotency_key=$1`,
      [key],
    );
    return r.rows[0] ?? null;
  }
  async nextKnowledgeVersion(tx: Tx, knowledgeCode: string): Promise<number> {
    const r = await tx.query<{ next: number }>(
      `SELECT COALESCE(MAX(version_number),0)+1 AS next FROM legaldoc_knowledge WHERE knowledge_code=$1`,
      [knowledgeCode],
    );
    return firstRow(r.rows, 'next knowledge version').next;
  }
  /** Content patch — draft/changes_requested only (published content is immutable; ADR-074). CAS on version. */
  async updateKnowledge(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      title: string | null;
      summary: string | null;
      abstract: string | null;
      knowledgeType: string | null;
      practiceArea: string | null;
      jurisdiction: string | null;
      authorityLevel: string | null;
      riskLevel: string | null;
      source: string | null;
      sourceReference: string | null;
      effectiveDate: string | null;
      reviewDate: string | null;
      expiryDate: string | null;
      by: string | null;
    },
  ): Promise<KnowledgeRow | null> {
    const r = await tx.query<KnowledgeRow>(
      `UPDATE legaldoc_knowledge SET
         title=COALESCE($3,title), summary=COALESCE($4,summary), abstract=COALESCE($5,abstract),
         knowledge_type=COALESCE($6,knowledge_type), practice_area=COALESCE($7,practice_area),
         jurisdiction=COALESCE($8,jurisdiction), authority_level=COALESCE($9,authority_level),
         risk_level=COALESCE($10,risk_level), source=COALESCE($11,source), source_reference=COALESCE($12,source_reference),
         effective_date=COALESCE($13,effective_date), review_date=COALESCE($14,review_date),
         expiry_date=COALESCE($15,expiry_date), updated_by=$16, updated_at=now(), version=version+1
       WHERE id=$1 AND version=$2 AND status IN ('draft','changes_requested') RETURNING ${KNOWLEDGE_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.title,
        i.summary,
        i.abstract,
        i.knowledgeType,
        i.practiceArea,
        i.jurisdiction,
        i.authorityLevel,
        i.riskLevel,
        i.source,
        i.sourceReference,
        i.effectiveDate,
        i.reviewDate,
        i.expiryDate,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  /** Classification change — confidentiality / privilege only. CAS on version. */
  async patchKnowledgeClassification(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      confidentiality: string | null;
      privileged: boolean | null;
      privilegeLevel: string | null;
      by: string | null;
    },
  ): Promise<KnowledgeRow | null> {
    const r = await tx.query<KnowledgeRow>(
      `UPDATE legaldoc_knowledge SET confidentiality=COALESCE($3,confidentiality), privileged=COALESCE($4,privileged), privilege_level=COALESCE($5,privilege_level), updated_by=$6, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${KNOWLEDGE_COLS}`,
      [i.id, i.expectedVersion, i.confidentiality, i.privileged, i.privilegeLevel, i.by],
    );
    return r.rows[0] ?? null;
  }
  /** Owner/reviewer/approver assignment. CAS on version. */
  async assignKnowledge(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      owner: string | null;
      reviewer: string | null;
      approver: string | null;
      by: string | null;
    },
  ): Promise<KnowledgeRow | null> {
    const r = await tx.query<KnowledgeRow>(
      `UPDATE legaldoc_knowledge SET owner=COALESCE($3,owner), reviewer=COALESCE($4,reviewer), approver=COALESCE($5,approver), updated_by=$6, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${KNOWLEDGE_COLS}`,
      [i.id, i.expectedVersion, i.owner, i.reviewer, i.approver, i.by],
    );
    return r.rows[0] ?? null;
  }
  /**
   * The single lifecycle-transition UPDATE. CAS on version. Optional maker-checker + publish stamps: `submittedBy`
   * sets submitted_by/submitted_at; `approvedBy` sets approved_by/approved_at (the DB CHECK also enforces
   * approved_by <> submitted_by); `contentHash`/`publicationDate` freeze at publish; `supersededById` links a
   * superseded prior version to its successor; published_at stamps when moving to 'published'.
   */
  async transitionKnowledge(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      submittedBy?: string | null;
      approvedBy?: string | null;
      contentHash?: string | null;
      publicationDate?: string | null;
      supersededById?: string | null;
      by: string | null;
    },
  ): Promise<KnowledgeRow | null> {
    const r = await tx.query<KnowledgeRow>(
      `UPDATE legaldoc_knowledge SET
         status=$3,
         submitted_by=COALESCE($4,submitted_by), submitted_at=CASE WHEN $4::uuid IS NOT NULL THEN now() ELSE submitted_at END,
         approved_by=COALESCE($5,approved_by), approved_at=CASE WHEN $5::uuid IS NOT NULL THEN now() ELSE approved_at END,
         content_hash=COALESCE($6,content_hash), publication_date=COALESCE($7,publication_date),
         published_at=CASE WHEN $3='published' THEN now() ELSE published_at END,
         superseded_by_id=COALESCE($8,superseded_by_id),
         updated_by=$9, updated_at=now(), version=version+1
       WHERE id=$1 AND version=$2 RETURNING ${KNOWLEDGE_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.toStatus,
        i.submittedBy ?? null,
        i.approvedBy ?? null,
        i.contentHash ?? null,
        i.publicationDate ?? null,
        i.supersededById ?? null,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async searchKnowledge(
    tx: Tx,
    f: {
      knowledgeType?: string;
      status?: string;
      practiceArea?: string;
      jurisdiction?: string;
      owner?: string;
      limit: number;
      offset: number;
    },
  ): Promise<KnowledgeRow[]> {
    const r = await tx.query<KnowledgeRow>(
      `SELECT ${KNOWLEDGE_COLS} FROM legaldoc_knowledge WHERE ($1::text IS NULL OR knowledge_type=$1) AND ($2::text IS NULL OR status=$2) AND ($3::text IS NULL OR practice_area=$3) AND ($4::text IS NULL OR jurisdiction=$4) AND ($5::uuid IS NULL OR owner=$5) ORDER BY created_at DESC LIMIT $6 OFFSET $7`,
      [
        f.knowledgeType ?? null,
        f.status ?? null,
        f.practiceArea ?? null,
        f.jurisdiction ?? null,
        f.owner ?? null,
        f.limit,
        f.offset,
      ],
    );
    return r.rows;
  }
  async analyticsByDimension(tx: Tx, dimension: string): Promise<{ dim: string | null; count: string }[]> {
    const col =
      {
        knowledge_type: 'knowledge_type',
        practice_area: 'practice_area',
        jurisdiction: 'jurisdiction',
        authority_level: 'authority_level',
        status: 'status',
        confidentiality: 'confidentiality',
        source: 'source',
        risk_level: 'risk_level',
      }[dimension] ?? 'status';
    const r = await tx.query<{ dim: string | null; count: string }>(
      `SELECT ${col} AS dim, count(*)::text AS count FROM legaldoc_knowledge GROUP BY ${col} ORDER BY count DESC`,
    );
    return r.rows;
  }

  // --- histories (append-only) ------------------------------------------------------------------
  async insertStatusHistory(
    tx: Tx,
    i: {
      tenantId: string;
      knowledgeId: string;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      reasonCode: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO legaldoc_status_history (tenant_id, knowledge_id, from_status, to_status, reason, reason_code, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.knowledgeId, i.fromStatus, i.toStatus, i.reason, i.reasonCode, i.by, i.correlationId],
    );
  }
  async insertAssignmentHistory(
    tx: Tx,
    i: {
      tenantId: string;
      knowledgeId: string;
      kind: string;
      ref: string | null;
      reason: string | null;
      by: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO legaldoc_assignment_history (tenant_id, knowledge_id, kind, ref, reason, by_user, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [i.tenantId, i.knowledgeId, i.kind, i.ref, i.reason, i.by, i.correlationId],
    );
  }
  async insertApprovalHistory(
    tx: Tx,
    i: {
      tenantId: string;
      entityType: string;
      entityId: string;
      action: string;
      decision: string | null;
      by: string | null;
      note: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO legaldoc_approval_history (tenant_id, entity_type, entity_id, action, decision, by_user, note, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i.tenantId, i.entityType, i.entityId, i.action, i.decision, i.by, i.note, i.correlationId],
    );
  }
  async listStatusHistory(tx: Tx, knowledgeId: string): Promise<StatusHistoryRow[]> {
    const r = await tx.query<StatusHistoryRow>(
      `SELECT ${STATUS_HISTORY_COLS} FROM legaldoc_status_history WHERE knowledge_id=$1 ORDER BY created_at`,
      [knowledgeId],
    );
    return r.rows;
  }
  async listAssignmentHistory(tx: Tx, knowledgeId: string): Promise<AssignmentHistoryRow[]> {
    const r = await tx.query<AssignmentHistoryRow>(
      `SELECT ${ASSIGNMENT_HISTORY_COLS} FROM legaldoc_assignment_history WHERE knowledge_id=$1 ORDER BY created_at`,
      [knowledgeId],
    );
    return r.rows;
  }

  // --- authorities + treatments -----------------------------------------------------------------
  async insertAuthority(
    tx: Tx,
    i: {
      tenantId: string;
      authorityType: string;
      title: string;
      citation: string | null;
      jurisdiction: string | null;
      issuingBody: string | null;
      court: string | null;
      decisionDate: string | null;
      effectiveDate: string | null;
      authorityLevel: string | null;
      treatment: string | null;
      relevance: string | null;
      sourceReference: string | null;
      documentRef: string | null;
      notes: string | null;
      confidentiality: string;
      by: string | null;
    },
  ): Promise<AuthorityRow> {
    const r = await tx.query<AuthorityRow>(
      `INSERT INTO legaldoc_authority (tenant_id, authority_type, title, citation, jurisdiction, issuing_body, court, decision_date, effective_date, authority_level, treatment, relevance, source_reference, document_ref, notes, confidentiality, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17) RETURNING ${AUTHORITY_COLS}`,
      [
        i.tenantId,
        i.authorityType,
        i.title,
        i.citation,
        i.jurisdiction,
        i.issuingBody,
        i.court,
        i.decisionDate,
        i.effectiveDate,
        i.authorityLevel,
        i.treatment,
        i.relevance,
        i.sourceReference,
        i.documentRef,
        i.notes,
        i.confidentiality,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert authority');
  }
  async findAuthority(tx: Tx, id: string): Promise<AuthorityRow | null> {
    const r = await tx.query<AuthorityRow>(`SELECT ${AUTHORITY_COLS} FROM legaldoc_authority WHERE id=$1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }
  async updateAuthority(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      title: string | null;
      citation: string | null;
      jurisdiction: string | null;
      authorityLevel: string | null;
      status: string | null;
      treatment: string | null;
      relevance: string | null;
      notes: string | null;
      by: string | null;
    },
  ): Promise<AuthorityRow | null> {
    const r = await tx.query<AuthorityRow>(
      `UPDATE legaldoc_authority SET title=COALESCE($3,title), citation=COALESCE($4,citation), jurisdiction=COALESCE($5,jurisdiction), authority_level=COALESCE($6,authority_level), status=COALESCE($7,status), treatment=COALESCE($8,treatment), relevance=COALESCE($9,relevance), notes=COALESCE($10,notes), updated_by=$11, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${AUTHORITY_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.title,
        i.citation,
        i.jurisdiction,
        i.authorityLevel,
        i.status,
        i.treatment,
        i.relevance,
        i.notes,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async insertAuthorityTreatment(
    tx: Tx,
    i: {
      tenantId: string;
      authorityId: string;
      treatment: string;
      byAuthorityRef: string | null;
      treatedBy: string | null;
      note: string | null;
      correlationId: string;
    },
  ): Promise<AuthorityTreatmentRow> {
    const r = await tx.query<AuthorityTreatmentRow>(
      `INSERT INTO legaldoc_authority_treatment (tenant_id, authority_id, treatment, by_authority_ref, treated_by, note, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${AUTHORITY_TREATMENT_COLS}`,
      [i.tenantId, i.authorityId, i.treatment, i.byAuthorityRef, i.treatedBy, i.note, i.correlationId],
    );
    return firstRow(r.rows, 'insert authority treatment');
  }
  async listAuthorities(
    tx: Tx,
    f: { authorityType?: string; jurisdiction?: string },
  ): Promise<AuthorityRow[]> {
    const r = await tx.query<AuthorityRow>(
      `SELECT ${AUTHORITY_COLS} FROM legaldoc_authority WHERE ($1::text IS NULL OR authority_type=$1) AND ($2::text IS NULL OR jurisdiction=$2) ORDER BY created_at DESC`,
      [f.authorityType ?? null, f.jurisdiction ?? null],
    );
    return r.rows;
  }
  async listTreatments(tx: Tx, authorityId: string): Promise<AuthorityTreatmentRow[]> {
    const r = await tx.query<AuthorityTreatmentRow>(
      `SELECT ${AUTHORITY_TREATMENT_COLS} FROM legaldoc_authority_treatment WHERE authority_id=$1 ORDER BY created_at`,
      [authorityId],
    );
    return r.rows;
  }

  // --- precedents -------------------------------------------------------------------------------
  async insertPrecedent(
    tx: Tx,
    i: {
      tenantId: string;
      title: string;
      summary: string | null;
      court: string | null;
      decisionDate: string | null;
      holding: string | null;
      principle: string | null;
      jurisdiction: string | null;
      documentRef: string | null;
      relatedAuthority: string | null;
      confidentiality: string;
      by: string | null;
    },
  ): Promise<PrecedentRow> {
    const r = await tx.query<PrecedentRow>(
      `INSERT INTO legaldoc_precedent (tenant_id, title, summary, court, decision_date, holding, principle, jurisdiction, document_ref, related_authority, confidentiality, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING ${PRECEDENT_COLS}`,
      [
        i.tenantId,
        i.title,
        i.summary,
        i.court,
        i.decisionDate,
        i.holding,
        i.principle,
        i.jurisdiction,
        i.documentRef,
        i.relatedAuthority,
        i.confidentiality,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert precedent');
  }
  async findPrecedent(tx: Tx, id: string): Promise<PrecedentRow | null> {
    const r = await tx.query<PrecedentRow>(`SELECT ${PRECEDENT_COLS} FROM legaldoc_precedent WHERE id=$1`, [
      id,
    ]);
    return r.rows[0] ?? null;
  }
  async updatePrecedent(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      title: string | null;
      summary: string | null;
      holding: string | null;
      principle: string | null;
      status: string | null;
      by: string | null;
    },
  ): Promise<PrecedentRow | null> {
    const r = await tx.query<PrecedentRow>(
      `UPDATE legaldoc_precedent SET title=COALESCE($3,title), summary=COALESCE($4,summary), holding=COALESCE($5,holding), principle=COALESCE($6,principle), status=COALESCE($7,status), updated_by=$8, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${PRECEDENT_COLS}`,
      [i.id, i.expectedVersion, i.title, i.summary, i.holding, i.principle, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listPrecedents(tx: Tx, jurisdiction?: string): Promise<PrecedentRow[]> {
    const r = await tx.query<PrecedentRow>(
      `SELECT ${PRECEDENT_COLS} FROM legaldoc_precedent WHERE ($1::text IS NULL OR jurisdiction=$1) ORDER BY created_at DESC`,
      [jurisdiction ?? null],
    );
    return r.rows;
  }

  // --- opinions (maker-checker approve) ---------------------------------------------------------
  async insertOpinion(
    tx: Tx,
    i: {
      tenantId: string;
      title: string;
      question: string | null;
      conclusion: string | null;
      riskRating: string | null;
      recommendation: string | null;
      jurisdiction: string | null;
      author: string | null;
      documentRef: string | null;
      relatedMatter: string | null;
      confidentiality: string;
      privilegeLevel: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<OpinionRow> {
    const r = await tx.query<OpinionRow>(
      `INSERT INTO legaldoc_opinion (tenant_id, title, question, conclusion, risk_rating, recommendation, jurisdiction, author, document_ref, related_matter, confidentiality, privilege_level, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING ${OPINION_COLS}`,
      [
        i.tenantId,
        i.title,
        i.question,
        i.conclusion,
        i.riskRating,
        i.recommendation,
        i.jurisdiction,
        i.author,
        i.documentRef,
        i.relatedMatter,
        i.confidentiality,
        i.privilegeLevel,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert opinion');
  }
  async findOpinion(tx: Tx, id: string): Promise<OpinionRow | null> {
    const r = await tx.query<OpinionRow>(`SELECT ${OPINION_COLS} FROM legaldoc_opinion WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  /** Single-winner maker-checker approval: CAS on approval_status='draft' AND version=$expected (approver <> author). */
  async approveOpinion(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      decision: 'approved' | 'rejected';
      approvedBy: string | null;
      by: string | null;
    },
  ): Promise<OpinionRow | null> {
    const r = await tx.query<OpinionRow>(
      `UPDATE legaldoc_opinion SET approval_status=$3, approved_by=$4, approved_at=now(), updated_by=$5, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND approval_status='draft' RETURNING ${OPINION_COLS}`,
      [i.id, i.expectedVersion, i.decision, i.approvedBy, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listOpinions(tx: Tx, relatedMatter?: string): Promise<OpinionRow[]> {
    const r = await tx.query<OpinionRow>(
      `SELECT ${OPINION_COLS} FROM legaldoc_opinion WHERE ($1::uuid IS NULL OR related_matter=$1) ORDER BY created_at DESC`,
      [relatedMatter ?? null],
    );
    return r.rows;
  }

  // --- research ---------------------------------------------------------------------------------
  async insertResearch(
    tx: Tx,
    i: {
      tenantId: string;
      title: string;
      question: string | null;
      findings: string | null;
      author: string | null;
      jurisdiction: string | null;
      practiceArea: string | null;
      documentRef: string | null;
      confidentiality: string;
      by: string | null;
    },
  ): Promise<ResearchRow> {
    const r = await tx.query<ResearchRow>(
      `INSERT INTO legaldoc_research (tenant_id, title, question, findings, author, jurisdiction, practice_area, document_ref, confidentiality, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING ${RESEARCH_COLS}`,
      [
        i.tenantId,
        i.title,
        i.question,
        i.findings,
        i.author,
        i.jurisdiction,
        i.practiceArea,
        i.documentRef,
        i.confidentiality,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert research');
  }
  async findResearch(tx: Tx, id: string): Promise<ResearchRow | null> {
    const r = await tx.query<ResearchRow>(`SELECT ${RESEARCH_COLS} FROM legaldoc_research WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async updateResearch(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      title: string | null;
      question: string | null;
      findings: string | null;
      status: string | null;
      by: string | null;
    },
  ): Promise<ResearchRow | null> {
    const r = await tx.query<ResearchRow>(
      `UPDATE legaldoc_research SET title=COALESCE($3,title), question=COALESCE($4,question), findings=COALESCE($5,findings), status=COALESCE($6,status), updated_by=$7, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 RETURNING ${RESEARCH_COLS}`,
      [i.id, i.expectedVersion, i.title, i.question, i.findings, i.status, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listResearch(tx: Tx, practiceArea?: string): Promise<ResearchRow[]> {
    const r = await tx.query<ResearchRow>(
      `SELECT ${RESEARCH_COLS} FROM legaldoc_research WHERE ($1::text IS NULL OR practice_area=$1) ORDER BY created_at DESC`,
      [practiceArea ?? null],
    );
    return r.rows;
  }

  // --- templates (publishable; immutable after publish) -----------------------------------------
  async insertTemplate(
    tx: Tx,
    i: {
      tenantId: string;
      templateCode: string;
      versionNumber: number;
      category: string | null;
      title: string;
      description: string | null;
      jurisdiction: string | null;
      practiceArea: string | null;
      contentRef: string | null;
      guidance: string | null;
      status: string;
      contentHash: string | null;
      submittedBy: string | null;
      approvedBy: string | null;
      supersedesId: string | null;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<TemplateRow> {
    const r = await tx.query<TemplateRow>(
      `INSERT INTO legaldoc_template (tenant_id, template_code, version_number, category, title, description, jurisdiction, practice_area, content_ref, guidance, status, content_hash, submitted_by, submitted_at, approved_by, approved_at, published_at, supersedes_id, confidentiality, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, CASE WHEN $13::uuid IS NOT NULL THEN now() ELSE NULL END, $14, CASE WHEN $14::uuid IS NOT NULL THEN now() ELSE NULL END, CASE WHEN $11='published' THEN now() ELSE NULL END, $15,$16,$17,$18,$18) RETURNING ${TEMPLATE_COLS}`,
      [
        i.tenantId,
        i.templateCode,
        i.versionNumber,
        i.category,
        i.title,
        i.description,
        i.jurisdiction,
        i.practiceArea,
        i.contentRef,
        i.guidance,
        i.status,
        i.contentHash,
        i.submittedBy,
        i.approvedBy,
        i.supersedesId,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert template');
  }
  async findTemplate(tx: Tx, id: string): Promise<TemplateRow | null> {
    const r = await tx.query<TemplateRow>(`SELECT ${TEMPLATE_COLS} FROM legaldoc_template WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async transitionTemplate(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      submittedBy?: string | null;
      approvedBy?: string | null;
      contentHash?: string | null;
      supersededById?: string | null;
      by: string | null;
    },
  ): Promise<TemplateRow | null> {
    const r = await tx.query<TemplateRow>(
      `UPDATE legaldoc_template SET
         status=$3,
         submitted_by=COALESCE($4,submitted_by), submitted_at=CASE WHEN $4::uuid IS NOT NULL THEN now() ELSE submitted_at END,
         approved_by=COALESCE($5,approved_by), approved_at=CASE WHEN $5::uuid IS NOT NULL THEN now() ELSE approved_at END,
         content_hash=COALESCE($6,content_hash), published_at=CASE WHEN $3='published' THEN now() ELSE published_at END,
         superseded_by_id=COALESCE($7,superseded_by_id),
         updated_by=$8, updated_at=now(), version=version+1
       WHERE id=$1 AND version=$2 RETURNING ${TEMPLATE_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.toStatus,
        i.submittedBy ?? null,
        i.approvedBy ?? null,
        i.contentHash ?? null,
        i.supersededById ?? null,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async listTemplates(tx: Tx, category?: string): Promise<TemplateRow[]> {
    const r = await tx.query<TemplateRow>(
      `SELECT ${TEMPLATE_COLS} FROM legaldoc_template WHERE ($1::text IS NULL OR category=$1) ORDER BY created_at DESC`,
      [category ?? null],
    );
    return r.rows;
  }

  // --- clauses (publishable; immutable after publish) -------------------------------------------
  async insertClause(
    tx: Tx,
    i: {
      tenantId: string;
      clauseCode: string;
      versionNumber: number;
      clauseKind: string;
      title: string;
      category: string | null;
      jurisdiction: string | null;
      practiceArea: string | null;
      guidance: string | null;
      contentRef: string | null;
      status: string;
      contentHash: string | null;
      submittedBy: string | null;
      approvedBy: string | null;
      supersedesId: string | null;
      confidentiality: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ClauseRow> {
    const r = await tx.query<ClauseRow>(
      `INSERT INTO legaldoc_clause (tenant_id, clause_code, version_number, clause_kind, title, category, jurisdiction, practice_area, guidance, content_ref, status, content_hash, submitted_by, submitted_at, approved_by, approved_at, published_at, supersedes_id, confidentiality, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, CASE WHEN $13::uuid IS NOT NULL THEN now() ELSE NULL END, $14, CASE WHEN $14::uuid IS NOT NULL THEN now() ELSE NULL END, CASE WHEN $11='published' THEN now() ELSE NULL END, $15,$16,$17,$18,$18) RETURNING ${CLAUSE_COLS}`,
      [
        i.tenantId,
        i.clauseCode,
        i.versionNumber,
        i.clauseKind,
        i.title,
        i.category,
        i.jurisdiction,
        i.practiceArea,
        i.guidance,
        i.contentRef,
        i.status,
        i.contentHash,
        i.submittedBy,
        i.approvedBy,
        i.supersedesId,
        i.confidentiality,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert clause');
  }
  async findClause(tx: Tx, id: string): Promise<ClauseRow | null> {
    const r = await tx.query<ClauseRow>(`SELECT ${CLAUSE_COLS} FROM legaldoc_clause WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async transitionClause(
    tx: Tx,
    i: {
      id: string;
      expectedVersion: number;
      toStatus: string;
      submittedBy?: string | null;
      approvedBy?: string | null;
      contentHash?: string | null;
      supersededById?: string | null;
      by: string | null;
    },
  ): Promise<ClauseRow | null> {
    const r = await tx.query<ClauseRow>(
      `UPDATE legaldoc_clause SET
         status=$3,
         submitted_by=COALESCE($4,submitted_by), submitted_at=CASE WHEN $4::uuid IS NOT NULL THEN now() ELSE submitted_at END,
         approved_by=COALESCE($5,approved_by), approved_at=CASE WHEN $5::uuid IS NOT NULL THEN now() ELSE approved_at END,
         content_hash=COALESCE($6,content_hash), published_at=CASE WHEN $3='published' THEN now() ELSE published_at END,
         superseded_by_id=COALESCE($7,superseded_by_id),
         updated_by=$8, updated_at=now(), version=version+1
       WHERE id=$1 AND version=$2 RETURNING ${CLAUSE_COLS}`,
      [
        i.id,
        i.expectedVersion,
        i.toStatus,
        i.submittedBy ?? null,
        i.approvedBy ?? null,
        i.contentHash ?? null,
        i.supersededById ?? null,
        i.by,
      ],
    );
    return r.rows[0] ?? null;
  }
  async listClauses(tx: Tx, f: { clauseKind?: string; category?: string }): Promise<ClauseRow[]> {
    const r = await tx.query<ClauseRow>(
      `SELECT ${CLAUSE_COLS} FROM legaldoc_clause WHERE ($1::text IS NULL OR clause_kind=$1) AND ($2::text IS NULL OR category=$2) ORDER BY created_at DESC`,
      [f.clauseKind ?? null, f.category ?? null],
    );
    return r.rows;
  }
  async insertClauseRelation(
    tx: Tx,
    i: {
      tenantId: string;
      fromId: string;
      toId: string;
      kind: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ClauseRelationRow> {
    const r = await tx.query<ClauseRelationRow>(
      `INSERT INTO legaldoc_clause_relation (tenant_id, from_clause_id, to_clause_id, kind, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${CLAUSE_RELATION_COLS}`,
      [i.tenantId, i.fromId, i.toId, i.kind, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert clause relation');
  }
  async findActiveClauseRelation(
    tx: Tx,
    fromId: string,
    toId: string,
    kind: string,
  ): Promise<ClauseRelationRow | null> {
    const r = await tx.query<ClauseRelationRow>(
      `SELECT ${CLAUSE_RELATION_COLS} FROM legaldoc_clause_relation WHERE from_clause_id=$1 AND to_clause_id=$2 AND kind=$3 AND status='active'`,
      [fromId, toId, kind],
    );
    return r.rows[0] ?? null;
  }
  async listClauseRelations(tx: Tx, clauseId: string): Promise<ClauseRelationRow[]> {
    const r = await tx.query<ClauseRelationRow>(
      `SELECT ${CLAUSE_RELATION_COLS} FROM legaldoc_clause_relation WHERE (from_clause_id=$1 OR to_clause_id=$1) AND status='active' ORDER BY created_at`,
      [clauseId],
    );
    return r.rows;
  }

  // --- references (OPAQUE cross-module ids) ------------------------------------------------------
  async insertReference(
    tx: Tx,
    i: {
      tenantId: string;
      knowledgeId: string;
      refType: string;
      targetId: string;
      label: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ReferenceRow> {
    const r = await tx.query<ReferenceRow>(
      `INSERT INTO legaldoc_reference (tenant_id, knowledge_id, ref_type, target_id, label, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${REFERENCE_COLS}`,
      [i.tenantId, i.knowledgeId, i.refType, i.targetId, i.label, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert reference');
  }
  async listReferences(tx: Tx, knowledgeId: string): Promise<ReferenceRow[]> {
    const r = await tx.query<ReferenceRow>(
      `SELECT ${REFERENCE_COLS} FROM legaldoc_reference WHERE knowledge_id=$1 AND status='active' ORDER BY created_at`,
      [knowledgeId],
    );
    return r.rows;
  }

  // --- knowledge relationships ------------------------------------------------------------------
  async insertRelationship(
    tx: Tx,
    i: {
      tenantId: string;
      fromId: string;
      toId: string;
      kind: string;
      correlationId: string;
      by: string | null;
    },
  ): Promise<RelationshipRow> {
    const r = await tx.query<RelationshipRow>(
      `INSERT INTO legaldoc_relationship (tenant_id, from_knowledge_id, to_knowledge_id, kind, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${RELATIONSHIP_COLS}`,
      [i.tenantId, i.fromId, i.toId, i.kind, i.correlationId, i.by],
    );
    return firstRow(r.rows, 'insert relationship');
  }
  async findActiveRelationship(
    tx: Tx,
    fromId: string,
    toId: string,
    kind: string,
  ): Promise<RelationshipRow | null> {
    const r = await tx.query<RelationshipRow>(
      `SELECT ${RELATIONSHIP_COLS} FROM legaldoc_relationship WHERE from_knowledge_id=$1 AND to_knowledge_id=$2 AND kind=$3 AND status='active'`,
      [fromId, toId, kind],
    );
    return r.rows[0] ?? null;
  }
  async retireRelationship(
    tx: Tx,
    i: { id: string; expectedVersion: number; by: string | null },
  ): Promise<RelationshipRow | null> {
    const r = await tx.query<RelationshipRow>(
      `UPDATE legaldoc_relationship SET status='retired', version=version+1 WHERE id=$1 AND version=$2 AND status='active' RETURNING ${RELATIONSHIP_COLS}`,
      [i.id, i.expectedVersion, i.by],
    );
    return r.rows[0] ?? null;
  }
  async listRelationships(tx: Tx, knowledgeId: string): Promise<RelationshipRow[]> {
    const r = await tx.query<RelationshipRow>(
      `SELECT ${RELATIONSHIP_COLS} FROM legaldoc_relationship WHERE (from_knowledge_id=$1 OR to_knowledge_id=$1) AND status='active' ORDER BY created_at`,
      [knowledgeId],
    );
    return r.rows;
  }

  // --- reviews / expiry deadlines (deterministic) -----------------------------------------------
  async insertReview(
    tx: Tx,
    i: {
      tenantId: string;
      knowledgeId: string;
      reviewType: string;
      startAt: string | null;
      dueAt: string;
      rule: unknown;
      warnWindowMs: number | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<ReviewRow> {
    const r = await tx.query<ReviewRow>(
      `INSERT INTO legaldoc_review (tenant_id, knowledge_id, review_type, start_at, due_at, rule, warn_window_ms, correlation_id, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$9) RETURNING ${REVIEW_COLS}`,
      [
        i.tenantId,
        i.knowledgeId,
        i.reviewType,
        i.startAt,
        i.dueAt,
        JSON.stringify(i.rule ?? {}),
        i.warnWindowMs,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert review');
  }
  async findReview(tx: Tx, id: string): Promise<ReviewRow | null> {
    const r = await tx.query<ReviewRow>(`SELECT ${REVIEW_COLS} FROM legaldoc_review WHERE id=$1`, [id]);
    return r.rows[0] ?? null;
  }
  async completeReview(
    tx: Tx,
    i: { id: string; expectedVersion: number; outcome: string | null; by: string | null },
  ): Promise<ReviewRow | null> {
    const r = await tx.query<ReviewRow>(
      `UPDATE legaldoc_review SET status='completed', completed_at=now(), completed_by=$3, outcome=COALESCE($4,outcome), updated_by=$3, updated_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND status IN ('open','overdue') RETURNING ${REVIEW_COLS}`,
      [i.id, i.expectedVersion, i.by, i.outcome],
    );
    return r.rows[0] ?? null;
  }
  async listReviews(tx: Tx, knowledgeId: string): Promise<ReviewRow[]> {
    const r = await tx.query<ReviewRow>(
      `SELECT ${REVIEW_COLS} FROM legaldoc_review WHERE knowledge_id=$1 ORDER BY due_at`,
      [knowledgeId],
    );
    return r.rows;
  }

  // --- tags -------------------------------------------------------------------------------------
  async insertTag(
    tx: Tx,
    i: {
      tenantId: string;
      knowledgeId: string;
      taxonomyKind: string;
      taxonomyCode: string;
      label: string | null;
      by: string | null;
    },
  ): Promise<TagRow> {
    const r = await tx.query<TagRow>(
      `INSERT INTO legaldoc_tag (tenant_id, knowledge_id, taxonomy_kind, taxonomy_code, label, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${TAG_COLS}`,
      [i.tenantId, i.knowledgeId, i.taxonomyKind, i.taxonomyCode, i.label, i.by],
    );
    return firstRow(r.rows, 'insert tag');
  }
  async findTag(
    tx: Tx,
    knowledgeId: string,
    taxonomyKind: string,
    taxonomyCode: string,
  ): Promise<TagRow | null> {
    const r = await tx.query<TagRow>(
      `SELECT ${TAG_COLS} FROM legaldoc_tag WHERE knowledge_id=$1 AND taxonomy_kind=$2 AND taxonomy_code=$3 AND active`,
      [knowledgeId, taxonomyKind, taxonomyCode],
    );
    return r.rows[0] ?? null;
  }
  /**
   * Removes a tag assignment by SOFT delete (active=false) — 0002 grants no DELETE anywhere (ADR-010). The partial
   * unique index `legaldoc_tag_key ... WHERE active` frees the (kind,code) slot, so the same tag can be re-added.
   */
  async deleteTag(tx: Tx, knowledgeId: string, taxonomyKind: string, taxonomyCode: string): Promise<boolean> {
    const r = await tx.query<{ id: string }>(
      `UPDATE legaldoc_tag SET active=false WHERE knowledge_id=$1 AND taxonomy_kind=$2 AND taxonomy_code=$3 AND active RETURNING id`,
      [knowledgeId, taxonomyKind, taxonomyCode],
    );
    return r.rows[0] !== undefined;
  }
  async listTags(tx: Tx, knowledgeId: string): Promise<TagRow[]> {
    const r = await tx.query<TagRow>(
      `SELECT ${TAG_COLS} FROM legaldoc_tag WHERE knowledge_id=$1 AND active ORDER BY taxonomy_kind, taxonomy_code`,
      [knowledgeId],
    );
    return r.rows;
  }

  // --- citations --------------------------------------------------------------------------------
  async insertCitation(
    tx: Tx,
    i: {
      tenantId: string;
      knowledgeId: string;
      authorityRef: string | null;
      externalCitation: string | null;
      pinpoint: string | null;
      note: string | null;
      correlationId: string;
      by: string | null;
    },
  ): Promise<CitationRow> {
    const r = await tx.query<CitationRow>(
      `INSERT INTO legaldoc_citation (tenant_id, knowledge_id, authority_ref, external_citation, pinpoint, note, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${CITATION_COLS}`,
      [
        i.tenantId,
        i.knowledgeId,
        i.authorityRef,
        i.externalCitation,
        i.pinpoint,
        i.note,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert citation');
  }
  async listCitations(tx: Tx, knowledgeId: string): Promise<CitationRow[]> {
    const r = await tx.query<CitationRow>(
      `SELECT ${CITATION_COLS} FROM legaldoc_citation WHERE knowledge_id=$1 ORDER BY created_at`,
      [knowledgeId],
    );
    return r.rows;
  }

  // --- notes (append-only; privileged content redacted by the service) --------------------------
  async insertNote(
    tx: Tx,
    i: {
      tenantId: string;
      knowledgeId: string;
      noteType: string;
      headline: string | null;
      content: string;
      confidentiality: string;
      privileged: boolean;
      correlationId: string;
      by: string | null;
    },
  ): Promise<NoteRow> {
    const r = await tx.query<NoteRow>(
      `INSERT INTO legaldoc_note (tenant_id, knowledge_id, note_type, headline, content, confidentiality, privileged, correlation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${NOTE_COLS}`,
      [
        i.tenantId,
        i.knowledgeId,
        i.noteType,
        i.headline,
        i.content,
        i.confidentiality,
        i.privileged,
        i.correlationId,
        i.by,
      ],
    );
    return firstRow(r.rows, 'insert note');
  }
  async listNotes(tx: Tx, knowledgeId: string): Promise<NoteRow[]> {
    const r = await tx.query<NoteRow>(
      `SELECT ${NOTE_COLS} FROM legaldoc_note WHERE knowledge_id=$1 ORDER BY created_at`,
      [knowledgeId],
    );
    return r.rows;
  }

  // --- usage (append-only analytics; safe dimensions only) --------------------------------------
  async insertUsage(
    tx: Tx,
    i: {
      tenantId: string;
      knowledgeId: string;
      usageType: string;
      actorRef: string | null;
      contextRef: string | null;
      note: string | null;
      correlationId: string;
    },
  ): Promise<UsageRow> {
    const r = await tx.query<UsageRow>(
      `INSERT INTO legaldoc_usage (tenant_id, knowledge_id, usage_type, actor_ref, context_ref, note, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${USAGE_COLS}`,
      [i.tenantId, i.knowledgeId, i.usageType, i.actorRef, i.contextRef, i.note, i.correlationId],
    );
    return firstRow(r.rows, 'insert usage');
  }
  async listUsage(tx: Tx, knowledgeId: string): Promise<UsageRow[]> {
    const r = await tx.query<UsageRow>(
      `SELECT ${USAGE_COLS} FROM legaldoc_usage WHERE knowledge_id=$1 ORDER BY created_at`,
      [knowledgeId],
    );
    return r.rows;
  }
  async listApprovalHistory(tx: Tx, entityType: string, entityId: string): Promise<ApprovalHistoryRow[]> {
    const r = await tx.query<ApprovalHistoryRow>(
      `SELECT ${APPROVAL_HISTORY_COLS} FROM legaldoc_approval_history WHERE entity_type=$1 AND entity_id=$2 ORDER BY created_at`,
      [entityType, entityId],
    );
    return r.rows;
  }
  async countActive(tx: Tx, table: string, whereCol: string, whereVal: string): Promise<number> {
    const r = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM ${table} WHERE ${whereCol}=$1 AND status='active'`,
      [whereVal],
    );
    return count(r.rows);
  }
}
