import { defineSuite } from '@finapp/test-runner';
import {
  LEGALDOCS_LIMITS,
  LegalDocsError,
  RECORD_TYPES,
  isRecordType,
  KNOWLEDGE_TYPES,
  isKnowledgeType,
  AUTHORITY_TYPES,
  isAuthorityType,
  AUTHORITY_TREATMENTS,
  isAuthorityTreatment,
  CLAUSE_KINDS,
  isClauseKind,
  AUTHORITY_LEVELS,
  isAuthorityLevel,
  PRIVILEGE_LEVELS,
  isPrivilegeLevel,
  CONFIDENTIALITY_LEVELS,
  isConfidentiality,
  confidentialityRank,
  RISK_LEVELS,
  isRiskLevel,
  SOURCE_TYPES,
  isSourceType,
  TAXONOMY_KINDS,
  isTaxonomyKind,
  REVIEW_TYPES,
  isReviewType,
  REFERENCE_TYPES,
  isReferenceType,
  NOTE_TYPES,
  isNoteType,
  isRestrictedNote,
  PUBLISHABLE_STATUSES,
  checkPublishableTransition,
  isPublishableTerminal,
  isPublishableFrozen,
  isPublishableOpen,
  isPublished,
  computeReviewDueMs,
  reviewState,
  isExpirySafe,
  isExpiry,
  RELATIONSHIP_KINDS,
  isRelationshipKind,
  CLAUSE_RELATION_KINDS,
  isClauseRelationKind,
  isSelfRelation,
  formatKnowledgeNumber,
  isValidKnowledgeNumber,
  contentHashOf,
  canonicalJson,
  SystemClock,
  FixedClock,
  ALL_M18_PERMISSIONS,
  M18_PRIVILEGED_PERMISSIONS,
  ALL_M18_AUDIT_CODES,
  LEGALDOC_AUDIT_PREFIX,
} from '../src/index.ts';

export default defineSuite('m18-legaldocs', (t) => {
  // --- vocabulary -------------------------------------------------------------------------------
  t.equal(RECORD_TYPES.length, 7, 'seven record types');
  t.ok(
    isRecordType('knowledge') && isRecordType('clause') && !isRecordType('vibes'),
    'record type recognized',
  );
  t.equal(KNOWLEDGE_TYPES.length, 10, 'ten knowledge types');
  t.ok(
    isKnowledgeType('legal_memo') && isKnowledgeType('playbook') && !isKnowledgeType('gossip'),
    'knowledge type recognized',
  );
  t.equal(AUTHORITY_TYPES.length, 10, 'ten authority types');
  t.ok(
    isAuthorityType('statute') && isAuthorityType('case_law') && !isAuthorityType('rumor'),
    'authority type recognized',
  );
  t.equal(AUTHORITY_TREATMENTS.length, 9, 'nine authority treatments');
  t.ok(
    isAuthorityTreatment('overruled') && isAuthorityTreatment('followed') && !isAuthorityTreatment('ignored'),
    'treatment recognized',
  );
  t.equal(CLAUSE_KINDS.length, 6, 'six clause kinds');
  t.ok(
    isClauseKind('prohibited') && isClauseKind('fallback') && !isClauseKind('whatever'),
    'clause kind recognized',
  );
  t.equal(AUTHORITY_LEVELS.length, 4, 'four authority levels');
  t.ok(isAuthorityLevel('binding') && !isAuthorityLevel('supreme'), 'authority level recognized');
  t.equal(PRIVILEGE_LEVELS.length, 4, 'four privilege levels');
  t.ok(
    isPrivilegeLevel('attorney_client') && isPrivilegeLevel('none') && !isPrivilegeLevel('secret'),
    'privilege level recognized',
  );
  t.equal(CONFIDENTIALITY_LEVELS.length, 4, 'four confidentiality levels');
  t.ok(isConfidentiality('privileged') && !isConfidentiality('classified'), 'confidentiality recognized');
  t.ok(confidentialityRank('privileged') > confidentialityRank('standard'), 'confidentiality ranks order');
  t.equal(RISK_LEVELS.length, 4, 'four risk levels');
  t.ok(isRiskLevel('critical') && !isRiskLevel('spicy'), 'risk level recognized');
  t.equal(SOURCE_TYPES.length, 8, 'eight source types');
  t.ok(isSourceType('regulator') && !isSourceType('ouija'), 'source type recognized');
  t.equal(TAXONOMY_KINDS.length, 5, 'five taxonomy kinds');
  t.ok(
    isTaxonomyKind('practice_area') && isTaxonomyKind('jurisdiction') && !isTaxonomyKind('mood'),
    'taxonomy kind recognized',
  );
  t.equal(REVIEW_TYPES.length, 5, 'five review types');
  t.ok(
    isReviewType('expiry') && isReviewType('renewal') && !isReviewType('whenever'),
    'review type recognized',
  );
  t.equal(REFERENCE_TYPES.length, 7, 'seven reference types');
  t.ok(
    isReferenceType('document') &&
      isReferenceType('matter') &&
      isReferenceType('litigation') &&
      !isReferenceType('telepathy'),
    'reference type recognized',
  );
  t.equal(NOTE_TYPES.length, 6, 'six note types');
  t.ok(
    isNoteType('privileged') &&
      isRestrictedNote('strategy') &&
      isRestrictedNote('confidential') &&
      !isRestrictedNote('general'),
    'restricted note recognized',
  );
  t.ok(new LegalDocsError('X', 'y') instanceof Error, 'LegalDocsError is an Error');
  t.equal(LEGALDOCS_LIMITS.maxSearchLimit, 200, 'search bounded');

  // --- publishable lifecycle (shared by knowledge/template/clause) ------------------------------
  t.equal(PUBLISHABLE_STATUSES.length, 9, 'nine publishable states');
  t.ok(checkPublishableTransition('draft', 'under_review').ok, 'draft -> under_review ok');
  t.ok(checkPublishableTransition('under_review', 'approved').ok, 'under_review -> approved ok');
  t.ok(
    checkPublishableTransition('under_review', 'changes_requested').ok,
    'under_review -> changes_requested ok',
  );
  t.ok(checkPublishableTransition('changes_requested', 'draft').ok, 'changes_requested -> draft ok');
  t.ok(checkPublishableTransition('approved', 'published').ok, 'approved -> published ok');
  t.ok(checkPublishableTransition('published', 'superseded').ok, 'published -> superseded ok');
  t.ok(checkPublishableTransition('published', 'withdrawn').ok, 'published -> withdrawn ok');
  t.ok(checkPublishableTransition('withdrawn', 'reopened').ok, 'withdrawn -> reopened ok');
  t.ok(checkPublishableTransition('published', 'archived').ok, 'published -> archived ok');
  t.ok(!checkPublishableTransition('draft', 'published').ok, 'draft -> published rejected');
  t.ok(!checkPublishableTransition('archived', 'reopened').ok, 'archived is terminal');
  t.ok(!checkPublishableTransition('nowhere', 'draft').ok, 'unknown state rejected');
  t.ok(
    isPublishableTerminal('archived') &&
      !isPublishableTerminal('withdrawn') &&
      !isPublishableTerminal('published'),
    'only archived terminal',
  );
  t.ok(
    isPublishableFrozen('published') &&
      isPublishableFrozen('superseded') &&
      !isPublishableFrozen('approved') &&
      !isPublishableFrozen('draft'),
    'frozen after publish',
  );
  t.ok(
    isPublishableOpen('published') && !isPublishableOpen('withdrawn') && !isPublishableOpen('archived'),
    'open check',
  );
  t.ok(isPublished('published') && !isPublished('approved'), 'published check');

  // --- deterministic review / expiry deadlines --------------------------------------------------
  const start = 1_700_000_000_000;
  t.equal(
    computeReviewDueMs({ type: 'periodic_review', startMs: start, rule: { kind: 'offset_days', days: 365 } }),
    start + 365 * 86_400_000,
    'offset_days review deterministic',
  );
  t.equal(
    computeReviewDueMs({ type: 'expiry', startMs: start, rule: { kind: 'explicit', dueMs: start + 500 } }),
    start + 500,
    'explicit review deterministic',
  );
  t.throws(
    () => computeReviewDueMs({ type: 'not_a_type', startMs: start, rule: { kind: 'offset_days', days: 1 } }),
    'invalid review type rejected',
  );
  t.throws(
    () =>
      computeReviewDueMs({
        type: 'periodic_review',
        startMs: start,
        rule: { kind: 'offset_days', days: -1 },
      }),
    'negative offset rejected',
  );
  t.ok(
    reviewState({ dueMs: start + 1000, nowMs: start + 2000, warnWindowMs: 500 }).overdue,
    'past-due review is overdue',
  );
  t.ok(
    reviewState({ dueMs: start + 1000, nowMs: start + 700, warnWindowMs: 500 }).warn,
    'inside warn window warns',
  );
  t.ok(isExpiry('expiry') && !isExpiry('renewal'), 'expiry flagged');
  t.ok(
    isExpirySafe('expiry', start + 1000, start) && !isExpirySafe('expiry', start - 1, start),
    'expiry safety check',
  );

  // --- relationships ----------------------------------------------------------------------------
  t.equal(RELATIONSHIP_KINDS.length, 7, 'seven relationship kinds');
  t.ok(
    isRelationshipKind('supersedes') && isRelationshipKind('cites') && !isRelationshipKind('vibes_with'),
    'relationship kind recognized',
  );
  t.equal(CLAUSE_RELATION_KINDS.length, 4, 'four clause relation kinds');
  t.ok(
    isClauseRelationKind('depends_on') &&
      isClauseRelationKind('conflicts_with') &&
      !isClauseRelationKind('likes'),
    'clause relation kind recognized',
  );
  t.ok(isSelfRelation('a', 'a') && !isSelfRelation('a', 'b'), 'self-relation check');

  // --- knowledge number -------------------------------------------------------------------------
  t.ok(
    isValidKnowledgeNumber(formatKnowledgeNumber('0123456789abcdef-0000')),
    'formatted knowledge number is valid',
  );
  t.equal(
    formatKnowledgeNumber('0123456789ab'),
    'KNOW-0123456789ab',
    'knowledge number format is deterministic',
  );
  t.ok(
    !isValidKnowledgeNumber('KNOW-XYZ') && !isValidKnowledgeNumber('nope'),
    'malformed knowledge number rejected',
  );

  // --- hash + clock -----------------------------------------------------------------------------
  t.equal(
    contentHashOf({ a: 1, b: 2 }),
    contentHashOf({ b: 2, a: 1 }),
    'content hash is key-order independent',
  );
  t.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}', 'canonical json sorts keys');
  t.ok(new SystemClock().now() > 0, 'system clock returns epoch ms');
  const fixed = new FixedClock(start);
  fixed.advance(1000);
  t.equal(fixed.now(), start + 1000, 'fixed clock advances deterministically');

  // --- permissions + audit codes ----------------------------------------------------------------
  t.equal(ALL_M18_PERMISSIONS.length, 46, 'forty-six permissions');
  t.equal(M18_PRIVILEGED_PERMISSIONS.length, 19, 'nineteen privileged permissions');
  t.ok(
    ALL_M18_PERMISSIONS.every((p) => p.startsWith('legaldocs.') && p.split('.').length === 3),
    'permissions are three-segment legaldocs.*',
  );
  t.equal(ALL_M18_AUDIT_CODES.length, 55, 'fifty-five audit codes');
  t.ok(
    ALL_M18_AUDIT_CODES.every((c) => c.startsWith(LEGALDOC_AUDIT_PREFIX) && c.split('_').length >= 3),
    'audit codes are LEGALDOC_ prefixed with >= 3 segments',
  );
  t.equal(new Set(ALL_M18_AUDIT_CODES).size, ALL_M18_AUDIT_CODES.length, 'audit codes unique');
});
