import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M31Emitter,
  StudioRepository,
  StudioProjectService,
  StudioArtifactService,
  StudioBindingService,
  FixtureWorkflowDefinitionPort,
  FixtureRuleDefinitionPort,
  FixtureIntegrationCatalog,
  M31_PERMISSIONS,
} from '../src/index.ts';

/**
 * M31 services DB spec — proves the design-time pipeline END TO END on a REAL PostgreSQL: create a project + a workflow
 * design; validate it (fail-closed); request review; and PUBLISH under maker-checker/SoD — the approver must be a HUMAN
 * who is NOT the requester (self-approval + AI-approval are refused), a design that FAILED validation can never be sent
 * for review or published, a referenced integration capability that is UNAVAILABLE (m33 unbuilt) blocks publication
 * (fail closed), and default-deny holds (RBAC is authoritative — no permission, no action). On success the design BINDS
 * to the canonical engine through the port (opaque binding only; m31 owns no engine), and a rule design binds to m07.
 */
export default defineDbSpec('m31-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const emitter = new M31Emitter(audit, outbox);
  const repo = new StudioRepository();
  const wfPort = new FixtureWorkflowDefinitionPort();
  const rulePort = new FixtureRuleDefinitionPort();
  const catalog = new FixtureIntegrationCatalog(['connector:known']);
  const projects = new StudioProjectService(db, authz, emitter, repo);
  const artifacts = new StudioArtifactService(db, authz, emitter, wfPort, rulePort, catalog, repo);
  const bindings = new StudioBindingService(db, authz, emitter, wfPort, rulePort, repo);

  const tenant = randomUUID();
  const userR = randomUUID(); // requester / author
  const userA = randomUUID(); // approver
  const ctxOf = (userId: string, perms: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId,
    correlationId: randomUUID(),
    permissions: [...perms],
  });
  const authorCtx = ctxOf(userR, [
    M31_PERMISSIONS.projectManage,
    M31_PERMISSIONS.artifactAuthor,
    M31_PERMISSIONS.artifactValidate,
    M31_PERMISSIONS.artifactRead,
  ]);
  const approverCtx = ctxOf(userA, [
    M31_PERMISSIONS.artifactPublish,
    M31_PERMISSIONS.artifactRead,
    M31_PERMISSIONS.bindingManage,
  ]);

  const validWorkflow = {
    schemaVersion: 1,
    code: 'simple_approval',
    name: 'Simple approval',
    variables: [{ name: 'amount', type: 'number' }],
    nodes: [
      { key: 'start', type: 'START' },
      { key: 'approve', type: 'APPROVAL_TASK' },
      { key: 'end_ok', type: 'END' },
      { key: 'end_no', type: 'END' },
    ],
    transitions: [
      { key: 't0', from: 'start', to: 'approve' },
      { key: 't1', from: 'approve', to: 'end_ok', condition: 'amount < 1000' },
      { key: 't2', from: 'approve', to: 'end_no' },
    ],
  };

  const getVer = async (
    artifactId: string,
    versionId: string,
  ): Promise<{ version: number; state: string }> => {
    const versions = await artifacts.listVersions(authorCtx, artifactId);
    const v = versions.find((x) => x.id === versionId);
    return { version: v?.version ?? 0, state: v?.state ?? '' };
  };

  // --- project + workflow artifact --------------------------------------------------------------
  const project = await projects.createProject(authorCtx, userR, { projectKey: 'proj', name: 'Proj' });
  t.equal(project.status, 'active', 'a project is created active');

  const wf = await artifacts.createArtifact(authorCtx, userR, {
    projectId: project.id,
    kind: 'workflow',
    artifactKey: 'simple_approval',
    name: 'Simple approval',
    spec: validWorkflow,
  });
  t.equal(wf.version.state, 'draft', 'a new design version starts draft');

  // --- validate (fail-closed; passes here) ------------------------------------------------------
  const vr = await artifacts.validateVersion(authorCtx, userR, wf.version.id, wf.version.version);
  t.ok(vr.passed, 'a valid workflow design passes validation');
  const afterValidate = await getVer(wf.artifact.id, wf.version.id);
  t.equal(afterValidate.state, 'validated', 'a passing validation moves the version to validated');

  // --- request review (records the requester for SoD) -------------------------------------------
  const reviewed = await artifacts.requestReview(authorCtx, userR, wf.version.id, afterValidate.version);
  t.equal(reviewed.state, 'review_pending', 'a validated version can be sent for review');

  // --- self-approval is refused (maker != checker) ----------------------------------------------
  const selfCtx = ctxOf(userR, [M31_PERMISSIONS.artifactPublish, M31_PERMISSIONS.artifactRead]);
  await t.rejects(
    artifacts.publishArtifact(selfCtx, userR, wf.version.id, reviewed.version),
    'the requester cannot approve/publish their own design (self-approval refused)',
  );

  // --- AI can never approve ---------------------------------------------------------------------
  await t.rejects(
    artifacts.publishArtifact(approverCtx, 'ai', wf.version.id, reviewed.version),
    'AI can never approve/publish a Studio design',
  );

  // --- default deny: no publish permission -> refused -------------------------------------------
  const noPermCtx = ctxOf(userA, [M31_PERMISSIONS.artifactRead]);
  await t.rejects(
    artifacts.publishArtifact(noPermCtx, userA, wf.version.id, reviewed.version),
    'default deny — a caller without studio.artifact.publish is refused (RBAC authoritative)',
  );

  // --- publish by an independent human approver -> binds to the canonical m06 engine ------------
  const published = await artifacts.publishArtifact(approverCtx, userA, wf.version.id, reviewed.version);
  t.equal(published.version.state, 'published', 'an independently-approved validated design publishes');
  t.ok(
    published.binding !== null && published.binding.targetEngine === 'workflow',
    'the workflow design binds to the m06 engine',
  );
  t.ok(
    published.binding !== null && published.binding.definitionId !== '' && published.binding.versionId !== '',
    'the binding is the OPAQUE canonical (definitionId, versionId) — m31 owns no engine',
  );

  // the recorded binding row points at the opaque canonical definition
  const bindingRow = await bindings.getBinding(approverCtx, wf.version.id);
  t.ok(
    bindingRow !== null &&
      bindingRow.target_engine === 'workflow' &&
      bindingRow.target_definition_id !== null,
    'the binding row stores the opaque canonical id',
  );

  // --- published version is IMMUTABLE via the service (a new edit is a new version) -------------
  const v2 = await artifacts.newVersion(
    authorCtx,
    userR,
    wf.artifact.id,
    { ...validWorkflow, name: 'v2' },
    'edit',
  );
  t.equal(
    v2.state,
    'draft',
    'editing a published design creates a NEW draft version (published stays immutable)',
  );

  // --- VALIDATION FAILURE BLOCKS PUBLICATION ----------------------------------------------------
  const badForm = await artifacts.createArtifact(authorCtx, userR, {
    projectId: project.id,
    kind: 'form',
    artifactKey: 'bad_form',
    name: 'Bad form',
    spec: {
      schemaVersion: 1,
      key: 'bad',
      name: 'bad',
      sections: [{ key: 's', title: 's', fields: [{ key: 'f', type: 'executable' }] }],
    },
  });
  const badVr = await artifacts.validateVersion(
    authorCtx,
    userR,
    badForm.version.id,
    badForm.version.version,
  );
  t.ok(!badVr.passed, 'an invalid form schema fails validation');
  await t.rejects(
    artifacts.requestReview(authorCtx, userR, badForm.version.id, badForm.version.version),
    'a design that failed validation cannot be sent for review (so cannot be published)',
  );

  // --- FAIL-CLOSED INTEGRATION: an unavailable capability (m33 unbuilt) blocks publish ----------
  const wf2 = await artifacts.createArtifact(authorCtx, userR, {
    projectId: project.id,
    kind: 'workflow',
    artifactKey: 'needs_connector',
    name: 'Needs connector',
    spec: { ...validWorkflow, code: 'needs_connector' },
  });
  const wf2vr = await artifacts.validateVersion(authorCtx, userR, wf2.version.id, wf2.version.version);
  t.ok(wf2vr.passed, 'the second workflow validates');
  await artifacts.addDependency(authorCtx, userR, wf2.version.id, { capabilityRef: 'connector:unknown' });
  const wf2after = await getVer(wf2.artifact.id, wf2.version.id);
  const wf2reviewed = await artifacts.requestReview(authorCtx, userR, wf2.version.id, wf2after.version);
  await t.rejects(
    artifacts.publishArtifact(approverCtx, userA, wf2.version.id, wf2reviewed.version),
    'a design referencing an UNAVAILABLE integration capability cannot be published (fail closed, m33 unbuilt)',
  );

  // --- rule design binds to the canonical m07 engine --------------------------------------------
  const validRule = {
    schemaVersion: 1,
    code: 'credit_decision',
    name: 'Credit decision',
    inputSchema: [{ name: 'score', type: 'number' }],
    outputSchema: [{ name: 'decision', type: 'string', required: true }],
    decisionTables: [
      {
        id: 't_decision',
        hitPolicy: 'FIRST',
        inputFields: ['score'],
        outputFields: ['decision'],
        rows: [
          {
            id: 'r_ok',
            when: { type: 'compare', field: 'score', op: 'ge', value: 700, valueType: 'number' },
            outputs: { decision: 'APPROVE' },
            reasonCode: 'SCORE_OK',
          },
          {
            id: 'r_low',
            when: { type: 'compare', field: 'score', op: 'lt', value: 700, valueType: 'number' },
            outputs: { decision: 'REVIEW' },
            reasonCode: 'SCORE_LOW',
          },
        ],
      },
    ],
  };
  const rule = await artifacts.createArtifact(authorCtx, userR, {
    projectId: project.id,
    kind: 'rule',
    artifactKey: 'credit_decision',
    name: 'Credit decision',
    spec: validRule,
  });
  const ruleVr = await artifacts.validateVersion(authorCtx, userR, rule.version.id, rule.version.version);
  t.ok(ruleVr.passed, 'a valid rule design passes validation');
  const ruleAfter = await getVer(rule.artifact.id, rule.version.id);
  const ruleReviewed = await artifacts.requestReview(authorCtx, userR, rule.version.id, ruleAfter.version);
  const rulePublished = await artifacts.publishArtifact(
    approverCtx,
    userA,
    rule.version.id,
    ruleReviewed.version,
  );
  t.ok(
    rulePublished.binding !== null && rulePublished.binding.targetEngine === 'rule',
    'the rule design binds to the m07 engine (opaque binding; m07 stays canonical)',
  );
});
