/**
 * The single place M28 writes AUDIT — through the kernel AUDIT port, taking the caller's `tx` so the audit entry and the
 * state change commit atomically. M28 publishes NO domain events and owns NO outbox (naming-map: `event_families: []`):
 * the AI request/output lifecycle is emitted by M24 through the ONE m06 outbox; M28's copilot actions are AUDITED
 * (shared `AI_` prefix, AI_COPILOT_*). Audit payloads carry safe ids, status, intent class, reason codes, confidence
 * (integer basis points), source COUNTS and timestamps ONLY — never the full question, the full answer, restricted
 * finance/legal/customer content, document content, a privileged narrative, secrets or credentials.
 */
import type { Audit, AuditEntry, RequestContext, SystemContext, Tx } from '@finapp/kernel';

export class M28Emitter {
  private readonly audit: Audit;
  constructor(audit: Audit) {
    this.audit = audit;
  }
  async recordAudit(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.audit.write(tx, ctx, entry);
  }
}
