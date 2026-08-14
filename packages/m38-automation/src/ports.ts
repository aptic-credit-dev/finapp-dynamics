/**
 * M38 ports — the two fail-closed seams that keep m38 an ORCHESTRATOR (not a second engine), plus the m30 secret seam. All
 * deterministic offline doubles for tests (no network, no provider):
 *  (1) `CapabilityInvokerPort` — how m38 EXECUTES an automation step: it invokes a REGISTERED capability through the OWNING
 *      module's public contract (m06 workflow command, m08 notification, m33 connector capability, m36 event op, ...). The
 *      owning module enforces its own authorization/governance; m38 orchestrates only. It is FRAMEWORK ONLY:
 *      `UnavailableCapabilityInvoker` (the DEFAULT) yields a durable BLOCKED outcome (no arbitrary code, no eval/shell, no
 *      network); a `FixtureCapabilityInvoker` is a deterministic offline double for tests. A real invoker (dispatched through
 *      registered capabilities) drops in behind the port — never here.
 *  (2) `TimerSchedulerPort` — how m38 COMPOSES m06's durable one-shot timer per schedule occurrence. m06 owns THE timer
 *      runtime; m38 computes `next_run_at` (governed recurrence) and delegates the wake-up. The DEFAULT `EmptyTimerScheduler`
 *      schedules nothing (fail closed — m38 invents no wake-ups; the real m06 scheduler drives occurrences).
 *  (3) the SECRET-RESOLVER seam is reused from m30 (opaque `secretref:` -> availability metadata only, never a value; real
 *      backend = m41-security), re-exported for convenience.
 */
import type { RequestContext } from '@finapp/kernel';
import {
  DeterministicSecretResolver,
  UnavailableSecretResolver,
  type SecretResolver,
} from '@finapp/m30-platform';

export { DeterministicSecretResolver, UnavailableSecretResolver };
export type { SecretResolver };

/** The outcome of invoking one registered capability step. Never carries a full downstream payload or a secret. */
export interface InvocationOutcome {
  readonly ok: boolean;
  readonly reasonCode: string;
  readonly downstreamRef?: string;
}

/** The seam m38 uses to EXECUTE a registered capability through its owning module's contract. Framework-only; fail closed. */
export interface CapabilityInvokerPort {
  invoke(
    ctx: RequestContext,
    input: { capabilityRef: string; requiredPermission: string; inputRef?: string | null },
  ): Promise<InvocationOutcome>;
}

/** FAIL-CLOSED default — no arbitrary code, no network: every invocation is durably BLOCKED (never guessed as executed). */
export class UnavailableCapabilityInvoker implements CapabilityInvokerPort {
  invoke(): Promise<InvocationOutcome> {
    return Promise.resolve({ ok: false, reasonCode: 'capability_unavailable' });
  }
}

/** A DETERMINISTIC offline double: a capability in the known set succeeds; nothing else does. NO real execution. Tests only. */
export class FixtureCapabilityInvoker implements CapabilityInvokerPort {
  private readonly known: ReadonlySet<string>;
  constructor(known: Iterable<string> = []) {
    this.known = new Set(known);
  }
  invoke(
    _ctx: RequestContext,
    input: { capabilityRef: string; requiredPermission: string; inputRef?: string | null },
  ): Promise<InvocationOutcome> {
    return Promise.resolve(
      this.known.has(input.capabilityRef)
        ? { ok: true, reasonCode: 'capability_invoked', downstreamRef: `ran:${input.capabilityRef}` }
        : { ok: false, reasonCode: 'capability_unavailable' },
    );
  }
}

/** The seam m38 uses to COMPOSE m06's durable one-shot timer for a schedule occurrence. m38 owns no timer engine. */
export interface TimerSchedulerPort {
  scheduleOccurrence(
    ctx: RequestContext,
    input: { scheduleId: string; fireAtEpochSeconds: number; dedupeKey: string },
  ): Promise<{ scheduled: boolean; reasonCode: string }>;
}

/** DEFAULT — schedules nothing (fail closed): m38 invents no wake-ups; the real m06 scheduler drives occurrences by contract. */
export class EmptyTimerScheduler implements TimerSchedulerPort {
  scheduleOccurrence(): Promise<{ scheduled: boolean; reasonCode: string }> {
    return Promise.resolve({ scheduled: false, reasonCode: 'timer_scheduler_unavailable' });
  }
}

/** A DETERMINISTIC offline double for tests: records the scheduled occurrence in-memory. NO real timer. */
export class FixtureTimerScheduler implements TimerSchedulerPort {
  scheduleOccurrence(): Promise<{ scheduled: boolean; reasonCode: string }> {
    return Promise.resolve({ scheduled: true, reasonCode: 'timer_scheduled' });
  }
}
