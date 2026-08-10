/**
 * StudioArtifactService — the DESIGN lifecycle: author -> validate -> version -> request review -> PUBLISH (a controlled
 * action) / reject / archive. It is NOT a runtime engine. On publish, a validated+approved workflow/rule design is
 * COMPILED to the canonical engine through a port (m06 `DefinitionService` / m07 `RuleSetService`) and m31 records only
 * the OPAQUE binding; a form binds to nothing external. PUBLISH is guarded in three layers: the pure gates
 * (`evaluatePublishGate` — passing validation + human approver + author != approver + a valid binding), the service
 * (authz + fail-closed integration-capability check + version CAS) and the database (evidence_ck, review SoD/decider
 * CHECKs, the published-immutability trigger). AI never approves (`isHumanActor`). Every mutation is audited through m03
 * in the same transaction; refusals are a durable audit + a 403 governance error.
 */
import { createHash } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M31_PERMISSIONS } from './permissions.ts';
import { M31_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden, versionConflict } from './errors.ts';
import {
  isArtifactKind,
  isScope,
  isPlatformScope,
  validateArtifactSpec,
  evaluateSodGate,
  evaluatePublishGate,
  targetEngineForKind,
  REASON_CODES,
  type ArtifactKind,
} from './domain.ts';
import {
  StudioRepository,
  type ArtifactRow,
  type ArtifactVersionRow,
  type ValidationResultRow,
} from './repository.ts';
import type { M31Emitter } from './emit.ts';
import type {
  WorkflowDefinitionPort,
  RuleDefinitionPort,
  IntegrationCapabilityCatalogPort,
  PublishedBinding,
} from './ports.ts';

/** A stable content hash over the canonical JSON of a design spec (freezes the version). */
export function contentHashOf(spec: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(spec ?? null))
    .digest('hex')}`;
}

export class StudioArtifactService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M31Emitter;
  private readonly workflowPort: WorkflowDefinitionPort;
  private readonly rulePort: RuleDefinitionPort;
  private readonly catalog: IntegrationCapabilityCatalogPort;
  private readonly repo: StudioRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M31Emitter,
    workflowPort: WorkflowDefinitionPort,
    rulePort: RuleDefinitionPort,
    catalog: IntegrationCapabilityCatalogPort,
    repo: StudioRepository = new StudioRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.workflowPort = workflowPort;
    this.rulePort = rulePort;
    this.catalog = catalog;
    this.repo = repo;
  }

  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M31_PERMISSIONS.administer);
  }

  /** Create a design artifact + its first DRAFT version (declarative spec). Authoring is not privileged; publish is. */
  async createArtifact(
    ctx: RequestContext,
    actor: string | null,
    input: {
      projectId: string;
      scope?: string;
      kind: string;
      artifactKey: string;
      name: string;
      description?: string | null;
      spec: unknown;
      idempotencyKey?: string | null;
    },
  ): Promise<{ artifact: ArtifactRow; version: ArtifactVersionRow }> {
    await this.authz.require(ctx, M31_PERMISSIONS.artifactAuthor);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    if (!isArtifactKind(input.kind)) throw badRequest('unknown artifact kind.', ctx.correlationId);
    if (input.artifactKey.trim() === '') throw badRequest('an artifact key is required.', ctx.correlationId);
    if (input.name.trim() === '') throw badRequest('an artifact name is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findArtifactByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) {
          const versions = await this.repo.listVersions(tx, existing.id);
          const v = versions[versions.length - 1] ?? versions[0];
          if (v !== undefined) return { artifact: existing, version: v };
        }
      }
      const project = await this.repo.getProject(tx, input.projectId);
      if (project === null) throw badRequest('unknown project.', ctx.correlationId);
      const artifact = await this.repo.insertArtifact(tx, {
        tenantId: ctx.tenantId,
        projectId: input.projectId,
        scope,
        kind: input.kind,
        artifactKey: input.artifactKey,
        name: input.name,
        description: input.description ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      const version = await this.repo.insertVersion(tx, {
        tenantId: ctx.tenantId,
        artifactId: artifact.id,
        versionNo: 1,
        spec: input.spec,
        contentHash: contentHashOf(input.spec),
        notes: null,
        idempotencyKey: null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      const bumped = await this.repo.updateArtifact(tx, artifact.id, artifact.version, {
        name: artifact.name,
        description: artifact.description,
        status: artifact.status,
        latestVersion: 1,
        publishedVersion: null,
        by: actor,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'artifact',
        targetId: artifact.id,
        fromStatus: null,
        toStatus: 'active',
        reason: null,
        reasonCode: REASON_CODES.artifactCreated,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M31_AUDIT_CODES.artifactCreated,
        entityType: 'studio_artifact',
        entityId: artifact.id,
        detail: { kind: input.kind, artifactKey: input.artifactKey, scope },
      });
      await this.emitter.publishStudio(tx, 'ArtifactCreated', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: artifact.id,
          recordType: 'artifact',
          artifactKind: input.kind,
          artifactKey: input.artifactKey,
          versionNo: 1,
          toStatus: 'draft',
          reasonCode: REASON_CODES.artifactCreated,
        },
      });
      return { artifact: bumped ?? artifact, version };
    });
  }

  /** Add a new DRAFT version (an edit of a published/rejected design becomes a new version — never an in-place edit). */
  async newVersion(
    ctx: RequestContext,
    actor: string | null,
    artifactId: string,
    spec: unknown,
    notes: string | null = null,
  ): Promise<ArtifactVersionRow> {
    await this.authz.require(ctx, M31_PERMISSIONS.artifactAuthor);
    return this.db.withTenant(ctx, async (tx) => {
      const artifact = await this.repo.getArtifact(tx, artifactId);
      if (artifact === null) throw badRequest('unknown artifact.', ctx.correlationId);
      await this.authorizeScope(ctx, artifact.scope);
      const nextNo = artifact.latest_version + 1;
      const version = await this.repo.insertVersion(tx, {
        tenantId: ctx.tenantId,
        artifactId,
        versionNo: nextNo,
        spec,
        contentHash: contentHashOf(spec),
        notes,
        idempotencyKey: null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      const bumped = await this.repo.updateArtifact(tx, artifactId, artifact.version, {
        name: artifact.name,
        description: artifact.description,
        status: artifact.status,
        latestVersion: nextNo,
        publishedVersion: artifact.published_version,
        by: actor,
      });
      if (bumped === null) throw versionConflict(ctx.correlationId);
      await this.emitter.recordAudit(tx, ctx, {
        code: M31_AUDIT_CODES.artifactVersionCreated,
        entityType: 'studio_artifact_version',
        entityId: version.id,
        detail: { artifactId, versionNo: nextNo },
      });
      return version;
    });
  }

  /**
   * Validate a version fail-closed (reusing the canonical m06/m07 validators + m06 expression sandbox + a deep secret/
   * prohibited-expression scan). A passing result transitions draft -> validated; a failing result records the findings
   * and leaves the version in draft (it can never advance — DB evidence_ck). Returns the validation result row.
   */
  async validateVersion(
    ctx: RequestContext,
    actor: string | null,
    versionId: string,
    expectedVersion: number,
  ): Promise<ValidationResultRow> {
    await this.authz.require(ctx, M31_PERMISSIONS.artifactValidate);
    return this.db.withTenant(ctx, async (tx) => {
      const version = await this.repo.getVersion(tx, versionId);
      if (version === null) throw badRequest('unknown version.', ctx.correlationId);
      const artifact = await this.repo.getArtifact(tx, version.artifact_id);
      if (artifact === null) throw badRequest('unknown artifact.', ctx.correlationId);
      const outcome = validateArtifactSpec(artifact.kind as ArtifactKind, version.spec);
      const result = await this.repo.insertValidationResult(tx, {
        tenantId: ctx.tenantId,
        artifactVersionId: versionId,
        passed: outcome.passed,
        findingCount: outcome.findings.length,
        findings: outcome.findings,
        reasonCode: outcome.passed ? REASON_CODES.validationPassed : REASON_CODES.validationFailed,
        correlationId: ctx.correlationId,
        by: actor,
      });
      if (outcome.passed) {
        const moved = await this.repo.updateVersionState(tx, versionId, expectedVersion, {
          state: 'validated',
          validationPassed: true,
          by: actor,
        });
        if (moved === null) throw versionConflict(ctx.correlationId);
        await this.emitter.recordAudit(tx, ctx, {
          code: M31_AUDIT_CODES.artifactValidated,
          entityType: 'studio_artifact_version',
          entityId: versionId,
          detail: { artifactId: version.artifact_id, versionNo: version.version_no },
        });
        await this.emitter.publishStudio(tx, 'VersionValidated', {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: {
            recordId: versionId,
            recordType: 'version',
            artifactKind: artifact.kind,
            versionNo: version.version_no,
            toStatus: 'validated',
            reasonCode: REASON_CODES.validationPassed,
          },
        });
      } else {
        await this.emitter.recordAudit(tx, ctx, {
          code: M31_AUDIT_CODES.artifactValidationFailed,
          entityType: 'studio_artifact_version',
          entityId: versionId,
          detail: { artifactId: version.artifact_id, findingCount: outcome.findings.length },
        });
      }
      return result;
    });
  }

  /** Request review of a validated version (validated -> review_pending) and record the requester (for the SoD check). */
  async requestReview(
    ctx: RequestContext,
    actor: string | null,
    versionId: string,
    expectedVersion: number,
  ): Promise<ArtifactVersionRow> {
    await this.authz.require(ctx, M31_PERMISSIONS.artifactValidate);
    if (actor === null || actor.trim() === '')
      throw badRequest('an identified requester is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const version = await this.repo.getVersion(tx, versionId);
      if (version === null) throw badRequest('unknown version.', ctx.correlationId);
      if (version.state !== 'validated')
        throw badRequest('only a validated version can be sent for review.', ctx.correlationId);
      const moved = await this.repo.updateVersionState(tx, versionId, expectedVersion, {
        state: 'review_pending',
        validationPassed: true,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        artifactVersionId: versionId,
        kind: 'requested',
        requestedBy: actor,
        decidedBy: null,
        reason: null,
        reasonCode: REASON_CODES.reviewRequested,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M31_AUDIT_CODES.reviewRequested,
        entityType: 'studio_artifact_version',
        entityId: versionId,
        detail: { artifactId: version.artifact_id, versionNo: version.version_no },
      });
      await this.emitter.publishStudio(tx, 'ReviewRequested', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        actor,
        payload: {
          recordId: versionId,
          recordType: 'version',
          versionNo: version.version_no,
          toStatus: 'review_pending',
          reasonCode: REASON_CODES.reviewRequested,
        },
      });
      return moved;
    });
  }

  /**
   * PUBLISH — the controlled action. The approver (`actor`) must be a HUMAN and NOT the requester (maker-checker/SoD),
   * the version must have passed validation, every referenced integration capability must be available (fail closed,
   * m33), and a valid canonical binding must be produced. On success the design is compiled to the canonical engine
   * (m06/m07) through the port, the opaque binding is recorded, any prior published version is superseded, and the
   * version becomes published (immutable thereafter). A refusal is a durable audit + a 403.
   */
  async publishArtifact(
    ctx: RequestContext,
    actor: string | null,
    versionId: string,
    expectedVersion: number,
  ): Promise<{ version: ArtifactVersionRow; binding: PublishedBinding | null }> {
    await this.authz.require(ctx, M31_PERMISSIONS.artifactPublish);

    // Phase 1 — load + gate (a refusal is a durable audit + 403, never a silent failure).
    const prepared = await this.db.withTenant(ctx, async (tx) => {
      const version = await this.repo.getVersion(tx, versionId);
      if (version === null) throw badRequest('unknown version.', ctx.correlationId);
      const artifact = await this.repo.getArtifact(tx, version.artifact_id);
      if (artifact === null) throw badRequest('unknown artifact.', ctx.correlationId);
      await this.authorizeScope(ctx, artifact.scope);
      if (version.state !== 'review_pending')
        throw badRequest('only a version in review can be published.', ctx.correlationId);

      const request = await this.repo.findOpenReviewRequest(tx, versionId);
      const requestedBy = request?.requested_by ?? '';

      // maker-checker / SoD — AI never approves; author != approver.
      const sod = evaluateSodGate(requestedBy, actor);
      if (!sod.allowed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M31_AUDIT_CODES.sodBlocked,
          entityType: 'studio_artifact_version',
          entityId: versionId,
          detail: { reasonCode: sod.reasonCode },
        });
        throw governanceForbidden(sod.reasonCode, ctx.correlationId);
      }
      if (!version.validation_passed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M31_AUDIT_CODES.publishBlocked,
          entityType: 'studio_artifact_version',
          entityId: versionId,
          detail: { reasonCode: REASON_CODES.validationNotPassed },
        });
        throw governanceForbidden(REASON_CODES.validationNotPassed, ctx.correlationId);
      }
      // Fail-closed integration boundary — m33 is UNBUILT; any referenced capability must resolve as available.
      const deps = await this.repo.listDependencies(tx, versionId);
      const capRefs = deps.map((d) => d.capability_ref).filter((r): r is string => r !== null);
      for (const ref of capRefs) {
        const cap = await this.catalog.getCapability(ctx, ref);
        if (!cap.available) {
          await this.emitter.recordAudit(tx, ctx, {
            code: M31_AUDIT_CODES.publishBlocked,
            entityType: 'studio_artifact_version',
            entityId: versionId,
            detail: { reasonCode: REASON_CODES.capabilityUnavailable },
          });
          throw governanceForbidden(REASON_CODES.capabilityUnavailable, ctx.correlationId);
        }
      }
      return { version, artifact, requestedBy };
    });

    // Phase 2 — compile to the canonical engine THROUGH the port (its own tx; m31 keeps only the opaque binding).
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

    // Phase 3 — persist: binding + supersede prior + publish (immutable) + approved decision + audit + event.
    return this.db.withTenant(ctx, async (tx) => {
      const gate = evaluatePublishGate({
        validationPassed: prepared.version.validation_passed,
        requestedBy: prepared.requestedBy,
        approver: actor,
        hasBinding: engine === 'none' || binding !== null,
      });
      if (!gate.allowed) throw governanceForbidden(gate.reasonCode, ctx.correlationId);

      await this.repo.insertBinding(tx, {
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

      // Supersede any currently-published version of this artifact (one published at a time).
      const priorPublished = await this.repo.getPublishedVersion(tx, prepared.artifact.id);
      if (priorPublished !== null && priorPublished.id !== versionId) {
        const superseded = await this.repo.updateVersionState(tx, priorPublished.id, priorPublished.version, {
          state: 'superseded',
          validationPassed: priorPublished.validation_passed,
          by: actor,
        });
        if (superseded === null) throw versionConflict(ctx.correlationId);
        await this.emitter.recordAudit(tx, ctx, {
          code: M31_AUDIT_CODES.artifactSuperseded,
          entityType: 'studio_artifact_version',
          entityId: priorPublished.id,
          detail: { artifactId: prepared.artifact.id },
        });
        await this.emitter.publishStudio(tx, 'ArtifactSuperseded', {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: {
            recordId: priorPublished.id,
            recordType: 'version',
            versionNo: priorPublished.version_no,
            toStatus: 'superseded',
            reasonCode: REASON_CODES.superseded,
          },
        });
      }

      const published = await this.repo.updateVersionState(tx, versionId, expectedVersion, {
        state: 'published',
        validationPassed: true,
        by: actor,
      });
      if (published === null) throw versionConflict(ctx.correlationId);

      const freshArtifact = await this.repo.getArtifact(tx, prepared.artifact.id);
      if (freshArtifact !== null) {
        await this.repo.updateArtifact(tx, freshArtifact.id, freshArtifact.version, {
          name: freshArtifact.name,
          description: freshArtifact.description,
          status: freshArtifact.status,
          latestVersion: freshArtifact.latest_version,
          publishedVersion: prepared.version.version_no,
          by: actor,
        });
      }

      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        artifactVersionId: versionId,
        kind: 'approved',
        requestedBy: prepared.requestedBy,
        decidedBy: actor,
        reason: null,
        reasonCode: REASON_CODES.published,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'version',
        targetId: versionId,
        fromStatus: 'review_pending',
        toStatus: 'published',
        reason: null,
        reasonCode: REASON_CODES.published,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M31_AUDIT_CODES.bindingCreated,
        entityType: 'studio_binding',
        entityId: versionId,
        detail: { targetEngine: engine },
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M31_AUDIT_CODES.artifactPublished,
        entityType: 'studio_artifact_version',
        entityId: versionId,
        detail: {
          artifactId: prepared.artifact.id,
          versionNo: prepared.version.version_no,
          targetEngine: engine,
        },
      });
      await this.emitter.publishStudio(tx, 'ArtifactPublished', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: versionId,
          recordType: 'version',
          artifactKind: prepared.artifact.kind,
          artifactKey: prepared.artifact.artifact_key,
          versionNo: prepared.version.version_no,
          targetEngine: engine,
          toStatus: 'published',
          reasonCode: REASON_CODES.published,
        },
      });
      return { version: published, binding };
    });
  }

  /** Reject a version in review (review_pending -> rejected). SoD applies — the rejecter cannot be the requester. */
  async rejectReview(
    ctx: RequestContext,
    actor: string | null,
    versionId: string,
    expectedVersion: number,
    reason: string | null = null,
  ): Promise<ArtifactVersionRow> {
    await this.authz.require(ctx, M31_PERMISSIONS.artifactPublish);
    return this.db.withTenant(ctx, async (tx) => {
      const version = await this.repo.getVersion(tx, versionId);
      if (version === null) throw badRequest('unknown version.', ctx.correlationId);
      if (version.state !== 'review_pending')
        throw badRequest('only a version in review can be rejected.', ctx.correlationId);
      const request = await this.repo.findOpenReviewRequest(tx, versionId);
      const sod = evaluateSodGate(request?.requested_by ?? '', actor);
      if (!sod.allowed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M31_AUDIT_CODES.sodBlocked,
          entityType: 'studio_artifact_version',
          entityId: versionId,
          detail: { reasonCode: sod.reasonCode },
        });
        throw governanceForbidden(sod.reasonCode, ctx.correlationId);
      }
      const moved = await this.repo.updateVersionState(tx, versionId, expectedVersion, {
        state: 'rejected',
        validationPassed: version.validation_passed,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        artifactVersionId: versionId,
        kind: 'rejected',
        requestedBy: request?.requested_by ?? '',
        decidedBy: actor,
        reason,
        reasonCode: REASON_CODES.rejected,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M31_AUDIT_CODES.reviewRejected,
        entityType: 'studio_artifact_version',
        entityId: versionId,
        detail: { artifactId: version.artifact_id },
      });
      return moved;
    });
  }

  /** Archive an artifact (active -> archived). Privileged. */
  async archiveArtifact(
    ctx: RequestContext,
    actor: string | null,
    artifactId: string,
    expectedVersion: number,
  ): Promise<ArtifactRow> {
    await this.authz.require(ctx, M31_PERMISSIONS.artifactArchive);
    return this.db.withTenant(ctx, async (tx) => {
      const artifact = await this.repo.getArtifact(tx, artifactId);
      if (artifact === null) throw badRequest('unknown artifact.', ctx.correlationId);
      await this.authorizeScope(ctx, artifact.scope);
      const updated = await this.repo.updateArtifact(tx, artifactId, expectedVersion, {
        name: artifact.name,
        description: artifact.description,
        status: 'archived',
        latestVersion: artifact.latest_version,
        publishedVersion: artifact.published_version,
        by: actor,
      });
      if (updated === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'artifact',
        targetId: artifactId,
        fromStatus: artifact.status,
        toStatus: 'archived',
        reason: null,
        reasonCode: REASON_CODES.archived,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M31_AUDIT_CODES.artifactArchived,
        entityType: 'studio_artifact',
        entityId: artifactId,
        detail: {},
      });
      await this.emitter.publishStudio(tx, 'ArtifactArchived', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: artifactId,
          recordType: 'artifact',
          toStatus: 'archived',
          reasonCode: REASON_CODES.archived,
        },
      });
      return updated;
    });
  }

  /** Declare a design dependency (on another artifact, or an OPAQUE m33 integration capability reference). */
  async addDependency(
    ctx: RequestContext,
    actor: string | null,
    versionId: string,
    dep: {
      dependsOnArtifactId?: string | null;
      dependsOnKind?: string | null;
      requiredMinVersion?: number | null;
      capabilityRef?: string | null;
    },
  ): Promise<void> {
    await this.authz.require(ctx, M31_PERMISSIONS.artifactAuthor);
    if ((dep.dependsOnArtifactId ?? null) === null && (dep.capabilityRef ?? null) === null)
      throw badRequest('a dependency needs an artifact or a capability reference.', ctx.correlationId);
    await this.db.withTenant(ctx, async (tx) => {
      const version = await this.repo.getVersion(tx, versionId);
      if (version === null) throw badRequest('unknown version.', ctx.correlationId);
      await this.repo.insertDependency(tx, {
        tenantId: ctx.tenantId,
        artifactVersionId: versionId,
        dependsOnArtifactId: dep.dependsOnArtifactId ?? null,
        dependsOnKind: dep.dependsOnKind ?? null,
        requiredMinVersion: dep.requiredMinVersion ?? null,
        capabilityRef: dep.capabilityRef ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
    });
  }

  async getArtifact(ctx: RequestContext, artifactId: string): Promise<ArtifactRow | null> {
    await this.authz.require(ctx, M31_PERMISSIONS.artifactRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getArtifact(tx, artifactId));
  }
  async listVersions(ctx: RequestContext, artifactId: string): Promise<ArtifactVersionRow[]> {
    await this.authz.require(ctx, M31_PERMISSIONS.artifactRead);
    return this.db.withTenant(ctx, (tx) => this.repo.listVersions(tx, artifactId));
  }
}
