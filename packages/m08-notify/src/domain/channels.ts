/**
 * Channel abstraction + destination normalization (channel-neutral core, ADR-040).
 *
 * The module models channels as an allow-listed enum and normalizes/validates destinations WITHOUT contacting
 * any provider — normalization is pure and deterministic. Webhook destinations are validated against an SSRF
 * guard (https only, no credentials, no private/loopback/link-local literals): the module never becomes an
 * arbitrary-URL fetcher (ADR-041, prompt §E19). Actual sending is a provider adapter's job (ports/adapters).
 */
import { NotifyError } from './limits.ts';

export const CHANNELS = ['email', 'sms', 'in_app', 'webhook'] as const;
export type Channel = (typeof CHANNELS)[number];

export function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && (CHANNELS as readonly string[]).includes(value);
}

/** Escaping appropriate to a channel's rendered output. Email + in-app are HTML-escaped; SMS/webhook are not. */
export function channelEscapes(channel: Channel): boolean {
  return channel === 'email' || channel === 'in_app';
}

/** Does the channel render a subject line? (Email + in-app do; SMS + webhook do not.) */
export function channelHasSubject(channel: Channel): boolean {
  return channel === 'email' || channel === 'in_app';
}

export interface DestinationResult {
  readonly ok: boolean;
  readonly value?: string;
  readonly error?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reject hosts that would let a webhook reach the internal network (SSRF, prompt §E19). */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) {
    return true;
  }
  if (h === '0.0.0.0' || h === '127.0.0.1' || h.startsWith('127.') || h === '::1') return true;
  if (h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('169.254.')) return true;
  // 172.16.0.0 – 172.31.255.255
  const m = /^172\.(\d{1,3})\./.exec(h);
  if (m !== null) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  // Cloud metadata endpoint.
  if (h === '169.254.169.254' || h === 'metadata.google.internal') return true;
  return false;
}

/**
 * Normalizes a raw destination for a channel, or refuses. Deterministic, no I/O.
 *  - email: trimmed + lowercased, must look like an address.
 *  - sms:   compact E.164 (`+` and 7–15 digits).
 *  - in_app: a recipient UUID (the inbox owner).
 *  - webhook: an absolute https URL to a non-private host, with no embedded credentials.
 */
export function normalizeDestination(channel: Channel, raw: unknown): DestinationResult {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, error: 'destination is required' };
  }
  const value = raw.trim();
  switch (channel) {
    case 'email': {
      const lower = value.toLowerCase();
      return EMAIL_RE.test(lower)
        ? { ok: true, value: lower }
        : { ok: false, error: 'not a valid email address' };
    }
    case 'sms': {
      const compact = value.replace(/[\s()-]/g, '');
      return E164_RE.test(compact)
        ? { ok: true, value: compact }
        : { ok: false, error: 'not a valid E.164 phone number' };
    }
    case 'in_app': {
      return UUID_RE.test(value)
        ? { ok: true, value: value.toLowerCase() }
        : { ok: false, error: 'in-app destination must be a recipient id (uuid)' };
    }
    case 'webhook': {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return { ok: false, error: 'not a valid url' };
      }
      if (url.protocol !== 'https:') return { ok: false, error: 'webhook url must be https' };
      if (url.username !== '' || url.password !== '') {
        return { ok: false, error: 'webhook url must not embed credentials' };
      }
      if (isPrivateHost(url.hostname)) {
        return { ok: false, error: 'webhook url must not target a private or loopback host' };
      }
      return { ok: true, value: url.toString() };
    }
    default:
      return { ok: false, error: 'unknown channel' };
  }
}

/** Throwing form for services (they surface a stable 400). */
export function requireDestination(channel: Channel, raw: unknown): string {
  const result = normalizeDestination(channel, raw);
  if (!result.ok || result.value === undefined) {
    throw new NotifyError('INVALID_DESTINATION', result.error ?? 'invalid destination');
  }
  return result.value;
}
