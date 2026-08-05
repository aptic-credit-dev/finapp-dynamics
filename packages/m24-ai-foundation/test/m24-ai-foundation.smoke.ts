import { defineSuite } from '@finapp/test-runner';
import {
  M24_LIMITS,
  AiError,
  DATA_CLASSIFICATIONS,
  isDataClassification,
  SPEC_STATUSES,
  isSpecFrozen,
  REQUEST_STATUSES,
  checkRequestTransition,
  isRequestTerminal,
  OUTPUT_STATUSES,
  checkOutputTransition,
  isOutputTerminal,
  OUTPUT_KINDS,
  isOutputKind,
  DLP_ACTIONS,
  REASON_CODES,
  ALL_REASON_CODES,
  isConfidenceBps,
  evaluateRouting,
  evaluateApprovalGate,
  isSecretReference,
  clampPage,
  ALL_M24_PERMISSIONS,
  M24_PERMISSIONS,
  M24_PRIVILEGED_PERMISSIONS,
  ALL_M24_AUDIT_CODES,
  AI_AUDIT_PREFIX,
  DeterministicProvider,
  SafePromptRenderer,
  DeterministicDlp,
  DeterministicValidator,
  NoopCitationResolver,
  DefaultHumanReviewGateway,
  DefaultUsageMeter,
  DefaultCostCalculator,
  DeterministicProviderHealth,
  FixedClock,
} from '../src/index.ts';
import type {
  AiProvider,
  DlpPolicyEvaluator,
  OutputValidator,
  CitationResolver,
  ProviderHealthPort,
} from '../src/index.ts';

export default defineSuite('m24-ai-foundation', (t) => {
  // --- data classification --------------------------------------------------------------------
  t.equal(DATA_CLASSIFICATIONS.length, 4, 'four data classifications (public..restricted)');
  t.ok(isDataClassification('restricted') && !isDataClassification('cosmic'), 'classification recognized');

  // --- spec status ----------------------------------------------------------------------------
  t.equal(SPEC_STATUSES.length, 4, 'four spec statuses');
  t.ok(isSpecFrozen('active') && !isSpecFrozen('draft'), 'a published spec is frozen');

  // --- request lifecycle (a HUMAN completes; the model never does) ----------------------------
  t.equal(REQUEST_STATUSES.length, 10, 'ten request statuses');
  t.ok(checkRequestTransition('received', 'dlp_checked').ok, 'received -> dlp_checked');
  t.ok(
    !checkRequestTransition('received', 'routed').ok,
    'DLP must clear before routing (no restricted data to unapproved provider)',
  );
  t.ok(checkRequestTransition('dlp_checked', 'routed').ok, 'dlp_checked -> routed');
  t.ok(checkRequestTransition('routed', 'generating').ok, 'routed -> generating');
  t.ok(checkRequestTransition('generating', 'generated').ok, 'generating -> generated');
  t.ok(checkRequestTransition('generated', 'review_pending').ok, 'generated -> review_pending');
  t.ok(
    checkRequestTransition('review_pending', 'completed').ok,
    'a human completes a review_pending request',
  );
  t.ok(
    !checkRequestTransition('generated', 'completed').ok,
    'a request can NEVER autonomously complete without human review',
  );
  t.ok(!checkRequestTransition('completed', 'review_pending').ok, 'completed is terminal');
  t.ok(
    isRequestTerminal('completed') &&
      isRequestTerminal('rejected') &&
      isRequestTerminal('failed') &&
      isRequestTerminal('cancelled'),
    'completed/rejected/failed/cancelled are terminal',
  );
  t.ok(!isRequestTerminal('review_pending'), 'review_pending is not terminal');

  // --- output lifecycle (an output is a RECOMMENDATION; a human approves) ----------------------
  t.equal(OUTPUT_STATUSES.length, 5, 'five output statuses');
  t.ok(checkOutputTransition('draft', 'validated').ok, 'draft -> validated');
  t.ok(checkOutputTransition('validated', 'review_pending').ok, 'validated -> review_pending');
  t.ok(checkOutputTransition('review_pending', 'approved').ok, 'review_pending -> approved (by a human)');
  t.ok(
    !checkOutputTransition('validated', 'approved').ok,
    'an output can NEVER be approved without going through human review',
  );
  t.ok(!checkOutputTransition('draft', 'approved').ok, 'a draft output can never jump to approved');
  t.ok(isOutputTerminal('approved') && isOutputTerminal('rejected'), 'approved/rejected are terminal');

  // --- output kinds (assistive only — never a controlled action) ------------------------------
  t.equal(OUTPUT_KINDS.length, 5, 'five assistive output kinds');
  t.ok(isOutputKind('summary') && isOutputKind('recommendation'), 'assistive kinds recognized');
  t.ok(
    !isOutputKind('post_journal') && !isOutputKind('approve') && !isOutputKind('file'),
    'no output kind is a controlled action (never post/approve/file)',
  );

  // --- DLP actions ----------------------------------------------------------------------------
  t.equal(DLP_ACTIONS.length, 3, 'three DLP actions (allow/redact/block)');

  // --- reason codes ---------------------------------------------------------------------------
  t.equal(REASON_CODES.autonomousActionForbidden, 'autonomous_action_forbidden', 'autonomy is forbidden');
  t.equal(REASON_CODES.unapprovedProvider, 'unapproved_provider_for_classification', 'routing reason code');
  t.ok(
    ALL_REASON_CODES.includes('human_approved') && ALL_REASON_CODES.includes('missing_required_citations'),
    'governance reason codes present',
  );
  t.ok(new Set(ALL_REASON_CODES).size === ALL_REASON_CODES.length, 'no reason code declared twice');

  // --- confidence is INTEGER basis points, never a float --------------------------------------
  t.ok(isConfidenceBps(0) && isConfidenceBps(10000), 'confidence bounds 0..10000');
  t.ok(!isConfidenceBps(10001) && !isConfidenceBps(-1), 'out-of-range confidence rejected');
  t.ok(!isConfidenceBps(50.5), 'a fractional confidence is rejected (integer basis points only)');
  t.equal(M24_LIMITS.maxConfidenceBps, 10000, 'max confidence is 10000 bps');

  // --- approved-provider routing (fails CLOSED) -----------------------------------------------
  t.ok(
    evaluateRouting({
      classification: 'internal',
      providerApproved: true,
      providerActive: true,
      providerClassifications: [],
    }).allowed,
    'internal data may route to any active approved provider',
  );
  const restrictedToApproved = evaluateRouting({
    classification: 'restricted',
    providerApproved: true,
    providerActive: true,
    providerClassifications: ['restricted'],
  });
  t.ok(
    restrictedToApproved.allowed && restrictedToApproved.reasonCode === REASON_CODES.routedApproved,
    'restricted data may route to a provider explicitly approved for restricted',
  );
  const restrictedToUnapproved = evaluateRouting({
    classification: 'restricted',
    providerApproved: true,
    providerActive: true,
    providerClassifications: ['internal'],
  });
  t.ok(
    !restrictedToUnapproved.allowed && restrictedToUnapproved.reasonCode === REASON_CODES.unapprovedProvider,
    'restricted data may NEVER route to a provider not approved for restricted',
  );
  t.ok(
    !evaluateRouting({
      classification: 'confidential',
      providerApproved: false,
      providerActive: true,
      providerClassifications: ['confidential'],
    }).allowed,
    'an unapproved provider can never be routed to (fail closed)',
  );
  t.ok(
    !evaluateRouting({
      classification: 'public',
      providerApproved: true,
      providerActive: false,
      providerClassifications: [],
    }).allowed,
    'an inactive provider can never be routed to',
  );

  // --- human-approval gate (NO autonomous approval) -------------------------------------------
  t.ok(
    evaluateApprovalGate({ reviewerId: 'user-1', citationsRequired: false, citationCount: 0 }).allowed,
    'a human reviewer may approve when citations are not required',
  );
  const noReviewer = evaluateApprovalGate({ reviewerId: null, citationsRequired: false, citationCount: 0 });
  t.ok(
    !noReviewer.allowed && noReviewer.reasonCode === REASON_CODES.autonomousActionForbidden,
    'without a human reviewer, approval is forbidden (no autonomous action)',
  );
  t.ok(
    !evaluateApprovalGate({ reviewerId: '   ', citationsRequired: false, citationCount: 0 }).allowed,
    'a blank reviewer id is not a human (fail closed)',
  );
  const noCites = evaluateApprovalGate({ reviewerId: 'user-1', citationsRequired: true, citationCount: 0 });
  t.ok(
    !noCites.allowed && noCites.reasonCode === REASON_CODES.missingCitations,
    'where citations are required, approval needs at least one citation',
  );

  // --- secret reference is a POINTER, never a secret ------------------------------------------
  t.ok(isSecretReference('secretref:vault/ai/openai-key'), 'a well-formed secretref is accepted');
  t.ok(!isSecretReference('sk-live-1234567890'), 'an inline secret is NOT a reference');
  t.ok(!isSecretReference('secretref:has space'), 'a reference with whitespace is rejected');

  // --- bounded pagination ---------------------------------------------------------------------
  t.deepEqual(clampPage(undefined, undefined), { limit: 50, offset: 0 }, 'defaults');
  t.deepEqual(clampPage(9999, -5), { limit: 200, offset: 0 }, 'clamped to max limit / non-negative offset');

  // --- permissions ----------------------------------------------------------------------------
  t.equal(ALL_M24_PERMISSIONS.length, 23, 'm24 declares 23 ai.* permissions');
  t.ok(
    ALL_M24_PERMISSIONS.every((p) => p.startsWith('ai.') && p.split('.').length === 3),
    'every permission is a 3-segment ai.<entity>.<action> code',
  );
  t.ok(new Set(ALL_M24_PERMISSIONS).size === ALL_M24_PERMISSIONS.length, 'no permission declared twice');
  t.ok(!ALL_M24_PERMISSIONS.includes('ai.admin' as never), 'there is no vague ai.admin catch-all');
  t.equal(M24_PRIVILEGED_PERMISSIONS.length, 10, 'ten privileged permissions');
  t.ok(
    M24_PRIVILEGED_PERMISSIONS.includes(M24_PERMISSIONS.outputReview) &&
      M24_PRIVILEGED_PERMISSIONS.includes(M24_PERMISSIONS.providerApprove),
    'the human review + provider approve are privileged',
  );

  // --- audit codes ----------------------------------------------------------------------------
  t.equal(ALL_M24_AUDIT_CODES.length, 22, 'm24 declares 22 AI_ audit codes');
  t.ok(
    ALL_M24_AUDIT_CODES.every((c) => c.startsWith(AI_AUDIT_PREFIX) && c.split('_').length >= 3),
    'every audit code is AI_ SCREAMING_SNAKE with >= 3 segments',
  );
  t.ok(new Set(ALL_M24_AUDIT_CODES).size === ALL_M24_AUDIT_CODES.length, 'no audit code declared twice');
  t.ok(
    ALL_M24_AUDIT_CODES.includes('AI_DLP_BLOCKED'),
    'a blocked DLP attempt is audited (no governed AI decision disappears silently)',
  );

  // --- deterministic doubles: offline, reproducible, no secrets/network -----------------------
  // The SYNCHRONOUS engines are asserted by value here; the async provider ports (generate / DLP /
  // validate / cite / health) are exercised end-to-end on real PostgreSQL in m24-services.db-spec —
  // this pure suite only proves they exist and are the deterministic, offline doubles (no adapter).
  const provider: AiProvider = new DeterministicProvider();
  t.ok(
    typeof provider.generate === 'function',
    'the only AiProvider is the deterministic double (no production adapter)',
  );

  const renderer = new SafePromptRenderer();
  t.equal(renderer.render('Hi {{name}}', { name: 'Ada' }), 'Hi Ada', 'safe {{var}} substitution');
  t.equal(renderer.render('{{missing}}!', {}), '!', 'unknown vars render empty (no eval, no crash)');
  t.equal(
    renderer.render('{{a}}-{{b}}', { a: '1', b: '2' }),
    '1-2',
    'multiple vars render deterministically',
  );

  const dlp: DlpPolicyEvaluator = new DeterministicDlp();
  t.ok(
    typeof dlp.evaluate === 'function',
    'the DLP evaluator is a deterministic double (m41 integrates behind it)',
  );
  const validator: OutputValidator = new DeterministicValidator();
  t.ok(typeof validator.validate === 'function', 'the OutputValidator is a deterministic double');
  const cites: CitationResolver = new NoopCitationResolver();
  t.ok(typeof cites.resolve === 'function', 'the CitationResolver is a deterministic double');
  const health: ProviderHealthPort = new DeterministicProviderHealth();
  t.ok(
    typeof health.status === 'function',
    'the ProviderHealthPort is a deterministic double (no external provider)',
  );

  const human = new DefaultHumanReviewGateway();
  t.ok(
    human.isHuman('user-1') && !human.isHuman(null) && !human.isHuman('  '),
    'human gateway rejects non-humans (no autonomous action)',
  );

  const meter = new DefaultUsageMeter();
  t.equal(meter.meter({ promptTokens: 10, completionTokens: 5 }).totalTokens, 15, 'usage sums tokens');

  const cost = new DefaultCostCalculator();
  t.equal(cost.cost(2000, 30), 60, 'cost is integer minor units (2000 tokens * 30/1k = 60)');
  t.ok(Number.isInteger(cost.cost(1234, 7)), 'cost is always an integer (never float)');

  // --- clock: deterministic, no wall-clock in tests -------------------------------------------
  const clock = new FixedClock(1000);
  clock.advance(500);
  t.equal(clock.now(), 1500, 'FixedClock is deterministic and advanceable');

  // --- error type -----------------------------------------------------------------------------
  t.ok(new AiError('X', 'y') instanceof Error, 'AiError is an Error');
});
