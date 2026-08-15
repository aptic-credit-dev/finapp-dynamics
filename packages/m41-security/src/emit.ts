/**
 * The single place M41 writes AUDIT and publishes EVENTS — through the kernel AUDIT and OUTBOX ports, both taking the caller's
 * `tx` so audit + event + state change commit atomically (ADR-005/023). M41 OWNS the seven `security.*` families (contracts) but
 * owns NO outbox: it publishes onto the ONE outbox m06 owns. Payloads carry safe ids, states, classifications, an approved
 * algorithm id and reason codes ONLY — NEVER a secret value, ciphertext, a token, a credential or raw restricted content.
 */
import { randomUUID } from 'node:crypto';
import type { Audit, AuditEntry, Outbox, RequestContext, SystemContext, Tx } from '@finapp/kernel';
import type { DomainEvent, SecurityLifecyclePayload } from '@finapp/contracts';
import {
  SECURITY_IDENTITY_LIFECYCLE_FAMILY,
  SECURITY_IDENTITY_LIFECYCLE_VERSION,
  SECURITY_PRIVILEGED_LIFECYCLE_FAMILY,
  SECURITY_PRIVILEGED_LIFECYCLE_VERSION,
  SECURITY_DLP_LIFECYCLE_FAMILY,
  SECURITY_DLP_LIFECYCLE_VERSION,
  SECURITY_CRYPTO_LIFECYCLE_FAMILY,
  SECURITY_CRYPTO_LIFECYCLE_VERSION,
  SECURITY_GRC_LIFECYCLE_FAMILY,
  SECURITY_GRC_LIFECYCLE_VERSION,
  SECURITY_PRIVACY_LIFECYCLE_FAMILY,
  SECURITY_PRIVACY_LIFECYCLE_VERSION,
  SECURITY_SOC_LIFECYCLE_FAMILY,
  SECURITY_SOC_LIFECYCLE_VERSION,
} from '@finapp/contracts';

interface PublishInput {
  tenantId: string;
  correlationId: string;
  actor?: string | undefined;
  payload: SecurityLifecyclePayload;
}

export class M41Emitter {
  private readonly audit: Audit;
  private readonly outbox: Outbox<DomainEvent>;
  constructor(audit: Audit, outbox: Outbox<DomainEvent>) {
    this.audit = audit;
    this.outbox = outbox;
  }

  async recordAudit(tx: Tx, ctx: RequestContext | SystemContext, entry: AuditEntry): Promise<void> {
    await this.audit.write(tx, ctx, entry);
  }

  publishIdentity(tx: Tx, type: string, input: PublishInput): Promise<void> {
    return this.publish(
      tx,
      SECURITY_IDENTITY_LIFECYCLE_FAMILY,
      SECURITY_IDENTITY_LIFECYCLE_VERSION,
      type,
      input,
    );
  }
  publishPrivileged(tx: Tx, type: string, input: PublishInput): Promise<void> {
    return this.publish(
      tx,
      SECURITY_PRIVILEGED_LIFECYCLE_FAMILY,
      SECURITY_PRIVILEGED_LIFECYCLE_VERSION,
      type,
      input,
    );
  }
  publishDlp(tx: Tx, type: string, input: PublishInput): Promise<void> {
    return this.publish(tx, SECURITY_DLP_LIFECYCLE_FAMILY, SECURITY_DLP_LIFECYCLE_VERSION, type, input);
  }
  publishCrypto(tx: Tx, type: string, input: PublishInput): Promise<void> {
    return this.publish(tx, SECURITY_CRYPTO_LIFECYCLE_FAMILY, SECURITY_CRYPTO_LIFECYCLE_VERSION, type, input);
  }
  publishGrc(tx: Tx, type: string, input: PublishInput): Promise<void> {
    return this.publish(tx, SECURITY_GRC_LIFECYCLE_FAMILY, SECURITY_GRC_LIFECYCLE_VERSION, type, input);
  }
  publishPrivacy(tx: Tx, type: string, input: PublishInput): Promise<void> {
    return this.publish(
      tx,
      SECURITY_PRIVACY_LIFECYCLE_FAMILY,
      SECURITY_PRIVACY_LIFECYCLE_VERSION,
      type,
      input,
    );
  }
  publishSoc(tx: Tx, type: string, input: PublishInput): Promise<void> {
    return this.publish(tx, SECURITY_SOC_LIFECYCLE_FAMILY, SECURITY_SOC_LIFECYCLE_VERSION, type, input);
  }

  private async publish(
    tx: Tx,
    family: string,
    version: number,
    type: string,
    input: PublishInput,
  ): Promise<void> {
    const event = {
      eventId: randomUUID(),
      family,
      type,
      version,
      occurredAt: new Date(),
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
      classification: 'internal' as const,
      payload: input.payload,
    } as unknown as DomainEvent;
    await this.outbox.publish(tx, event);
  }
}
