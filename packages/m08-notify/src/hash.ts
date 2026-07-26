/**
 * Canonical hashing — the immutability evidence for a published template/policy spec (content_hash) and the
 * idempotency-payload hash for a request's variables. Canonical JSON sorts object keys so the hash is stable
 * regardless of key order (deterministic, replayable).
 */
import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/** Canonical SHA-256 of any JSON-serialisable value, prefixed `sha256:`. */
export function contentHashOf(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}
