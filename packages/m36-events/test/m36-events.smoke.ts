import { defineSuite } from '@finapp/test-runner';
import {
  M36_PERMISSIONS,
  ALL_M36_PERMISSIONS,
  M36_PRIVILEGED_PERMISSIONS,
  ALL_M36_AUDIT_CODES,
  WEBHOOK_AUDIT_PREFIX,
  EVENTSTREAM_AUDIT_PREFIX,
  ENDPOINT_STATES,
  isEndpointFrozen,
  isHumanActor,
  evaluateSodGate,
  evaluateApprovalGate,
  validateEndpointUrl,
  validateEndpoint,
  isRegisteredEventFamily,
  eventMatchesSubscription,
  isSecretReference,
  REASON_CODES,
} from '../src/index.ts';

/**
 * M36 Webhooks & Event Streaming PURE smoke suite. Exercises the load-bearing controls WITHOUT a database: the events.*
 * permission + WEBHOOK_/EVENTSTREAM_ audit shape; maker-checker/SoD + approval gates; the ENDPOINT-URL allow-list (SSRF —
 * https public only, fail closed); REGISTERED-family subscription (no arbitrary family); event/subscription matching; the
 * signing-secret seam (opaque secretref only).
 */
export default defineSuite('m36-events', (t) => {
  // --- permission shape ---------------------------------------------------------------------------
  t.equal(ALL_M36_PERMISSIONS.length, 8, 'eight events.* permissions');
  for (const p of ALL_M36_PERMISSIONS) {
    t.ok(p.startsWith('events.'), `${p} is in the events namespace`);
    t.equal(p.split('.').length, 3, `${p} is exactly three segments`);
  }
  t.equal(new Set(ALL_M36_PERMISSIONS).size, ALL_M36_PERMISSIONS.length, 'no duplicate permission');
  t.ok(!ALL_M36_PERMISSIONS.includes('events.admin' as never), 'there is NO events.admin wildcard');
  t.equal(M36_PRIVILEGED_PERMISSIONS.length, 3, 'three privileged permissions');
  t.ok(
    M36_PRIVILEGED_PERMISSIONS.includes(M36_PERMISSIONS.webhookApprove),
    'endpoint approval is privileged (controlled)',
  );
  t.ok(M36_PRIVILEGED_PERMISSIONS.includes(M36_PERMISSIONS.deliveryReplay), 'delivery replay is privileged');
  t.ok(
    !M36_PRIVILEGED_PERMISSIONS.includes(M36_PERMISSIONS.webhookManage),
    'endpoint authoring is not privileged',
  );

  // --- audit shape --------------------------------------------------------------------------------
  t.equal(ALL_M36_AUDIT_CODES.length, 17, 'seventeen WEBHOOK_/EVENTSTREAM_ audit codes');
  for (const c of ALL_M36_AUDIT_CODES) {
    t.ok(
      c.startsWith(WEBHOOK_AUDIT_PREFIX) || c.startsWith(EVENTSTREAM_AUDIT_PREFIX),
      `${c} carries the WEBHOOK_/EVENTSTREAM_ prefix`,
    );
    t.ok(c.split('_').length >= 3, `${c} is >= 3 segments`);
  }
  t.equal(new Set(ALL_M36_AUDIT_CODES).size, ALL_M36_AUDIT_CODES.length, 'no duplicate audit code');

  // --- vocabulary ---------------------------------------------------------------------------------
  t.ok(
    ENDPOINT_STATES.includes('active') && ENDPOINT_STATES.includes('suspended'),
    'endpoint states include active/suspended',
  );
  t.ok(isEndpointFrozen('rejected'), 'rejected is terminal');
  t.ok(!isEndpointFrozen('active'), 'active is not terminal');

  // --- maker-checker / SoD ------------------------------------------------------------------------
  t.ok(!evaluateSodGate('u1', 'u1').allowed, 'the approver cannot be the requester (self-approval)');
  t.ok(!evaluateSodGate('u1', 'ai').allowed, 'AI cannot approve');
  t.ok(evaluateSodGate('u1', 'u2').allowed, 'a distinct human approver is allowed');
  t.ok(
    !evaluateApprovalGate({ validationPassed: false, requestedBy: 'u1', approver: 'u2' }).allowed,
    'an unvalidated endpoint cannot be approved',
  );
  t.ok(
    evaluateApprovalGate({ validationPassed: true, requestedBy: 'u1', approver: 'u2' }).allowed,
    'a validated + independently-approved endpoint can be activated',
  );
  t.ok(!isHumanActor('automation'), 'automation is not human');

  // --- ENDPOINT URL allow-list (SSRF; fail closed) ------------------------------------------------
  t.equal(validateEndpointUrl('https://hooks.example.com/x').length, 0, 'an https public URL passes');
  t.ok(validateEndpointUrl('http://hooks.example.com/x').length > 0, 'an http URL is rejected (insecure)');
  t.equal(
    validateEndpointUrl('http://hooks.example.com/x')[0]?.code,
    REASON_CODES.insecureUrl,
    'the finding is endpoint_url_insecure',
  );
  t.ok(validateEndpointUrl('https://localhost/x').length > 0, 'localhost is rejected (private)');
  t.ok(validateEndpointUrl('https://127.0.0.1/x').length > 0, 'loopback is rejected (private)');
  t.ok(validateEndpointUrl('https://10.0.0.5/x').length > 0, 'a private 10.x host is rejected');
  t.ok(validateEndpointUrl('https://192.168.1.1/x').length > 0, 'a private 192.168.x host is rejected');
  t.ok(
    validateEndpointUrl('https://169.254.169.254/latest/meta-data').length > 0,
    'the cloud metadata address is rejected',
  );
  t.ok(validateEndpointUrl('https://user:pw@example.com/x').length > 0, 'embedded credentials are rejected');
  t.ok(validateEndpointUrl('not-a-url').length > 0, 'a malformed URL is rejected');
  t.equal(
    validateEndpoint({ url: 'https://hooks.example.com/x', signingSecretRef: 'secretref:vault/kv/wh' })
      .passed,
    true,
    'a public https endpoint with an opaque signing secret passes',
  );
  t.ok(
    !validateEndpoint({ url: 'https://hooks.example.com/x', signingSecretRef: 'hunter2' }).passed,
    'a raw signing secret is rejected (opaque secretref only)',
  );
  t.ok(isSecretReference('secretref:vault/kv/wh'), 'the secretref pattern is reused from the m30 seam');

  // --- REGISTERED-family subscription (no arbitrary family) ---------------------------------------
  t.ok(isRegisteredEventFamily('webhook.lifecycle'), 'a registered family is accepted');
  t.ok(!isRegisteredEventFamily('totally.made.up'), 'an unregistered family is refused');
  t.ok(
    eventMatchesSubscription(
      { eventFamily: 'finance.lifecycle', eventType: '*' },
      { family: 'finance.lifecycle', type: 'JournalPosted' },
    ),
    'a wildcard subscription matches any type in the family',
  );
  t.ok(
    eventMatchesSubscription(
      { eventFamily: 'finance.lifecycle', eventType: 'JournalPosted' },
      { family: 'finance.lifecycle', type: 'JournalPosted' },
    ),
    'an exact type subscription matches',
  );
  t.ok(
    !eventMatchesSubscription(
      { eventFamily: 'finance.lifecycle', eventType: 'JournalPosted' },
      { family: 'finance.lifecycle', type: 'JournalReversed' },
    ),
    'a different type does not match',
  );
  t.ok(
    !eventMatchesSubscription(
      { eventFamily: 'finance.lifecycle', eventType: '*' },
      { family: 'case.lifecycle', type: 'CaseOpened' },
    ),
    'a different family does not match',
  );
});
