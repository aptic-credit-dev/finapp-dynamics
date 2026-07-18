import type { Tx } from '@finapp/kernel';
import { AuthRepository } from './repository.ts';
import {
  LOCKOUT_MAX_FAILURES,
  LOCKOUT_WINDOW_MS,
  SOURCE_THROTTLE_MAX_FAILURES,
  SOURCE_THROTTLE_WINDOW_MS,
  type AuthFailureCategory,
} from './domain/policy.ts';

/**
 * Authentication-attempt recording and throttling (Part D). All state is DURABLE — the `login_attempts`
 * table — so lockout and credential-stuffing defence hold across horizontally-scaled instances, not just
 * within one process's memory. The supplied password is never recorded (the identifier only as a hash).
 *
 * These run INSIDE the login transaction (they take `tx`), so an attempt is recorded atomically with the
 * outcome it describes.
 */
export class AttemptService {
  private readonly repo: AuthRepository;
  constructor(repo: AuthRepository = new AuthRepository()) {
    this.repo = repo;
  }

  async record(
    tx: Tx,
    input: {
      loginRefHash: string;
      accountId: string | null;
      outcome: 'succeeded' | 'failed';
      failureReason: AuthFailureCategory | null;
      clientIp: string | null;
      userAgent: string | null;
      correlationId: string;
    },
  ): Promise<void> {
    await this.repo.insertAttempt(tx, {
      loginRefHash: input.loginRefHash,
      accountId: input.accountId,
      outcome: input.outcome,
      failureReason: input.failureReason,
      clientIp: input.clientIp,
      userAgent: input.userAgent,
      correlationId: input.correlationId,
    });
  }

  /** True when this identifier has accumulated too many recent failures — a temporary account lockout. */
  async isLockedOut(tx: Tx, loginRefHash: string, now: Date): Promise<boolean> {
    const since = new Date(now.getTime() - LOCKOUT_WINDOW_MS);
    const failures = await this.repo.countRecentFailures(tx, { loginRefHash, since });
    return failures >= LOCKOUT_MAX_FAILURES;
  }

  /** True when this source IP is generating too many failures — credential-stuffing throttle. */
  async isThrottled(tx: Tx, clientIp: string | null, now: Date): Promise<boolean> {
    if (clientIp === null) return false;
    const since = new Date(now.getTime() - SOURCE_THROTTLE_WINDOW_MS);
    const failures = await this.repo.countRecentFailures(tx, { clientIp, since });
    return failures >= SOURCE_THROTTLE_MAX_FAILURES;
  }
}
