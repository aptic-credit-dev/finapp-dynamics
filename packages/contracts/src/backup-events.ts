import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The backup event family — owned by m40-resilience (Stage 6G). One family: `backup.lifecycle`. Registered in
 * manifests/event-registry.yaml alongside this declaration. Delivered through the SINGLE transactional outbox that m06 owns
 * (ADR-004) — m40 owns no outbox. These are BACKUP-RUN evidence transitions ONLY (a backup completed / blocked) — NOT raw
 * backup data. Payloads carry a policy/run reference, a result, a bounded size and REASON CODES ONLY — never a secret, a
 * credential, raw backup data or personal data (ADR-127).
 */
export const BACKUP_LIFECYCLE_FAMILY = 'backup.lifecycle';
export const BACKUP_LIFECYCLE_VERSION = 1;
export type BackupLifecycleEventType = 'BackupCompleted' | 'BackupBlocked';
export const BACKUP_LIFECYCLE_EVENT_TYPES: readonly BackupLifecycleEventType[] = [
  'BackupCompleted',
  'BackupBlocked',
];

/**
 * A backup-run evidence transition. Policy/run refs, a result, a bounded size (as text) + checksum ref and reason codes ONLY —
 * never a secret, a credential or raw backup data.
 */
export interface BackupLifecyclePayload {
  readonly backupRunId: string;
  readonly policyId?: string;
  readonly result?: string;
  readonly sizeBytes?: string;
  readonly reasonCode?: string;
}

export type BackupLifecycleEvent = DomainEventEnvelope<
  typeof BACKUP_LIFECYCLE_FAMILY,
  BackupLifecycleEventType,
  BackupLifecyclePayload
>;
