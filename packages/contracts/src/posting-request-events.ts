import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The `posting_request.lifecycle` event family — owned by m21-journal (Stage 3), REGISTERED but posting is
 * DEFERRED (draft-first MVP; naming-map.yaml). A posting request is m21's prepared, approval-gated intent to
 * hand an approved draft journal to downstream integration (m23/m33) for posting to a core banking/accounting
 * system. In the MVP m21 only PREPARES and records posting requests + posting-result evidence — it NEVER pushes
 * to an external system, NEVER approves (m22 owns maker-checker + SoD), and NEVER auto-posts. A posting request
 * cannot advance past `prepared` without an opaque m22 approval reference (no posting without approval), never
 * targets a closed/locked period (no posting into a closed period), is idempotency-keyed (no duplicate posting),
 * and its approver must not be its requester (maker != checker). Delivered through the SINGLE m06 outbox
 * (ADR-004/023). Classification `confidential`. Money is INTEGER MINOR UNITS (never float; ADR-007), carried as
 * STRINGS. Payloads carry identifiers, states, totals, reason codes and dates ONLY — never account numbers,
 * external credentials, raw responses or secrets.
 */

export const POSTING_REQUEST_LIFECYCLE_FAMILY = 'posting_request.lifecycle';
export const POSTING_REQUEST_LIFECYCLE_VERSION = 1;

export type PostingRequestLifecycleEventType =
  | 'PostingRequestCreated'
  | 'PostingRequestAuthorized'
  | 'PostingRequestCancelled'
  | 'PostingResultRecorded'
  | 'PostingSucceeded'
  | 'PostingFailed';

export const POSTING_REQUEST_LIFECYCLE_EVENT_TYPES: readonly PostingRequestLifecycleEventType[] = [
  'PostingRequestCreated',
  'PostingRequestAuthorized',
  'PostingRequestCancelled',
  'PostingResultRecorded',
  'PostingSucceeded',
  'PostingFailed',
];

/**
 * A posting-request lifecycle transition. Ids, states, totals (INTEGER MINOR UNITS as strings), reason codes and
 * dates ONLY — never account numbers, external credentials, raw integration responses or secrets. `isDraft`
 * is always true in the MVP — posting is deferred; m21 never posts or approves.
 */
export interface PostingRequestLifecyclePayload {
  readonly recordId: string;
  readonly recordType?: string;
  readonly draftId?: string;
  readonly postingRequestId?: string;
  readonly approvalRef?: string;
  readonly externalRef?: string;
  readonly amountMinor?: string;
  readonly periodStatus?: string;
  readonly reasonCode?: string;
  readonly isDraft?: boolean;
  readonly fromStatus?: string;
  readonly toStatus?: string;
}

export type PostingRequestLifecycleEvent = DomainEventEnvelope<
  typeof POSTING_REQUEST_LIFECYCLE_FAMILY,
  PostingRequestLifecycleEventType,
  PostingRequestLifecyclePayload
>;
