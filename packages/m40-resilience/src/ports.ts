/**
 * M40 ports — one fail-closed seam, deterministic offline doubles for tests (no shell, no network, no provider):
 *
 *  `BackupExecutorPort` — how m40 would EXECUTE a backup / restore / failover against real infrastructure. m40 owns NO executor:
 *  execution is FRAMEWORK-ONLY. The DEFAULT `UnavailableBackupExecutor` FAILS CLOSED — every request yields a durable BLOCKED
 *  outcome (no shell / no `pg_dump` / no restore command / no OS command / no filesystem / no network). A real executor
 *  (invoked only through an approved port, behind maker-checker for restore/failover) drops in later. m40 never runs arbitrary
 *  code and opens no infrastructure connection here.
 */
import type { RequestContext } from '@finapp/kernel';

export interface ExecutionOutcome {
  readonly executed: boolean;
  readonly reasonCode: string;
  /** An opaque evidence/size reference the executor returns; never raw data, never a secret. */
  readonly evidenceRef?: string;
  readonly sizeBytes?: number;
}

/** The seam m40 uses to run a backup / restore / failover. Fail closed. */
export interface BackupExecutorPort {
  runBackup(ctx: RequestContext, input: { policyRef: string; targetRef: string }): Promise<ExecutionOutcome>;
  runRestore(
    ctx: RequestContext,
    input: { requestRef: string; kind: string; targetRef: string; backupRef?: string | null },
  ): Promise<ExecutionOutcome>;
}

/** FAIL-CLOSED default — no executor is wired: every backup/restore/failover is durably BLOCKED (never guessed as run). */
export class UnavailableBackupExecutor implements BackupExecutorPort {
  runBackup(): Promise<ExecutionOutcome> {
    return Promise.resolve({ executed: false, reasonCode: 'executor_unavailable' });
  }
  runRestore(): Promise<ExecutionOutcome> {
    return Promise.resolve({ executed: false, reasonCode: 'executor_unavailable' });
  }
}

/** A DETERMINISTIC offline double for tests ONLY — never real infrastructure; returns a bounded evidence ref. */
export class FixtureBackupExecutor implements BackupExecutorPort {
  runBackup(): Promise<ExecutionOutcome> {
    return Promise.resolve({
      executed: true,
      reasonCode: 'executed_fixture',
      evidenceRef: 'evidence:fixture',
      sizeBytes: 1024,
    });
  }
  runRestore(): Promise<ExecutionOutcome> {
    return Promise.resolve({
      executed: true,
      reasonCode: 'executed_fixture',
      evidenceRef: 'evidence:fixture',
    });
  }
}
