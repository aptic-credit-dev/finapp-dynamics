/**
 * ImportService — GL + source-system ingestion. A GL import carries transaction lines (INTEGER MINOR UNITS) and,
 * optionally, an opening/closing balance whose invariant (closing = opening + debits − credits) is verified in the
 * engine AND by the DB CHECK (fail closed). Duplicate imports are blocked by the per-account file hash. Imports move
 * created → validated → accepted or rejected. Every mutation runs inside `db.withTenant` with audit + a
 * glrecon.lifecycle event in the same transaction. Money is INTEGER MINOR UNITS — never float (ADR-007).
 */
import type { Authz, Db, RequestContext, Tx } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import type { GlreconLifecycleEventType, GlreconLifecyclePayload } from '@finapp/contracts';
import { aggregateByDirection, calculatedClosingMinor } from './engine.ts';
import { M20_PERMISSIONS } from './permissions.ts';
import { M20_AUDIT_CODES } from './audit-codes.ts';
import { isSourceFormat } from './domain/limits.ts';
import { badRequest } from './errors.ts';
import {
  GlreconRepository,
  type GlImportRow,
  type GlLineRow,
  type GlSourceImportRow,
  type GlSourceLineRow,
  type GlBalanceRow,
  type GlImportErrorRow,
} from './repository.ts';
import type { M20Emitter } from './emit.ts';

export interface RawGlLine {
  readonly txnDate: string;
  readonly amountMinor: number;
  readonly direction: string;
  readonly reference?: string | null;
  readonly description?: string | null;
  readonly sourceRef?: string | null;
}
export interface RawSourceLine {
  readonly entryDate: string;
  readonly amountMinor: number;
  readonly direction: string;
  readonly reference?: string | null;
  readonly description?: string | null;
  readonly sourceRef?: string | null;
}
export interface GlImportResult {
  readonly import: GlImportRow;
  readonly lineCount: number;
  readonly balance: GlBalanceRow | null;
}
export interface SourceImportResult {
  readonly import: GlSourceImportRow;
  readonly entryCount: number;
}

function assertLineAmount(v: number, what: string, correlationId: string): number {
  if (!Number.isInteger(v))
    throw badRequest(`${what} must be an integer in minor units (no float money).`, correlationId);
  return v;
}

export class ImportService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M20Emitter;
  private readonly repo: GlreconRepository;
  constructor(db: Db, authz: Authz, emitter: M20Emitter, repo: GlreconRepository = new GlreconRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }
  private async publish(
    tx: Tx,
    ctx: RequestContext,
    actor: string | null,
    type: GlreconLifecycleEventType,
    payload: GlreconLifecyclePayload,
  ): Promise<void> {
    await this.emitter.publish(tx, {
      type,
      tenantId: ctx.tenantId,
      correlationId: ctx.correlationId,
      ...(actor !== null ? { actor } : {}),
      payload,
    });
  }

  async importGl(
    ctx: RequestContext,
    actor: string | null,
    input: {
      glAccountId: string;
      sourceFormat: string;
      fileHash: string;
      fileName?: string | null;
      documentRef?: string | null;
      periodStart?: string | null;
      periodEnd?: string | null;
      openingBalanceMinor?: number | null;
      closingBalanceMinor?: number | null;
      currencyRef?: string | null;
      lines: readonly RawGlLine[];
      idempotencyKey?: string | null;
    },
  ): Promise<GlImportResult> {
    await this.authz.require(ctx, M20_PERMISSIONS.importCreate);
    if (!isSourceFormat(input.sourceFormat))
      throw badRequest(`Unknown source format "${input.sourceFormat}".`, ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const acct = await this.repo.findAccount(tx, input.glAccountId);
      if (acct === null) throw ProblemError.notFound('GL account not found.', ctx.correlationId);
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const prior = await this.repo.findImportByIdempotencyKey(tx, input.idempotencyKey);
        if (prior !== null) {
          const lines = await this.repo.listLinesByImport(tx, prior.id);
          const bal = await this.repo.findBalanceForPeriod(
            tx,
            prior.gl_account_id,
            prior.period_start ?? '',
            prior.period_end ?? '',
          );
          return { import: prior, lineCount: lines.length, balance: bal };
        }
      }
      const dup = await this.repo.findImportByFileHash(tx, input.glAccountId, input.fileHash);
      if (dup !== null)
        throw ProblemError.conflict('This file was already imported for this account.', ctx.correlationId);

      const imp = await this.repo.insertImport(tx, {
        tenantId: ctx.tenantId,
        glAccountId: input.glAccountId,
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
      let lineNo = 0;
      const directional: { amountMinor: number; direction: 'debit' | 'credit' }[] = [];
      for (const line of input.lines) {
        lineNo += 1;
        if (line.direction !== 'debit' && line.direction !== 'credit') {
          await this.repo.insertImportError(tx, {
            tenantId: ctx.tenantId,
            importId: imp.id,
            importKind: 'gl',
            lineNo,
            errorCode: 'BAD_DIRECTION',
            detail: `line ${String(lineNo)}: direction must be debit or credit`,
            correlationId: ctx.correlationId,
          });
          continue;
        }
        const amt = assertLineAmount(line.amountMinor, `line ${String(lineNo)} amount`, ctx.correlationId);
        await this.repo.insertLine(tx, {
          tenantId: ctx.tenantId,
          importId: imp.id,
          glAccountId: input.glAccountId,
          lineNo,
          txnDate: line.txnDate,
          amountMinor: amt,
          direction: line.direction,
          reference: line.reference ?? null,
          description: line.description ?? null,
          sourceRef: line.sourceRef ?? null,
          correlationId: ctx.correlationId,
          by: actor,
        });
        directional.push({ amountMinor: amt, direction: line.direction });
      }

      // Optional opening/closing balance snapshot — the invariant is enforced by the engine + the DB CHECK.
      let balance: GlBalanceRow | null = null;
      if (
        input.openingBalanceMinor != null &&
        input.closingBalanceMinor != null &&
        input.periodStart != null &&
        input.periodEnd != null
      ) {
        const { debitsMinor, creditsMinor } = aggregateByDirection(directional);
        const calc = calculatedClosingMinor(input.openingBalanceMinor, debitsMinor, creditsMinor);
        if (calc !== input.closingBalanceMinor) {
          await this.repo.insertImportError(tx, {
            tenantId: ctx.tenantId,
            importId: imp.id,
            importKind: 'gl',
            lineNo: null,
            errorCode: 'BALANCE_INVARIANT',
            detail: 'closing != opening + debits - credits',
            correlationId: ctx.correlationId,
          });
          throw badRequest(
            'GL balance invariant failed: closing must equal opening + debits - credits.',
            ctx.correlationId,
          );
        }
        balance = await this.repo.insertBalance(tx, {
          tenantId: ctx.tenantId,
          glAccountId: input.glAccountId,
          importId: imp.id,
          currencyRef: input.currencyRef ?? null,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          openingBalanceMinor: input.openingBalanceMinor,
          debitsMinor,
          creditsMinor,
          closingBalanceMinor: input.closingBalanceMinor,
          correlationId: ctx.correlationId,
          by: actor,
        });
      }

      const finalized = await this.repo.setImportStatus(tx, {
        id: imp.id,
        expectedVersion: imp.version,
        status: 'validated',
        lineCount: lineNo,
        by: actor,
      });
      if (finalized === null) throw ProblemError.conflict('Import modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.importCreated,
        entityType: 'gl_import',
        entityId: imp.id,
        detail: { lineCount: lineNo },
      });
      await this.publish(tx, ctx, actor, 'ImportCreated', {
        recordId: imp.id,
        recordType: 'gl_import',
        glAccountRef: input.glAccountId,
        lineCount: lineNo,
        toStatus: 'validated',
      });
      return { import: finalized, lineCount: lineNo, balance };
    });
  }

  async acceptImport(
    ctx: RequestContext,
    actor: string | null,
    importId: string,
    expectedVersion: number,
  ): Promise<GlImportRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.importAccept);
    return this.db.withTenant(ctx, async (tx) => {
      const imp = await this.repo.findImport(tx, importId);
      if (imp === null) throw ProblemError.notFound('Import not found.', ctx.correlationId);
      if (imp.status !== 'validated')
        throw ProblemError.conflict(
          `Only a validated import can be accepted (is ${imp.status}).`,
          ctx.correlationId,
        );
      const accepted = await this.repo.setImportStatus(tx, {
        id: importId,
        expectedVersion,
        status: 'accepted',
        lineCount: null,
        by: actor,
      });
      if (accepted === null)
        throw ProblemError.conflict('Import modified concurrently (stale version).', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.importAccepted,
        entityType: 'gl_import',
        entityId: importId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'ImportAccepted', {
        recordId: importId,
        recordType: 'gl_import',
        toStatus: 'accepted',
      });
      return accepted;
    });
  }

  async rejectImport(
    ctx: RequestContext,
    actor: string | null,
    importId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<GlImportRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.importReject);
    return this.db.withTenant(ctx, async (tx) => {
      const imp = await this.repo.findImport(tx, importId);
      if (imp === null) throw ProblemError.notFound('Import not found.', ctx.correlationId);
      const rejected = await this.repo.setImportStatus(tx, {
        id: importId,
        expectedVersion,
        status: 'rejected',
        lineCount: null,
        by: actor,
      });
      if (rejected === null)
        throw ProblemError.conflict('Import modified concurrently (stale version).', ctx.correlationId);
      await this.repo.insertImportError(tx, {
        tenantId: ctx.tenantId,
        importId,
        importKind: 'gl',
        lineNo: null,
        errorCode: 'REJECTED',
        detail: reason,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.importRejected,
        entityType: 'gl_import',
        entityId: importId,
        detail: {},
      });
      await this.publish(tx, ctx, actor, 'ImportRejected', {
        recordId: importId,
        recordType: 'gl_import',
        toStatus: 'rejected',
      });
      return rejected;
    });
  }

  async importSource(
    ctx: RequestContext,
    actor: string | null,
    input: {
      glAccountId: string;
      sourceSystem?: string;
      sourceFormat?: string;
      fileHash?: string | null;
      documentRef?: string | null;
      entries: readonly RawSourceLine[];
      idempotencyKey?: string | null;
    },
  ): Promise<SourceImportResult> {
    await this.authz.require(ctx, M20_PERMISSIONS.sourceImport);
    const format = input.sourceFormat ?? 'api';
    return this.db.withTenant(ctx, async (tx) => {
      const acct = await this.repo.findAccount(tx, input.glAccountId);
      if (acct === null) throw ProblemError.notFound('GL account not found.', ctx.correlationId);
      if (input.fileHash != null && input.fileHash !== '') {
        const dup = await this.repo.findSourceImportByFileHash(tx, input.glAccountId, input.fileHash);
        if (dup !== null)
          throw ProblemError.conflict(
            'This source file was already imported for this account.',
            ctx.correlationId,
          );
      }
      const imp = await this.repo.insertSourceImport(tx, {
        tenantId: ctx.tenantId,
        glAccountId: input.glAccountId,
        sourceSystem: input.sourceSystem ?? 'source',
        sourceFormat: format,
        fileHash: input.fileHash ?? null,
        documentRef: input.documentRef ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      let lineNo = 0;
      for (const entry of input.entries) {
        lineNo += 1;
        if (entry.direction !== 'debit' && entry.direction !== 'credit') {
          await this.repo.insertImportError(tx, {
            tenantId: ctx.tenantId,
            importId: imp.id,
            importKind: 'source',
            lineNo,
            errorCode: 'BAD_DIRECTION',
            detail: `entry ${String(lineNo)}: direction must be debit or credit`,
            correlationId: ctx.correlationId,
          });
          continue;
        }
        const amt = assertLineAmount(entry.amountMinor, `entry ${String(lineNo)} amount`, ctx.correlationId);
        await this.repo.insertSourceLine(tx, {
          tenantId: ctx.tenantId,
          sourceImportId: imp.id,
          glAccountId: input.glAccountId,
          lineNo,
          entryDate: entry.entryDate,
          amountMinor: amt,
          direction: entry.direction,
          reference: entry.reference ?? null,
          description: entry.description ?? null,
          sourceRef: entry.sourceRef ?? null,
          correlationId: ctx.correlationId,
          by: actor,
        });
      }
      const accepted = await this.repo.setSourceImportStatus(tx, {
        id: imp.id,
        expectedVersion: imp.version,
        status: 'accepted',
        entryCount: lineNo,
        by: actor,
      });
      if (accepted === null)
        throw ProblemError.conflict('Source import modified concurrently.', ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M20_AUDIT_CODES.sourceImported,
        entityType: 'gl_source_import',
        entityId: imp.id,
        detail: { entryCount: lineNo },
      });
      await this.publish(tx, ctx, actor, 'SourceImported', {
        recordId: imp.id,
        recordType: 'source_import',
        glAccountRef: input.glAccountId,
        lineCount: lineNo,
        toStatus: 'accepted',
      });
      return { import: accepted, entryCount: lineNo };
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async getImport(ctx: RequestContext, id: string): Promise<GlImportRow> {
    await this.authz.require(ctx, M20_PERMISSIONS.importRead);
    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.findImport(tx, id);
      if (row === null) throw ProblemError.notFound('Import not found.', ctx.correlationId);
      return row;
    });
  }
  async listImports(ctx: RequestContext, glAccountId: string): Promise<GlImportRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.importRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listImports(tx, glAccountId));
  }
  async listImportLines(ctx: RequestContext, importId: string): Promise<GlLineRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.importRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listLinesByImport(tx, importId));
  }
  async listImportErrors(ctx: RequestContext, importId: string): Promise<GlImportErrorRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.importRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listImportErrors(tx, importId));
  }
  async listBalances(ctx: RequestContext, glAccountId: string): Promise<GlBalanceRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.importRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listBalances(tx, glAccountId));
  }
  async listSourceLines(ctx: RequestContext, sourceImportId: string): Promise<GlSourceLineRow[]> {
    await this.authz.require(ctx, M20_PERMISSIONS.importRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listSourceLinesByImport(tx, sourceImportId));
  }
}
