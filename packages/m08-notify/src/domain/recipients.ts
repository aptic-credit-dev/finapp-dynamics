/**
 * Recipient model + deterministic dedup (prompt §E9). Recipients are described declaratively — an explicit
 * user, an explicit destination, a role, or a permission — and RESOLVED by a port whose data is owned by other
 * modules (identity/rbac); m08 never invents organizational data. This module owns only the pure parts:
 * a stable recipient descriptor, deterministic de-duplication and ordering, and the resolution record shape.
 * Resolution must fail safe: no resolvable recipient is a refusal, not a silent drop.
 */
import { NOTIFY_LIMITS, NotifyError } from './limits.ts';

export const RECIPIENT_KINDS = ['user', 'destination', 'role', 'permission'] as const;
export type RecipientKind = (typeof RECIPIENT_KINDS)[number];

/** A declarative recipient reference — WHO, not yet WHERE. */
export interface RecipientRef {
  readonly kind: RecipientKind;
  /** user id / role code / permission code / raw destination, by kind. */
  readonly ref: string;
}

/** A recipient resolved to a concrete destination, with how it was resolved (evidence, prompt §E9). */
export interface ResolvedRecipient {
  readonly kind: RecipientKind;
  readonly ref: string;
  readonly recipientId?: string;
  readonly destination: string;
  readonly resolvedVia: string;
}

/**
 * De-duplicate resolved recipients by destination, preserving first-seen order (deterministic). Two role
 * resolvers landing on the same person send one message, not two.
 */
export function dedupeRecipients(list: readonly ResolvedRecipient[]): ResolvedRecipient[] {
  if (list.length > NOTIFY_LIMITS.maxRecipients) {
    throw new NotifyError('TOO_MANY_RECIPIENTS', 'resolved recipient set exceeds the hard limit');
  }
  const seen = new Set<string>();
  const out: ResolvedRecipient[] = [];
  for (const r of list) {
    const key = r.destination.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

/** Stable ordering for a resolved set — destination ascending, so the same set always dispatches in one order. */
export function orderRecipients(list: readonly ResolvedRecipient[]): ResolvedRecipient[] {
  return [...list].sort((a, b) =>
    a.destination < b.destination ? -1 : a.destination > b.destination ? 1 : 0,
  );
}
