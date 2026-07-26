import { defineSuite } from '@finapp/test-runner';
import {
  CHANNELS,
  isChannel,
  channelEscapes,
  channelHasSubject,
  normalizeDestination,
} from '../src/domain/channels.ts';
import {
  renderTemplate,
  extractPlaceholders,
  hasMalformedPlaceholder,
  escapeHtml,
} from '../src/domain/render.ts';
import { validateTemplateSpec, type VariableSchema } from '../src/domain/template.ts';
import { validateVariables } from '../src/domain/variables.ts';
import {
  checkTemplateTransition,
  isTemplateContentFrozen,
  checkRequestTransition,
  isRequestTerminal,
  checkEscalationTransition,
  isEscalationTerminal,
} from '../src/domain/lifecycles.ts';
import { DEFAULT_RETRY_POLICY, retryDecision, validateRetryPolicy } from '../src/domain/retry.ts';
import {
  validateEscalationSpec,
  nextEscalation,
  type EscalationPolicySpec,
} from '../src/domain/escalation.ts';
import { dedupeRecipients, orderRecipients, type ResolvedRecipient } from '../src/domain/recipients.ts';
import { evaluateDelivery, isMandatoryCategory } from '../src/domain/preferences.ts';
import { NotifyError, NOTIFY_LIMITS } from '../src/domain/limits.ts';
import { contentHashOf } from '../src/hash.ts';
import { DeterministicProvider } from '../src/provider.ts';

function goodTemplateSpec() {
  return {
    schemaVersion: 1,
    code: 'welcome',
    name: 'Welcome',
    channel: 'email',
    locale: 'en',
    subjectTemplate: 'Hi {{ name }}',
    bodyTemplate: 'Welcome {{ name }}, your balance is {{ amount }}.',
    variables: [
      { name: 'name', type: 'string', required: true },
      { name: 'amount', type: 'number', required: true },
    ],
  };
}

function goodEscalationSpec(): EscalationPolicySpec {
  return {
    schemaVersion: 1,
    code: 'overdue',
    name: 'Overdue escalation',
    requireAck: true,
    levels: [
      { level: 1, delayMs: 60_000, channel: 'email', recipients: [{ kind: 'role', ref: 'ops' }] },
      { level: 2, delayMs: 300_000, channel: 'sms', recipients: [{ kind: 'user', ref: 'mgr-1' }] },
    ],
  };
}

export default defineSuite('m08-notify', (t) => {
  // --- channels + destinations ------------------------------------------------------------------
  t.equal(CHANNELS.length, 4, 'four channels');
  t.ok(
    isChannel('email') && isChannel('sms') && isChannel('in_app') && isChannel('webhook'),
    'channels recognized',
  );
  t.ok(!isChannel('carrier-pigeon'), 'unknown channel rejected');
  t.ok(channelEscapes('email') && channelEscapes('in_app'), 'email + in-app escape');
  t.ok(!channelEscapes('sms') && !channelEscapes('webhook'), 'sms + webhook do not escape');
  t.ok(channelHasSubject('email') && !channelHasSubject('sms'), 'subject support by channel');

  t.equal(
    normalizeDestination('email', '  Foo@Example.COM ').value,
    'foo@example.com',
    'email trimmed + lowercased',
  );
  t.ok(!normalizeDestination('email', 'not-an-email').ok, 'invalid email rejected');
  t.equal(normalizeDestination('sms', '+254 (700) 111-222').value, '+254700111222', 'sms compacted to E.164');
  t.ok(!normalizeDestination('sms', '0700111222').ok, 'non-E.164 sms rejected');
  t.ok(normalizeDestination('in_app', '3f2504e0-4f89-41d3-9a0c-0305e82c3301').ok, 'in-app accepts a uuid');
  t.ok(!normalizeDestination('in_app', 'someone').ok, 'in-app rejects a non-uuid');
  // Webhook SSRF guard.
  t.ok(
    normalizeDestination('webhook', 'https://hooks.example.com/x').ok,
    'https webhook to public host allowed',
  );
  t.ok(
    !normalizeDestination('webhook', 'http://hooks.example.com/x').ok,
    'http webhook rejected (not https)',
  );
  t.ok(!normalizeDestination('webhook', 'https://localhost/x').ok, 'localhost webhook rejected (SSRF)');
  t.ok(!normalizeDestination('webhook', 'https://127.0.0.1/x').ok, 'loopback webhook rejected (SSRF)');
  t.ok(!normalizeDestination('webhook', 'https://10.0.0.5/x').ok, 'private 10.x webhook rejected (SSRF)');
  t.ok(
    !normalizeDestination('webhook', 'https://169.254.169.254/latest').ok,
    'metadata endpoint rejected (SSRF)',
  );
  t.ok(
    !normalizeDestination('webhook', 'https://user:pass@hooks.example.com/x').ok,
    'webhook with credentials rejected',
  );
  t.ok(!normalizeDestination('webhook', 'https://192.168.1.1/x').ok, 'private 192.168 rejected');
  t.ok(!normalizeDestination('webhook', 'https://172.16.0.1/x').ok, 'private 172.16 rejected');

  // --- safe rendering ---------------------------------------------------------------------------
  t.equal(escapeHtml('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;', 'html escaping');
  t.deepEqual(
    extractPlaceholders('{{ a }} {{b}} {{ a }}'),
    ['a', 'b'],
    'placeholders extracted first-seen, deduped',
  );
  t.ok(!hasMalformedPlaceholder('{{ ok }}'), 'well-formed placeholder ok');
  t.ok(hasMalformedPlaceholder('{{ 2 + 2 }}'), 'expression placeholder is malformed');
  t.ok(hasMalformedPlaceholder('{{ user.name }}'), 'property access is malformed');
  t.equal(
    renderTemplate('Hi {{ name }} ({{ n }})', { name: 'Ada', n: 42 }, { escape: false }),
    'Hi Ada (42)',
    'substitution renders scalars deterministically',
  );
  t.equal(
    renderTemplate('{{ x }}', { x: '<script>' }, { escape: true }),
    '&lt;script&gt;',
    'escaped channel escapes injected html',
  );
  t.equal(
    renderTemplate('{{ x }}', { x: '<script>' }, { escape: false }),
    '<script>',
    'unescaped channel leaves value verbatim (sms/webhook)',
  );
  // Determinism: same inputs, same output.
  t.equal(
    renderTemplate('{{ a }}{{ b }}', { a: '1', b: '2' }, { escape: false }),
    renderTemplate('{{ a }}{{ b }}', { a: '1', b: '2' }, { escape: false }),
    'rendering is deterministic',
  );
  t.throws(() => renderTemplate('{{ missing }}', {}, { escape: false }), 'missing variable throws');
  t.throws(
    () => renderTemplate('{{ x }}', { x: Number.POSITIVE_INFINITY }, { escape: false }),
    'non-finite number rejected',
  );
  // no eval / host access is structural — a template is data; assert a would-be-expression is inert
  t.ok(
    !hasMalformedPlaceholder('{{ constructor }}'),
    'a bare identifier named constructor is just a variable name',
  );
  t.throws(
    () => renderTemplate('{{ constructor }}', {}, { escape: false }),
    'and it resolves to nothing (no host access)',
  );
  const bigValue = 'a'.repeat(NOTIFY_LIMITS.maxVariableValueChars + 1);
  t.throws(() => renderTemplate('{{ x }}', { x: bigValue }, { escape: false }), 'oversized value rejected');

  // --- template spec validation -----------------------------------------------------------------
  t.ok(validateTemplateSpec(goodTemplateSpec()).ok, 'a good template spec validates');
  t.ok(!validateTemplateSpec({ ...goodTemplateSpec(), channel: 'pigeon' }).ok, 'invalid channel rejected');
  t.ok(
    !validateTemplateSpec({ ...goodTemplateSpec(), bodyTemplate: 'Hi {{ unknownVar }}' }).ok,
    'placeholder referencing an undeclared variable rejected',
  );
  t.ok(
    !validateTemplateSpec({ ...goodTemplateSpec(), channel: 'sms', subjectTemplate: 'x' }).ok,
    'subject on a subject-less channel rejected',
  );
  t.ok(
    !validateTemplateSpec({ ...goodTemplateSpec(), bodyTemplate: 'Hi {{ 2+2 }}' }).ok,
    'malformed placeholder rejected',
  );
  t.ok(
    !validateTemplateSpec({
      ...goodTemplateSpec(),
      variables: [
        { name: 'name', type: 'string' },
        { name: 'name', type: 'number' },
      ],
    }).ok,
    'duplicate variable name rejected',
  );

  // --- variable validation ----------------------------------------------------------------------
  const schema: VariableSchema[] = [
    { name: 'name', type: 'string', required: true },
    { name: 'amount', type: 'number', required: true },
  ];
  const okVars = validateVariables(schema, { name: 'Ada', amount: 100 });
  t.ok(okVars.ok, 'matching variables validate');
  t.equal(okVars.values['amount'], 100, 'value passes through');
  t.ok(!validateVariables(schema, { name: 'Ada' }).ok, 'missing required variable rejected');
  t.ok(!validateVariables(schema, { name: 'Ada', amount: 'lots' }).ok, 'type mismatch rejected');
  t.ok(!validateVariables(schema, { name: 'Ada', amount: 1, extra: 'x' }).ok, 'unknown variable rejected');

  // --- lifecycles -------------------------------------------------------------------------------
  t.ok(checkTemplateTransition('DRAFT', 'validate').ok, 'DRAFT -> validate ok');
  t.ok(!checkTemplateTransition('DRAFT', 'publish').ok, 'DRAFT -> publish rejected');
  t.ok(checkTemplateTransition('PUBLISHED', 'activate').ok, 'PUBLISHED -> activate ok');
  t.ok(
    !isTemplateContentFrozen('DRAFT') && isTemplateContentFrozen('PUBLISHED'),
    'content frozen at publish',
  );
  t.ok(checkRequestTransition('requested', 'queued').ok, 'request requested -> queued ok');
  t.ok(!checkRequestTransition('delivered', 'queued').ok, 'delivered is terminal');
  t.ok(
    isRequestTerminal('delivered') && isRequestTerminal('cancelled') && !isRequestTerminal('queued'),
    'request terminals',
  );
  t.ok(checkEscalationTransition('active', 'acknowledged').ok, 'escalation active -> acknowledged ok');
  t.ok(!checkEscalationTransition('resolved', 'active').ok, 'resolved is terminal');
  t.ok(isEscalationTerminal('resolved') && !isEscalationTerminal('active'), 'escalation terminals');

  // --- retry policy -----------------------------------------------------------------------------
  validateRetryPolicy(DEFAULT_RETRY_POLICY);
  const d1 = retryDecision(DEFAULT_RETRY_POLICY, 1, 'transient');
  t.ok(d1.retry && d1.delayMs === 30_000, 'first transient failure retries after initial delay');
  const d2 = retryDecision(DEFAULT_RETRY_POLICY, 2, 'transient');
  t.ok(d2.retry && d2.delayMs === 60_000, 'exponential backoff doubles');
  t.ok(
    !retryDecision(DEFAULT_RETRY_POLICY, 1, 'invalid_recipient').retry,
    'non-retryable category does not retry',
  );
  t.equal(
    retryDecision(DEFAULT_RETRY_POLICY, 5, 'transient').reason,
    'exhausted',
    'reaching maxAttempts exhausts',
  );
  const capped = retryDecision(
    { ...DEFAULT_RETRY_POLICY, maxAttempts: 20, maxDelayMs: 100_000 },
    10,
    'transient',
  );
  t.ok(capped.delayMs <= 100_000, 'backoff is capped at maxDelayMs');
  t.throws(() => {
    validateRetryPolicy({ ...DEFAULT_RETRY_POLICY, maxAttempts: 0 });
  }, 'invalid maxAttempts rejected');
  t.throws(() => {
    validateRetryPolicy({ ...DEFAULT_RETRY_POLICY, maxAttempts: 999 });
  }, 'over-limit maxAttempts rejected');

  // --- escalation spec + calculator -------------------------------------------------------------
  t.ok(validateEscalationSpec(goodEscalationSpec()).ok, 'good escalation spec validates');
  t.ok(!validateEscalationSpec({ ...goodEscalationSpec(), levels: [] }).ok, 'empty levels rejected');
  t.ok(
    !validateEscalationSpec({
      ...goodEscalationSpec(),
      levels: [{ level: 2, delayMs: 1, channel: 'email', recipients: [{ kind: 'role', ref: 'x' }] }],
    }).ok,
    'non-sequential level rejected',
  );
  const spec = goodEscalationSpec();
  const step0 = nextEscalation(spec, 0);
  t.ok(step0.advance && step0.nextLevel === 1 && step0.delayMs === 60_000, 'first escalation is level 1');
  const step1 = nextEscalation(spec, 1);
  t.ok(step1.advance && step1.nextLevel === 2, 'second escalation is level 2');
  const step2 = nextEscalation(spec, 2);
  t.ok(!step2.advance && step2.exhausted, 'past the last level is exhausted (bounded)');
  const repeating = nextEscalation({ ...spec, repeatIntervalMs: 10_000 }, 2);
  t.ok(!repeating.exhausted && repeating.delayMs === 10_000, 'repeatInterval re-fires the last level');

  // --- recipients -------------------------------------------------------------------------------
  const recips: ResolvedRecipient[] = [
    { kind: 'role', ref: 'ops', destination: 'a@x.com', resolvedVia: 'role:ops' },
    { kind: 'user', ref: 'u1', destination: 'a@x.com', resolvedVia: 'user:u1' },
    { kind: 'user', ref: 'u2', destination: 'b@x.com', resolvedVia: 'user:u2' },
  ];
  t.equal(dedupeRecipients(recips).length, 2, 'recipients deduped by destination');
  t.equal(orderRecipients(recips)[0]?.destination, 'a@x.com', 'recipients ordered deterministically');

  // --- preferences ------------------------------------------------------------------------------
  t.ok(isMandatoryCategory('security') && isMandatoryCategory('legal'), 'security + legal are mandatory');
  t.ok(
    !isMandatoryCategory('optional') && !isMandatoryCategory('operational'),
    'optional + operational are not mandatory',
  );
  t.equal(
    evaluateDelivery({
      category: 'security',
      channel: 'email',
      minuteOfDay: 30,
      preference: { channel: 'email', optIn: false, suppressed: true },
    }).reason,
    'mandatory',
    'security bypasses opt-out + suppression',
  );
  t.ok(
    !evaluateDelivery({
      category: 'optional',
      channel: 'email',
      minuteOfDay: 30,
      preference: { channel: 'email', optIn: false, suppressed: false },
    }).deliver,
    'optional respects opt-out',
  );
  t.ok(
    !evaluateDelivery({
      category: 'optional',
      channel: 'email',
      minuteOfDay: 30,
      destinationSuppressed: true,
    }).deliver,
    'destination suppression stops optional',
  );
  t.ok(
    evaluateDelivery({ category: 'legal', channel: 'email', minuteOfDay: 30, destinationSuppressed: true })
      .deliver,
    'legal delivers even to a suppressed destination',
  );
  const quiet = evaluateDelivery({
    category: 'optional',
    channel: 'email',
    minuteOfDay: 100,
    preference: {
      channel: 'email',
      optIn: true,
      suppressed: false,
      quietHours: { startMinute: 60, endMinute: 120 },
    },
  });
  t.ok(!quiet.deliver && quiet.defer, 'optional deferred during quiet hours');
  const wrap = evaluateDelivery({
    category: 'operational',
    channel: 'email',
    minuteOfDay: 30,
    preference: {
      channel: 'email',
      optIn: true,
      suppressed: false,
      quietHours: { startMinute: 1320, endMinute: 60 },
    },
  });
  t.ok(wrap.defer, 'quiet hours wrapping midnight defers operational');
  t.throws(
    () => evaluateDelivery({ category: 'optional', channel: 'email', minuteOfDay: 1500 }),
    'invalid minuteOfDay rejected',
  );

  // --- hashing ----------------------------------------------------------------------------------
  t.equal(
    contentHashOf({ a: 1, b: 2 }),
    contentHashOf({ b: 2, a: 1 }),
    'canonical hash is key-order independent',
  );
  t.ok(contentHashOf({ a: 1 }) !== contentHashOf({ a: 2 }), 'different content hashes differently');

  // --- provider test double ---------------------------------------------------------------------
  const provider = new DeterministicProvider({ failFor: { 'bounce@x.com': 'permanent' } });
  t.ok(provider.supports('email'), 'provider supports email');

  // NotifyError is structured
  t.ok(new NotifyError('X', 'y') instanceof Error, 'NotifyError is an Error');
});
