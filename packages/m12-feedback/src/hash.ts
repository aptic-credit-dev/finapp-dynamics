/**
 * Canonical hashing — the immutability evidence for a published questionnaire/SLA-policy spec (content_hash) and
 * a safe payload hash for an ingested source transaction (so the raw external payload is never persisted).
 */
import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function contentHashOf(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}
