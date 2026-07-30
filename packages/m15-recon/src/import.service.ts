/**
 * ImportService — ingests bank STATEMENT lines and book/LEDGER entries into a run-ready, normalized shape. Every
 * mutating method enforces its permission (default deny), runs inside `db.withTenant`, and records audit + a
 * `reconciliation.lifecycle` event in the SAME transaction. Imports are DUPLICATE-PROTECTED: a second import with the
 * same (bank_account, file_hash) is rejected as a clean conflict (the DB unique index is the hard guard). Each raw
 * line is validated + normalized; a bad line does not poison the batch — it is recorded append-only in
 * recon_import_error and skipped, and the import is finalized with the count of accepted lines. MONEY IS INTEGER
 * MINOR UNITS (bigint) — a non-integer / unsafe amount is rejected as an import error, never coerced through a float
 * (ADR-007). m15 owns only `recon_*`; document_ref is an OPAQUE m09 id.
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import type { ReconciliationLifecycleEventType, ReconciliationLifecyclePayload } from '@finapp/contracts';
import { M15_PERMISSIONS } from './permissions.ts';
import { M15_AUDIT_CODES } from './audit-codes.ts';
import { isSourceFormat, isDirection, RECON_LIMITS } from './domain/limits.ts';
import {
  ReconRepository,
  type StatementImportRow,
  type StatementLineRow,
  type LedgerImportRow,
  type LedgerEntryRow,
  type ImportErrorRow,
} from './repository.ts';
import type { M15Emitter } from './emit.ts';
import { badRequest } from './errors.ts';

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export interface RawStatementLine {
  readonly lineNo?: number;
  readonly txnDate: string;
  readonly valueDate?: string | null;
  readonly amountMinor: number;
  readonly direction: string;
  readonly reference?: string | null;
  readonly description?: string | null;
  readonly counterpartyRef?: string | null;
}
export interface RawLedgerEntry {
  readonly entryNo?: number | null;
  readonly entryDate: string;
  readonly amountMinor: number;
  readonly direction: string;
  readonly reference?: string | null;
  readonly description?: string | null;
  readonly sourceRef?: string | null;
}
export interface StatementImportResult {
  readonly import: StatementImportRow;
  readonly accepted: number;
  readonly errors: number;
}
export interface LedgerImportResult {
  readonly import: LedgerImportRow;
  readonly accepted: number;
  readonly errors: number;
}

/** A validated raw money field — INTEGER MINOR UNITS only; never a float. */
function isMinor(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

export class ImportService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M15Emitter;
  private readonly repo: ReconRepository;
  constructor(db: Db, authz: Authz, emitter: M15Emitter, repo: ReconRepository = new ReconRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  private async publish(
    tx: Tx,
    ctx: RequestContext,
    actor: string | null,
    type: ReconciliationLifecycleEventType,
    payload: ReconciliationLifecyclePayload,
  ): Promise<void> {
    await this.emitter.publish(tx, {
      type,
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      ...(actor !== null ? { actor } : {}),
      payload,
    });
  }
  /** Validate one raw line's shared fields; returns an error code (append to recon_import_error) or null. */
  private validateLine(date: string, amountMinor: number, direction: string): string | null {
    if (!isoDate.test(date)) return 'INVALID_DATE';
    if (!isMinor(amountMinor)) return 'INVALID_AMOUNT';
    if (!isDirection(direction)) return 'INVALID_DIRECTION';
    return null;
  }

  // --- statement import -------------------------------------------------------------------------
  async importStatement(
    ctx: RequestContext,
    actor: string | null,
    input: {
      bankAccountId: string;
      sourceFormat: string;
      fileHash: string;
      fileName?: string | null;
      documentRef?: string | null;
      periodStart?: string | null;
      periodEnd?: string | null;
      idempotencyKey?: string | null;
      lines: readonly RawStatementLine[];
    },
  ): Promise<StatementImportResult> {
    await this.authz.require(ctx, M15_PERMISSIONS.statementImport);
    if (!isSourceFormat(input.sourceFormat))
      throw badRequest('invalid statement source format', ctx.correlationId);
    if (input.fileHash.trim() === '') throw badRequest('a file hash is required', ctx.correlationId);
    if (input.lines.length > RECON_LIMITS.maxImportLines)
      throw badRequest('import exceeds the maximum line count', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const acct = await this.repo.findBankAccount(tx, input.bankAccountId);
      if (acct === null) throw ProblemError.notFound('Bank account not found.', ctx.correlationId);
      // Idempotent replay short-circuits to the existing import; a genuine re-file of the same content conflicts.
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const byKey = await this.repo.findStatementImportByIdempotencyKey(tx, input.idempotencyKey);
        if (byKey !== null)
          return { import: byKey, accepted: byKey.line_count, errors: 0 } satisfies StatementImportResult;
      }
      // DUPLICATE PROTECTION — a second import of the same file for the account is a clean conflict.
      const dup = await this.repo.findStatementImportByFileHash(tx, input.bankAccountId, input.fileHash);
      if (dup !== null) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M15_AUDIT_CODES.statementImportRejected,
          entityType: 'recon_statement_import',
          entityId: dup.id,
          detail: { reasonCode: 'duplicate_file_hash' },
        });
        await this.publish(tx, ctx, actor, 'StatementImportRejected', {
          recordId: dup.id,
          recordType: 'statement_import',
          bankAccountRef: input.bankAccountId,
          reasonCode: 'duplicate_file_hash',
        });
        throw ProblemError.conflict(
          'This statement file has already been imported for this bank account.',
          ctx.correlationId,
        );
      }
      const imp = await this.repo.insertStatementImport(tx, {
        tenantId: ctx.tenantId,
        bankAccountId: input.bankAccountId,
        sourceFormat: input.sourceFormat,
        fileHash: input.fileHash,
        fileName: input.fileName ?? null,
        documentRef: input.documentRef ?? null,
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      let accepted = 0;
      let errors = 0;
      let lineNo = 0;
      for (const raw of input.lines) {
        lineNo += 1;
        const at = raw.lineNo ?? lineNo;
        const err = this.validateLine(raw.txnDate, raw.amountMinor, raw.direction);
        if (err !== null) {
          errors += 1;
          await this.repo.insertImportError(tx, {
            tenantId: ctx.tenantId,
            importId: imp.id,
            importKind: 'statement',
            lineNo: at,
            errorCode: err,
            detail: null,
            correlationId: ctx.correlationId,
          });
          continue;
        }
        await this.repo.insertStatementLine(tx, {
          tenantId: ctx.tenantId,
          importId: imp.id,
          bankAccountId: input.bankAccountId,
          lineNo: at,
          txnDate: raw.txnDate,
          valueDate: raw.valueDate ?? null,
          amountMinor: raw.amountMinor,
          direction: raw.direction,
          reference: raw.reference ?? null,
          description: raw.description ?? null,
          counterpartyRef: raw.counterpartyRef ?? null,
          correlationId: ctx.correlationId,
          by: actor,
        });
        accepted += 1;
      }
      const finalized = await this.repo.finalizeStatementImport(tx, {
        id: imp.id,
        expectedVersion: imp.version,
        status: 'imported',
        lineCount: accepted,
        by: actor,
      });
      if (finalized === null)
        throw ProblemError.conflict('Statement import modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M15_AUDIT_CODES.statementImported,
        entityType: 'recon_statement_import',
        entityId: imp.id,
        detail: { sourceFormat: input.sourceFormat, accepted, errors },
      });
      await this.publish(tx, ctx, actor, 'StatementImported', {
        recordId: imp.id,
        recordType: 'statement_import',
        bankAccountRef: input.bankAccountId,
        lineCount: accepted,
        toStatus: finalized.status,
      });
      return { import: finalized, accepted, errors } satisfies StatementImportResult;
    });
  }

  // --- ledger import ----------------------------------------------------------------------------
  async importLedger(
    ctx: RequestContext,
    actor: string | null,
    input: {
      bankAccountId: string;
      sourceFormat?: string;
      fileHash?: string | null;
      documentRef?: string | null;
      idempotencyKey?: string | null;
      entries: readonly RawLedgerEntry[];
    },
  ): Promise<LedgerImportResult> {
    await this.authz.require(ctx, M15_PERMISSIONS.ledgerImport);
    const sourceFormat = input.sourceFormat ?? 'api';
    if (!isSourceFormat(sourceFormat) || sourceFormat === 'pdf')
      throw badRequest('invalid ledger source format', ctx.correlationId);
    if (input.entries.length > RECON_LIMITS.maxImportLines)
      throw badRequest('import exceeds the maximum entry count', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const acct = await this.repo.findBankAccount(tx, input.bankAccountId);
      if (acct === null) throw ProblemError.notFound('Bank account not found.', ctx.correlationId);
      // DUPLICATE PROTECTION — only when a file hash is supplied (API feeds may have none).
      if (input.fileHash != null && input.fileHash !== '') {
        const dup = await this.repo.findLedgerImportByFileHash(tx, input.bankAccountId, input.fileHash);
        if (dup !== null)
          throw ProblemError.conflict(
            'This ledger file has already been imported for this bank account.',
            ctx.correlationId,
          );
      }
      const imp = await this.repo.insertLedgerImport(tx, {
        tenantId: ctx.tenantId,
        bankAccountId: input.bankAccountId,
        sourceFormat,
        fileHash: input.fileHash ?? null,
        documentRef: input.documentRef ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      let accepted = 0;
      let errors = 0;
      let entryNo = 0;
      for (const raw of input.entries) {
        entryNo += 1;
        const at = raw.entryNo ?? entryNo;
        const err = this.validateLine(raw.entryDate, raw.amountMinor, raw.direction);
        if (err !== null) {
          errors += 1;
          await this.repo.insertImportError(tx, {
            tenantId: ctx.tenantId,
            importId: imp.id,
            importKind: 'ledger',
            lineNo: at,
            errorCode: err,
            detail: null,
            correlationId: ctx.correlationId,
          });
          continue;
        }
        await this.repo.insertLedgerEntry(tx, {
          tenantId: ctx.tenantId,
          ledgerImportId: imp.id,
          bankAccountId: input.bankAccountId,
          entryNo: at,
          entryDate: raw.entryDate,
          amountMinor: raw.amountMinor,
          direction: raw.direction,
          reference: raw.reference ?? null,
          description: raw.description ?? null,
          sourceRef: raw.sourceRef ?? null,
          correlationId: ctx.correlationId,
          by: actor,
        });
        accepted += 1;
      }
      const finalized = await this.repo.finalizeLedgerImport(tx, {
        id: imp.id,
        expectedVersion: imp.version,
        status: 'imported',
        entryCount: accepted,
        by: actor,
      });
      if (finalized === null)
        throw ProblemError.conflict('Ledger import modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M15_AUDIT_CODES.ledgerImported,
        entityType: 'recon_ledger_import',
        entityId: imp.id,
        detail: { sourceFormat, accepted, errors },
      });
      await this.publish(tx, ctx, actor, 'LedgerImported', {
        recordId: imp.id,
        recordType: 'ledger_import',
        bankAccountRef: input.bankAccountId,
        lineCount: accepted,
        toStatus: finalized.status,
      });
      return { import: finalized, accepted, errors } satisfies LedgerImportResult;
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async listStatementImports(ctx: RequestContext, bankAccountId: string): Promise<StatementImportRow[]> {
    await this.authz.require(ctx, M15_PERMISSIONS.statementRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listStatementImports(tx, bankAccountId));
  }
  async listStatementLines(ctx: RequestContext, importId: string): Promise<StatementLineRow[]> {
    await this.authz.require(ctx, M15_PERMISSIONS.statementRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listStatementLinesByImport(tx, importId));
  }
  async listLedgerImports(ctx: RequestContext, bankAccountId: string): Promise<LedgerImportRow[]> {
    await this.authz.require(ctx, M15_PERMISSIONS.ledgerRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listLedgerImports(tx, bankAccountId));
  }
  async listLedgerEntries(ctx: RequestContext, ledgerImportId: string): Promise<LedgerEntryRow[]> {
    await this.authz.require(ctx, M15_PERMISSIONS.ledgerRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listLedgerEntriesByImport(tx, ledgerImportId));
  }
  async listImportErrors(
    ctx: RequestContext,
    importId: string,
    kind: 'statement' | 'ledger',
  ): Promise<ImportErrorRow[]> {
    await this.authz.require(
      ctx,
      kind === 'statement' ? M15_PERMISSIONS.statementRead : M15_PERMISSIONS.ledgerRead,
    );
    return this.db.withTenant(ctx, (tx) => this.repo.listImportErrors(tx, importId));
  }
}
