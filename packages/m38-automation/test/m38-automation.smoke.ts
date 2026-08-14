import { defineSuite } from '@finapp/test-runner';
import {
  M38_PERMISSIONS,
  ALL_M38_PERMISSIONS,
  M38_PRIVILEGED_PERMISSIONS,
  ALL_M38_AUDIT_CODES,
  AUTOMATION_AUDIT_PREFIX,
  EXTENSION_AUDIT_PREFIX,
  AUTOMATION_STATES,
  isAutomationFrozen,
  isHumanActor,
  evaluateSodGate,
  evaluateActivationGate,
  parseRecurrence,
  validateRecurrence,
  computeNextRun,
  isThreeSegmentPermission,
  screenSteps,
  validateAutomation,
  isSecretReference,
  REASON_CODES,
} from '../src/index.ts';

/**
 * M38 Scheduler/Automation/Extensions PURE smoke suite. Exercises the load-bearing controls WITHOUT a database: the
 * automation./extensions. permission + AUTOMATION_/EXTENSION_ audit shape; maker-checker/SoD + activation gates; the
 * GOVERNED recurrence parser (bounded vocabulary, frequency floor — no cron/shell); the CAPABILITY-FACADE rule (every step
 * carries a 3-segment m02 permission; no raw code); the secret seam.
 */
export default defineSuite('m38-automation', (t) => {
  // --- permission shape ---------------------------------------------------------------------------
  t.equal(ALL_M38_PERMISSIONS.length, 9, 'nine automation.*/extensions.* permissions');
  for (const p of ALL_M38_PERMISSIONS) {
    t.ok(
      p.startsWith('automation.') || p.startsWith('extensions.'),
      `${p} is in the automation/extensions namespace`,
    );
    t.equal(p.split('.').length, 3, `${p} is exactly three segments`);
  }
  t.equal(new Set(ALL_M38_PERMISSIONS).size, ALL_M38_PERMISSIONS.length, 'no duplicate permission');
  t.ok(!ALL_M38_PERMISSIONS.includes('automation.admin' as never), 'there is NO automation.admin wildcard');
  t.ok(!ALL_M38_PERMISSIONS.includes('extensions.admin' as never), 'there is NO extensions.admin wildcard');
  t.equal(M38_PRIVILEGED_PERMISSIONS.length, 3, 'three privileged permissions');
  t.ok(
    M38_PRIVILEGED_PERMISSIONS.includes(M38_PERMISSIONS.jobActivate),
    'automation activation is privileged',
  );
  t.ok(
    M38_PRIVILEGED_PERMISSIONS.includes(M38_PERMISSIONS.extensionPublish),
    'extension publish is privileged',
  );
  t.ok(!M38_PRIVILEGED_PERMISSIONS.includes(M38_PERMISSIONS.jobManage), 'authoring is not privileged');

  // --- audit shape --------------------------------------------------------------------------------
  t.equal(ALL_M38_AUDIT_CODES.length, 20, 'twenty AUTOMATION_/EXTENSION_ audit codes');
  for (const c of ALL_M38_AUDIT_CODES) {
    t.ok(
      c.startsWith(AUTOMATION_AUDIT_PREFIX) || c.startsWith(EXTENSION_AUDIT_PREFIX),
      `${c} carries the AUTOMATION_/EXTENSION_ prefix`,
    );
    t.ok(c.split('_').length >= 3, `${c} is >= 3 segments`);
  }
  t.equal(new Set(ALL_M38_AUDIT_CODES).size, ALL_M38_AUDIT_CODES.length, 'no duplicate audit code');

  // --- vocabulary ---------------------------------------------------------------------------------
  t.ok(
    AUTOMATION_STATES.includes('active') && AUTOMATION_STATES.includes('archived'),
    'automation states include active/archived',
  );
  t.ok(isAutomationFrozen('archived'), 'archived is terminal');
  t.ok(!isAutomationFrozen('active'), 'active is not terminal');

  // --- maker-checker / SoD + activation -----------------------------------------------------------
  t.ok(!evaluateSodGate('u1', 'u1').allowed, 'the approver cannot be the requester (self-approval)');
  t.ok(!evaluateSodGate('u1', 'ai').allowed, 'AI cannot approve');
  t.ok(!evaluateSodGate('u1', 'automation').allowed, 'an automation actor cannot approve');
  t.ok(evaluateSodGate('u1', 'u2').allowed, 'a distinct human approver is allowed');
  t.ok(
    !evaluateActivationGate({ validationPassed: false, requestedBy: 'u1', approver: 'u2' }).allowed,
    'an unvalidated automation cannot be activated',
  );
  t.ok(
    evaluateActivationGate({ validationPassed: true, requestedBy: 'u1', approver: 'u2' }).allowed,
    'a validated + independently-approved automation can be activated',
  );
  t.ok(!isHumanActor('automation'), 'automation is not human');

  // --- GOVERNED recurrence (bounded vocabulary; frequency floor; no cron/shell) --------------------
  t.equal(parseRecurrence('hourly'), 3600, 'hourly parses to 3600s');
  t.equal(parseRecurrence('daily'), 86400, 'daily parses to 86400s');
  t.equal(parseRecurrence('every:3600'), 3600, 'every:<seconds> parses');
  t.equal(parseRecurrence('* * * * *'), null, 'a raw cron expression is NOT accepted (no cron)');
  t.equal(parseRecurrence('rm -rf /'), null, 'a shell string is NOT accepted');
  t.equal(validateRecurrence('daily').length, 0, 'a daily recurrence is valid');
  t.ok(
    validateRecurrence('every:5').length > 0,
    'a 5-second recurrence is refused (below the frequency floor)',
  );
  t.equal(
    validateRecurrence('every:5')[0]?.code,
    REASON_CODES.frequencyTooHigh,
    'the finding is recurrence_frequency_too_high (no job storm)',
  );
  t.ok(validateRecurrence('nonsense').length > 0, 'an unparseable recurrence is refused');
  t.equal(
    computeNextRun('hourly', 1000),
    1000 + 3600,
    'the next run is computed from the interval (deterministic)',
  );
  t.equal(computeNextRun('nonsense', 1000), null, 'an invalid recurrence yields no next run');

  // --- CAPABILITY-FACADE rule: a step carries a 3-segment m02 permission (no raw code) --------------
  t.ok(isThreeSegmentPermission('finance.journal.post'), 'a 3-segment permission is well-formed');
  t.ok(!isThreeSegmentPermission('post'), 'a 1-segment permission is rejected');
  t.equal(
    screenSteps([{ capabilityRef: 'workflow:advance', requiredPermission: 'workflow.instance.advance' }])
      .length,
    0,
    'a step with a required permission passes the facade rule',
  );
  t.ok(
    screenSteps([{ capabilityRef: 'x', requiredPermission: 'post' }]).length > 0,
    'a step without a 3-segment permission is rejected (never bypasses RBAC)',
  );
  t.equal(
    screenSteps([{ capabilityRef: 'x', requiredPermission: 'post' }])[0]?.code,
    REASON_CODES.missingRequiredPermission,
    'the finding is step_missing_required_permission',
  );

  // --- automation validation ----------------------------------------------------------------------
  t.ok(
    validateAutomation({
      automationKey: 'nightly',
      triggerKind: 'schedule',
      steps: [{ capabilityRef: 'notify:send', requiredPermission: 'notifications.message.send' }],
    }).passed,
    'a valid automation passes',
  );
  t.ok(
    !validateAutomation({
      automationKey: '',
      triggerKind: 'schedule',
      steps: [{ capabilityRef: 'x', requiredPermission: 'a.b.c' }],
    }).passed,
    'an empty automation key fails',
  );
  t.ok(
    !validateAutomation({ automationKey: 'a', triggerKind: 'schedule', steps: [] }).passed,
    'an automation with no steps fails',
  );
  t.ok(
    !validateAutomation({
      automationKey: 'a',
      triggerKind: 'ghost',
      steps: [{ capabilityRef: 'x', requiredPermission: 'a.b.c' }],
    }).passed,
    'an unknown trigger kind fails',
  );

  // --- secret seam --------------------------------------------------------------------------------
  t.ok(isSecretReference('secretref:vault/kv/x'), 'the secretref pattern is reused from the m30 seam');
  t.ok(!isSecretReference('raw-secret'), 'a raw secret value is not a secretref');
});
