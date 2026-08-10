/**
 * StudioBindingService — READ access to the opaque bindings a published design holds against the canonical m06/m07
 * engines, plus a privileged `rebind` that re-establishes the binding for an already-published version by re-compiling
 * through the canonical port (never a second engine). `rebind` requires `studio.binding.manage`. m31 stores ONLY the
 * opaque binding tuple; it owns no workflow_definition/rule_set table and reads none.
 */
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M31_PERMISSIONS } from './permissions.ts';
import { M31_AUDIT_CODES } from './audit-codes.ts';
import { badRequest } from './errors.ts';
import { targetEngineForKind, REASON_CODES, type ArtifactKind } from './domain.ts';
import { StudioRepository, type BindingRow } from './repository.ts';
import type { M31Emitter } from './emit.ts';
import type { WorkflowDefinitionPort, RuleDefinitionPort, PublishedBinding } from './ports.ts';

export class StudioBindingService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M31Emitter;
  private readonly workflowPort: WorkflowDefinitionPort;
  private readonly rulePort: RuleDefinitionPort;
  private readonly repo: StudioRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M31Emitter,
    workflowPort: WorkflowDefinitionPort,
    rulePort: RuleDefinitionPort,
    repo: StudioRepository = new StudioRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.workflowPort = workflowPort;
    this.rulePort = rulePort;
    this.repo = repo;
  }

  async getBinding(ctx: RequestContext, versionId: string): Promise<BindingRow | null> {
    await this.authz.require(ctx, M31_PERMISSIONS.artifactRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getBindingForVersion(tx, versionId));
  }

  /** Re-establish the canonical binding for a PUBLISHED version (privileged). Recompiles through the m06/m07 port. */
  async rebind(ctx: RequestContext, actor: string | null, versionId: string): Promise<BindingRow> {
    await this.authz.require(ctx, M31_PERMISSIONS.bindingManage);
    const prepared = await this.db.withTenant(ctx, async (tx) => {
      const version = await this.repo.getVersion(tx, versionId);
      if (version === null) throw badRequest('unknown version.', ctx.correlationId);
      if (version.state !== 'published')
        throw badRequest('only a published version can be rebound.', ctx.correlationId);
      const artifact = await this.repo.getArtifact(tx, version.artifact_id);
      if (artifact === null) throw badRequest('unknown artifact.', ctx.correlationId);
      return { version, artifact };
    });

    const engine = targetEngineForKind(prepared.artifact.kind as ArtifactKind);
    let binding: PublishedBinding | null = null;
    if (engine === 'workflow') {
      binding = await this.workflowPort.publishWorkflowDefinition(ctx, actor, {
        code: prepared.artifact.artifact_key,
        name: prepared.artifact.name,
        description: prepared.artifact.description,
        spec: prepared.version.spec,
      });
    } else if (engine === 'rule') {
      binding = await this.rulePort.publishRuleDefinition(ctx, actor, {
        key: prepared.artifact.artifact_key,
        name: prepared.artifact.name,
        description: prepared.artifact.description,
        spec: prepared.version.spec,
      });
    }

    return this.db.withTenant(ctx, async (tx) => {
      const row = await this.repo.insertBinding(tx, {
        tenantId: ctx.tenantId,
        artifactVersionId: versionId,
        targetEngine: engine,
        targetDefinitionId: binding?.definitionId ?? null,
        targetVersionId: binding?.versionId ?? null,
        targetVersionNo: binding?.versionNo ?? null,
        targetCode: binding?.code ?? null,
        contentHash: binding?.contentHash ?? prepared.version.content_hash,
        capabilityRef: null,
        reasonCode: REASON_CODES.bindingCreated,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M31_AUDIT_CODES.bindingCreated,
        entityType: 'studio_binding',
        entityId: versionId,
        detail: { targetEngine: engine, rebind: true },
      });
      return row;
    });
  }
}
