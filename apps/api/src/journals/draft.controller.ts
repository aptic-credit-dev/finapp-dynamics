import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { DraftService, ValidationService, M21_AUDIT_CODES, M21_PERMISSIONS } from '@finapp/m21-journal';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { draftView, lineView, statusHistoryView, noteView, validationView, findingView } from './views.ts';

/**
 * DRAFT journals — create/edit BALANCED, decimal-safe drafts, manage lines, run deterministic validation, submit for
 * approval (m22) and withdraw — under `/api/v1/journals`. m21 NEVER approves or posts (there is no approve/post route
 * here). Amounts are INTEGER MINOR UNITS — numbers in, strings out; never a float (ADR-007). Permissions are enforced
 * in-service (default deny); read routes carry no `@Endpoint`. `expectedVersion` is mandatory on every mutation.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number.NaN;
}
interface RawLine {
  accountRef?: string | null;
  direction: string;
  amountMinor: number;
  currencyRef?: string | null;
  costCentreRef?: string | null;
  dimensionRef?: string | null;
  taxCodeRef?: string | null;
  description?: string | null;
}
function parseLines(v: unknown): RawLine[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return {
      accountRef: typeof o['accountRef'] === 'string' ? o['accountRef'] : null,
      direction: typeof o['direction'] === 'string' ? o['direction'] : '',
      amountMinor: num(o['amountMinor']),
      currencyRef: typeof o['currencyRef'] === 'string' ? o['currencyRef'] : null,
      costCentreRef: typeof o['costCentreRef'] === 'string' ? o['costCentreRef'] : null,
      dimensionRef: typeof o['dimensionRef'] === 'string' ? o['dimensionRef'] : null,
      taxCodeRef: typeof o['taxCodeRef'] === 'string' ? o['taxCodeRef'] : null,
      description: typeof o['description'] === 'string' ? o['description'] : null,
    };
  });
}

@Controller('journals')
export class JournalDraftController {
  private readonly service: DraftService;
  private readonly validation: ValidationService;
  private readonly actors: ActorContextFactory;
  constructor(service: DraftService, validation: ValidationService, actors: ActorContextFactory) {
    this.service = service;
    this.validation = validation;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M21_PERMISSIONS.draftCreate,
    auditCode: M21_AUDIT_CODES.draftCreated,
    description: 'Create a draft journal.',
  })
  @Post('drafts')
  async create(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create draft (m21)');
    return draftView(
      await this.service.createDraft(s.ctx, s.actor.identityId, {
        ...optStr(b['journalTypeId'], 'journalTypeId'),
        ...optStr(b['entityRef'], 'entityRef'),
        ...optStr(b['periodRef'], 'periodRef'),
        ...optStr(b['periodStatus'], 'periodStatus'),
        ...optStr(b['currencyRef'], 'currencyRef'),
        ...optStr(b['journalDate'], 'journalDate'),
        ...optStr(b['description'], 'description'),
        ...optStr(b['sourceType'], 'sourceType'),
        ...optStr(b['reference'], 'reference'),
        lines: parseLines(b['lines']),
      }),
    );
  }

  @Endpoint({
    permission: M21_PERMISSIONS.draftEdit,
    auditCode: M21_AUDIT_CODES.draftEdited,
    description: 'Edit a draft journal header.',
  })
  @Post('drafts/:id/edit')
  async edit(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'edit draft (m21)');
    return draftView(
      await this.service.editHeader(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        {
          ...optStr(b['journalTypeId'], 'journalTypeId'),
          ...optStr(b['entityRef'], 'entityRef'),
          ...optStr(b['periodRef'], 'periodRef'),
          ...optStr(b['periodStatus'], 'periodStatus'),
          ...optStr(b['currencyRef'], 'currencyRef'),
          ...optStr(b['journalDate'], 'journalDate'),
          ...optStr(b['description'], 'description'),
          ...optStr(b['reference'], 'reference'),
        },
      ),
    );
  }

  @Endpoint({
    permission: M21_PERMISSIONS.lineManage,
    auditCode: M21_AUDIT_CODES.lineAdded,
    description: 'Add a line to a draft journal.',
  })
  @Post('drafts/:id/lines')
  async addLine(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add line (m21)');
    const out = await this.service.addLine(s.ctx, s.actor.identityId, id, {
      accountRef: typeof b['accountRef'] === 'string' ? b['accountRef'] : null,
      direction: typeof b['direction'] === 'string' ? b['direction'] : '',
      amountMinor: num(b['amountMinor']),
      currencyRef: typeof b['currencyRef'] === 'string' ? b['currencyRef'] : null,
      costCentreRef: typeof b['costCentreRef'] === 'string' ? b['costCentreRef'] : null,
      dimensionRef: typeof b['dimensionRef'] === 'string' ? b['dimensionRef'] : null,
      taxCodeRef: typeof b['taxCodeRef'] === 'string' ? b['taxCodeRef'] : null,
      description: typeof b['description'] === 'string' ? b['description'] : null,
    });
    return { draft: draftView(out.draft), line: lineView(out.line) };
  }

  @Endpoint({
    permission: M21_PERMISSIONS.lineManage,
    auditCode: M21_AUDIT_CODES.lineUpdated,
    description: 'Update a draft journal line.',
  })
  @Post('lines/:id/update')
  async updateLine(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update line (m21)');
    const out = await this.service.updateLine(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
      {
        accountRef: typeof b['accountRef'] === 'string' ? b['accountRef'] : null,
        direction: typeof b['direction'] === 'string' ? b['direction'] : '',
        amountMinor: num(b['amountMinor']),
        currencyRef: typeof b['currencyRef'] === 'string' ? b['currencyRef'] : null,
        description: typeof b['description'] === 'string' ? b['description'] : null,
      },
    );
    return { draft: draftView(out.draft), line: lineView(out.line) };
  }

  @Endpoint({
    permission: M21_PERMISSIONS.lineManage,
    auditCode: M21_AUDIT_CODES.lineRemoved,
    description: 'Remove a draft journal line.',
  })
  @Post('lines/:id/remove')
  async removeLine(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'remove line (m21)');
    const out = await this.service.removeLine(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return { draft: draftView(out.draft), line: lineView(out.line) };
  }

  @Endpoint({
    permission: M21_PERMISSIONS.validationRun,
    auditCode: M21_AUDIT_CODES.draftValidated,
    description: 'Run deterministic validation on a draft journal.',
  })
  @Post('drafts/:id/validate')
  async validate(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'validate draft (m21)');
    const out = await this.validation.runValidation(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return {
      validation: validationView(out.validation),
      findings: out.findings.map(findingView),
      draftStatus: out.draftStatus,
    };
  }

  @Endpoint({
    permission: M21_PERMISSIONS.draftSubmit,
    auditCode: M21_AUDIT_CODES.draftSubmitted,
    description: 'Submit a validated draft for approval (m22).',
  })
  @Post('drafts/:id/submit')
  async submit(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'submit draft (m21)');
    return draftView(
      await this.service.submitDraft(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
      ),
    );
  }

  @Endpoint({
    permission: M21_PERMISSIONS.draftWithdraw,
    auditCode: M21_AUDIT_CODES.draftWithdrawn,
    description: 'Withdraw a draft journal.',
  })
  @Post('drafts/:id/withdraw')
  async withdraw(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'withdraw draft (m21)');
    return draftView(
      await this.service.withdrawDraft(
        s.ctx,
        s.actor.identityId,
        id,
        requireVersion(b['expectedVersion'], s.correlationId),
        requireString(b['reason'], 'reason', s.correlationId),
      ),
    );
  }

  @Endpoint({
    permission: M21_PERMISSIONS.noteAdd,
    auditCode: M21_AUDIT_CODES.noteAdded,
    description: 'Add a note to a draft journal.',
  })
  @Post('drafts/:id/notes')
  async addNote(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add note (m21)');
    return noteView(
      await this.service.addNote(s.ctx, s.actor.identityId, id, {
        ...optStr(b['noteType'], 'noteType'),
        content: requireString(b['content'], 'content', s.correlationId),
      }),
    );
  }

  // --- reads ------------------------------------------------------------------------------------
  @Get('drafts')
  async list(@Headers() h: Record<string, string>, @Query('status') status?: string) {
    const s = await this.scoped(h, 'list drafts (m21)');
    return { drafts: (await this.service.listDrafts(s.ctx, status)).map(draftView) };
  }
  @Get('drafts/:id')
  async get(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get draft (m21)');
    const out = await this.service.getDraft(s.ctx, id);
    return { draft: draftView(out.draft), lines: out.lines.map(lineView) };
  }
  @Get('drafts/:id/history')
  async history(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'draft history (m21)');
    return { history: (await this.service.listHistory(s.ctx, id)).map(statusHistoryView) };
  }
  @Get('drafts/:id/notes')
  async notes(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'draft notes (m21)');
    return { notes: (await this.service.listNotes(s.ctx, id)).map(noteView) };
  }
  @Get('drafts/:id/validations')
  async validations(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'draft validations (m21)');
    return { validations: (await this.validation.listValidations(s.ctx, id)).map(validationView) };
  }
  @Get('validations/:id')
  async getValidation(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get validation (m21)');
    const out = await this.validation.getValidation(s.ctx, id);
    return { validation: validationView(out.validation), findings: out.findings.map(findingView) };
  }
}
