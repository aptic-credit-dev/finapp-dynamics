import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M41Emitter,
  SecurityRepository,
  SecretService,
  DlpService,
  GovernanceService,
  FixtureSecretProvider,
  UnavailableSecretProvider,
  M41_PERMISSIONS,
  REASON_CODES,
} from '../src/index.ts';

/**
 * M41 services DB spec — proves the security pipeline END TO END on a REAL PostgreSQL: POSTURE OVER RBAC (rbac-deny/security-deny
 * => DENY, all-allow => ALLOW); define + ACTIVATE a secret under maker-checker (self + AI refused, an independent human);
 * ROTATE race-safe (concurrent rotations => one winner, exactly one active version); REVOKE; the m30-facing RESOLVER (active =>
 * available metadata, revoked/missing => unavailable, never a value); a plaintext REVEAL under maker-checker (no material); the
 * m24-facing DLP evaluator FAILS CLOSED (restricted+secret => block, restricted no-policy => block, clean => allow); a GRC
 * control + assessment; a privacy classification + record. No secret value is ever returned.
 */
export default defineDbSpec('m41-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const emitter = new M41Emitter(audit, outbox);
  const repo = new SecurityRepository();
  const secretOk = new SecretService(db, authz, emitter, new FixtureSecretProvider(), repo);
  const secretUnavail = new SecretService(db, authz, emitter, new UnavailableSecretProvider(), repo);
  const dlp = new DlpService(db, authz, emitter, repo);
  const gov = new GovernanceService(db, authz, emitter, repo);

  const tenant = randomUUID();
  const userR = randomUUID();
  const userA = randomUUID();
  const ctxOf = (userId: string, perms: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId,
    correlationId: randomUUID(),
    permissions: [...perms],
  });
  const manageCtx = ctxOf(userR, [M41_PERMISSIONS.secretManage, M41_PERMISSIONS.secretRead]);
  const rotateCtx = ctxOf(userA, [M41_PERMISSIONS.secretRotate]);
  const destroyCtx = ctxOf(userA, [M41_PERMISSIONS.secretDestroy]);
  const revealCtx = ctxOf(userA, [M41_PERMISSIONS.secretReveal]);
  const dlpCtx = ctxOf(userR, [M41_PERMISSIONS.dlpManage, M41_PERMISSIONS.dlpRead]);
  const grcCtx = ctxOf(userR, [M41_PERMISSIONS.grcControlManage, M41_PERMISSIONS.grcAssessmentRecord]);
  const privacyCtx = ctxOf(userR, [M41_PERMISSIONS.privacyPolicyManage, M41_PERMISSIONS.privacyRecordManage]);

  // --- POSTURE OVER RBAC --------------------------------------------------------------------------
  const withPerm = [M41_PERMISSIONS.secretRead];
  t.equal(
    (
      await secretOk.evaluateAccess(ctxOf(userR, []), {
        requiredPermission: M41_PERMISSIONS.secretRead,
        securityAllowed: true,
      })
    ).reasonCode,
    REASON_CODES.rbacDenied,
    'RBAC deny + security allow => DENY (security never grants what RBAC denies)',
  );
  t.equal(
    (
      await secretOk.evaluateAccess(ctxOf(userR, withPerm), {
        requiredPermission: M41_PERMISSIONS.secretRead,
        securityAllowed: false,
      })
    ).reasonCode,
    REASON_CODES.securityDenied,
    'RBAC allow + security deny => DENY',
  );
  t.ok(
    (
      await secretOk.evaluateAccess(ctxOf(userR, withPerm), {
        requiredPermission: M41_PERMISSIONS.secretRead,
        securityAllowed: true,
      })
    ).allowed,
    'RBAC allow + security allow => ALLOW',
  );

  // --- define + activate (maker-checker) ----------------------------------------------------------
  const secret = await secretOk.defineSecret(manageCtx, {
    materialKind: 'key',
    secretKey: 'sig',
    secretRef: 'secretref:vault/kv/sig',
    algorithm: 'aes-256-gcm',
  });
  t.equal(secret.state, 'draft', 'a defined secret starts draft with a pending version');
  await t.rejects(
    secretOk.activateSecret(ctxOf(userR, [M41_PERMISSIONS.secretRotate]), userR, secret.id, secret.version, {
      requestedBy: userR,
    }),
    'the requester cannot self-approve activation',
  );
  await t.rejects(
    secretOk.activateSecret(rotateCtx, 'ai', secret.id, secret.version, { requestedBy: userR }),
    'AI can never approve activation',
  );
  const active = await secretOk.activateSecret(rotateCtx, userA, secret.id, secret.version, {
    requestedBy: userR,
  });
  t.equal(active.state, 'active', 'an independently-approved secret activates');

  // --- resolver: active => available metadata (never a value) -------------------------------------
  const meta1 = await secretOk.resolveSecretMetadata(manageCtx, 'secretref:vault/kv/sig');
  t.ok(
    meta1.available && meta1.reasonCode === REASON_CODES.secretResolvable,
    'the resolver reports an active secret as available (metadata only, no value)',
  );
  const metaMissing = await secretOk.resolveSecretMetadata(manageCtx, 'secretref:vault/kv/missing');
  t.ok(!metaMissing.available, 'the resolver fails closed for a missing secret');
  // even for an active secret, an unavailable provider yields unavailable (fail closed)
  const metaProviderDown = await secretUnavail.resolveSecretMetadata(manageCtx, 'secretref:vault/kv/sig');
  t.ok(!metaProviderDown.available, 'the resolver fails closed when the provider is unavailable');

  // --- rotation: race-safe (concurrent => one winner, exactly one active version) -----------------
  const cur = await secretOk.getSecret(manageCtx, secret.id);
  const rotations = await Promise.allSettled([
    secretOk.rotateSecret(rotateCtx, userA, secret.id, cur?.version ?? 0, { requestedBy: userR }),
    secretOk.rotateSecret(rotateCtx, userA, secret.id, cur?.version ?? 0, { requestedBy: userR }),
  ]);
  const okRotations = rotations.filter((r) => r.status === 'fulfilled').length;
  t.equal(okRotations, 1, 'two concurrent rotations at the same version admit exactly ONE winner (CAS)');
  await ctx.asTenant(tenant, async (tx) => {
    const a = await tx.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM security_secret_version WHERE secret_id=$1 AND state='active'`,
      [secret.id],
    );
    t.equal(
      a.rows[0]?.c,
      '1',
      'exactly one active version remains after concurrent rotation (no split-brain)',
    );
  });

  // --- reveal (maker-checker; no material returned) -----------------------------------------------
  await t.rejects(
    secretOk.requestReveal(ctxOf(userR, [M41_PERMISSIONS.secretReveal]), userR, secret.id, {
      requestedBy: userR,
      purpose: 'debug',
    }),
    'a reveal cannot be self-approved',
  );
  const reveal = await secretOk.requestReveal(revealCtx, userA, secret.id, {
    requestedBy: userR,
    purpose: 'incident-triage',
  });
  t.ok(
    reveal.id && reveal.reasonCode === REASON_CODES.providerUnavailable,
    'a reveal is granted under maker-checker but returns NO material (provider unavailable)',
  );

  // --- revoke + destroy ---------------------------------------------------------------------------
  const afterRotate = await secretOk.getSecret(manageCtx, secret.id);
  const revoked = await secretOk.revokeSecret(rotateCtx, userA, secret.id, afterRotate?.version ?? 0, {
    requestedBy: userR,
  });
  t.equal(revoked.state, 'revoked', 'a secret can be revoked (maker-checker)');
  const metaRevoked = await secretOk.resolveSecretMetadata(manageCtx, 'secretref:vault/kv/sig');
  t.ok(!metaRevoked.available, 'the resolver fails closed for a revoked secret');
  const destroyed = await secretOk.destroySecret(destroyCtx, userA, secret.id, revoked.version, {
    requestedBy: userR,
  });
  t.equal(
    destroyed.state,
    'destroyed',
    'a revoked secret can be destroyed (material crypto-erased via the fail-closed provider)',
  );

  // --- DLP fails closed ---------------------------------------------------------------------------
  const d1 = await dlp.evaluate(dlpCtx, { classification: 'restricted', text: 'my password is hunter2' });
  t.equal(d1.action, 'block', 'restricted data that looks secret is BLOCKED');
  const d2 = await dlp.evaluate(dlpCtx, { classification: 'restricted', text: 'perfectly clean sentence' });
  t.equal(d2.action, 'block', 'restricted data with NO governing policy is BLOCKED (fail closed)');
  await dlp.setPolicy(dlpCtx, { policyKey: 'internal-allow', classification: 'internal', action: 'allow' });
  const d3 = await dlp.evaluate(dlpCtx, { classification: 'internal', text: 'ordinary text' });
  t.equal(d3.action, 'allow', 'internal non-secret data is allowed by an allow policy');

  // --- GRC + privacy ------------------------------------------------------------------------------
  const control = await gov.defineControl(grcCtx, {
    controlKey: 'ac-1',
    framework: 'iso27001',
    title: 'Access control',
  });
  const assessment = await gov.recordAssessment(grcCtx, control.id, { status: 'compliant' });
  t.ok(assessment.id, 'a GRC control + assessment are recorded (append-only evidence)');
  const cls = await gov.setClassification(privacyCtx, {
    classificationKey: 'pii',
    level: 'restricted',
    retentionDays: 365,
  });
  t.equal(cls.level, 'restricted', 'a data classification is set');
  const record = await gov.recordPrivacyEvent(privacyCtx, {
    subjectRef: 'subject:opaque-123',
    action: 'erase_request',
  });
  t.ok(record.id, 'a privacy processing record is added (opaque subject ref; no personal data)');

  // --- READ MODEL (M41 privacy/DLP/incident read-model completion) -------------------------------
  // Closes the write-only gap: everything written above is now readable over an RLS-scoped, permission-gated
  // read surface (no audit on reads). Prove: (1) reads return the written rows; (2) a caller WITHOUT the read
  // permission is denied server-side; (3) RLS isolates another tenant (empty list + not-found by id).
  const soc = await gov.recordIncident(dlpCtx, {
    incidentKey: 'inc-1',
    category: 'dlp_block',
    severity: 'high',
  });
  const dlpReadCtx = ctxOf(userR, [M41_PERMISSIONS.dlpRead]);
  const privacyReadCtx = ctxOf(userR, [M41_PERMISSIONS.privacyPolicyRead]);

  const policies = await dlp.listPolicies(dlpReadCtx);
  t.ok(
    policies.some((p) => p.policy_key === 'internal-allow'),
    'DLP policies are readable (read model returns the written policy)',
  );
  const findings = await dlp.listFindings(dlpReadCtx);
  t.ok(findings.length >= 1, 'DLP findings are readable as append-only evidence');
  const incidents = await gov.listIncidents(dlpReadCtx);
  t.ok(
    incidents.some((i) => i.incident_key === 'inc-1' && i.state === 'open'),
    'security incidents are readable (with lifecycle state)',
  );
  t.equal(
    (await gov.getIncident(dlpReadCtx, soc.id)).incident_key,
    'inc-1',
    'an incident is readable by id (RLS-scoped)',
  );
  const classifications = await gov.listPrivacyClassifications(privacyReadCtx);
  t.ok(
    classifications.some((c) => c.classification_key === 'pii'),
    'privacy classifications are readable',
  );
  const records = await gov.listPrivacyRecords(privacyReadCtx);
  t.ok(
    records.some((r) => r.subject_ref === 'subject:opaque-123'),
    'privacy records are readable (opaque subject ref only — never personal data)',
  );

  // (2) permission gating — a caller WITHOUT the read permission is denied in-service (Restricted/Auditor
  // without the grant cannot read), independent of any UI.
  const noPerm = ctxOf(userR, []);
  await t.rejects(gov.listIncidents(noPerm), 'reading incidents requires security.dlp.read (fail closed)');
  await t.rejects(
    gov.listPrivacyRecords(noPerm),
    'reading privacy records requires privacy.policy.read (fail closed)',
  );
  await t.rejects(dlp.listPolicies(noPerm), 'reading DLP policies requires security.dlp.read (fail closed)');

  // (3) tenant isolation — another tenant (with the read grants) sees NONE of tenant-1's rows, and a
  // detail-by-id for a foreign row fails closed (RLS makes it invisible => not found).
  const tenant2 = randomUUID();
  const otherCtx = (perms: readonly string[]): RequestContext => ({
    tenantId: tenant2,
    userId: randomUUID(),
    correlationId: randomUUID(),
    permissions: [...perms],
  });
  t.equal(
    (await gov.listIncidents(otherCtx([M41_PERMISSIONS.dlpRead]))).length,
    0,
    'a different tenant sees NO incidents (FORCE RLS isolation)',
  );
  t.equal(
    (await gov.listPrivacyRecords(otherCtx([M41_PERMISSIONS.privacyPolicyRead]))).length,
    0,
    'a different tenant sees NO privacy records (FORCE RLS isolation)',
  );
  await t.rejects(
    gov.getIncident(otherCtx([M41_PERMISSIONS.dlpRead]), soc.id),
    'cross-tenant incident detail-by-id fails closed (RLS => not found)',
  );
});
