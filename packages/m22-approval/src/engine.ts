/**
 * The PURE maker-checker + Segregation-of-Duties engine — no I/O, fully deterministic and reproducible (same input =>
 * identical output), so it is exhaustively unit-tested and shared by the services and (mirrored) by the DB CHECKs.
 * This is where "one identity must never both make and check a controlled action" is decided. It fails CLOSED: any
 * ambiguity yields a BLOCKED verdict with an explaining reason code. The engine NEVER approves — it only decides
 * whether a given actor is *permitted to act as checker* on a request, and whether an approval quorum has been met.
 */
import {
  APPROVING_DECISIONS,
  REASON_CODES,
  type DecisionKind,
  type SodRule,
  type SodVerdict,
} from './domain/vocab.ts';

export class ApprovalEngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApprovalEngineError';
    this.code = code;
  }
}

/** A single SoD finding — the rule that was evaluated, its verdict, and the machine-readable reason code. */
export interface SodFinding {
  readonly rule: SodRule;
  readonly verdict: SodVerdict;
  readonly reasonCode: string;
}

export interface SodInput {
  /** The actor attempting to act as checker/approver on the request. */
  readonly actor: string;
  /** Who raised the request (the maker). */
  readonly maker: string | null;
  /** Who prepared the underlying artefact (e.g. the m21 journal preparer), when distinct from the maker. */
  readonly preparer?: string | null;
  /** If the actor is acting under a delegation, who delegated to them (the delegation still must not launder SoD). */
  readonly delegatorOf?: string | null;
  /** Prior distinct approvers on this request — used for the single-approver (needs a second checker) rule. */
  readonly priorApprovers?: readonly string[];
  /** Whether the policy requires at least two distinct approvers (strict mode). */
  readonly requireDistinctSecondApprover?: boolean;
}

export interface SodResult {
  readonly allowed: boolean;
  readonly findings: readonly SodFinding[];
}

/**
 * Evaluate whether `actor` may act as CHECKER on a request. Every rule that BLOCKS contributes a finding; the actor is
 * allowed only when nothing blocks. Fails closed: a missing maker/actor is treated as a block, not a pass.
 */
export function evaluateSod(input: SodInput): SodResult {
  const findings: SodFinding[] = [];
  const actor = input.actor.trim();
  if (actor === '') {
    findings.push({
      rule: 'maker_checker',
      verdict: 'blocked',
      reasonCode: REASON_CODES.unauthorizedActor.code,
    });
    return { allowed: false, findings };
  }
  // maker != checker
  if (input.maker != null && actor === input.maker) {
    findings.push({
      rule: 'maker_checker',
      verdict: 'blocked',
      reasonCode: REASON_CODES.makerIsChecker.code,
    });
  }
  // preparer != checker (e.g. the journal preparer cannot be the required checker)
  if (input.preparer != null && actor === input.preparer) {
    findings.push({
      rule: 'preparer_checker',
      verdict: 'blocked',
      reasonCode: REASON_CODES.preparerIsChecker.code,
    });
  }
  // a delegated approver cannot bypass SoD — if the delegator is the maker, the delegation launders nothing
  if (input.delegatorOf != null && input.maker != null && input.delegatorOf === input.maker) {
    findings.push({
      rule: 'delegate_maker',
      verdict: 'blocked',
      reasonCode: REASON_CODES.delegateIsMaker.code,
    });
  }
  // a delegated approver who IS the maker is also blocked
  if (input.delegatorOf != null && actor === input.maker) {
    findings.push({
      rule: 'delegate_maker',
      verdict: 'blocked',
      reasonCode: REASON_CODES.delegateIsMaker.code,
    });
  }
  // strict mode: a second, DISTINCT approver is required — the same actor cannot supply both approvals
  if (input.requireDistinctSecondApprover === true && (input.priorApprovers ?? []).includes(actor)) {
    findings.push({
      rule: 'single_approver',
      verdict: 'blocked',
      reasonCode: REASON_CODES.singleApprover.code,
    });
  }
  return { allowed: findings.length === 0, findings };
}

/** Convenience: is this actor permitted to record this decision under SoD? Only approving decisions are gated here. */
export function sodPermits(decision: DecisionKind, input: SodInput): SodResult {
  if (!(APPROVING_DECISIONS as readonly string[]).includes(decision)) {
    return { allowed: true, findings: [] };
  }
  return evaluateSod(input);
}

export interface QuorumInput {
  readonly approvalsCount: number;
  readonly requiredApprovals: number;
}
export interface QuorumResult {
  readonly met: boolean;
  readonly remaining: number;
  readonly reasonCode: string;
}
/** Deterministic quorum check — how many distinct approvals are still needed before a request can be approved. */
export function checkQuorum(input: QuorumInput): QuorumResult {
  if (!Number.isInteger(input.requiredApprovals) || input.requiredApprovals < 1) {
    throw new ApprovalEngineError('BadQuorum', 'requiredApprovals must be a positive integer');
  }
  if (!Number.isInteger(input.approvalsCount) || input.approvalsCount < 0) {
    throw new ApprovalEngineError('BadQuorum', 'approvalsCount must be a non-negative integer');
  }
  const remaining = Math.max(0, input.requiredApprovals - input.approvalsCount);
  const met = input.approvalsCount >= input.requiredApprovals;
  return {
    met,
    remaining,
    reasonCode: met ? REASON_CODES.quorumMet.code : REASON_CODES.insufficientApprovals.code,
  };
}

export interface EscalationInput {
  readonly currentDepth: number;
  readonly maxDepth: number;
}
/** Deterministic escalation guard — an escalation is permitted only while depth stays within the bounded maximum. */
export function canEscalate(input: EscalationInput): { ok: boolean; nextDepth: number; reasonCode: string } {
  const nextDepth = input.currentDepth + 1;
  if (nextDepth > input.maxDepth) {
    return {
      ok: false,
      nextDepth: input.currentDepth,
      reasonCode: REASON_CODES.escalationDepthExceeded.code,
    };
  }
  return { ok: true, nextDepth, reasonCode: REASON_CODES.escalationTimeout.code };
}
