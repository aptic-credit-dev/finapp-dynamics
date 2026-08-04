/**
 * DestinationService — configures external DESTINATION profiles and manages their enable/disable lifecycle. A
 * destination holds a SECRET REFERENCE (an opaque `secretref:` pointer, format-validated) — NEVER a credential/secret
 * value (ADR-102). There is no endpoint/URL and no external call. Every controlled mutation is audited through the m03
 * `AUDIT` port in the same transaction (FIN_INTEGRATION_ codes). FRAMEWORK ONLY: this module exposes no HTTP surface and
 * no permission namespace (naming-map authoritative) — it is an internal foundation library; the RBAC-gated API is
 * deferred to the proven-integration phase (ADR-101).
 */
import type { Audit, Db, RequestContext } from '@finapp/kernel';
import { ProblemError } from '@finapp/kernel';
import { M23_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { checkDestinationTransition } from './domain/lifecycles.ts';
import { isDestinationType } from './domain/vocab.ts';
import { assertSecretReference } from './engine.ts';
import { IntegrationRepository, type DestinationRow } from './repository.ts';

export class DestinationService {
  private readonly db: Db;
  private readonly audit: Audit;
  private readonly repo: IntegrationRepository;
  constructor(db: Db, audit: Audit, repo: IntegrationRepository = new IntegrationRepository()) {
    this.db = db;
    this.audit = audit;
    this.repo = repo;
  }

  async configureDestination(
    ctx: RequestContext,
    actor: string | null,
    input: {
      systemCode: string;
      scope?: string;
      name?: string | null;
      destinationType?: string;
      allowlisted?: boolean;
      secretReference?: string | null;
    },
  ): Promise<DestinationRow> {
    if (input.systemCode.trim() === '') throw badRequest('a system code is required.', ctx.correlationId);
    const destinationType = input.destinationType ?? 'generic';
    if (!isDestinationType(destinationType)) throw badRequest('unknown destination type.', ctx.correlationId);
    // A secret reference must be a POINTER, never an inline secret (fail closed).
    if (input.secretReference != null && input.secretReference !== '')
      assertSecretReference(input.secretReference);
    return this.db.withTenant(ctx, async (tx) => {
      const dest = await this.repo.insertDestination(tx, {
        tenantId: ctx.tenantId,
        systemCode: input.systemCode,
        scope: input.scope ?? 'default',
        name: input.name ?? null,
        destinationType,
        allowlisted: input.allowlisted ?? false,
        secretReference: input.secretReference ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertDestinationHistory(tx, {
        tenantId: ctx.tenantId,
        destinationId: dest.id,
        fromStatus: null,
        toStatus: 'draft',
        reason: null,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.audit.write(tx, ctx, {
        code: M23_AUDIT_CODES.destinationConfigured,
        entityType: 'integration_destination',
        entityId: dest.id,
        detail: { systemCode: dest.system_code, destinationType: dest.destination_type },
      });
      return dest;
    });
  }

  async enableDestination(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<DestinationRow> {
    return this.transition(ctx, actor, id, expectedVersion, 'enabled', M23_AUDIT_CODES.destinationEnabled);
  }
  async disableDestination(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
  ): Promise<DestinationRow> {
    return this.transition(ctx, actor, id, expectedVersion, 'disabled', M23_AUDIT_CODES.destinationDisabled);
  }

  private async transition(
    ctx: RequestContext,
    actor: string | null,
    id: string,
    expectedVersion: number,
    to: string,
    auditCode: string,
  ): Promise<DestinationRow> {
    return this.db.withTenant(ctx, async (tx) => {
      const dest = await this.repo.findDestination(tx, id);
      if (dest === null) throw ProblemError.notFound('Destination not found.', ctx.correlationId);
      const t = checkDestinationTransition(dest.status, to);
      if (!t.ok) throw badRequest(`A ${dest.status} destination cannot move to ${to}.`, ctx.correlationId);
      const updated = await this.repo.setDestinationStatus(tx, {
        id,
        expectedVersion,
        status: to,
        by: actor,
      });
      if (updated === null)
        throw ProblemError.conflict('Destination modified concurrently.', ctx.correlationId);
      await this.repo.insertDestinationHistory(tx, {
        tenantId: ctx.tenantId,
        destinationId: id,
        fromStatus: dest.status,
        toStatus: to,
        reason: null,
        reasonCode: null,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.audit.write(tx, ctx, {
        code: auditCode,
        entityType: 'integration_destination',
        entityId: id,
        detail: { systemCode: dest.system_code },
      });
      return updated;
    });
  }

  async getDestination(ctx: RequestContext, id: string): Promise<DestinationRow> {
    return this.db.withTenant(ctx, async (tx) => {
      const dest = await this.repo.findDestination(tx, id);
      if (dest === null) throw ProblemError.notFound('Destination not found.', ctx.correlationId);
      return dest;
    });
  }
  async listDestinations(ctx: RequestContext): Promise<DestinationRow[]> {
    return this.db.withTenant(ctx, (tx) => this.repo.listDestinations(tx));
  }
}
