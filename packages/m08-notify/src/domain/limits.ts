/**
 * Hard limits for the notifications domain. Every bound is enforced fail-closed so a malformed template,
 * an oversized payload, or an excessive recipient set is rejected deterministically rather than turned into
 * a denial-of-service or an unbounded render (ADR-040). These are DATA, shared by the validator, the safe
 * renderer, and the request path.
 */
export const NOTIFY_LIMITS = {
  /** Max characters in a subject or body template string. */
  maxTemplateChars: 20_000,
  /** Max characters in a fully rendered output. */
  maxRenderedChars: 40_000,
  /** Max declared variables on a template. */
  maxVariables: 100,
  /** Max variables supplied on a request. */
  maxSuppliedVariables: 200,
  /** Max characters in a single string variable value. */
  maxVariableValueChars: 8_000,
  /** Max `{{ placeholders }}` a single template may contain. */
  maxPlaceholders: 500,
  /** Max recipients resolved for one request or escalation level. */
  maxRecipients: 500,
  /** Max escalation levels a policy may declare. */
  maxEscalationLevels: 20,
  /** Max delivery attempts a retry policy may allow. */
  maxAttempts: 20,
} as const;

/** A structured, safe-to-surface domain error. Never carries secrets or raw payload values. */
export class NotifyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'NotifyError';
    this.code = code;
  }
}
