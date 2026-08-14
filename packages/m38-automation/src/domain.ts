/**
 * M38 PURE domain — vocabulary, guards, the maker-checker/SoD + activation/publish gates, the GOVERNED recurrence parser (a
 * restricted vocabulary — NEVER OS cron/shell), the CAPABILITY-FACADE rule, and the SECRET-SEAM re-export. No I/O. THE
 * CAPABILITY RULE: an automation step + an extension point reference a REGISTERED capability by OPAQUE ref and each carries
 * the m02 permission it requires (a 3-segment permission) — automation never bypasses m02 RBAC and executes no arbitrary
 * code. THE RECURRENCE RULE: a schedule's recurrence is a bounded expression (`hourly`/`daily`/`weekly`/`every:<seconds>`)
 * whose interval must be >= the frequency floor (no job storm); there is NO cron/shell. THE HUMAN RULE: activating an
 * automation and publishing/promoting an extension are decided by a HUMAN who is not the requester. THE SECRET RULE: a
 * secret-bearing config is an opaque `secretref:` pointer (the m30 seam) — never a value.
 */
import { SECRET_REFERENCE_PATTERN, isSecretReference } from '@finapp/m30-platform';

export { SECRET_REFERENCE_PATTERN, isSecretReference };

export class AutomationError extends Error {
  readonly reasonCode: string;
  constructor(reasonCode: string, message?: string) {
    super(message ?? reasonCode);
    this.name = 'AutomationError';
    this.reasonCode = reasonCode;
  }
}

export const M38_LIMITS = {
  minIntervalSeconds: 60, // frequency floor — no high-frequency job storm
  maxSteps: 100,
  maxFindings: 100,
  maxPageSize: 200,
  defaultPageSize: 50,
  maxRunAttempts: 8,
} as const;

export const SCOPES = ['platform', 'tenant'] as const;
export type Scope = (typeof SCOPES)[number];
export function isScope(s: string): s is Scope {
  return (SCOPES as readonly string[]).includes(s);
}
export function isPlatformScope(s: string): boolean {
  return s === 'platform';
}

export const TRIGGER_KINDS = ['schedule', 'event', 'manual'] as const;
export function isTriggerKind(s: string): boolean {
  return (TRIGGER_KINDS as readonly string[]).includes(s);
}

export const AUTOMATION_STATES = ['draft', 'review_pending', 'active', 'suspended', 'archived'] as const;
export type AutomationState = (typeof AUTOMATION_STATES)[number];
export function isAutomationState(s: string): s is AutomationState {
  return (AUTOMATION_STATES as readonly string[]).includes(s);
}
export function isAutomationFrozen(s: string): boolean {
  return s === 'archived';
}

export const SCHEDULE_STATUSES = ['active', 'suspended'] as const;
export function isScheduleStatus(s: string): boolean {
  return (SCHEDULE_STATUSES as readonly string[]).includes(s);
}

export const CONCURRENCY_POLICIES = ['allow', 'forbid', 'replace'] as const;
export function isConcurrencyPolicy(s: string): boolean {
  return (CONCURRENCY_POLICIES as readonly string[]).includes(s);
}
export const MISSED_RUN_POLICIES = ['skip', 'run_once'] as const;
export function isMissedRunPolicy(s: string): boolean {
  return (MISSED_RUN_POLICIES as readonly string[]).includes(s);
}

export const RUN_STATUSES = ['succeeded', 'failed', 'blocked', 'skipped'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export function isRunStatus(s: string): boolean {
  return (RUN_STATUSES as readonly string[]).includes(s);
}

export const TRUST_TIERS = ['untrusted', 'verified', 'certified'] as const;
export function isTrustTier(s: string): boolean {
  return (TRUST_TIERS as readonly string[]).includes(s);
}
export const ISOLATION_LEVELS = ['none', 'sandboxed', 'isolated'] as const;
export function isIsolationLevel(s: string): boolean {
  return (ISOLATION_LEVELS as readonly string[]).includes(s);
}

export const EXTENSION_STATES = ['draft', 'review_pending', 'published', 'deprecated', 'rejected'] as const;
export type ExtensionState = (typeof EXTENSION_STATES)[number];
export function isExtensionState(s: string): s is ExtensionState {
  return (EXTENSION_STATES as readonly string[]).includes(s);
}
export const INSTALL_STATUSES = ['enabled', 'disabled'] as const;
export function isInstallStatus(s: string): boolean {
  return (INSTALL_STATUSES as readonly string[]).includes(s);
}

export const REASON_CODES = {
  automationDefined: 'automation_defined',
  stepAdded: 'step_added',
  scheduleSet: 'schedule_set',
  reviewRequested: 'review_requested',
  activated: 'automation_activated',
  suspended: 'automation_suspended',
  archived: 'automation_archived',
  rejected: 'review_rejected',
  runRecorded: 'run_recorded',
  runBlocked: 'run_blocked',
  extensionDefined: 'extension_defined',
  pointAdded: 'extension_point_added',
  published: 'extension_published',
  deprecated: 'extension_deprecated',
  installed: 'extension_installed',
  disabled: 'extension_disabled',
  validationNotPassed: 'validation_not_passed',
  notHumanApprover: 'approver_not_human',
  selfApproval: 'self_approval_forbidden',
  missingRequiredPermission: 'step_missing_required_permission',
  invalidRecurrence: 'invalid_recurrence',
  frequencyTooHigh: 'recurrence_frequency_too_high',
  invalidSecretReference: 'invalid_secret_reference',
  capabilityUnavailable: 'capability_unavailable',
  automationNotActive: 'automation_not_active',
  structuralInvalid: 'structural_invalid',
} as const;
export type ReasonCodeKey = keyof typeof REASON_CODES;
export const ALL_REASON_CODES: readonly string[] = Object.values(REASON_CODES);

// ---- maker-checker (controlled activation/publication) ----

export function isHumanActor(actor: string | null | undefined): actor is string {
  if (actor === null || actor === undefined) return false;
  const a = actor.trim().toLowerCase();
  if (a === '') return false;
  return a !== 'system' && a !== 'ai' && a !== 'automation';
}

export interface GateResult {
  readonly allowed: boolean;
  readonly reasonCode: string;
}

export function evaluateSodGate(requestedBy: string, approver: string | null): GateResult {
  if (!isHumanActor(approver)) return { allowed: false, reasonCode: REASON_CODES.notHumanApprover };
  if (approver === requestedBy) return { allowed: false, reasonCode: REASON_CODES.selfApproval };
  return { allowed: true, reasonCode: REASON_CODES.activated };
}

export interface ActivationGateInput {
  readonly validationPassed: boolean;
  readonly requestedBy: string;
  readonly approver: string | null;
}
/** Activating an automation / publishing an extension needs a passing validation + an independent human approver. */
export function evaluateActivationGate(input: ActivationGateInput): GateResult {
  if (!input.validationPassed) return { allowed: false, reasonCode: REASON_CODES.validationNotPassed };
  return evaluateSodGate(input.requestedBy, input.approver);
}

// ---- GOVERNED recurrence (restricted vocabulary; NO cron/shell) ----

const RECURRENCE_ALIASES: Record<string, number> = { hourly: 3600, daily: 86400, weekly: 604800 };

/** Parse a bounded recurrence expression to an interval in seconds. `hourly`/`daily`/`weekly` or `every:<seconds>`. */
export function parseRecurrence(expr: string): number | null {
  const e = expr.trim().toLowerCase();
  if (e in RECURRENCE_ALIASES) return RECURRENCE_ALIASES[e] ?? null;
  const m = /^every:(\d{1,7})$/.exec(e);
  if (m !== null) return Number(m[1]);
  return null;
}

export interface ValidationFinding {
  readonly code: string;
  readonly ref?: string;
}

/** A recurrence is valid iff it parses AND its interval is >= the frequency floor (no job storm). Fail closed. */
export function validateRecurrence(
  expr: string,
  minIntervalSeconds: number = M38_LIMITS.minIntervalSeconds,
): ValidationFinding[] {
  const interval = parseRecurrence(expr);
  if (interval === null) return [{ code: REASON_CODES.invalidRecurrence, ref: 'recurrence' }];
  if (interval < minIntervalSeconds) return [{ code: REASON_CODES.frequencyTooHigh, ref: 'recurrence' }];
  return [];
}

/** Compute the next run epoch (seconds) from a recurrence + a reference epoch. Deterministic; no wall clock here. */
export function computeNextRun(expr: string, fromEpochSeconds: number): number | null {
  const interval = parseRecurrence(expr);
  if (interval === null || interval <= 0) return null;
  return fromEpochSeconds + interval;
}

// ---- the CAPABILITY-FACADE rule: a step/point carries the m02 permission it requires ----

export function isThreeSegmentPermission(p: string): boolean {
  const parts = p.split('.');
  return parts.length === 3 && parts.every((s) => s.trim() !== '');
}

export interface CapabilityStep {
  readonly capabilityRef: string;
  readonly requiredPermission: string;
}

/** Screen automation steps / extension points: each must name a REGISTERED capability AND carry a 3-segment m02 permission
 * (automation never bypasses the RBAC permission that guards the action). No raw executable code. Fail closed. */
export function screenSteps(steps: readonly CapabilityStep[]): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const s of steps) {
    if (findings.length >= M38_LIMITS.maxFindings) break;
    if (s.capabilityRef.trim() === '')
      findings.push({ code: REASON_CODES.structuralInvalid, ref: 'capability_ref' });
    if (!isThreeSegmentPermission(s.requiredPermission))
      findings.push({ code: REASON_CODES.missingRequiredPermission, ref: s.capabilityRef });
  }
  return findings;
}

// ---- automation validation (fail closed) ----

export interface ValidationOutcome {
  readonly passed: boolean;
  readonly findings: readonly ValidationFinding[];
}

/** An automation is valid if its key/trigger are well-formed and it exposes at least one permission-guarded capability step. */
export function validateAutomation(input: {
  automationKey: string;
  triggerKind: string;
  steps: readonly CapabilityStep[];
}): ValidationOutcome {
  const findings: ValidationFinding[] = [];
  if (input.automationKey.trim() === '')
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'automation_key' });
  if (!isTriggerKind(input.triggerKind))
    findings.push({ code: REASON_CODES.structuralInvalid, ref: 'trigger_kind' });
  if (input.steps.length === 0) findings.push({ code: REASON_CODES.structuralInvalid, ref: 'steps' });
  findings.push(...screenSteps(input.steps));
  return { passed: findings.length === 0, findings };
}

export interface Page {
  readonly limit: number;
  readonly offset: number;
}
export function clampPage(limit?: number, offset?: number): Page {
  const l =
    limit === undefined || limit <= 0 ? M38_LIMITS.defaultPageSize : Math.min(limit, M38_LIMITS.maxPageSize);
  const o = offset === undefined || offset < 0 ? 0 : offset;
  return { limit: l, offset: o };
}
