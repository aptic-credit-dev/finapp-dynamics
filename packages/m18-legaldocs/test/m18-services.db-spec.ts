import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import { LEGALDOCS_LIFECYCLE_FAMILY } from '@finapp/contracts';
import {
  M18Emitter,
  LegalDocsRepository,
  CatalogService,
  KnowledgeService,
  LibraryService,
  FixedClock,
  redactKnowledge,
  M18_AUDIT_CODES,
  M18_PERMISSIONS,
  ALL_M18_PERMISSIONS,
} from '@finapp/m18-legaldocs';

/**
 * M18 services DB spec — proves the enterprise legal-documents & knowledge engine END TO END on a REAL PostgreSQL
 * and enforces governance: the configurable taxonomy (create/retire); legal authorities + append-only treatment
 * history; precedents; legal opinions with maker-checker approval (approver <> author); research; the core
 * PUBLISHABLE knowledge record through the single choke point (draft -> submit -> approve[maker-checker] -> publish
 * [content_hash frozen, one-published] -> supersede[version_number+1, prior superseded, prior content unchanged] ->
 * withdraw/archive/reopen), with every illegal transition rejected; opaque cross-module references (document +
 * reference), knowledge-to-knowledge relationships (self rejected), tags (add/remove/re-add), citations, notes
 * (restricted note requires privileged-create), review/expiry deadlines with a deterministic FixedClock, and usage;
 * the drafting library (templates + clauses: versioned, maker-checker, immutable-after-publish, superseded);
 * fail-closed redaction (abstract nulled without confidential.read; restricted note bodies withheld without
 * privileged.read; privileged reads audited); NO privileged text in any audit/event payload; and cross-tenant
 * isolation via RLS. Audit + `legaldocs.lifecycle` events are asserted through the same recording test doubles m17
 * uses.
 */
export default defineDbSpec('m18-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const emitter = new M18Emitter(audit, outbox);
  const repo = new LegalDocsRepository();
  const clock = new FixedClock(1_700_000_000_000);
  const catalog = new CatalogService(db, authz, emitter, repo);
  const knowledge = new KnowledgeService(db, authz, emitter, repo, clock);
  const library = new LibraryService(db, authz, emitter, repo);

  const tenant = randomUUID();
  const author = randomUUID();
  const approver = randomUUID();
  const cid = (): string => randomUUID();
  const mk = (userId: string, permissions: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId,
    correlationId: cid(),
    permissions: [...permissions],
  });
  const full = mk(author, ALL_M18_PERMISSIONS);
  const approverCtx = mk(approver, ALL_M18_PERMISSIONS);
  const noPerm = mk(author, []);
  const noConf = mk(
    author,
    ALL_M18_PERMISSIONS.filter((p) => p !== M18_PERMISSIONS.confidentialRead),
  );
  const noPriv = mk(
    author,
    ALL_M18_PERMISSIONS.filter((p) => p !== M18_PERMISSIONS.privilegedRead),
  );
  const noPrivCreate = mk(
    author,
    ALL_M18_PERMISSIONS.filter((p) => p !== M18_PERMISSIONS.privilegedCreate),
  );

  // Sensitive text that must NEVER reach an audit/event payload (ADR-076).
  const SECRET_ABSTRACT = `ABSTRACT-ANALYSIS-${randomUUID()}`;
  const SECRET_OPINION_CONCLUSION = `OPINION-CONCLUSION-${randomUUID()}`;
  const SECRET_OPINION_RECOMMENDATION = `OPINION-RECOMMENDATION-${randomUUID()}`;
  const SECRET_NOTE_BODY = `NOTE-BODY-${randomUUID()}`;
  const SECRET_CLAUSE_GUIDANCE = `CLAUSE-GUIDANCE-${randomUUID()}`;
  const SECRET_TEMPLATE_GUIDANCE = `TEMPLATE-GUIDANCE-${randomUUID()}`;
  const SECRET_PRECEDENT_HOLDING = `PRECEDENT-HOLDING-${randomUUID()}`;
  const SECRET_RESEARCH_FINDINGS = `RESEARCH-FINDINGS-${randomUUID()}`;

  // --- taxonomy (configurable classification; active/retired) -----------------------------------
  await t.rejects(
    catalog.createTaxonomy(noPerm, author, { kind: 'practice_area', code: 'x', label: 'X' }),
    'authoring taxonomy needs the manage permission (default deny)',
  );
  await t.rejects(
    catalog.createTaxonomy(full, author, { kind: 'not_a_kind', code: 'y', label: 'Y' }),
    'an unknown taxonomy kind is rejected',
  );
  const tax = await catalog.createTaxonomy(full, author, {
    kind: 'practice_area',
    code: 'litigation',
    label: 'Litigation',
  });
  t.equal(tax.active, true, 'a new taxonomy entry is active');
  const taxRetired = await catalog.retireTaxonomy(full, author, tax.id, tax.version);
  t.equal(taxRetired.active, false, 'a taxonomy entry retires by the active flag (no delete)');
  await t.rejects(
    catalog.retireTaxonomy(full, author, tax.id, taxRetired.version),
    'a taxonomy entry cannot be retired twice',
  );

  // --- authorities + append-only treatments -----------------------------------------------------
  const authRow = await catalog.registerAuthority(full, author, {
    authorityType: 'case_law',
    title: 'Foo v Bar',
    jurisdiction: 'KE',
    authorityLevel: 'binding',
  });
  await catalog.recordTreatment(full, author, authRow.id, { treatment: 'followed', note: 'on point' });
  await catalog.recordTreatment(full, author, authRow.id, { treatment: 'distinguished' });
  const treatments = await catalog.listTreatments(full, authRow.id);
  t.equal(treatments.length, 2, 'authority treatments are append-only and accumulate');
  await t.rejects(
    catalog.recordTreatment(full, author, authRow.id, { treatment: 'not_a_treatment' }),
    'an invalid treatment is rejected',
  );

  // --- precedent (holding is SENSITIVE) ---------------------------------------------------------
  const prec = await catalog.registerPrecedent(full, author, {
    title: 'Landmark Case',
    holding: SECRET_PRECEDENT_HOLDING,
    jurisdiction: 'KE',
  });
  t.ok(prec.id !== '', 'a precedent is registered');

  // --- opinion (PRIVILEGED; maker-checker approval) ---------------------------------------------
  const op = await catalog.registerOpinion(full, author, {
    title: 'Enforceability Opinion',
    question: 'Is the charge enforceable?',
    conclusion: SECRET_OPINION_CONCLUSION,
    recommendation: SECRET_OPINION_RECOMMENDATION,
    riskRating: 'high',
  });
  t.equal(op.author, author, 'the opinion author defaults to the acting identity');
  await t.rejects(
    catalog.approveOpinion(full, author, op.id, { expectedVersion: op.version }),
    'the opinion author cannot approve it (maker-checker / SoD)',
  );
  const opApproved = await catalog.approveOpinion(approverCtx, approver, op.id, {
    expectedVersion: op.version,
  });
  t.equal(opApproved.approval_status, 'approved', 'an independent approver approves the opinion');

  // --- research (findings are SENSITIVE) --------------------------------------------------------
  const research = await catalog.registerResearch(full, author, {
    title: 'AML Research',
    findings: SECRET_RESEARCH_FINDINGS,
    practiceArea: 'banking',
  });
  const researchU = await catalog.updateResearch(full, author, research.id, {
    expectedVersion: research.version,
    status: 'final',
  });
  t.equal(researchU.status, 'final', 'a research note updates under optimistic concurrency');

  // --- knowledge record: create (+ idempotency) -------------------------------------------------
  await t.rejects(
    knowledge.create(noPerm, author, { knowledgeType: 'legal_memo', title: 'nope' }),
    'creating a knowledge record requires the create permission',
  );
  const kn = await knowledge.create(full, author, {
    knowledgeType: 'legal_memo',
    title: 'Charge Enforcement Memo',
    summary: 'Public summary',
    abstract: SECRET_ABSTRACT,
    confidentiality: 'confidential',
    privileged: true,
    practiceArea: 'banking',
    jurisdiction: 'KE',
    idempotencyKey: 'kn-1',
  });
  t.ok(kn.knowledge_number.startsWith('KNOW-'), 'a human-readable knowledge number is generated');
  const knDup = await knowledge.create(full, author, {
    knowledgeType: 'legal_memo',
    title: 'Charge Enforcement Memo',
    idempotencyKey: 'kn-1',
  });
  t.equal(knDup.id, kn.id, 'creating with the same idempotency key returns the same record');
  const knU = await knowledge.update(full, author, kn.id, {
    expectedVersion: kn.version,
    summary: 'Public summary (edited)',
  });
  t.equal(knU.version, kn.version + 1, 'a draft edit bumps the optimistic-lock version');
  await t.rejects(
    knowledge.update(full, author, kn.id, { expectedVersion: kn.version, summary: 'stale write' }),
    'a stale expectedVersion is rejected (optimistic concurrency / single-winner CAS)',
  );

  // --- references (opaque cross-module ids; DOCUMENT + REFERENCE) --------------------------------
  const docRef = await knowledge.addReference(full, author, kn.id, {
    refType: 'document',
    targetId: randomUUID(),
    label: 'source brief',
  });
  t.equal(docRef.ref_type, 'document', 'a document reference is linked (opaque m09 id)');
  const litRef = await knowledge.addReference(full, author, kn.id, {
    refType: 'litigation',
    targetId: randomUUID(),
  });
  t.equal(litRef.ref_type, 'litigation', 'an opaque m16 litigation reference is linked');
  const matterRef = await knowledge.addReference(full, author, kn.id, {
    refType: 'matter',
    targetId: randomUUID(),
  });
  t.equal(matterRef.ref_type, 'matter', 'an opaque m14 matter reference is linked');
  const recoveryRef = await knowledge.addReference(full, author, kn.id, {
    refType: 'recovery',
    targetId: randomUUID(),
  });
  t.equal(recoveryRef.ref_type, 'recovery', 'an opaque m17 recovery reference is linked');
  const refs = await knowledge.listReferences(full, kn.id);
  t.ok(
    ['document', 'litigation', 'matter', 'recovery'].every((rt) => refs.some((r) => r.ref_type === rt)),
    'all four cross-module reference kinds (m09/m14/m16/m17) are stored as opaque ids',
  );
  await t.rejects(
    knowledge.addReference(full, author, kn.id, { refType: 'bogus', targetId: randomUUID() }),
    'an invalid reference type is rejected',
  );

  // --- relationships (knowledge <-> knowledge; self rejected) -----------------------------------
  const kn2 = await knowledge.create(full, author, { knowledgeType: 'guidance', title: 'Related Guidance' });
  const rel = await knowledge.relate(full, author, {
    fromKnowledgeId: kn.id,
    toKnowledgeId: kn2.id,
    kind: 'related_to',
  });
  t.equal(rel.kind, 'related_to', 'two knowledge records can be related');
  await t.rejects(
    knowledge.relate(full, author, { fromKnowledgeId: kn.id, toKnowledgeId: kn.id, kind: 'related_to' }),
    'a knowledge record cannot relate to itself',
  );

  // --- tags (add / remove [soft-delete] / re-add) -----------------------------------------------
  await knowledge.addTag(full, author, kn.id, { taxonomyKind: 'legal_topic', taxonomyCode: 'aml' });
  await knowledge.removeTag(full, author, kn.id, { taxonomyKind: 'legal_topic', taxonomyCode: 'aml' });
  const readded = await knowledge.addTag(full, author, kn.id, {
    taxonomyKind: 'legal_topic',
    taxonomyCode: 'aml',
  });
  t.ok(readded.active, 'a soft-deleted tag can be re-added (partial unique index frees the slot)');
  const tags = await knowledge.listTags(full, kn.id);
  t.equal(tags.filter((x) => x.active).length, 1, 'exactly one active tag remains after re-add');

  // --- citations --------------------------------------------------------------------------------
  const citation = await knowledge.addCitation(full, author, kn.id, {
    authorityRef: authRow.id,
    pinpoint: 'para 5',
  });
  t.equal(citation.authority_ref, authRow.id, 'a citation to an authority is recorded');

  // --- notes (restricted note requires privileged-create) ---------------------------------------
  await knowledge.addNote(full, author, kn.id, { noteType: 'general', content: 'a general note' });
  await t.rejects(
    knowledge.addNote(noPrivCreate, author, kn.id, { noteType: 'privileged', content: SECRET_NOTE_BODY }),
    'a restricted note requires legaldocs.privileged.create',
  );
  const restrictedNote = await knowledge.addNote(full, author, kn.id, {
    noteType: 'privileged',
    content: SECRET_NOTE_BODY,
  });
  t.ok(restrictedNote.privileged, 'a restricted note is flagged privileged');

  // --- reviews / expiry deadlines (deterministic FixedClock) ------------------------------------
  const review = await knowledge.scheduleReview(full, author, kn.id, {
    reviewType: 'periodic_review',
    rule: { kind: 'offset_days', days: 30 },
  });
  const expectedDueMs = clock.now() + 30 * 86_400_000;
  t.equal(
    new Date(review.due_at).getTime(),
    expectedDueMs,
    'the review due instant is computed deterministically from the FixedClock',
  );
  const reviewDone = await knowledge.completeReview(full, author, review.id, {
    expectedVersion: review.version,
    outcome: 'still_current',
  });
  t.equal(reviewDone.status, 'completed', 'a scheduled review can be completed');

  // --- usage ------------------------------------------------------------------------------------
  await knowledge.recordUsage(full, kn.id, { usageType: 'cited', contextRef: 'matter-ref-1' });
  const usage = await knowledge.listUsage(full, kn.id);
  t.ok(usage.length >= 1, 'usage events are recorded (safe dimensions)');

  // --- REDACTION (fail-closed) ------------------------------------------------------------------
  const readConf = await knowledge.get(full, kn.id);
  t.equal(readConf.canReadConfidential, true, 'a caller with confidential.read is flagged');
  t.equal(readConf.knowledge.abstract, SECRET_ABSTRACT, 'a confidential reader sees the abstract');
  const readRed = await knowledge.get(noConf, kn.id);
  t.equal(readRed.canReadConfidential, false, 'a caller without confidential.read is flagged');
  t.equal(readRed.knowledge.abstract, null, 'the abstract is nulled without confidential.read');
  t.equal(redactKnowledge(kn, false).abstract, null, 'redactKnowledge nulls the abstract when not permitted');
  t.equal(
    redactKnowledge(kn, true).abstract,
    SECRET_ABSTRACT,
    'redactKnowledge keeps the abstract when permitted',
  );
  const notesPriv = await knowledge.listNotes(full, kn.id);
  t.equal(notesPriv.canReadPrivileged, true, 'a caller with privileged.read is flagged');
  t.ok(
    notesPriv.notes.some((n) => n.content === SECRET_NOTE_BODY),
    'a privileged reader sees the restricted note body',
  );
  const notesRed = await knowledge.listNotes(noPriv, kn.id);
  t.equal(notesRed.canReadPrivileged, false, 'a caller without privileged.read is flagged');
  t.ok(
    !notesRed.notes.some((n) => n.privileged),
    'restricted note bodies are withheld without privileged.read',
  );

  // --- classification change + assignment -------------------------------------------------------
  const knClass = await knowledge.changeClassification(full, author, kn.id, {
    expectedVersion: knU.version,
    confidentiality: 'restricted',
  });
  t.equal(knClass.confidentiality, 'restricted', 'the classification can be tightened');
  const knAssign = await knowledge.assign(full, author, kn.id, {
    expectedVersion: knClass.version,
    reviewer: approver,
  });

  // --- lifecycle: submit -> approve[maker-checker] -> publish[freeze] ----------------------------
  const knSub = await knowledge.submit(full, author, kn.id, knAssign.version);
  t.equal(knSub.status, 'under_review', 'submit advances draft -> under_review and stamps the submitter');
  await t.rejects(
    knowledge.publish(full, author, kn.id, knSub.version),
    'an under_review record cannot jump straight to published',
  );
  await t.rejects(
    knowledge.approve(full, author, kn.id, knSub.version),
    'the submitter cannot approve the record (maker-checker / SoD)',
  );
  const knApproved = await knowledge.approve(approverCtx, approver, kn.id, knSub.version);
  t.equal(knApproved.status, 'approved', 'an independent approver approves the record');
  const knPublished = await knowledge.publish(full, author, kn.id, knApproved.version);
  t.equal(knPublished.status, 'published', 'an approved record publishes');
  t.ok(knPublished.content_hash !== null, 'publishing freezes a content hash');
  t.ok(knPublished.publication_date !== null, 'publishing stamps a publication date');
  await t.rejects(
    knowledge.update(full, author, kn.id, { expectedVersion: knPublished.version, summary: 'illegal edit' }),
    'published content is immutable (supersede to create a new version)',
  );

  // --- supersession (maker-checker; version_number+1; prior content unchanged) ------------------
  await t.rejects(
    knowledge.supersede(full, author, kn.id, { expectedVersion: knPublished.version }),
    'the successor submitter cannot also approve the supersession (maker-checker)',
  );
  const sup = await knowledge.supersede(approverCtx, approver, kn.id, {
    expectedVersion: knPublished.version,
    title: 'Charge Enforcement Memo v2',
    abstract: 'a fresh abstract',
  });
  t.equal(sup.successor.version_number, kn.version_number + 1, 'supersession creates version_number + 1');
  t.equal(sup.successor.status, 'published', 'the successor becomes the new published head');
  t.equal(sup.prior.status, 'superseded', 'the prior version moves to superseded');
  t.equal(sup.prior.abstract, SECRET_ABSTRACT, 'the superseded prior content is unchanged');
  t.equal(sup.successor.title, 'Charge Enforcement Memo v2', 'the successor carries the new title');
  t.ok(sup.successor.content_hash !== null, 'the successor freezes its own content hash');

  // --- withdraw / archive / reopen (on a fresh record) ------------------------------------------
  const rec3 = await knowledge.create(full, author, {
    knowledgeType: 'checklist',
    title: 'Onboarding Checklist',
  });
  const withdrawn = await knowledge.withdraw(full, author, rec3.id, { expectedVersion: rec3.version });
  t.equal(withdrawn.status, 'withdrawn', 'a draft can be withdrawn');
  const reopened = await knowledge.reopen(full, author, rec3.id, {
    expectedVersion: withdrawn.version,
    reason: 'revisit',
  });
  t.equal(reopened.status, 'reopened', 'a withdrawn record can be reopened');
  await t.rejects(
    knowledge.archive(full, author, rec3.id, reopened.version),
    'a reopened record cannot be archived directly',
  );
  const rewithdrawn = await knowledge.withdraw(full, author, rec3.id, { expectedVersion: reopened.version });
  const archived = await knowledge.archive(full, author, rec3.id, rewithdrawn.version);
  t.equal(archived.status, 'archived', 'a withdrawn record can be archived');

  // --- library: templates (versioned; maker-checker; immutable-after-publish; supersede) --------
  const tmpl = await library.createTemplate(full, author, {
    templateCode: 'nda-template',
    title: 'NDA Template',
    guidance: SECRET_TEMPLATE_GUIDANCE,
    contentRef: randomUUID(),
  });
  const tmplSub = await library.submitTemplate(full, author, tmpl.id, tmpl.version);
  await t.rejects(
    library.approveTemplate(full, author, tmpl.id, tmplSub.version),
    'the template submitter cannot approve it (maker-checker)',
  );
  const tmplApp = await library.approveTemplate(approverCtx, approver, tmpl.id, tmplSub.version);
  const tmplPub = await library.publishTemplate(full, author, tmpl.id, tmplApp.version);
  t.equal(tmplPub.status, 'published', 'a template publishes');
  t.ok(tmplPub.content_hash !== null, 'a published template freezes a content hash');
  const tmplSup = await library.supersedeTemplate(approverCtx, approver, tmpl.id, {
    expectedVersion: tmplPub.version,
    title: 'NDA Template v2',
  });
  t.equal(tmplSup.successor.version_number, 2, 'a superseded template creates version_number 2');
  t.equal(tmplSup.prior.status, 'superseded', 'the prior template becomes superseded');
  await t.rejects(
    library.submitTemplate(full, author, tmpl.id, tmplSup.prior.version),
    'a superseded template cannot be resubmitted (immutable)',
  );

  // --- library: clauses (versioned; maker-checker; supersede; relation self rejected) -----------
  const clause = await library.createClause(full, author, {
    clauseCode: 'governing-law',
    title: 'Governing Law',
    clauseKind: 'approved',
    guidance: SECRET_CLAUSE_GUIDANCE,
    contentRef: randomUUID(),
  });
  const clauseSub = await library.submitClause(full, author, clause.id, clause.version);
  await t.rejects(
    library.approveClause(full, author, clause.id, clauseSub.version),
    'the clause submitter cannot approve it (maker-checker)',
  );
  const clauseApp = await library.approveClause(approverCtx, approver, clause.id, clauseSub.version);
  const clausePub = await library.publishClause(full, author, clause.id, clauseApp.version);
  t.ok(clausePub.content_hash !== null, 'a published clause freezes a content hash');
  const clause2 = await library.createClause(full, author, {
    clauseCode: 'jurisdiction',
    title: 'Jurisdiction',
    contentRef: randomUUID(),
  });
  const clauseRel = await library.addClauseRelation(full, author, {
    fromClauseId: clause.id,
    toClauseId: clause2.id,
    kind: 'depends_on',
  });
  t.equal(clauseRel.kind, 'depends_on', 'a clause dependency relation is recorded');
  await t.rejects(
    library.addClauseRelation(full, author, {
      fromClauseId: clause.id,
      toClauseId: clause.id,
      kind: 'depends_on',
    }),
    'a clause cannot relate to itself',
  );
  const clauseSup = await library.supersedeClause(approverCtx, approver, clause.id, {
    expectedVersion: clausePub.version,
    guidance: 'updated guidance',
  });
  t.equal(clauseSup.successor.version_number, 2, 'a superseded clause creates version_number 2');

  // --- audit + outbox: expected codes / events emitted ------------------------------------------
  const auditCodes = new Set<string>(audit.entries.map((e) => e.code));
  for (const code of [
    M18_AUDIT_CODES.taxonomyCreated,
    M18_AUDIT_CODES.taxonomyRetired,
    M18_AUDIT_CODES.authorityRegistered,
    M18_AUDIT_CODES.authorityTreated,
    M18_AUDIT_CODES.precedentRegistered,
    M18_AUDIT_CODES.opinionRegistered,
    M18_AUDIT_CODES.opinionApproved,
    M18_AUDIT_CODES.researchRegistered,
    M18_AUDIT_CODES.knowledgeCreated,
    M18_AUDIT_CODES.knowledgeAssigned,
    M18_AUDIT_CODES.classificationChanged,
    M18_AUDIT_CODES.knowledgeSubmitted,
    M18_AUDIT_CODES.knowledgeApproved,
    M18_AUDIT_CODES.knowledgePublished,
    M18_AUDIT_CODES.knowledgeSuperseded,
    M18_AUDIT_CODES.knowledgeVersioned,
    M18_AUDIT_CODES.knowledgeWithdrawn,
    M18_AUDIT_CODES.knowledgeArchived,
    M18_AUDIT_CODES.knowledgeReopened,
    M18_AUDIT_CODES.documentLinked,
    M18_AUDIT_CODES.referenceLinked,
    M18_AUDIT_CODES.relationshipCreated,
    M18_AUDIT_CODES.tagAdded,
    M18_AUDIT_CODES.tagRemoved,
    M18_AUDIT_CODES.citationAdded,
    M18_AUDIT_CODES.noteAdded,
    M18_AUDIT_CODES.reviewScheduled,
    M18_AUDIT_CODES.reviewCompleted,
    M18_AUDIT_CODES.usageRecorded,
    M18_AUDIT_CODES.confidentialAccessed,
    M18_AUDIT_CODES.privilegedAccessed,
    M18_AUDIT_CODES.templateCreated,
    M18_AUDIT_CODES.templatePublished,
    M18_AUDIT_CODES.templateSuperseded,
    M18_AUDIT_CODES.clauseCreated,
    M18_AUDIT_CODES.clausePublished,
    M18_AUDIT_CODES.clauseSuperseded,
    M18_AUDIT_CODES.clauseRelationCreated,
  ]) {
    t.ok(auditCodes.has(code), `audit code ${code} is emitted`);
  }
  t.ok(
    audit.entries.every((e) => e.code.startsWith('LEGALDOC_')),
    'every recorded audit code is a LEGALDOC_ code',
  );

  const eventTypes = new Set<string>(outbox.events.map((e) => e.type));
  for (const type of [
    'KnowledgeCreated',
    'KnowledgeAssigned',
    'ClassificationChanged',
    'KnowledgeSubmitted',
    'KnowledgeApproved',
    'KnowledgePublished',
    'KnowledgeSuperseded',
    'KnowledgeVersionCreated',
    'KnowledgeWithdrawn',
    'AuthorityRegistered',
    'AuthorityTreated',
    'PrecedentRegistered',
    'OpinionRegistered',
    'OpinionApproved',
    'ResearchRegistered',
    'DocumentLinked',
    'ReferenceLinked',
    'RelationshipCreated',
    'CitationAdded',
    'ReviewScheduled',
    'ReviewCompleted',
    'TemplateCreated',
    'TemplateApproved',
    'TemplatePublished',
    'TemplateSuperseded',
    'ClauseCreated',
    'ClauseApproved',
    'ClausePublished',
    'ClauseSuperseded',
  ]) {
    t.ok(eventTypes.has(type), `lifecycle event ${type} is published`);
  }
  t.ok(
    outbox.events.every((e) => e.family === LEGALDOCS_LIFECYCLE_FAMILY),
    'every event flows on the legaldocs.lifecycle family (one outbox, m06)',
  );

  // --- NO privileged text ever leaks into audit / event payloads (ADR-076) ----------------------
  const auditBlob = JSON.stringify(audit.entries);
  const eventBlob = JSON.stringify(outbox.events);
  for (const secret of [
    SECRET_ABSTRACT,
    SECRET_OPINION_CONCLUSION,
    SECRET_OPINION_RECOMMENDATION,
    SECRET_NOTE_BODY,
    SECRET_CLAUSE_GUIDANCE,
    SECRET_TEMPLATE_GUIDANCE,
    SECRET_PRECEDENT_HOLDING,
    SECRET_RESEARCH_FINDINGS,
  ]) {
    t.ok(!auditBlob.includes(secret), 'no privileged/confidential text appears in any audit payload');
    t.ok(!eventBlob.includes(secret), 'no privileged/confidential text appears in any event payload');
  }

  // --- cross-tenant isolation (RLS) -------------------------------------------------------------
  const foreignUser = randomUUID();
  const foreign = mk(foreignUser, ALL_M18_PERMISSIONS);
  const foreignCtx: RequestContext = { ...foreign, tenantId: randomUUID() };
  await t.rejects(
    knowledge.get(foreignCtx, kn.id),
    "another tenant cannot read this tenant's knowledge (RLS)",
  );
  const foreignSearch = await knowledge.search(foreignCtx, {});
  t.equal(foreignSearch.results.length, 0, "another tenant sees none of this tenant's knowledge (RLS)");
  const foreignOpinions = await catalog.listOpinions(foreignCtx);
  t.equal(foreignOpinions.length, 0, "another tenant sees none of this tenant's opinions (RLS)");
  await t.rejects(
    knowledge.publish(foreignCtx, foreignUser, kn.id, knPublished.version),
    "another tenant cannot act on this tenant's knowledge (RLS)",
  );
});
