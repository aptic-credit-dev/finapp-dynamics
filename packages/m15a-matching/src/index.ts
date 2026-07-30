/**
 * @finapp/m15a-matching — the PURE, deterministic, explainable bank-reconciliation matching engine (Stage 3).
 *
 * No I/O, no tables, no ambient clock, no randomness, no float money. It scores a bank statement line against a
 * candidate ledger entry under a versioned ruleset, assigns a confidence band + colour status, computes exact
 * variances in INTEGER MINOR UNITS, and classifies match cardinality (1:1, 1:many, many:1, split, grouped). Same
 * inputs + same ruleset version => identical output (reproducible). Consumed by m15-recon; AI suggestions (m27) are
 * a separate optional layer and are never required.
 */
export {
  RULE_KINDS,
  isRuleKind,
  CONFIDENCE_BANDS,
  isConfidenceBand,
  COLOUR_STATUS,
  MATCH_TYPES,
  isMatchType,
  DIRECTIONS,
  isDirection,
  EXCEPTION_TYPES,
  isExceptionType,
  MatchingError,
  assertMinorUnits,
  amountVarianceMinor,
  dateVarianceDays,
} from './domain.ts';
export type { RuleKind, ConfidenceBand, MatchType, Direction, ExceptionType } from './domain.ts';

export {
  scoreCandidate,
  confidenceOf,
  classifyMatchType,
  sumMinor,
  balances,
  bestCandidate,
} from './engine.ts';
export type { MatchableLine, MatchRuleConfig, Ruleset, CandidateScore } from './engine.ts';
