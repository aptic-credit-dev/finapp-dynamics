import type { DomainEventEnvelope } from './envelope.ts';

/**
 * The `identity.authentication` event family — owned by m02-auth (Stage 1C).
 *
 * Registered in manifests/event-registry.yaml alongside this declaration and the module that emits it
 * (GAP-1 discipline: never a family ahead of its module). Delivered through the SINGLE outbox port (m06
 * stand-in until then) — there is no second event path.
 *
 * CLASSIFICATION IS `confidential`. These events concern natural persons AND are a security signal, so
 * payloads carry **identifiers and transitions ONLY** — never a password, a hash, a session secret, a
 * token hash, a raw login identifier, an email, or a name. A client IP is included only where policy
 * permits and is treated as `restricted`; it is deliberately NOT part of the v1 payloads below.
 *
 * `tenantId` on the envelope is `PLATFORM_TENANT` for account-plane auth events — authentication is a
 * global account-plane act, not a tenant's business, exactly as identity-plane events are (see
 * identity-events.ts). A tenant learns about its people through membership, not through auth telemetry.
 */

export const AUTH_LIFECYCLE_FAMILY = 'identity.authentication';
export const AUTH_LIFECYCLE_VERSION = 1;

export type AuthLifecycleEventType =
  | 'AuthenticationSucceeded'
  | 'AuthenticationFailed'
  | 'SessionIssued'
  | 'SessionRefreshed'
  | 'SessionRevoked'
  | 'SessionExpired'
  | 'CredentialCreated'
  | 'CredentialChanged'
  | 'CredentialDisabled'
  | 'AccountLockoutInitiated'
  | 'AccountLockoutCleared';

export const AUTH_LIFECYCLE_EVENT_TYPES: readonly AuthLifecycleEventType[] = [
  'AuthenticationSucceeded',
  'AuthenticationFailed',
  'SessionIssued',
  'SessionRefreshed',
  'SessionRevoked',
  'SessionExpired',
  'CredentialCreated',
  'CredentialChanged',
  'CredentialDisabled',
  'AccountLockoutInitiated',
  'AccountLockoutCleared',
];

/** An authentication attempt resolved. `accountId` is present only when the account was identified. */
export interface AuthenticationOutcomePayload {
  readonly accountId?: string;
  /** Generic category — never the supplied credential or a specific "which field" hint. */
  readonly reasonCategory?: string;
  readonly assurance?: 'password' | 'mfa' | 'federated';
}

/** A session transition. Identifiers only — never the token or its hash. */
export interface SessionLifecyclePayload {
  readonly sessionId: string;
  readonly accountId: string;
  readonly rotationFamily: string;
  readonly fromStatus?: string;
  readonly toStatus: string;
  readonly reason?: string;
}

/** A credential transition. Never the hash, the algorithm parameters, or the password. */
export interface CredentialLifecyclePayload {
  readonly credentialId: string;
  readonly accountId: string;
  readonly credentialType: string;
  readonly reason?: string;
}

/** A lockout transition on an account. */
export interface AccountLockoutPayload {
  readonly accountId: string;
  readonly reason?: string;
}

export type AuthLifecyclePayload =
  AuthenticationOutcomePayload | SessionLifecyclePayload | CredentialLifecyclePayload | AccountLockoutPayload;

export type AuthLifecycleEvent = DomainEventEnvelope<
  typeof AUTH_LIFECYCLE_FAMILY,
  AuthLifecycleEventType,
  AuthLifecyclePayload
>;
