import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M37Emitter,
  GovreleaseRepository,
  ArtifactService,
  ReleaseService,
  FixtureArtifactRegistry,
  M37_PERMISSIONS,
} from '../src/index.ts';

/**
 * M37 services DB spec — proves the governance/QA/release pipeline END TO END on a REAL PostgreSQL: register an artifact +
 * environment; request a release (an artifact UNAVAILABLE upstream is refused, fail closed); declare a QA gate + record
 * append-only checks (a failed check blocks QA; a passed check lets QA pass); send for review and APPROVE under maker-checker
 * (self-approval + AI-approval + default-deny refused; a QA-passed + independently-approved release is RELEASED); a second
 * release SUPERSEDES the prior; a raw signature is refused (opaque secretref only); rollback is a controlled execute action.
 */
export default defineDbSpec('m37-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const emitter = new M37Emitter(audit, outbox);
  const repo = new GovreleaseRepository();
  const registry = new FixtureArtifactRegistry(['connector:conn-1']); // only conn-1 is releasable upstream
  const artifacts = new ArtifactService(db, authz, emitter, repo);
  const releases = new ReleaseService(db, authz, emitter, registry, repo);

  const tenant = randomUUID();
  const userR = randomUUID();
  const userA = randomUUID();
  const ctxOf = (userId: string, perms: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId,
    correlationId: randomUUID(),
    permissions: [...perms],
  });
  const authorCtx = ctxOf(userR, [
    M37_PERMISSIONS.artifactManage,
    M37_PERMISSIONS.artifactRead,
    M37_PERMISSIONS.releaseAuthor,
    M37_PERMISSIONS.releaseRead,
    M37_PERMISSIONS.gateManage,
  ]);
  const approverCtx = ctxOf(userA, [M37_PERMISSIONS.releaseApprove, M37_PERMISSIONS.releaseRead]);
  const executeCtx = ctxOf(userA, [M37_PERMISSIONS.releaseExecute, M37_PERMISSIONS.releaseRead]);

  // --- register artifacts + environment -----------------------------------------------------------
  const artifact = await artifacts.registerArtifact(authorCtx, userR, {
    artifactKey: 'sf',
    artifactKind: 'connector',
    artifactRef: 'conn-1',
    name: 'Salesforce',
  });
  t.equal(artifact.status, 'active', 'a registered artifact is active');
  const bad = await artifacts.registerArtifact(authorCtx, userR, {
    artifactKey: 'nope',
    artifactKind: 'connector',
    artifactRef: 'conn-x',
    name: 'Nope',
  });
  const env = await artifacts.defineEnvironment(authorCtx, userR, { envKey: 'prod', tier: 3 });
  t.equal(env.requires_approval, true, 'a production environment requires approval');

  // --- a release of an artifact UNAVAILABLE upstream is refused (fail closed) ----------------------
  await t.rejects(
    releases.requestRelease(authorCtx, userR, {
      artifactId: bad.id,
      environmentId: env.id,
      releaseKey: 'rk-bad',
      toVersion: 1,
    }),
    'a release of an artifact unavailable in its owning module is refused (fail closed)',
  );

  // --- request a release; QA gate blocks then passes ----------------------------------------------
  const release = await releases.requestRelease(authorCtx, userR, {
    artifactId: artifact.id,
    environmentId: env.id,
    releaseKey: 'rk-1',
    toVersion: 2,
  });
  t.equal(release.state, 'draft', 'a requested release starts draft');
  const gate = await releases.addGate(authorCtx, userR, release.id, {
    gateKey: 'security-scan',
    required: true,
  });
  await releases.recordCheck(authorCtx, userR, gate.id, { status: 'failed' });
  const afterFail = await releases.getRelease(authorCtx, release.id);
  const failedQa = await releases.validateReleaseQa(authorCtx, userR, release.id, afterFail?.version ?? 0);
  t.ok(!failedQa.passed, 'QA does not pass while a required gate has failed');
  await releases.recordCheck(authorCtx, userR, gate.id, { status: 'passed' });
  const afterPass = await releases.getRelease(authorCtx, release.id);
  const passedQa = await releases.validateReleaseQa(authorCtx, userR, release.id, afterPass?.version ?? 0);
  t.ok(passedQa.passed, 'QA passes once every required gate has passed');

  // --- review + maker-checker refusals ------------------------------------------------------------
  const qaPassed = await releases.getRelease(authorCtx, release.id);
  const reviewed = await releases.requestReview(authorCtx, userR, release.id, qaPassed?.version ?? 0);
  t.equal(reviewed.state, 'review_pending', 'a QA-passed release can be sent for review');
  await t.rejects(
    releases.approveRelease(
      ctxOf(userR, [M37_PERMISSIONS.releaseApprove, M37_PERMISSIONS.releaseRead]),
      userR,
      release.id,
      reviewed.version,
    ),
    'the requester cannot self-approve a release',
  );
  await t.rejects(
    releases.approveRelease(approverCtx, 'ai', release.id, reviewed.version),
    'AI can never approve a release',
  );
  await t.rejects(
    releases.approveRelease(ctxOf(userA, [M37_PERMISSIONS.releaseRead]), userA, release.id, reviewed.version),
    'default deny — no govrelease.release.approve, refused',
  );

  // --- approve by an independent human ------------------------------------------------------------
  const released = await releases.approveRelease(approverCtx, userA, release.id, reviewed.version);
  t.equal(released.state, 'released', 'a QA-passed, independently-approved release is released');

  // --- evidence: a raw signature is refused; an opaque secretref passes ---------------------------
  await t.rejects(
    releases.addEvidence(authorCtx, userR, release.id, {
      evidenceKind: 'attestation',
      signatureRef: 'rawsig',
    }),
    'a raw signature value is refused (opaque secretref only)',
  );
  const evidence = await releases.addEvidence(authorCtx, userR, release.id, {
    evidenceKind: 'attestation',
    signatureRef: 'secretref:vault/kv/sig',
  });
  t.ok(
    evidence.signature_ref === 'secretref:vault/kv/sig',
    'a signature is stored as an opaque reference only',
  );

  // --- a second release SUPERSEDES the prior released for the same artifact/environment -----------
  const release2 = await releases.requestRelease(authorCtx, userR, {
    artifactId: artifact.id,
    environmentId: env.id,
    releaseKey: 'rk-2',
    toVersion: 3,
  });
  const gate2 = await releases.addGate(authorCtx, userR, release2.id, {
    gateKey: 'security-scan',
    required: true,
  });
  await releases.recordCheck(authorCtx, userR, gate2.id, { status: 'passed' });
  const r2p = await releases.getRelease(authorCtx, release2.id);
  await releases.validateReleaseQa(authorCtx, userR, release2.id, r2p?.version ?? 0);
  const r2qa = await releases.getRelease(authorCtx, release2.id);
  const r2rev = await releases.requestReview(authorCtx, userR, release2.id, r2qa?.version ?? 0);
  const released2 = await releases.approveRelease(approverCtx, userA, release2.id, r2rev.version);
  t.equal(released2.state, 'released', 'the second release is released');
  const priorAfter = await releases.getRelease(authorCtx, release.id);
  t.equal(priorAfter?.state, 'rolled_back', 'the prior released record is superseded (rolled_back)');

  // --- rollback is a controlled execute action ----------------------------------------------------
  await t.rejects(
    releases.rollbackRelease(ctxOf(userR, [M37_PERMISSIONS.releaseRead]), userR, release2.id),
    'default deny — no govrelease.release.execute, rollback refused',
  );
  const rolledBack = await releases.rollbackRelease(executeCtx, userA, release2.id);
  t.equal(rolledBack.state, 'rolled_back', 'an authorized human rolls back a released record');
});
