import { defineSuite } from '@finapp/test-runner';
import {
  M42_PERMISSIONS,
  ALL_M42_PERMISSIONS,
  M42_PRIVILEGED_PERMISSIONS,
  ALL_M42_AUDIT_CODES,
  CERT_AUDIT_PREFIX,
  CERT_DOMAINS,
  CERT_ASPECTS,
  REQUIRED_SIGNOFF_ROLES,
  isHumanActor,
  evaluateSodGate,
  evaluateCertificationDecision,
  isWaiverActive,
  isThreeSegmentPermission,
  type CertificationState,
} from '../src/index.ts';

/**
 * M42 certification PURE smoke suite. Exercises the load-bearing controls WITHOUT a database: the platform_certification.*
 * permission + CERT_ audit shape; THE DENY-BY-DEFAULT GO/CONDITIONAL_GO/NO_GO ENGINE (a caller can never set GO — every verdict
 * is derived; a missing/failed assessment, a critical open finding, a missing/failed readiness or a missing sign-off blocks GO;
 * an expired waiver stops satisfying the gate); maker-checker/SoD; and the 12 domains x 8 aspects matrix. No secret/PII here.
 */

// A fully-satisfied Stage-6 state: every domain x aspect passes, all readiness passes, all mandatory roles sign off.
function fullState(overrides: Partial<CertificationState> = {}): CertificationState {
  const assessments = CERT_DOMAINS.flatMap((d) =>
    CERT_ASPECTS.map((a) => ({ domainKey: d, aspectKey: a, status: 'pass' })),
  );
  return {
    requiredDomains: CERT_DOMAINS,
    requiredAspects: CERT_ASPECTS,
    requiredReadinessKinds: ['migration', 'uat', 'pilot', 'release'],
    requiredSignoffRoles: REQUIRED_SIGNOFF_ROLES,
    assessments,
    findings: [],
    readiness: [
      { kind: 'migration', result: 'pass' },
      { kind: 'uat', result: 'pass' },
      { kind: 'pilot', result: 'pass' },
      { kind: 'release', result: 'pass' },
    ],
    signoffs: REQUIRED_SIGNOFF_ROLES.map((r) => ({ roleKey: r, disposition: 'approve' })),
    residualConditions: 0,
    ...overrides,
  };
}

export default defineSuite('m42-certification', (t) => {
  // --- permission shape ---------------------------------------------------------------------------
  t.equal(ALL_M42_PERMISSIONS.length, 12, 'twelve platform_certification permissions');
  for (const p of ALL_M42_PERMISSIONS) {
    t.ok(p.startsWith('platform_certification.'), `${p} is in the platform_certification namespace`);
    t.equal(p.split('.').length, 3, `${p} is exactly three segments`);
  }
  t.equal(new Set(ALL_M42_PERMISSIONS).size, ALL_M42_PERMISSIONS.length, 'no duplicate permission');
  t.ok(
    !ALL_M42_PERMISSIONS.includes('platform_certification.admin' as never),
    'there is NO platform_certification.admin wildcard',
  );
  t.equal(M42_PRIVILEGED_PERMISSIONS.length, 4, 'four privileged permissions');
  t.ok(M42_PRIVILEGED_PERMISSIONS.includes(M42_PERMISSIONS.decisionIssue), 'decision.issue is privileged');
  t.ok(M42_PRIVILEGED_PERMISSIONS.includes(M42_PERMISSIONS.waiverApprove), 'waiver.approve is privileged');
  t.ok(M42_PRIVILEGED_PERMISSIONS.includes(M42_PERMISSIONS.signoffApprove), 'signoff.approve is privileged');
  t.ok(
    !M42_PRIVILEGED_PERMISSIONS.includes(M42_PERMISSIONS.programmeRead),
    'reading a programme is not privileged',
  );
  t.ok(
    isThreeSegmentPermission('platform_certification.decision.issue'),
    'a 3-segment permission is well-formed',
  );

  // --- audit shape --------------------------------------------------------------------------------
  t.equal(ALL_M42_AUDIT_CODES.length, 18, 'eighteen CERT_ audit codes');
  for (const c of ALL_M42_AUDIT_CODES) {
    t.ok(c.startsWith(CERT_AUDIT_PREFIX), `${c} carries the CERT_ prefix`);
    t.ok(c.split('_').length >= 3, `${c} is >= 3 segments`);
  }
  t.equal(new Set(ALL_M42_AUDIT_CODES).size, ALL_M42_AUDIT_CODES.length, 'no duplicate audit code');

  // --- the assessment matrix ----------------------------------------------------------------------
  t.equal(CERT_DOMAINS.length, 12, 'twelve Stage-6 domains (M30-M41)');
  t.equal(CERT_ASPECTS.length, 8, 'eight assessment aspects');
  t.ok(CERT_DOMAINS.includes('m30') && CERT_DOMAINS.includes('m41'), 'the domains span m30..m41');

  // --- maker-checker / SoD ------------------------------------------------------------------------
  t.ok(
    !isHumanActor('ai') && !isHumanActor('system') && !isHumanActor('automation') && !isHumanActor(null),
    'ai/system/automation/null are not human',
  );
  t.ok(isHumanActor('u1'), 'a concrete identity is human');
  t.ok(!evaluateSodGate('u1', 'u1').allowed, 'a certifier cannot be the requester (self-certification)');
  t.ok(!evaluateSodGate('u1', 'ai').allowed, 'AI can never certify');
  t.ok(evaluateSodGate('u1', 'u2').allowed, 'a distinct human certifier is allowed');

  // --- THE DECISION ENGINE (deny-by-default; ADR-012) ---------------------------------------------
  t.equal(
    evaluateCertificationDecision(fullState()).decision,
    'go',
    'a fully-satisfied Stage-6 state derives GO',
  );
  t.equal(
    evaluateCertificationDecision(fullState({ residualConditions: 1 })).decision,
    'conditional_go',
    'a bounded approved residual condition (Stage-7 hardening) derives CONDITIONAL_GO',
  );
  // incomplete assessment blocks GO
  t.equal(
    evaluateCertificationDecision(
      fullState({ assessments: [{ domainKey: 'm30', aspectKey: 'security', status: 'pass' }] }),
    ).decision,
    'no_go',
    'an incomplete assessment matrix blocks GO (NO_GO)',
  );
  // a failed assessment blocks GO
  {
    const s = fullState();
    const withFail = {
      ...s,
      assessments: s.assessments.map((a) =>
        a.domainKey === 'm41' && a.aspectKey === 'security' ? { ...a, status: 'fail' } : a,
      ),
    };
    t.equal(evaluateCertificationDecision(withFail).decision, 'no_go', 'a failed assessment blocks GO');
  }
  // a critical OPEN finding blocks GO
  t.equal(
    evaluateCertificationDecision(fullState({ findings: [{ severity: 'critical', status: 'open' }] }))
      .decision,
    'no_go',
    'an unresolved critical finding blocks GO',
  );
  // a critical finding waived by an ACTIVE waiver does not block
  t.equal(
    evaluateCertificationDecision(
      fullState({ findings: [{ severity: 'critical', status: 'waived', waiverActive: true }] }),
    ).decision,
    'go',
    'a critical finding with an ACTIVE waiver does not block GO',
  );
  // a critical finding whose waiver is INACTIVE (expired) still blocks
  t.equal(
    evaluateCertificationDecision(
      fullState({ findings: [{ severity: 'critical', status: 'waived', waiverActive: false }] }),
    ).decision,
    'no_go',
    'an EXPIRED waiver stops satisfying the gate (critical still blocks)',
  );
  // missing readiness blocks GO
  t.equal(
    evaluateCertificationDecision(fullState({ readiness: [{ kind: 'migration', result: 'pass' }] })).decision,
    'no_go',
    'a missing mandatory readiness blocks GO',
  );
  // failed readiness blocks GO
  t.equal(
    evaluateCertificationDecision(
      fullState({
        readiness: [
          { kind: 'migration', result: 'fail' },
          { kind: 'uat', result: 'pass' },
          { kind: 'pilot', result: 'pass' },
          { kind: 'release', result: 'pass' },
        ],
      }),
    ).decision,
    'no_go',
    'a failed mandatory readiness blocks GO',
  );
  // missing sign-off blocks GO
  t.equal(
    evaluateCertificationDecision(
      fullState({ signoffs: [{ roleKey: 'engineering', disposition: 'approve' }] }),
    ).decision,
    'no_go',
    'a missing mandatory sign-off blocks GO',
  );
  // a rejection blocks GO
  t.equal(
    evaluateCertificationDecision(
      fullState({
        signoffs: [
          ...REQUIRED_SIGNOFF_ROLES.map((r) => ({ roleKey: r, disposition: 'approve' })),
          { roleKey: 'security', disposition: 'reject' },
        ],
      }),
    ).decision,
    'no_go',
    'a sign-off rejection blocks GO',
  );

  // --- waiver expiry ------------------------------------------------------------------------------
  const now = new Date('2026-08-16T00:00:00Z');
  t.ok(
    isWaiverActive('approved', new Date('2026-12-01T00:00:00Z'), now),
    'an approved, unexpired waiver is active',
  );
  t.ok(
    !isWaiverActive('approved', new Date('2026-01-01T00:00:00Z'), now),
    'an approved but EXPIRED waiver is inactive',
  );
  t.ok(
    !isWaiverActive('requested', new Date('2026-12-01T00:00:00Z'), now),
    'a non-approved waiver is inactive',
  );
  t.ok(
    !isWaiverActive('approved', null, now),
    'an approved waiver with no expiry is inactive (an expiry is mandatory)',
  );
});
