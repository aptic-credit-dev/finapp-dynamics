import { defineSuite } from '@finapp/test-runner';
import {
  M31_PERMISSIONS,
  ALL_M31_PERMISSIONS,
  M31_PRIVILEGED_PERMISSIONS,
  ALL_M31_AUDIT_CODES,
  STUDIO_AUDIT_PREFIX,
  ARTIFACT_KINDS,
  VERSION_STATES,
  isVersionFrozen,
  targetEngineForKind,
  isHumanActor,
  evaluateSodGate,
  evaluatePublishGate,
  validateArtifactSpec,
  validateFormSchema,
  scanSpecForProhibited,
  isSecretReference,
  REASON_CODES,
} from '../src/index.ts';
import { contentHashOf } from '../src/artifact.service.ts';

/**
 * M31 Studio PURE smoke suite. Exercises the design-time domain WITHOUT a database: the studio.* permission +
 * STUDIO_ audit shape; the maker-checker/SoD + publish gates (AI/self-approval refused); fail-closed VALIDATION
 * reusing the canonical validators (a prohibited execution expression, a raw secret VALUE, an invalid workflow
 * condition and an invalid form schema all fail; a well-formed declarative design + opaque secretref passes).
 */
export default defineSuite('m31-studio', (t) => {
  // --- permission shape ---------------------------------------------------------------------------
  t.equal(ALL_M31_PERMISSIONS.length, 9, 'nine studio.* permissions');
  for (const p of ALL_M31_PERMISSIONS) {
    t.ok(p.startsWith('studio.'), `${p} is in the studio namespace`);
    t.equal(p.split('.').length, 3, `${p} is exactly three segments (kernel @Endpoint rule)`);
  }
  t.equal(new Set(ALL_M31_PERMISSIONS).size, ALL_M31_PERMISSIONS.length, 'no duplicate permission');
  t.ok(!ALL_M31_PERMISSIONS.includes('studio.admin' as never), 'there is NO studio.admin wildcard');
  t.ok(
    M31_PRIVILEGED_PERMISSIONS.includes(M31_PERMISSIONS.artifactPublish),
    'publish is a privileged controlled action',
  );
  t.ok(
    !M31_PRIVILEGED_PERMISSIONS.includes(M31_PERMISSIONS.artifactAuthor),
    'authoring is not privileged (publish is the controlled step)',
  );
  t.equal(
    M31_PERMISSIONS.administer,
    'studio.control.administer',
    'the control-plane permission is 3-segment',
  );

  // --- audit shape --------------------------------------------------------------------------------
  t.equal(ALL_M31_AUDIT_CODES.length, 14, 'fourteen STUDIO_ audit codes');
  for (const c of ALL_M31_AUDIT_CODES) {
    t.ok(c.startsWith(STUDIO_AUDIT_PREFIX), `${c} carries the STUDIO_ prefix`);
    t.ok(c.split('_').length >= 3, `${c} is >= 3 segments`);
  }
  t.equal(new Set(ALL_M31_AUDIT_CODES).size, ALL_M31_AUDIT_CODES.length, 'no duplicate audit code');

  // --- vocabulary ---------------------------------------------------------------------------------
  t.deepEqual([...ARTIFACT_KINDS], ['workflow', 'rule', 'form'], 'three artifact kinds');
  t.equal(targetEngineForKind('workflow'), 'workflow', 'a workflow design binds to the m06 engine');
  t.equal(targetEngineForKind('rule'), 'rule', 'a rule design binds to the m07 engine');
  t.equal(targetEngineForKind('form'), 'none', 'a form design binds to no runtime engine');
  t.ok(
    isVersionFrozen('published') && isVersionFrozen('superseded') && isVersionFrozen('archived'),
    'terminal states are frozen',
  );
  t.ok(!isVersionFrozen('draft') && !isVersionFrozen('validated'), 'draft/validated are not frozen');
  t.ok(VERSION_STATES.includes('review_pending'), 'review_pending is a version state');

  // --- isHumanActor: AI never approves ------------------------------------------------------------
  t.ok(!isHumanActor(null), 'null is not human');
  t.ok(!isHumanActor(''), 'blank is not human');
  t.ok(!isHumanActor('system'), 'system is not human');
  t.ok(!isHumanActor('ai'), 'ai is not human');
  t.ok(!isHumanActor('automation'), 'automation is not human');
  t.ok(isHumanActor('user-123'), 'a real user id is human');

  // --- maker-checker / SoD ------------------------------------------------------------------------
  t.ok(!evaluateSodGate('u1', 'u1').allowed, 'the approver cannot be the requester (self-approval)');
  t.equal(evaluateSodGate('u1', 'u1').reasonCode, REASON_CODES.selfApproval, 'self-approval reason code');
  t.ok(!evaluateSodGate('u1', 'ai').allowed, 'AI cannot approve');
  t.ok(!evaluateSodGate('u1', null).allowed, 'a null approver is refused');
  t.ok(evaluateSodGate('u1', 'u2').allowed, 'a distinct human approver is allowed');

  // --- publish gate -------------------------------------------------------------------------------
  t.ok(
    !evaluatePublishGate({ validationPassed: false, requestedBy: 'u1', approver: 'u2', hasBinding: true })
      .allowed,
    'a design that failed validation cannot be published',
  );
  t.ok(
    !evaluatePublishGate({ validationPassed: true, requestedBy: 'u1', approver: 'u2', hasBinding: false })
      .allowed,
    'a design without a valid binding cannot be published',
  );
  t.ok(
    !evaluatePublishGate({ validationPassed: true, requestedBy: 'u1', approver: 'u1', hasBinding: true })
      .allowed,
    'a self-approved design cannot be published',
  );
  t.ok(
    evaluatePublishGate({ validationPassed: true, requestedBy: 'u1', approver: 'u2', hasBinding: true })
      .allowed,
    'a validated + independently-approved + bound design can be published',
  );

  // --- form schema validation (declarative; m31 is the canonical forms owner) ---------------------
  const goodForm = {
    schemaVersion: 1,
    key: 'onboarding',
    name: 'Onboarding',
    sections: [
      {
        key: 's1',
        title: 'Basics',
        fields: [
          { key: 'full_name', label: 'Full name', type: 'text', required: true },
          { key: 'age', label: 'Age', type: 'number' },
          { key: 'newsletter', label: 'Newsletter', type: 'boolean', visibleWhen: { field: 'age' } },
        ],
      },
    ],
  };
  t.ok(validateFormSchema(goodForm).passed, 'a well-formed declarative form schema passes');
  t.ok(validateArtifactSpec('form', goodForm).passed, 'validateArtifactSpec passes the good form');
  const badType = {
    schemaVersion: 1,
    key: 'k',
    name: 'k',
    sections: [{ key: 's', title: 's', fields: [{ key: 'f', label: 'f', type: 'executable' }] }],
  };
  t.ok(!validateFormSchema(badType).passed, 'an unknown field type is rejected (no arbitrary types)');
  const dupKey = {
    schemaVersion: 1,
    key: 'k',
    name: 'k',
    sections: [
      {
        key: 's',
        title: 's',
        fields: [
          { key: 'f', label: 'f', type: 'text' },
          { key: 'f', label: 'f2', type: 'number' },
        ],
      },
    ],
  };
  t.ok(!validateFormSchema(dupKey).passed, 'a duplicate field key is rejected');
  const badVis = {
    schemaVersion: 1,
    key: 'k',
    name: 'k',
    sections: [
      {
        key: 's',
        title: 's',
        fields: [{ key: 'f', label: 'f', type: 'text', visibleWhen: { field: 'nope' } }],
      },
    ],
  };
  t.ok(!validateFormSchema(badVis).passed, 'conditional visibility must reference an existing field');

  // --- NO arbitrary code: prohibited expression / SQL / shell fail closed -------------------------
  t.ok(scanSpecForProhibited({ hook: "eval('do bad')" }).length > 0, 'an eval() expression is rejected');
  t.ok(
    scanSpecForProhibited({ q: 'SELECT secret FROM users WHERE 1=1' }).length > 0,
    'an embedded SQL statement is rejected',
  );
  t.ok(
    scanSpecForProhibited({ cmd: 'require("child_process").exec("rm -rf /")' }).length > 0,
    'a shell/child_process expression is rejected',
  );
  t.ok(
    scanSpecForProhibited({ label: 'Total amount', hint: 'enter a value' }).length === 0,
    'plain declarative text is fine',
  );

  // --- secrets: a secret-keyed field must be an opaque secretref: pointer, never a raw value -------
  const secretLiteral = validateArtifactSpec('form', {
    schemaVersion: 1,
    key: 'k',
    name: 'k',
    sections: [{ key: 's', title: 's', fields: [{ key: 'api_key', label: 'API key', type: 'text' }] }],
    settings: { api_key: 'sk-live-1234567890' },
  });
  t.ok(!secretLiteral.passed, 'a raw secret VALUE in a secret-keyed field is rejected');
  t.ok(
    secretLiteral.findings.some((f) => f.code === REASON_CODES.secretValueForbidden),
    'the finding is secret_value_forbidden',
  );
  const secretRef = validateArtifactSpec('form', {
    schemaVersion: 1,
    key: 'k',
    name: 'k',
    sections: [{ key: 's', title: 's', fields: [{ key: 'x', label: 'x', type: 'text' }] }],
    settings: { api_key: 'secretref:vault/kv/smtp' },
  });
  t.ok(secretRef.passed, 'an opaque secretref: pointer in a secret-keyed field is accepted');
  t.ok(isSecretReference('secretref:vault/kv/smtp'), 'the secretref pattern is reused from the m30 seam');

  // --- workflow condition compiled through the m06 sandbox (invalid/prohibited -> fail) -----------
  const badWorkflow = {
    schemaVersion: 1,
    code: 'wf',
    name: 'wf',
    variables: [{ name: 'amount', type: 'number' }],
    nodes: [],
    transitions: [{ from: 'a', to: 'b', condition: 'eval(1)' }],
  };
  const wfOutcome = validateArtifactSpec('workflow', badWorkflow);
  t.ok(!wfOutcome.passed, 'a workflow whose condition is not a safe sandbox expression fails validation');

  // --- content hash is deterministic --------------------------------------------------------------
  t.equal(contentHashOf({ a: 1, b: 2 }), contentHashOf({ a: 1, b: 2 }), 'content hash is deterministic');
  t.ok(contentHashOf({ a: 1 }) !== contentHashOf({ a: 2 }), 'different specs hash differently');
});
