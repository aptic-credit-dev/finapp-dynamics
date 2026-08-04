import { defineSuite } from '@finapp/test-runner';
import {
  DESTINATION_TYPES,
  isDestinationType,
  DESTINATION_STATUSES,
  isDestinationStatus,
  EXECUTION_STATUSES,
  isExecutionStatus,
  ATTEMPT_RESULTS,
  isAttemptResult,
  SPEC_STATUSES,
  REASON_CATEGORIES,
  REASON_SEVERITIES,
  REASON_CODES,
  ALL_REASON_CODES,
  isSecretReference,
  checkDestinationTransition,
  isDestinationDispatchable,
  checkExecutionTransition,
  isExecutionTerminal,
  isExecutionActionable,
  checkSpecTransition,
  isSpecFrozen,
  decideRetry,
  assertSecretReference,
  evaluateDispatchGate,
  DEFAULT_RETRY_POLICY,
  IntegrationEngineError,
  FrameworkOnlyDispatch,
  ALL_M23_AUDIT_CODES,
  FININT_AUDIT_PREFIX,
} from '../src/index.ts';

export default defineSuite('m23-finance-integration', (t) => {
  // --- vocabulary -------------------------------------------------------------------------------
  t.equal(DESTINATION_TYPES.length, 5, 'five destination types');
  t.ok(
    isDestinationType('core_banking') && !isDestinationType('smoke_signal'),
    'destination type recognized',
  );
  t.equal(DESTINATION_STATUSES.length, 4, 'four destination statuses');
  t.ok(isDestinationStatus('enabled') && !isDestinationStatus('on'), 'destination status recognized');
  t.equal(EXECUTION_STATUSES.length, 8, 'eight execution statuses');
  t.ok(
    isExecutionStatus('dispatched') && !isExecutionStatus('posted'),
    'execution status recognized (never "posted")',
  );
  t.equal(ATTEMPT_RESULTS.length, 4, 'four attempt results');
  t.ok(isAttemptResult('acknowledged') && !isAttemptResult('teleported'), 'attempt result recognized');
  t.equal(SPEC_STATUSES.length, 4, 'four spec statuses');
  t.equal(REASON_CATEGORIES.length, 5, 'five reason categories');
  t.equal(REASON_SEVERITIES.length, 3, 'three reason severities');

  // --- reason codes -----------------------------------------------------------------------------
  t.equal(
    REASON_CODES.dispatchedFrameworkOnly.code,
    'dispatched_framework_only',
    'dispatch is framework-only',
  );
  t.equal(REASON_CODES.retryExhausted.code, 'retry_exhausted', 'retry_exhausted reason code');
  const reasons: readonly string[] = ALL_REASON_CODES;
  t.ok(
    reasons.includes('destination_not_allowlisted') && reasons.includes('missing_approval_reference'),
    'governance reason codes present',
  );
  t.ok(!reasons.includes('posted'), 'there is no "posted" reason — m23 never posts');

  // --- destination lifecycle --------------------------------------------------------------------
  t.ok(checkDestinationTransition('draft', 'enabled').ok, 'destination draft -> enabled');
  t.ok(checkDestinationTransition('enabled', 'disabled').ok, 'destination enabled -> disabled');
  t.ok(checkDestinationTransition('disabled', 'enabled').ok, 'a disabled destination can be re-enabled');
  t.ok(!checkDestinationTransition('retired', 'enabled').ok, 'a retired destination is terminal');
  t.ok(
    isDestinationDispatchable('enabled') && !isDestinationDispatchable('disabled'),
    'only an enabled destination is dispatchable',
  );

  // --- execution lifecycle (Framework-Only) -----------------------------------------------------
  t.ok(checkExecutionTransition('prepared', 'ready').ok, 'execution prepared -> ready');
  t.ok(checkExecutionTransition('ready', 'dispatched').ok, 'execution ready -> dispatched');
  t.ok(checkExecutionTransition('dispatched', 'acknowledged').ok, 'dispatched -> acknowledged (success)');
  t.ok(checkExecutionTransition('dispatched', 'failed').ok, 'dispatched -> failed');
  t.ok(checkExecutionTransition('failed', 'retryable').ok, 'failed -> retryable');
  t.ok(checkExecutionTransition('retryable', 'ready').ok, 'retryable -> ready (bounded retry)');
  t.ok(checkExecutionTransition('failed', 'exhausted').ok, 'failed -> exhausted');
  t.ok(
    !checkExecutionTransition('prepared', 'dispatched').ok,
    'an execution cannot dispatch without becoming ready',
  );
  t.ok(!checkExecutionTransition('acknowledged', 'ready').ok, 'acknowledged is terminal');
  t.ok(
    isExecutionTerminal('acknowledged') &&
      isExecutionTerminal('exhausted') &&
      isExecutionTerminal('cancelled'),
    'acknowledged/exhausted/cancelled are terminal',
  );
  t.ok(
    isExecutionActionable('prepared') && !isExecutionActionable('cancelled'),
    'actionable while non-terminal',
  );

  // --- spec lifecycle ---------------------------------------------------------------------------
  t.ok(checkSpecTransition('draft', 'active').ok, 'config draft -> active');
  t.ok(isSpecFrozen('active') && !isSpecFrozen('draft'), 'a published config is frozen');

  // --- bounded, deterministic retry -------------------------------------------------------------
  const r0 = decideRetry(0, DEFAULT_RETRY_POLICY);
  t.ok(r0.canRetry && r0.nextAttempt === 1 && r0.delayMs === 1000, 'first retry allowed with base delay');
  const r1 = decideRetry(1, DEFAULT_RETRY_POLICY);
  t.ok(r1.canRetry && r1.delayMs === 2000, 'deterministic exponential backoff (base * backoff^attempt)');
  const rMax = decideRetry(5, DEFAULT_RETRY_POLICY);
  t.ok(
    !rMax.canRetry && rMax.reasonCode === 'retry_exhausted' && rMax.delayMs === 0,
    'retry is bounded (exhausted at max)',
  );
  const a = decideRetry(2, DEFAULT_RETRY_POLICY);
  const b = decideRetry(2, DEFAULT_RETRY_POLICY);
  t.deepEqual(a, b, 'retry decision is reproducible (no jitter/randomness)');
  t.throws(() => decideRetry(-1, DEFAULT_RETRY_POLICY), 'a negative attempt count fails closed');

  // --- secret reference is a POINTER, never a secret --------------------------------------------
  t.ok(isSecretReference('secretref:vault/finapp/erp-token'), 'a well-formed secretref is accepted');
  t.ok(!isSecretReference('super-secret-password-123'), 'an inline secret is NOT a reference');
  t.ok(!isSecretReference('secretref:has space'), 'a reference with whitespace is rejected');
  t.throws(() => {
    assertSecretReference('AKIA_INLINE_KEY');
  }, 'an inline secret fails closed (m23 stores references only)');

  // --- Framework-Only dispatch gate -------------------------------------------------------------
  const gate = evaluateDispatchGate({
    destinationStatus: 'enabled',
    allowlisted: true,
    approvalRef: 'appr-1',
  });
  t.ok(
    gate.allowed && gate.reasonCode === 'dispatched_framework_only',
    'an enabled, allow-listed, approved intent may dispatch (framework-only)',
  );
  t.ok(
    !evaluateDispatchGate({ destinationStatus: 'disabled', allowlisted: true, approvalRef: 'a' }).allowed,
    'a disabled destination cannot dispatch',
  );
  t.ok(
    !evaluateDispatchGate({ destinationStatus: 'enabled', allowlisted: false, approvalRef: 'a' }).allowed,
    'a non-allow-listed destination cannot dispatch',
  );
  const noAppr = evaluateDispatchGate({ destinationStatus: 'enabled', allowlisted: true, approvalRef: null });
  t.ok(
    !noAppr.allowed && noAppr.reasonCode === 'missing_approval_reference',
    'no dispatch without an approval reference',
  );

  // --- the ONLY dispatch adapter never calls out ------------------------------------------------
  t.ok(new IntegrationEngineError('X', 'y') instanceof Error, 'IntegrationEngineError is an Error');
  t.ok(
    typeof new FrameworkOnlyDispatch().dispatch === 'function',
    'the only dispatch adapter is Framework-Only (records intent, never calls out — proven behaviourally in the services db-spec)',
  );

  // --- audit codes ------------------------------------------------------------------------------
  t.equal(ALL_M23_AUDIT_CODES.length, 12, 'm23 declares 12 audit codes');
  t.ok(
    ALL_M23_AUDIT_CODES.every((c) => c.startsWith(FININT_AUDIT_PREFIX) && c.split('_').length >= 3),
    'every audit code is FIN_INTEGRATION_ SCREAMING_SNAKE with >= 3 segments (FIN_ shared with m19, non-colliding)',
  );
  t.ok(new Set(ALL_M23_AUDIT_CODES).size === ALL_M23_AUDIT_CODES.length, 'no audit code is declared twice');
});
