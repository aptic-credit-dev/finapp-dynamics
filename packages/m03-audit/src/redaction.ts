/**
 * Redaction — PURE. The audit spine is append-only: whatever is written is kept forever, so nothing
 * sensitive may enter it. This sanitises a caller's structured `detail`/snapshot before it is persisted:
 * secret-named fields are masked (recursively), oversized payloads are summarised, long strings are
 * truncated, and binary is rejected outright. It never throws — a malformed detail becomes a safe marker,
 * because an audit write must not break the transaction it records.
 */

export const REDACTED = '[REDACTED]';
const BINARY_REJECTED = '[BINARY_REJECTED]';
const TRUNCATED_SUFFIX = '…[truncated]';

/** Key names whose values are always masked, matched case-insensitively as substrings. */
const SECRET_KEY_PATTERN =
  /pass(word|phrase)?|secret|token|api[-_]?key|authoriz|cookie|otp|pin\b|cvv|cvc|\bpan\b|card[-_]?number|account[-_]?number|iban|ssn|national[-_]?id|private[-_]?key|credential|secret_hash|refresh|session[-_]?token|bearer/i;

const MAX_STRING_LENGTH = 2048;
const MAX_DEPTH = 8;
const MAX_KEYS = 200;
/** Serialised ceiling for the whole detail object; beyond this it is replaced by a summary marker. */
const MAX_SERIALIZED_BYTES = 16 * 1024;

export interface RedactionResult {
  readonly value: Record<string, unknown> | null;
  /** Dotted paths whose values were masked — recorded as metadata, never the values themselves. */
  readonly redactedKeys: readonly string[];
  readonly truncated: boolean;
  readonly oversized: boolean;
  readonly binaryRejected: boolean;
}

function isBinary(v: unknown): boolean {
  if (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer) return true;
  if (typeof Uint8Array !== 'undefined' && v instanceof Uint8Array) return true;
  // Node Buffer is a Uint8Array subclass, so the check above covers it.
  return false;
}

/** Sanitises a detail object for durable audit storage. Returns null for a null/absent input. */
export function redact(input: Record<string, unknown> | undefined | null): RedactionResult {
  const redactedKeys: string[] = [];
  const flags = { truncated: false, oversized: false, binaryRejected: false };
  if (input === undefined || input === null) {
    return { value: null, redactedKeys, truncated: false, oversized: false, binaryRejected: false };
  }

  const walk = (value: unknown, path: string, depth: number): unknown => {
    if (depth > MAX_DEPTH) {
      flags.truncated = true;
      return TRUNCATED_SUFFIX;
    }
    if (value === null || value === undefined) return value;
    if (isBinary(value)) {
      flags.binaryRejected = true;
      return BINARY_REJECTED;
    }
    if (typeof value === 'string') {
      if (value.length > MAX_STRING_LENGTH) {
        flags.truncated = true;
        return value.slice(0, MAX_STRING_LENGTH) + TRUNCATED_SUFFIX;
      }
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'function' || typeof value === 'symbol') return undefined;
    if (Array.isArray(value)) {
      return value.slice(0, MAX_KEYS).map((v, i) => walk(v, `${path}[${i}]`, depth + 1));
    }
    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      let count = 0;
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (count >= MAX_KEYS) {
          flags.truncated = true;
          break;
        }
        count += 1;
        const childPath = path === '' ? k : `${path}.${k}`;
        if (SECRET_KEY_PATTERN.test(k)) {
          redactedKeys.push(childPath);
          out[k] = REDACTED;
          continue;
        }
        out[k] = walk(v, childPath, depth + 1);
      }
      return out;
    }
    // Exotic objects (Date, Map, RegExp, …): represent safely rather than "[object Object]".
    if (value instanceof Date) return value.toISOString();
    return '[unserialisable]';
  };

  let value = walk(input, '', 0) as Record<string, unknown>;

  // Whole-payload ceiling: if the sanitised object still serialises too large, replace it with a summary
  // rather than persisting an unbounded blob into an append-only store.
  const serialized = safeStringify(value);
  if (serialized !== null && byteLength(serialized) > MAX_SERIALIZED_BYTES) {
    flags.oversized = true;
    flags.truncated = true;
    value = { _summary: 'detail omitted — exceeded audit payload ceiling', _bytes: byteLength(serialized) };
  } else if (serialized === null) {
    // Unserialisable (e.g. a cycle) — never persist it raw.
    flags.truncated = true;
    value = { _summary: 'detail omitted — not serialisable' };
  }

  return {
    value,
    redactedKeys,
    truncated: flags.truncated,
    oversized: flags.oversized,
    binaryRejected: flags.binaryRejected,
  };
}

function safeStringify(v: unknown): string | null {
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

function byteLength(s: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
  return s.length;
}
