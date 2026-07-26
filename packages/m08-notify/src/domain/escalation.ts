/**
 * Escalation policy spec + level calculator (prompt §E8) — the immutable, versioned document stored on
 * `escalation_policy.spec`. A policy is an ordered ladder of levels; each level has a delay, a channel, an
 * optional notification template, and declarative recipients (resolved by the same port as notifications).
 * PURE: validation and the "what is the next level and when" calculation carry no I/O and no clock — the
 * caller supplies the current level and applies the returned delay against a stored timestamp.
 */
import { NOTIFY_LIMITS, NotifyError } from './limits.ts';
import { CHANNELS } from './channels.ts';
import { RECIPIENT_KINDS, type RecipientRef } from './recipients.ts';

export const ESCALATION_SCHEMA_VERSION = 1;

export interface EscalationLevel {
  readonly level: number;
  readonly delayMs: number;
  readonly channel: string;
  readonly templateCode?: string;
  readonly recipients: readonly RecipientRef[];
}

export interface EscalationPolicySpec {
  readonly schemaVersion: number;
  readonly code: string;
  readonly name: string;
  readonly requireAck: boolean;
  readonly repeatIntervalMs?: number;
  readonly levels: readonly EscalationLevel[];
}

export interface EscalationSpecError {
  readonly path: string;
  readonly code: string;
}
export interface EscalationSpecValidation {
  readonly ok: boolean;
  readonly errors: readonly EscalationSpecError[];
}

const IDENT_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;

export function validateEscalationSpec(candidate: unknown): EscalationSpecValidation {
  const errors: EscalationSpecError[] = [];
  const push = (path: string, code: string): void => void errors.push({ path, code });

  if (typeof candidate !== 'object' || candidate === null) {
    return { ok: false, errors: [{ path: '<root>', code: 'NOT_AN_OBJECT' }] };
  }
  const spec = candidate as Record<string, unknown>;
  if (spec['schemaVersion'] !== ESCALATION_SCHEMA_VERSION)
    push('schemaVersion', 'UNSUPPORTED_SCHEMA_VERSION');
  if (typeof spec['code'] !== 'string' || !IDENT_RE.test(spec['code'])) push('code', 'INVALID_CODE');
  if (typeof spec['name'] !== 'string' || spec['name'].trim() === '') push('name', 'NAME_REQUIRED');
  if (typeof spec['requireAck'] !== 'boolean') push('requireAck', 'REQUIRE_ACK_MUST_BE_BOOLEAN');
  if (spec['repeatIntervalMs'] !== undefined) {
    const r = spec['repeatIntervalMs'];
    if (typeof r !== 'number' || !Number.isFinite(r) || r < 0) push('repeatIntervalMs', 'INVALID_INTERVAL');
  }

  const levels = spec['levels'];
  if (!Array.isArray(levels) || levels.length === 0) {
    push('levels', 'LEVELS_REQUIRED');
  } else {
    if (levels.length > NOTIFY_LIMITS.maxEscalationLevels) push('levels', 'TOO_MANY_LEVELS');
    levels.forEach((lvl, i) => {
      if (typeof lvl !== 'object' || lvl === null) {
        push(`levels[${String(i)}]`, 'INVALID_LEVEL');
        return;
      }
      const l = lvl as Record<string, unknown>;
      if (l['level'] !== i + 1) push(`levels[${String(i)}].level`, 'LEVEL_MUST_BE_SEQUENTIAL');
      if (typeof l['delayMs'] !== 'number' || !Number.isFinite(l['delayMs']) || l['delayMs'] < 0) {
        push(`levels[${String(i)}].delayMs`, 'INVALID_DELAY');
      }
      if (!(CHANNELS as readonly unknown[]).includes(l['channel'])) {
        push(`levels[${String(i)}].channel`, 'INVALID_CHANNEL');
      }
      if (l['templateCode'] !== undefined && typeof l['templateCode'] !== 'string') {
        push(`levels[${String(i)}].templateCode`, 'INVALID_TEMPLATE_CODE');
      }
      const recips = l['recipients'];
      if (!Array.isArray(recips) || recips.length === 0) {
        push(`levels[${String(i)}].recipients`, 'RECIPIENTS_REQUIRED');
      } else if (recips.length > NOTIFY_LIMITS.maxRecipients) {
        push(`levels[${String(i)}].recipients`, 'TOO_MANY_RECIPIENTS');
      } else {
        recips.forEach((r, j) => {
          if (typeof r !== 'object' || r === null) {
            push(`levels[${String(i)}].recipients[${String(j)}]`, 'INVALID_RECIPIENT');
            return;
          }
          const rr = r as Record<string, unknown>;
          if (!(RECIPIENT_KINDS as readonly unknown[]).includes(rr['kind'])) {
            push(`levels[${String(i)}].recipients[${String(j)}].kind`, 'INVALID_RECIPIENT_KIND');
          }
          if (typeof rr['ref'] !== 'string' || rr['ref'].trim() === '') {
            push(`levels[${String(i)}].recipients[${String(j)}].ref`, 'RECIPIENT_REF_REQUIRED');
          }
        });
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

export interface EscalationStep {
  readonly advance: boolean;
  readonly nextLevel: number;
  readonly delayMs: number;
  readonly exhausted: boolean;
}

/**
 * Given a validated spec and the current level (0 = not yet started), compute the next level to fire and its
 * delay. When the ladder is exhausted, `exhausted` is true and no further level fires (bounded — no infinite
 * escalation). `repeatIntervalMs`, if set, re-fires the LAST level rather than advancing past it.
 */
export function nextEscalation(spec: EscalationPolicySpec, currentLevel: number): EscalationStep {
  const total = spec.levels.length;
  if (currentLevel < total) {
    const next = spec.levels[currentLevel];
    if (next === undefined) {
      return { advance: false, nextLevel: currentLevel, delayMs: 0, exhausted: true };
    }
    return { advance: true, nextLevel: next.level, delayMs: next.delayMs, exhausted: false };
  }
  // At or beyond the last level.
  if (spec.repeatIntervalMs !== undefined && spec.repeatIntervalMs > 0) {
    return { advance: false, nextLevel: total, delayMs: spec.repeatIntervalMs, exhausted: false };
  }
  return { advance: false, nextLevel: total, delayMs: 0, exhausted: true };
}

/** The recipients + template + channel for a given 1-based level, or null. */
export function levelAt(spec: EscalationPolicySpec, level: number): EscalationLevel | null {
  return spec.levels[level - 1] ?? null;
}

export function escalationContentHashInput(spec: EscalationPolicySpec): EscalationPolicySpec {
  return spec;
}

export function assertValidEscalationSpec(candidate: unknown): EscalationPolicySpec {
  const result = validateEscalationSpec(candidate);
  if (!result.ok) {
    throw new NotifyError(
      'INVALID_ESCALATION_SPEC',
      `escalation policy invalid (${String(result.errors.length)} problems)`,
    );
  }
  return candidate as EscalationPolicySpec;
}
