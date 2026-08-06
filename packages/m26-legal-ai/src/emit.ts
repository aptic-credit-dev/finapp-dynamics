/**
 * The single place M26 writes AUDIT — through the kernel AUDIT port, taking the caller's `tx` so the audit entry and the
 * state change commit atomically. M26 publishes NO domain events and owns NO outbox (naming-map: `event_families: []`):
 * the AI request/output lifecycle is emitted by M24 through the ONE m06 outbox; M26's legal-AI decisions are AUDITED
 * (shared `AI_` prefix, AI_LEGAL_*). Audit payloads carry safe ids, subject type, status, classification, confidence
 * (integer basis points), reason codes, timestamps and opaque evidence references ONLY — never legal text, privileged
 * narrative, raw prompt/output, document content, contacts, secrets or credentials.
 */
import type { Audit, AuditEntry, RequestContext, SystemContext, Tx } from '@finapp/kernel';

export class M26Emitter {
  private readonly audit: Audit;
  constructor(audit: Audit) {
    this.audit = audit;
  }
  async recordAudit(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.audit.write(tx, ctx, entry);
  }
}
