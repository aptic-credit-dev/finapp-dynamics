import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import {
  ImportService,
  M15_AUDIT_CODES,
  M15_PERMISSIONS,
  type RawStatementLine,
  type RawLedgerEntry,
} from '@finapp/m15-recon';
import { ActorContextFactory } from '@finapp/m02-identity';
import { badRequest, requireString, requireTenantScope } from '../identity/http.ts';
import {
  statementImportView,
  statementLineView,
  ledgerImportView,
  ledgerEntryView,
  importErrorView,
} from './views.ts';

/**
 * Statement + ledger INGESTION and the read side of imports, under `/api/v1/reconciliation`. Imports are DUPLICATE-
 * PROTECTED (a second import of the same (bank_account, file_hash) is a clean conflict), and each raw line is
 * validated/normalized — a bad line is recorded append-only in the import-error log and skipped, never poisoning the
 * batch. MONEY IS INTEGER MINOR UNITS: each raw line's `amountMinor` is an INTEGER number of minor units, validated
 * in-service; a non-integer/unsafe amount is rejected as an import error, never coerced through a float (ADR-007).
 * `Idempotency-Key` (header) makes a statement/ledger import replay-safe. Permission enforced in ImportService
 * (default deny). Read (GET) routes carry no `@Endpoint` — the read permission is enforced in-service.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function requireArray(v: unknown, field: string, correlationId: string): unknown[] {
  if (!Array.isArray(v)) throw badRequest(`${field} is required and must be an array.`, correlationId);
  return v;
}

@Controller('reconciliation')
export class ReconciliationImportController {
  private readonly service: ImportService;
  private readonly actors: ActorContextFactory;
  constructor(service: ImportService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  // --- statement import -------------------------------------------------------------------------
  @Endpoint({
    permission: M15_PERMISSIONS.statementImport,
    auditCode: M15_AUDIT_CODES.statementImported,
    description: 'Import a bank statement (duplicate-protected on file hash).',
  })
  @Post('statement-imports')
  async importStatement(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'import statement (m15)');
    const idem = h['idempotency-key'];
    const lines = requireArray(b['lines'], 'lines', s.correlationId) as readonly RawStatementLine[];
    const r = await this.service.importStatement(s.ctx, s.actor.identityId, {
      bankAccountId: requireString(b['bankAccountId'], 'bankAccountId', s.correlationId),
      sourceFormat: requireString(b['sourceFormat'], 'sourceFormat', s.correlationId),
      fileHash: requireString(b['fileHash'], 'fileHash', s.correlationId),
      ...optStr(b['fileName'], 'fileName'),
      ...optStr(b['documentRef'], 'documentRef'),
      ...optStr(b['periodStart'], 'periodStart'),
      ...optStr(b['periodEnd'], 'periodEnd'),
      ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
      lines,
    });
    return { import: statementImportView(r.import), accepted: r.accepted, errors: r.errors };
  }

  // --- ledger import ----------------------------------------------------------------------------
  @Endpoint({
    permission: M15_PERMISSIONS.ledgerImport,
    auditCode: M15_AUDIT_CODES.ledgerImported,
    description: 'Import book/ledger entries (duplicate-protected when a file hash is supplied).',
  })
  @Post('ledger-imports')
  async importLedger(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'import ledger (m15)');
    const idem = h['idempotency-key'];
    const entries = requireArray(b['entries'], 'entries', s.correlationId) as readonly RawLedgerEntry[];
    const r = await this.service.importLedger(s.ctx, s.actor.identityId, {
      bankAccountId: requireString(b['bankAccountId'], 'bankAccountId', s.correlationId),
      ...optStr(b['sourceFormat'], 'sourceFormat'),
      ...optStr(b['fileHash'], 'fileHash'),
      ...optStr(b['documentRef'], 'documentRef'),
      ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
      entries,
    });
    return { import: ledgerImportView(r.import), accepted: r.accepted, errors: r.errors };
  }

  // --- reads ------------------------------------------------------------------------------------
  @Get('bank-accounts/:id/statement-imports')
  async listStatementImports(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list statement imports (m15)');
    return { imports: (await this.service.listStatementImports(s.ctx, id)).map(statementImportView) };
  }
  @Get('statement-imports/:id/lines')
  async listStatementLines(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list statement lines (m15)');
    return { lines: (await this.service.listStatementLines(s.ctx, id)).map(statementLineView) };
  }
  @Get('statement-imports/:id/errors')
  async listStatementImportErrors(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list statement import errors (m15)');
    return { errors: (await this.service.listImportErrors(s.ctx, id, 'statement')).map(importErrorView) };
  }
  @Get('bank-accounts/:id/ledger-imports')
  async listLedgerImports(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list ledger imports (m15)');
    return { imports: (await this.service.listLedgerImports(s.ctx, id)).map(ledgerImportView) };
  }
  @Get('ledger-imports/:id/entries')
  async listLedgerEntries(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list ledger entries (m15)');
    return { entries: (await this.service.listLedgerEntries(s.ctx, id)).map(ledgerEntryView) };
  }
  @Get('ledger-imports/:id/errors')
  async listLedgerImportErrors(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list ledger import errors (m15)');
    return { errors: (await this.service.listImportErrors(s.ctx, id, 'ledger')).map(importErrorView) };
  }
}
