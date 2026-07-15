import type { RequestContext, SystemContext } from './request-context.ts';
import type { Tx } from './db.ts';

/**
 * The AUDIT contract.
 *
 * Stage 0 declared the `AUDIT` token but no interface. The contract belongs with the token — in the
 * kernel — while the single authoritative implementation is owned by m03-audit
 * (docs/01-architecture/SHARED_SERVICE_OWNERSHIP.md). Modules consume this; nobody writes a second
 * audit store (ADR-005).
 */

/** Every controlled action writes one entry, keyed by a registered SCREAMING_SNAKE code. */
export interface AuditEntry {
  /** Registered code from manifests/audit-code-registry.yaml. Unregistered codes fail CI (ADR-005). */
  readonly code: string;
  /** The record acted on, e.g. `tenant`, `tenant_environment`. */
  readonly entityType: string;
  /** Identifier of the record acted on. */
  readonly entityId: string;
  /** Why — required for codes whose registry entry sets `reason_required`. */
  readonly reason?: string;
  /**
   * Structured detail. Must be safe to retain: no secrets, no full payloads of restricted data.
   * The audit spine is append-only, so anything written here is written forever.
   */
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface Audit {
  /**
   * Records an audited action **inside the caller's transaction**.
   *
   * Taking `tx` is the whole point: the audit entry and the state change it describes commit or roll
   * back together. An audit written outside the transaction would eventually describe a change that
   * never happened, and a controlled action whose audit failed independently would succeed unrecorded
   * — both are the "security event disappears silently" failure CLAUDE.md forbids.
   */
  write(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void>;
}
