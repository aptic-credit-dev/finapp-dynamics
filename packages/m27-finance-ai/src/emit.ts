/**
 * The single place M27 writes AUDIT — through the kernel AUDIT port, taking the caller's `tx` so the audit entry and the
 * state change commit atomically. M27 publishes NO domain events and owns NO outbox (naming-map: `event_families: []`):
 * the AI request/output lifecycle is emitted by M24 through the ONE m06 outbox; M27's finance-AI decisions are AUDITED
 * (shared `AI_` prefix, AI_FINANCE_*). Audit payloads carry safe ids, subject type, status, suggestion type, reason
 * codes, confidence (integer basis points), timestamps and opaque evidence references ONLY — never bank-statement text,
 * raw ledger content, prompt/output, document content, secrets or credentials.
 */
import type { Audit, AuditEntry, RequestContext, SystemContext, Tx } from '@finapp/kernel';

export class M27Emitter {
  private readonly audit: Audit;
  constructor(audit: Audit) {
    this.audit = audit;
  }
  async recordAudit(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.audit.write(tx, ctx, entry);
  }
}
