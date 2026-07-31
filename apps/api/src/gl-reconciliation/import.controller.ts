import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import {
  ImportService,
  M20_AUDIT_CODES,
  M20_PERMISSIONS,
  type RawGlLine,
  type RawSourceLine,
} from '@finapp/m20-glrecon';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import {
  importView,
  lineView,
  importErrorView,
  balanceView,
  sourceImportView,
  sourceLineView,
} from './views.ts';

/**
 * GL + source ingestion, under `/api/v1/gl-reconciliation`. A GL import carries transaction lines (INTEGER MINOR
 * UNITS) and an optional opening/closing balance whose invariant is verified. Imports move created → validated →
 * accepted or rejected. Permission enforced in ImportService (default deny); read routes carry no `@Endpoint`.
 * Money is INTEGER MINOR UNITS — numbers in, strings out; never a float (ADR-007).
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function optNum<K extends string>(v: unknown, k: K): Partial<Record<K, number>> {
  return typeof v === 'number' ? ({ [k]: v } as Record<K, number>) : {};
}
function asGlLines(v: unknown): readonly RawGlLine[] {
  return Array.isArray(v) ? (v as RawGlLine[]) : [];
}
function asSourceLines(v: unknown): readonly RawSourceLine[] {
  return Array.isArray(v) ? (v as RawSourceLine[]) : [];
}

@Controller('gl-reconciliation')
export class GlreconImportController {
  private readonly service: ImportService;
  private readonly actors: ActorContextFactory;
  constructor(service: ImportService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M20_PERMISSIONS.importCreate,
    auditCode: M20_AUDIT_CODES.importCreated,
    description: 'Import GL balances + transaction lines.',
  })
  @Post('gl-imports')
  async importGl(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'import gl (m20)');
    const result = await this.service.importGl(s.ctx, s.actor.identityId, {
      glAccountId: requireString(b['glAccountId'], 'glAccountId', s.correlationId),
      sourceFormat: requireString(b['sourceFormat'], 'sourceFormat', s.correlationId),
      fileHash: requireString(b['fileHash'], 'fileHash', s.correlationId),
      ...optStr(b['fileName'], 'fileName'),
      ...optStr(b['documentRef'], 'documentRef'),
      ...optStr(b['periodStart'], 'periodStart'),
      ...optStr(b['periodEnd'], 'periodEnd'),
      ...optNum(b['openingBalanceMinor'], 'openingBalanceMinor'),
      ...optNum(b['closingBalanceMinor'], 'closingBalanceMinor'),
      ...optStr(b['currencyRef'], 'currencyRef'),
      lines: asGlLines(b['lines']),
      ...optStr(b['idempotencyKey'], 'idempotencyKey'),
    });
    return {
      import: importView(result.import),
      lineCount: result.lineCount,
      balance: result.balance === null ? null : balanceView(result.balance),
    };
  }
  @Endpoint({
    permission: M20_PERMISSIONS.importAccept,
    auditCode: M20_AUDIT_CODES.importAccepted,
    description: 'Accept a validated GL import.',
  })
  @Post('gl-imports/:id/accept')
  async accept(
    @Param('id') id: string,
    @Body() b: { expectedVersion?: unknown },
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'accept import (m20)');
    return importView(
      await this.service.acceptImport(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b.expectedVersion, s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M20_PERMISSIONS.importReject,
    auditCode: M20_AUDIT_CODES.importRejected,
    description: 'Reject a GL import.',
  })
  @Post('gl-imports/:id/reject')
  async reject(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'reject import (m20)');
    return importView(
      await this.service.rejectImport(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        requireString(b['reason'], 'reason', s.correlationId),
      ),
    );
  }
  @Endpoint({
    permission: M20_PERMISSIONS.sourceImport,
    auditCode: M20_AUDIT_CODES.sourceImported,
    description: 'Import source-system records for reconciliation.',
  })
  @Post('source-imports')
  async importSource(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'import source (m20)');
    const result = await this.service.importSource(s.ctx, s.actor.identityId, {
      glAccountId: requireString(b['glAccountId'], 'glAccountId', s.correlationId),
      ...optStr(b['sourceSystem'], 'sourceSystem'),
      ...optStr(b['sourceFormat'], 'sourceFormat'),
      ...optStr(b['fileHash'], 'fileHash'),
      ...optStr(b['documentRef'], 'documentRef'),
      entries: asSourceLines(b['entries']),
      ...optStr(b['idempotencyKey'], 'idempotencyKey'),
    });
    return { import: sourceImportView(result.import), entryCount: result.entryCount };
  }

  // --- reads ------------------------------------------------------------------------------------
  @Get('gl-imports')
  async listImports(@Headers() h: Record<string, string>, @Query('glAccountId') glAccountId?: string) {
    const s = await this.scoped(h, 'list imports (m20)');
    const acct = requireString(glAccountId, 'glAccountId', s.correlationId);
    return { imports: (await this.service.listImports(s.ctx, acct)).map(importView) };
  }
  @Get('gl-imports/:id')
  async getImport(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get import (m20)');
    return importView(await this.service.getImport(s.ctx, id));
  }
  @Get('gl-imports/:id/lines')
  async listLines(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list import lines (m20)');
    return { lines: (await this.service.listImportLines(s.ctx, id)).map(lineView) };
  }
  @Get('gl-imports/:id/errors')
  async listErrors(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list import errors (m20)');
    return { errors: (await this.service.listImportErrors(s.ctx, id)).map(importErrorView) };
  }
  @Get('balances')
  async listBalances(@Headers() h: Record<string, string>, @Query('glAccountId') glAccountId?: string) {
    const s = await this.scoped(h, 'list balances (m20)');
    const acct = requireString(glAccountId, 'glAccountId', s.correlationId);
    return { balances: (await this.service.listBalances(s.ctx, acct)).map(balanceView) };
  }
  @Get('source-imports/:id/lines')
  async listSourceLines(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list source lines (m20)');
    return { lines: (await this.service.listSourceLines(s.ctx, id)).map(sourceLineView) };
  }
}
