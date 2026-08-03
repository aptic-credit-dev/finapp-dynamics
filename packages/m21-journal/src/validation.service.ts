/**
 * ValidationService — runs the deterministic, explainable validation ENGINE against a draft and records the result +
 * findings + balance evidence (append-only). A draft that passes (balanced, decimal-safe, in an open period, no
 * duplicate posting) advances 'draft'/'validated' -> 'validated'; a failing draft is reverted to 'draft'. The reason
 * codes are machine-readable (domain/limits REASON_CODES). Validation is the gate a draft must clear before it can be
 * submitted for approval; it NEVER approves or posts. Money is INTEGER MINOR UNITS — never float (ADR-007).
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M21_PERMISSIONS } from './permissions.ts';
import { M21_AUDIT_CODES } from './audit-codes.ts';
import { checkDraftTransition } from './domain/lifecycles.ts';
import { validateDraft, type ValidationResult } from './engine.ts';
import {
  JournalRepository,
  type JournalValidationFindingRow,
  type JournalValidationRow,
} from './repository.ts';
import type { M21Emitter } from './emit.ts';

export class ValidationService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M21Emitter;
  private readonly repo: JournalRepository;
  constructor(db: Db, authz: Authz, emitter: M21Emitter, repo: JournalRepository = new JournalRepository()) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.repo = repo;
  }

  async runValidation(
    ctx: RequestContext,
    actor: string | null,
    draftId: string,
    expectedVersion: number,
  ): Promise<{
    validation: JournalValidationRow;
    findings: JournalValidationFindingRow[];
    result: ValidationResult;
    draftStatus: string;
  }> {
    await this.authz.require(ctx, M21_PERMISSIONS.validationRun);
    return this.db.withTenant(ctx, async (tx) => {
      const draft = await this.repo.findDraft(tx, draftId);
      if (draft === null) throw ProblemError.notFound('Draft not found.', ctx.correlationId);
      if (draft.version !== expectedVersion)
        throw ProblemError.conflict('Draft modified concurrently.', ctx.correlationId);
      if (draft.status !== 'draft' && draft.status !== 'validated')
        throw ProblemError.conflict(`A ${draft.status} draft cannot be validated.`, ctx.correlationId);

      const lines = await this.repo.listLines(tx, draftId, true);
      const alreadyPosted = await this.repo.draftHasSuccessfulPosting(tx, draftId);
      const result = validateDraft({
        entityRef: draft.entity_ref,
        currencyRef: draft.currency_ref,
        periodStatus: draft.period_status,
        alreadyPosted,
        lines: lines.map((l) => ({
          id: l.id,
          accountRef: l.account_ref,
          direction: l.direction,
          amountMinor: Number(l.amount_minor),
          currencyRef: l.currency_ref,
          status: l.status,
        })),
      });

      const validation = await this.repo.insertValidation(tx, {
        tenantId: ctx.tenantId,
        draftId,
        isValid: result.isValid,
        debitsMinor: result.debitsMinor,
        creditsMinor: result.creditsMinor,
        balanced: result.balanced,
        errorCount: result.errorCount,
        warningCount: result.warningCount,
        by: actor,
        correlationId: ctx.correlationId,
      });
      for (const f of result.findings) {
        await this.repo.insertValidationFinding(tx, {
          tenantId: ctx.tenantId,
          validationId: validation.id,
          draftId,
          lineRef: f.lineRef ?? null,
          severity: f.severity,
          reasonCode: f.reasonCode,
          detail: f.detail ?? null,
          correlationId: ctx.correlationId,
        });
      }
      // Append-only balance-invariant evidence.
      await this.repo.insertDraftBalance(tx, {
        tenantId: ctx.tenantId,
        draftId,
        debitsMinor: result.debitsMinor,
        creditsMinor: result.creditsMinor,
        varianceMinor: result.debitsMinor - result.creditsMinor,
        balanced: result.balanced,
        lineCount: lines.length,
        correlationId: ctx.correlationId,
        by: actor,
      });

      // Advance to 'validated' on success; revert a previously-validated draft to 'draft' on failure.
      let draftStatus = draft.status;
      if (result.isValid && draft.status !== 'validated') {
        const t = checkDraftTransition(draft.status, 'validated');
        if (t.ok) {
          const updated = await this.repo.setDraftStatus(tx, {
            id: draftId,
            expectedVersion,
            status: 'validated',
            by: actor,
          });
          if (updated === null)
            throw ProblemError.conflict('Draft modified concurrently.', ctx.correlationId);
          await this.repo.insertStatusHistory(tx, {
            tenantId: ctx.tenantId,
            draftId,
            fromStatus: draft.status,
            toStatus: 'validated',
            reason: null,
            reasonCode: 'balanced',
            by: actor,
            correlationId: ctx.correlationId,
          });
          draftStatus = 'validated';
        }
      } else if (!result.isValid && draft.status === 'validated') {
        const reverted = await this.repo.setDraftStatus(tx, {
          id: draftId,
          expectedVersion,
          status: 'draft',
          by: actor,
        });
        if (reverted === null) throw ProblemError.conflict('Draft modified concurrently.', ctx.correlationId);
        await this.repo.insertStatusHistory(tx, {
          tenantId: ctx.tenantId,
          draftId,
          fromStatus: 'validated',
          toStatus: 'draft',
          reason: 'validation failed',
          reasonCode: null,
          by: actor,
          correlationId: ctx.correlationId,
        });
        draftStatus = 'draft';
      }

      const firstError = result.findings.find((f) => f.severity === 'error');
      await this.emitter.recordAudit(tx, ctx, {
        code: M21_AUDIT_CODES.draftValidated,
        entityType: 'journal_draft',
        entityId: draftId,
        detail: { isValid: result.isValid, balanced: result.balanced, errorCount: result.errorCount },
      });
      await this.emitter.publishJournal(tx, {
        type: 'DraftValidated',
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: draftId,
          recordType: 'draft',
          balanced: result.balanced,
          toStatus: draftStatus,
          totalDebitsMinor: String(result.debitsMinor),
          totalCreditsMinor: String(result.creditsMinor),
          reasonCodes: result.findings.map((f) => f.reasonCode),
          ...(firstError !== undefined ? { reasonCode: firstError.reasonCode } : {}),
          isDraft: true,
        },
      });

      const findings = await this.repo.listValidationFindings(tx, validation.id);
      return { validation, findings, result, draftStatus };
    });
  }

  // --- reads ------------------------------------------------------------------------------------
  async getValidation(
    ctx: RequestContext,
    id: string,
  ): Promise<{ validation: JournalValidationRow; findings: JournalValidationFindingRow[] }> {
    await this.authz.require(ctx, M21_PERMISSIONS.validationRead);
    return this.db.withTenant(ctx, async (tx) => {
      const validation = await this.repo.findValidation(tx, id);
      if (validation === null) throw ProblemError.notFound('Validation not found.', ctx.correlationId);
      const findings = await this.repo.listValidationFindings(tx, id);
      return { validation, findings };
    });
  }
  async listValidations(ctx: RequestContext, draftId: string): Promise<JournalValidationRow[]> {
    await this.authz.require(ctx, M21_PERMISSIONS.validationRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listValidations(tx, draftId));
  }
}
