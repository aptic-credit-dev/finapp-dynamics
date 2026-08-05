/**
 * The single place M25 writes AUDIT — through the kernel AUDIT port, taking the caller's `tx` so the audit entry and the
 * state change commit atomically. M25 publishes NO domain events and owns NO outbox (naming-map: `event_families: []`):
 * the AI request/output lifecycle is emitted by M24 through the ONE m06 outbox; M25's operational decisions are AUDITED
 * (shared `AI_` prefix). Audit payloads carry ids, states, reason codes, confidence (integer basis points) and opaque
 * subject/request/output references ONLY — never feedback/case narrative, customer contact, prompt/output content or
 * secrets.
 */
import type { Audit, AuditEntry, RequestContext, SystemContext, Tx } from '@finapp/kernel';

export class M25Emitter {
  private readonly audit: Audit;
  constructor(audit: Audit) {
    this.audit = audit;
  }
  async recordAudit(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.audit.write(tx, ctx, entry);
  }
}
