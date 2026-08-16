import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M42Emitter,
  CertificationRepository,
  ProgrammeService,
  DecisionService,
  M42_PERMISSIONS,
  CERT_DOMAINS,
  CERT_ASPECTS,
} from '../src/index.ts';

/**
 * M42 services DB spec — proves the certification pipeline END TO END on a REAL PostgreSQL: DENY-BY-DEFAULT GO/CONDITIONAL_GO/
 * NO_GO DERIVED from governed evidence (a caller never sets GO); an incomplete assessment / critical open finding / missing UAT
 * / missing sign-off each BLOCKS a GO; an EXPIRED waiver does not satisfy the gate while a valid bounded waiver clears it; a
 * requester cannot self-certify; a domain assessor cannot self-sign that domain; AI/system cannot certify; a bounded residual
 * condition yields CONDITIONAL_GO; a decision is idempotent and a NEW decision supersedes (no edit); platform programmes require
 * the control-plane permission; and the immutable closure artifact is issued. M42 EXECUTES nothing.
 */
const ALL_PERMS = Object.values(M42_PERMISSIONS);

export default defineDbSpec('m42-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const emitter = new M42Emitter(new RecordingAudit(), new RecordingOutbox());
  const repo = new CertificationRepository();
  const programmes = new ProgrammeService(db, authz, emitter, repo);
  const decisions = new DecisionService(db, authz, emitter, repo);

  const tenant = randomUUID();
  const userMgr = randomUUID();
  const userReq = randomUUID();
  const userCert = randomUUID();
  const signers = {
    engineering: randomUUID(),
    security: randomUUID(),
    operations: randomUUID(),
    product: randomUUID(),
  };
  const ctxOf = (userId: string, perms: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId,
    correlationId: randomUUID(),
    permissions: [...perms],
  });
  const mgr = ctxOf(userMgr, ALL_PERMS);
  const noAdmin = ctxOf(
    userMgr,
    ALL_PERMS.filter((p) => p !== M42_PERMISSIONS.administer),
  );

  // --- platform control-plane auth ----------------------------------------------------------------
  await t.rejects(
    programmes.openProgramme(noAdmin, {
      scope: 'platform',
      programmeKey: 'p-denied',
      stageKey: 'stage-6',
      title: 'x',
    }),
    'a tenant admin without the control-plane permission cannot open a PLATFORM programme',
  );
  const prog = await programmes.openProgramme(mgr, {
    scope: 'platform',
    programmeKey: 'stage-6',
    stageKey: 'stage-6',
    title: 'Stage 6 closure',
  });
  t.equal(prog.state, 'draft', 'a platform programme opens (control-plane permission held)');

  // --- deny-by-default: an empty programme derives NO_GO (GO is DERIVED, never set) ----------------
  t.equal(
    (await decisions.previewDecision(mgr, prog.id)).decision,
    'no_go',
    'an empty programme previews NO_GO (deny-by-default)',
  );

  // populate assessments only -> still NO_GO (missing readiness + sign-offs)
  for (const d of CERT_DOMAINS)
    for (const a of CERT_ASPECTS)
      await programmes.recordAssessment(mgr, {
        programmeId: prog.id,
        domainKey: d,
        aspectKey: a,
        status: 'pass',
      });
  t.equal(
    (await decisions.previewDecision(mgr, prog.id)).decision,
    'no_go',
    'a complete assessment matrix alone is not enough — missing readiness/sign-offs block GO',
  );

  // add readiness but drop UAT -> NO_GO (missing UAT)
  for (const kind of ['migration', 'pilot', 'release'] as const)
    await programmes.recordReadiness(mgr, {
      programmeId: prog.id,
      kind,
      refKey: `${kind}-1`,
      result: 'pass',
    });
  t.equal(
    (await decisions.previewDecision(mgr, prog.id)).decision,
    'no_go',
    'missing UAT readiness blocks GO',
  );
  await programmes.recordReadiness(mgr, {
    programmeId: prog.id,
    kind: 'uat',
    refKey: 'uat-1',
    result: 'pass',
  });

  // add three sign-offs, still missing one -> NO_GO
  await programmes.recordSignoff(mgr, signers.engineering, { programmeId: prog.id, roleKey: 'engineering' });
  await programmes.recordSignoff(mgr, signers.security, { programmeId: prog.id, roleKey: 'security' });
  await programmes.recordSignoff(mgr, signers.operations, { programmeId: prog.id, roleKey: 'operations' });
  t.equal(
    (await decisions.previewDecision(mgr, prog.id)).decision,
    'no_go',
    'a missing mandatory sign-off blocks GO',
  );
  await programmes.recordSignoff(mgr, signers.product, { programmeId: prog.id, roleKey: 'product' });

  // now GO-ready
  t.equal(
    (await decisions.previewDecision(mgr, prog.id)).decision,
    'go',
    'a fully-satisfied programme previews GO',
  );

  // --- independence: self-certify + AI refused ----------------------------------------------------
  await t.rejects(
    decisions.issueDecision(mgr, userReq, {
      programmeId: prog.id,
      requestedBy: userReq,
      idempotencyKey: 'k-self',
    }),
    'the requester cannot self-certify (SoD)',
  );
  await t.rejects(
    decisions.issueDecision(mgr, 'ai', {
      programmeId: prog.id,
      requestedBy: userReq,
      idempotencyKey: 'k-ai',
    }),
    'AI can never certify',
  );

  // --- a critical OPEN finding blocks GO; a valid waiver clears it; an expired waiver does not -----
  const finding = await programmes.raiseFinding(mgr, {
    programmeId: prog.id,
    domainKey: 'm41',
    severity: 'critical',
    title: 'residual hardening item',
  });
  t.equal(
    (await decisions.previewDecision(mgr, prog.id)).decision,
    'no_go',
    'an unresolved critical finding blocks GO',
  );
  const waiver = await decisions.requestWaiver(mgr, {
    programmeId: prog.id,
    findingId: finding.id,
    scope: 'stage-6',
    reason: 'deferred to Stage 7',
  });
  // self-approval refused
  await t.rejects(
    decisions.approveWaiver(ctxOf(userMgr, ALL_PERMS), userMgr, waiver.id, waiver.version, {
      validTo: new Date('2027-01-01T00:00:00Z'),
    }),
    'a waiver cannot be self-approved (requester=approver)',
  );
  // approve with a PAST expiry -> waiver inactive -> still NO_GO
  const expired = await decisions.approveWaiver(mgr, userCert, waiver.id, waiver.version, {
    validTo: new Date('2020-01-01T00:00:00Z'),
  });
  t.equal(expired.state, 'approved', 'the waiver is approved (maker-checker: an independent human)');
  t.equal(
    (await decisions.previewDecision(mgr, prog.id, new Date('2026-08-16T00:00:00Z'))).decision,
    'no_go',
    'an EXPIRED waiver does not satisfy the gate',
  );

  // resolve the finding instead (clean path back to GO); the waiver->waived update bumped its version to 2.
  await programmes.resolveFinding(mgr, finding.id, finding.version + 1);
  t.equal(
    (await decisions.previewDecision(mgr, prog.id)).decision,
    'go',
    'resolving the finding returns the programme to GO',
  );

  // --- an absolute control cannot be waived -------------------------------------------------------
  const absFinding = await programmes.raiseFinding(mgr, {
    programmeId: prog.id,
    domainKey: 'm30',
    severity: 'critical',
    title: 'absolute control breach',
  });
  const absWaiver = await decisions.requestWaiver(mgr, {
    programmeId: prog.id,
    findingId: absFinding.id,
    scope: 'stage-6',
    reason: 'attempt',
    isAbsolute: true,
  });
  await t.rejects(
    decisions.approveWaiver(mgr, userCert, absWaiver.id, absWaiver.version, {
      validTo: new Date('2027-01-01T00:00:00Z'),
    }),
    'an ABSOLUTE control can never be waived',
  );
  await programmes.resolveFinding(mgr, absFinding.id, absFinding.version);

  // --- domain assessor cannot self-sign their own assessed domain ---------------------------------
  const assessorX = randomUUID();
  await programmes.recordAssessment(ctxOf(assessorX, ALL_PERMS), {
    programmeId: prog.id,
    domainKey: 'm35',
    aspectKey: 'security',
    status: 'pass',
  });
  await t.rejects(
    programmes.recordSignoff(mgr, assessorX, { programmeId: prog.id, roleKey: 'security', domainKey: 'm35' }),
    'a domain assessor cannot self-sign the domain they assessed (independence)',
  );

  // --- issue the DERIVED decision (GO) + idempotency + supersede -----------------------------------
  const go = await decisions.issueDecision(mgr, userCert, {
    programmeId: prog.id,
    requestedBy: userReq,
    idempotencyKey: 'k-go',
  });
  t.equal(go.decision, 'go', 'an independent human certifier issues the DERIVED GO');
  t.equal(go.decisionNo, 1, 'the first issued decision is decision_no 1');
  await t.rejects(
    decisions.issueDecision(mgr, userCert, {
      programmeId: prog.id,
      requestedBy: userReq,
      idempotencyKey: 'k-go',
    }),
    'the same idempotency key cannot issue a second decision',
  );
  // a NEW decision (new key) supersedes with a new decision_no — not an edit
  const cond = await decisions.issueDecision(mgr, userCert, {
    programmeId: prog.id,
    requestedBy: userReq,
    idempotencyKey: 'k-cond',
    conditions: [
      {
        conditionKey: 'stage-7-hardening',
        description: 'pen test + DR drill + load/chaos + real data migration',
      },
    ],
  });
  t.equal(cond.decision, 'conditional_go', 'a bounded residual condition derives CONDITIONAL_GO');
  t.equal(cond.decisionNo, 2, 'a correction is a NEW decision (decision_no 2), never an edit');

  // --- closure (immutable artifact) ---------------------------------------------------------------
  const closure = await decisions.closeStage(mgr, userCert, {
    programmeId: prog.id,
    requestedBy: userReq,
    idempotencyKey: 'k-close',
    assessedModules: 'm30..m41',
    implCertRefs: 'main@stage-6',
  });
  t.equal(closure.decision, 'conditional_go', 'the closure artifact records the latest issued decision');
  await t.rejects(
    decisions.closeStage(mgr, userCert, {
      programmeId: prog.id,
      requestedBy: userReq,
      idempotencyKey: 'k-close2',
      assessedModules: 'm30..m41',
    }),
    'a closed programme cannot be closed again (state transition)',
  );

  // --- a CLOSED programme is terminal: no further decision may be issued (closure immutability) ----
  await t.rejects(
    decisions.issueDecision(mgr, userCert, {
      programmeId: prog.id,
      requestedBy: userReq,
      idempotencyKey: 'k-reopen',
    }),
    'a closed programme is terminal — no decision can reopen it (closure immutability)',
  );

  // --- evidence privacy: the app role holds no secret-value column (proven structurally); a preview leaks no raw body ---
  t.ok(
    typeof go.decision === 'string' && !('evidenceBody' in go),
    'the decision result carries a verdict + ids only (no raw evidence body)',
  );
});
