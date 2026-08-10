import { defineSuite } from '@finapp/test-runner';
import {
  M33_PERMISSIONS,
  ALL_M33_PERMISSIONS,
  M33_PRIVILEGED_PERMISSIONS,
  ALL_M33_AUDIT_CODES,
  INTEGRATION_AUDIT_PREFIX,
  CONNECTOR_STATES,
  isConnectorFrozen,
  isHumanActor,
  evaluateSodGate,
  evaluatePublishGate,
  screenConnectionConfig,
  validateConnectorDefinition,
  isSecretReference,
  REASON_CODES,
  contentHashOf,
} from '../src/index.ts';

/**
 * M33 Integration PURE smoke suite. Exercises the load-bearing controls WITHOUT a database: the integration.* permission +
 * INTEGRATION_ audit shape; maker-checker/SoD + publish gates; the SECRET-SEAM screening (a raw secret value in a config
 * fails closed; an opaque secretref: pointer passes); connector-definition validation.
 */
export default defineSuite('m33-integration', (t) => {
  // --- permission shape ---------------------------------------------------------------------------
  t.equal(ALL_M33_PERMISSIONS.length, 9, 'nine integration.* permissions');
  for (const p of ALL_M33_PERMISSIONS) {
    t.ok(p.startsWith('integration.'), `${p} is in the integration namespace`);
    t.equal(p.split('.').length, 3, `${p} is exactly three segments`);
  }
  t.equal(new Set(ALL_M33_PERMISSIONS).size, ALL_M33_PERMISSIONS.length, 'no duplicate permission');
  t.ok(!ALL_M33_PERMISSIONS.includes('integration.admin' as never), 'there is NO integration.admin wildcard');
  t.equal(M33_PRIVILEGED_PERMISSIONS.length, 4, 'four privileged permissions');
  t.ok(
    M33_PRIVILEGED_PERMISSIONS.includes(M33_PERMISSIONS.connectorPublish),
    'connector publish is privileged (controlled action)',
  );
  t.ok(
    M33_PRIVILEGED_PERMISSIONS.includes(M33_PERMISSIONS.runExecute),
    'run execute is privileged (external access)',
  );
  t.ok(
    M33_PRIVILEGED_PERMISSIONS.includes(M33_PERMISSIONS.connectionManage),
    'connection manage is privileged (secrets)',
  );
  t.ok(!M33_PRIVILEGED_PERMISSIONS.includes(M33_PERMISSIONS.connectorAuthor), 'authoring is not privileged');

  // --- audit shape --------------------------------------------------------------------------------
  t.equal(ALL_M33_AUDIT_CODES.length, 15, 'fifteen INTEGRATION_ audit codes');
  for (const c of ALL_M33_AUDIT_CODES) {
    t.ok(c.startsWith(INTEGRATION_AUDIT_PREFIX), `${c} carries the INTEGRATION_ prefix`);
    t.ok(c.split('_').length >= 3, `${c} is >= 3 segments`);
  }
  t.equal(new Set(ALL_M33_AUDIT_CODES).size, ALL_M33_AUDIT_CODES.length, 'no duplicate audit code');

  // --- vocabulary ---------------------------------------------------------------------------------
  t.ok(
    CONNECTOR_STATES.includes('published') && CONNECTOR_STATES.includes('deprecated'),
    'connector states include published/deprecated',
  );
  t.ok(isConnectorFrozen('rejected'), 'rejected is terminal');
  t.ok(!isConnectorFrozen('published'), 'published is not terminal (may move to deprecated)');

  // --- maker-checker / SoD ------------------------------------------------------------------------
  t.ok(!evaluateSodGate('u1', 'u1').allowed, 'the approver cannot be the requester (self-approval)');
  t.ok(!evaluateSodGate('u1', 'ai').allowed, 'AI cannot approve');
  t.ok(!evaluateSodGate('u1', null).allowed, 'a null approver is refused');
  t.ok(evaluateSodGate('u1', 'u2').allowed, 'a distinct human approver is allowed');
  t.ok(
    !evaluatePublishGate({ validationPassed: false, requestedBy: 'u1', approver: 'u2' }).allowed,
    'an unvalidated connector cannot be published',
  );
  t.ok(
    evaluatePublishGate({ validationPassed: true, requestedBy: 'u1', approver: 'u2' }).allowed,
    'a validated + independently-approved connector can be published',
  );
  t.ok(!isHumanActor('automation'), 'automation is not human');

  // --- SECRET SEAM: a raw secret value in a connection config fails closed -------------------------
  t.equal(
    screenConnectionConfig({ host: 'smtp.example.com', port: 587 }).length,
    0,
    'a non-secret config passes',
  );
  t.ok(
    screenConnectionConfig({ api_key: 'sk-live-1234567890' }).length > 0,
    'a raw api_key VALUE in the config is rejected',
  );
  t.equal(
    screenConnectionConfig({ api_key: 'sk-live-1234567890' })[0]?.code,
    REASON_CODES.secretValueForbidden,
    'the finding is secret_value_forbidden',
  );
  t.equal(
    screenConnectionConfig({ api_key: 'secretref:vault/kv/smtp' }).length,
    0,
    'an opaque secretref: pointer in a secret-keyed field passes',
  );
  t.ok(
    screenConnectionConfig({ token: 'secretref:not a valid ref!!' }).length > 0,
    'a malformed secretref is rejected',
  );
  t.ok(isSecretReference('secretref:vault/kv/x'), 'the secretref pattern is reused from the m30 seam');

  // --- connector definition validation ------------------------------------------------------------
  t.ok(
    validateConnectorDefinition({ connectorKey: 'salesforce', authKind: 'oauth2', category: 'crm' }).passed,
    'a valid connector definition passes',
  );
  t.ok(
    !validateConnectorDefinition({ connectorKey: '', authKind: 'oauth2', category: 'crm' }).passed,
    'an empty connector key fails',
  );
  t.ok(
    !validateConnectorDefinition({ connectorKey: 'x', authKind: 'magic', category: 'crm' }).passed,
    'an unknown auth kind fails',
  );
  t.ok(
    !validateConnectorDefinition({ connectorKey: 'x', authKind: 'none', category: 'ghost' }).passed,
    'an unknown category fails',
  );

  // --- content hash deterministic -----------------------------------------------------------------
  t.equal(contentHashOf({ a: 1 }), contentHashOf({ a: 1 }), 'content hash is deterministic');
  t.ok(contentHashOf({ a: 1 }) !== contentHashOf({ a: 2 }), 'different definitions hash differently');
});
