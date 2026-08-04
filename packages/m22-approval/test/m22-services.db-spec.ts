import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import { APPROVAL_LIFECYCLE_FAMILY } from '@finapp/contracts';
import {
  M22Emitter,
  ApprovalRepository,
  CatalogService,
  RequestService,
  DecisionService,
  DelegationService,
  EscalationService,
  M22_PERMISSIONS,
  ALL_M22_PERMISSIONS,
  FixedClock,
} from '@finapp/m22-approval';

/**
 * M22 services DB spec — proves the approval workflow END TO END on a REAL PostgreSQL: publish a policy; create an
 * approval request (idempotent) for a controlled action, instantiate its steps, record maker + preparer participants;
 * submit (workflow + SLA-timer + notify hooks recorded as m06/m08 evidence); then the maker-checker + Segregation-of-
 * Duties core — the MAKER cannot approve their own request, the PREPARER cannot be the required checker, a DELEGATE
 * acting for the maker cannot launder SoD, and the SAME actor cannot supply a required second approval; a DISTINCT
 * checker approves, meeting quorum, releasing the approval reference downstream posting is gated on; reject; return +
 * controlled resubmission; controlled cancellation; clock-driven single-fire, depth-bounded escalation; a privileged
 * override that STILL honours SoD; optimistic-concurrency CAS (stale-version rejection); default deny; APPROVAL_ audit
 * + approval.lifecycle events with NO subject narrative in payloads; and cross-tenant isolation. m22 NEVER approves on
 * behalf of a human and NEVER posts.
 */
export default defineDbSpec('m22-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const emitter = new M22Emitter(audit, outbox);
  const repo = new ApprovalRepository();
  const clock = new FixedClock(1_760_000_000_000);
  const catalog = new CatalogService(db, authz, emitter, repo);
  const requests = new RequestService(db, authz, emitter, repo, clock);
  const decisions = new DecisionService(db, authz, emitter, repo);
  const delegations = new DelegationService(db, authz, emitter, repo);
  const escalations = new EscalationService(db, authz, emitter, repo);

  const tenant = randomUUID();
  const maker = randomUUID();
  const preparer = randomUUID();
  const checker = randomUUID();
  const checker2 = randomUUID();
  const ctxOf = (userId: string, perms: readonly string[]): RequestContext => ({
    tenantId: tenant,
    userId,
    correlationId: randomUUID(),
    permissions: [...perms],
  });
  const makerCtx = ctxOf(maker, ALL_M22_PERMISSIONS);
  const checkerCtx = ctxOf(checker, ALL_M22_PERMISSIONS);
  const checker2Ctx = ctxOf(checker2, ALL_M22_PERMISSIONS);
  const preparerCtx = ctxOf(preparer, ALL_M22_PERMISSIONS);
  const SECRET_TITLE = `APPROVAL-NARRATIVE-${randomUUID()}`;

  // --- publish a policy -------------------------------------------------------------------------
  const { policy } = await catalog.createPolicy(makerCtx, maker, {
    subjectType: 'journal_posting',
    scope: 'default',
    name: 'Journal posting approval',
    requiredApprovals: 1,
    sodMode: 'strict',
    steps: [
      { level: 1, requiredPermission: M22_PERMISSIONS.decisionApprove, sodConstraint: 'maker_checker' },
    ],
  });
  const publishedPolicy = await catalog.publishPolicy(makerCtx, maker, policy.id, policy.version);
  t.equal(publishedPolicy.status, 'active', 'a policy publishes to active');

  // helper: create + submit a pending request whose maker is `maker` and preparer is `preparer`.
  const newPending = async (opts?: { requiredApprovals?: number; title?: string }) => {
    const created = await requests.createRequest(makerCtx, maker, {
      subjectType: 'journal_posting',
      subjectRef: randomUUID(),
      title: opts?.title ?? 'post journal',
      amountMinor: 500000,
      preparedBy: preparer,
      ...(opts?.requiredApprovals !== undefined ? { requiredApprovals: opts.requiredApprovals } : {}),
    });
    const submitted = await requests.submitRequest(
      makerCtx,
      maker,
      created.request.id,
      created.request.version,
    );
    return submitted;
  };

  // --- idempotent create ------------------------------------------------------------------------
  const key = `req-${randomUUID()}`;
  const a1 = await requests.createRequest(makerCtx, maker, {
    subjectType: 'journal_posting',
    idempotencyKey: key,
  });
  const a2 = await requests.createRequest(makerCtx, maker, {
    subjectType: 'journal_posting',
    idempotencyKey: key,
  });
  t.equal(a1.request.id, a2.request.id, 'request creation is idempotent per key (no duplicate request)');

  // --- steps + participants recorded ------------------------------------------------------------
  const first = await newPending({ title: SECRET_TITLE });
  t.equal(first.status, 'pending', 'a submitted request is pending');
  const detail = await requests.getRequest(makerCtx, first.id);
  t.ok(detail.steps.length >= 1, 'the request instantiated its policy steps');
  const parts = await db.withTenant(makerCtx, (tx) => repo.listParticipants(tx, first.id));
  t.ok(
    parts.some((p) => p.role === 'maker' && p.actor === maker) &&
      parts.some((p) => p.role === 'preparer' && p.actor === preparer),
    'the maker and preparer are recorded as participants (the SoD basis)',
  );

  // workflow + notification hooks recorded as evidence
  const links = await db.withTenant(makerCtx, (tx) => repo.listWorkflowLinks(tx, first.id));
  const notifs = await db.withTenant(makerCtx, (tx) => repo.listNotifications(tx, first.id));
  t.ok(
    links.length >= 1,
    'submitting records an m06 workflow link (workflow hook; m22 owns no workflow engine)',
  );
  t.ok(
    notifs.length >= 1,
    'submitting records an m08 notification dispatch (notify hook; m22 owns no notify engine)',
  );

  // --- maker cannot approve their own request (maker != checker) --------------------------------
  await t.rejects(
    decisions.recordDecision(makerCtx, maker, first.id, first.version, { decision: 'approve' }),
    'the maker cannot approve their own request (maker != checker / SoD)',
  );
  t.ok(
    audit.entries.some((e) => e.code === 'APPROVAL_SOD_BLOCKED'),
    'a blocked SoD attempt is audited (fail closed — never silent)',
  );

  // --- the preparer cannot be the required checker ----------------------------------------------
  await t.rejects(
    decisions.recordDecision(preparerCtx, preparer, first.id, first.version, { decision: 'approve' }),
    'the preparer cannot act as the required checker (preparer != checker)',
  );

  // --- a distinct checker approves -> approved + outcome released --------------------------------
  const approved = await decisions.recordDecision(checkerCtx, checker, first.id, first.version, {
    decision: 'approve',
  });
  t.equal(approved.request.status, 'approved', 'a distinct checker approves the request');
  const outcome = await db.withTenant(makerCtx, (tx) => repo.findOutcome(tx, first.id));
  t.ok(
    outcome !== null &&
      outcome.outcome === 'approved' &&
      outcome.released &&
      outcome.final_approver === checker,
    'approval releases an outcome naming the final approver (the approval reference m21/m23 gate posting on)',
  );

  // --- two-approver quorum: the same actor cannot supply both approvals -------------------------
  const dual = await newPending({ requiredApprovals: 2 });
  const afterFirst = await decisions.recordDecision(checkerCtx, checker, dual.id, dual.version, {
    decision: 'approve',
  });
  t.equal(
    afterFirst.request.status,
    'pending',
    'with a 2-approver quorum, one approval leaves the request pending',
  );
  await t.rejects(
    decisions.recordDecision(checkerCtx, checker, dual.id, afterFirst.request.version, {
      decision: 'approve',
    }),
    'the same actor cannot supply the required second approval (single-approver SoD block)',
  );
  const afterSecond = await decisions.recordDecision(
    checker2Ctx,
    checker2,
    dual.id,
    afterFirst.request.version,
    {
      decision: 'approve',
    },
  );
  t.equal(afterSecond.request.status, 'approved', 'a distinct second approver meets the quorum and approves');

  // --- reject -----------------------------------------------------------------------------------
  const toReject = await newPending();
  const rejected = await decisions.recordDecision(checkerCtx, checker, toReject.id, toReject.version, {
    decision: 'reject',
    reason: 'insufficient support',
  });
  t.equal(rejected.request.status, 'rejected', 'a checker can reject a request');

  // --- return for changes + controlled resubmission ---------------------------------------------
  const toReturn = await newPending();
  const returned = await decisions.recordDecision(checkerCtx, checker, toReturn.id, toReturn.version, {
    decision: 'return',
    reason: 'fix the coding',
  });
  t.equal(returned.request.status, 'returned', 'a checker can return a request for changes');
  const resubmitted = await requests.resubmitRequest(makerCtx, maker, toReturn.id, returned.request.version);
  t.equal(resubmitted.status, 'pending', 'a returned request can be resubmitted (controlled resubmission)');

  // --- controlled cancellation ------------------------------------------------------------------
  const toCancel = await newPending();
  const cancelled = await requests.cancelRequest(
    makerCtx,
    maker,
    toCancel.id,
    toCancel.version,
    'no longer needed',
  );
  t.equal(cancelled.status, 'cancelled', 'a request can be cancelled (controlled cancellation)');
  await t.rejects(
    requests.cancelRequest(makerCtx, maker, toCancel.id, cancelled.version, 'again'),
    'a cancelled (terminal) request cannot be cancelled again (terminal-state protection)',
  );

  // --- delegated approver cannot bypass SoD -----------------------------------------------------
  const delegForMaker = await delegations.grantDelegation(makerCtx, maker, {
    delegator: maker,
    delegate: checker,
    subjectType: 'journal_posting',
  });
  t.equal(delegForMaker.status, 'active', 'a delegation is granted');
  const delTarget = await newPending();
  await t.rejects(
    decisions.recordDecision(checkerCtx, checker, delTarget.id, delTarget.version, {
      decision: 'approve',
      onBehalfOf: maker,
    }),
    'a delegate acting for the maker cannot bypass SoD (delegated approver cannot launder maker-checker)',
  );

  // a delegation from a NON-maker is fine — SoD only blocks laundering the maker.
  const thirdParty = randomUUID();
  await delegations.grantDelegation(makerCtx, maker, {
    delegator: thirdParty,
    delegate: checker,
    subjectType: 'journal_posting',
  });
  const okDeleg = await newPending();
  const viaDeleg = await decisions.recordDecision(checkerCtx, checker, okDeleg.id, okDeleg.version, {
    decision: 'approve',
    onBehalfOf: thirdParty,
  });
  t.equal(viaDeleg.request.status, 'approved', 'a delegate acting for a non-maker delegator may approve');

  // --- clock-driven, single-fire, depth-bounded escalation --------------------------------------
  const toEscalate = await newPending();
  const esc1 = await escalations.fireEscalation(makerCtx, maker, toEscalate.id, {
    toLevel: 2,
    mode: 'notify_only',
    timerRef: randomUUID(),
  });
  t.equal(esc1.to_level, 2, 'an SLA escalation fires to the next level');
  const esc2 = await escalations.fireEscalation(makerCtx, maker, toEscalate.id, {
    toLevel: 2,
    mode: 'notify_only',
  });
  t.equal(
    esc1.id,
    esc2.id,
    'a second escalation to the same level is a safe no-op (single-fire; no duplicate)',
  );

  // --- override honours SoD ---------------------------------------------------------------------
  const toOverride = await newPending();
  await t.rejects(
    decisions.overrideDecision(makerCtx, maker, toOverride.id, toOverride.version, {
      overrideType: 'override_approve',
      justification: 'urgent',
    }),
    'the maker cannot override-approve their own request (SoD applies to overrides)',
  );
  const overridden = await decisions.overrideDecision(
    checkerCtx,
    checker,
    toOverride.id,
    toOverride.version,
    {
      overrideType: 'override_approve',
      justification: 'urgent close',
    },
  );
  t.equal(
    overridden.request.status,
    'approved',
    'a distinct actor may override-approve (still not the maker)',
  );

  // --- optimistic concurrency (stale submit rejects) --------------------------------------------
  const staleTarget = await requests.createRequest(makerCtx, maker, { subjectType: 'journal_posting' });
  await t.rejects(
    requests.submitRequest(makerCtx, maker, staleTarget.request.id, staleTarget.request.version + 99),
    'a stale expectedVersion is rejected (optimistic concurrency / stale-version rejection)',
  );

  // --- default deny: an actor lacking the approve permission is refused --------------------------
  const noApprove = ctxOf(
    checker,
    ALL_M22_PERMISSIONS.filter((p) => p !== M22_PERMISSIONS.decisionApprove),
  );
  const denyTarget = await newPending();
  await t.rejects(
    decisions.recordDecision(noApprove, checker, denyTarget.id, denyTarget.version, { decision: 'approve' }),
    'approving without the approve permission is refused (default deny)',
  );

  // --- audit + event payloads carry NO subject narrative ----------------------------------------
  const events = outbox.events.filter((e) => e.family === APPROVAL_LIFECYCLE_FAMILY);
  t.ok(events.length >= 8, 'approval.lifecycle events were published on the shared outbox');
  t.ok(
    !JSON.stringify(events).includes(SECRET_TITLE),
    'no request title appears in any event payload (data minimisation)',
  );
  t.ok(
    !JSON.stringify(audit.entries).includes(SECRET_TITLE),
    'no request title appears in any audit entry (data minimisation)',
  );

  // --- cross-tenant isolation -------------------------------------------------------------------
  const otherTenant: RequestContext = { ...makerCtx, tenantId: randomUUID() };
  await t.rejects(
    requests.getRequest(otherTenant, first.id),
    "another tenant cannot read this tenant's request (RLS)",
  );
});
