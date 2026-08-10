/**
 * M31 ports — the seams where a validated+approved Studio DESIGN binds to the CANONICAL runtime engines, and where the
 * (UNBUILT) m33 integration foundation plugs in later. M31 NEVER duplicates m06/m07: a workflow/rule design is compiled
 * through m06 `DefinitionService` / m07 `RuleSetService` and m31 keeps ONLY the opaque published binding. The
 * integration catalog is FAIL-CLOSED (m33 unbuilt) — an unknown/unavailable capability reference is refused; only
 * deterministic offline doubles ship (no network, no connector execution, no credential).
 */
import type { RequestContext } from '@finapp/kernel';
import { randomUUID } from 'node:crypto';
import type { DefinitionService } from '@finapp/m06-workflow';
import type { RuleSetService } from '@finapp/m07-rules';

/** The opaque binding m31 stores after publishing a design to a canonical engine (no engine state is duplicated). */
export interface PublishedBinding {
  readonly targetEngine: 'workflow' | 'rule';
  readonly definitionId: string;
  readonly versionId: string;
  readonly versionNo: number;
  readonly code: string;
  readonly contentHash: string | null;
}

/** Compile+publish a Studio workflow design to the canonical m06 workflow definition contract. */
export interface WorkflowDefinitionPort {
  publishWorkflowDefinition(
    ctx: RequestContext,
    actor: string | null,
    input: { code: string; name: string; description?: string | null; spec: unknown },
  ): Promise<PublishedBinding>;
}

/** Compile+publish a Studio rule design to the canonical m07 rule-set contract. */
export interface RuleDefinitionPort {
  publishRuleDefinition(
    ctx: RequestContext,
    actor: string | null,
    input: { key: string; name: string; description?: string | null; spec: unknown },
  ): Promise<PublishedBinding>;
}

/** The REAL adapter: wraps m06 `DefinitionService` (create -> validate -> publish). m31 touches no m06 private table. */
export class M06WorkflowDefinitionAdapter implements WorkflowDefinitionPort {
  private readonly svc: DefinitionService;
  constructor(svc: DefinitionService) {
    this.svc = svc;
  }
  async publishWorkflowDefinition(
    ctx: RequestContext,
    actor: string | null,
    input: { code: string; name: string; description?: string | null; spec: unknown },
  ): Promise<PublishedBinding> {
    const created = await this.svc.create(ctx, actor, {
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      spec: input.spec,
    });
    const validated = await this.svc.validate(ctx, actor, created.version.id, created.version.version);
    const published = await this.svc.publish(ctx, actor, created.version.id, validated.version);
    return {
      targetEngine: 'workflow',
      definitionId: created.definition.id,
      versionId: published.id,
      versionNo: published.version_number,
      code: created.definition.code,
      contentHash: published.content_hash,
    };
  }
}

/** The REAL adapter: wraps m07 `RuleSetService`. */
export class M07RuleDefinitionAdapter implements RuleDefinitionPort {
  private readonly svc: RuleSetService;
  constructor(svc: RuleSetService) {
    this.svc = svc;
  }
  async publishRuleDefinition(
    ctx: RequestContext,
    actor: string | null,
    input: { key: string; name: string; description?: string | null; spec: unknown },
  ): Promise<PublishedBinding> {
    const created = await this.svc.create(ctx, actor, {
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      spec: input.spec,
    });
    const validated = await this.svc.validate(ctx, actor, created.version.id, created.version.version);
    const published = await this.svc.publish(ctx, actor, created.version.id, validated.version);
    return {
      targetEngine: 'rule',
      definitionId: created.ruleSet.id,
      versionId: published.id,
      versionNo: published.version_number,
      code: created.ruleSet.key,
      contentHash: published.content_hash,
    };
  }
}

/** A DETERMINISTIC offline double for the workflow port (no engine, no network) — used in tests. */
export class FixtureWorkflowDefinitionPort implements WorkflowDefinitionPort {
  publishWorkflowDefinition(
    _ctx: RequestContext,
    _actor: string | null,
    input: { code: string; name: string; description?: string | null; spec: unknown },
  ): Promise<PublishedBinding> {
    return Promise.resolve({
      targetEngine: 'workflow',
      definitionId: randomUUID(),
      versionId: randomUUID(),
      versionNo: 1,
      code: input.code,
      contentHash: `sha256:${input.code}`,
    });
  }
}

/** A DETERMINISTIC offline double for the rule port. */
export class FixtureRuleDefinitionPort implements RuleDefinitionPort {
  publishRuleDefinition(
    _ctx: RequestContext,
    _actor: string | null,
    input: { key: string; name: string; description?: string | null; spec: unknown },
  ): Promise<PublishedBinding> {
    return Promise.resolve({
      targetEngine: 'rule',
      definitionId: randomUUID(),
      versionId: randomUUID(),
      versionNo: 1,
      code: input.key,
      contentHash: `sha256:${input.key}`,
    });
  }
}

/** Availability metadata for an OPAQUE integration capability reference (m33 owns real resolution). */
export interface IntegrationCapability {
  readonly available: boolean;
  readonly reasonCode: string;
}

/** The seam where m33-integration plugs in later. M31 stores only opaque capability references. */
export interface IntegrationCapabilityCatalogPort {
  getCapability(ctx: RequestContext, capabilityRef: string): Promise<IntegrationCapability>;
}

/** FAIL-CLOSED: m33 is UNBUILT, so every integration capability is unavailable (a design referencing one fails to bind). */
export class UnavailableIntegrationCatalog implements IntegrationCapabilityCatalogPort {
  getCapability(): Promise<IntegrationCapability> {
    return Promise.resolve({ available: false, reasonCode: 'integration_unavailable' });
  }
}

/** A DETERMINISTIC offline double: a capability in the known set is available; nothing else is (no network). */
export class FixtureIntegrationCatalog implements IntegrationCapabilityCatalogPort {
  private readonly known: ReadonlySet<string>;
  constructor(known: Iterable<string> = []) {
    this.known = new Set(known);
  }
  getCapability(_ctx: RequestContext, capabilityRef: string): Promise<IntegrationCapability> {
    return Promise.resolve(
      this.known.has(capabilityRef)
        ? { available: true, reasonCode: 'capability_available' }
        : { available: false, reasonCode: 'integration_unavailable' },
    );
  }
}
