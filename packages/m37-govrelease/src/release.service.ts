/**
 * ReleaseService — the governed release/promotion pipeline: request a release of an artifact to an environment (the artifact
 * must be RELEASABLE in its owning module, checked through the fail-closed ArtifactRegistryPort — m37 reads no owning-module
 * table and executes no release), declare required QA GATES, record append-only QA CHECK results, VALIDATE (all required
 * gates passed — the evidence gate), send for review, and APPROVE (a controlled action — maker-checker/SoD over a passing QA
 * gate; a released record is immutable via DB trigger; a prior released for the same artifact/environment is superseded).
 * A release signature/attestation is an opaque m30 secretref: pointer only. Every mutation authorizes a `govrelease.*`
 * permission (default deny) and is audited through m03 in the same transaction. AI never approves or releases.
 */
import { createHash } from 'node:crypto';
import type { Authz, Db, RequestContext } from '@finapp/kernel';
import { M37_PERMISSIONS } from './permissions.ts';
import { M37_AUDIT_CODES } from './audit-codes.ts';
import { badRequest, governanceForbidden, versionConflict } from './errors.ts';
import {
  isScope,
  isPlatformScope,
  isCheckStatus,
  validateRelease,
  validateSignatureRef,
  evaluateQaGate,
  evaluateApprovalGate,
  evaluateSodGate,
  clampPage,
  REASON_CODES,
} from './domain.ts';
import { GovreleaseRepository, type ReleaseRow, type GateRow, type EvidenceRow } from './repository.ts';
import type { M37Emitter } from './emit.ts';
import type { ArtifactRegistryPort } from './ports.ts';

export function contentHashOf(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex')}`;
}

export class ReleaseService {
  private readonly db: Db;
  private readonly authz: Authz;
  private readonly emitter: M37Emitter;
  private readonly registry: ArtifactRegistryPort;
  private readonly repo: GovreleaseRepository;
  constructor(
    db: Db,
    authz: Authz,
    emitter: M37Emitter,
    registry: ArtifactRegistryPort,
    repo: GovreleaseRepository = new GovreleaseRepository(),
  ) {
    this.db = db;
    this.authz = authz;
    this.emitter = emitter;
    this.registry = registry;
    this.repo = repo;
  }
  private async authorizeScope(ctx: RequestContext, scope: string): Promise<void> {
    if (isPlatformScope(scope)) await this.authz.require(ctx, M37_PERMISSIONS.administer);
  }

  /** Request a release of an artifact to an environment. The artifact must be RELEASABLE in its owning module (fail closed). */
  async requestRelease(
    ctx: RequestContext,
    actor: string | null,
    input: {
      scope?: string;
      artifactId: string;
      environmentId: string;
      releaseKey: string;
      fromVersion?: number | null;
      toVersion: number;
      idempotencyKey?: string | null;
    },
  ): Promise<ReleaseRow> {
    await this.authz.require(ctx, M37_PERMISSIONS.releaseAuthor);
    const scope = input.scope ?? 'tenant';
    if (!isScope(scope)) throw badRequest('unknown scope.', ctx.correlationId);
    await this.authorizeScope(ctx, scope);
    const outcome = validateRelease({
      releaseKey: input.releaseKey,
      artifactRef: input.artifactId,
      environmentRef: input.environmentId,
      toVersion: input.toVersion,
    });
    if (!outcome.passed)
      throw badRequest(
        'a valid release key, artifact, environment and version are required.',
        ctx.correlationId,
      );

    const prepared = await this.db.withTenant(ctx, async (tx) => {
      if (input.idempotencyKey != null && input.idempotencyKey !== '') {
        const existing = await this.repo.findReleaseByIdempotencyKey(tx, input.idempotencyKey);
        if (existing !== null) return { existing };
      }
      const artifact = await this.repo.getArtifact(tx, input.artifactId);
      if (artifact === null) throw badRequest('unknown artifact.', ctx.correlationId);
      if (artifact.status !== 'active')
        throw governanceForbidden(REASON_CODES.artifactNotActive, ctx.correlationId);
      const env = await this.repo.getEnvironment(tx, input.environmentId);
      if (env === null) throw badRequest('unknown environment.', ctx.correlationId);
      return { artifact };
    });
    if ('existing' in prepared) return prepared.existing;

    // The artifact must be RELEASABLE in its owning module (m33/m34/...) — fail closed.
    const avail = await this.registry.isArtifactReleasable(
      ctx,
      prepared.artifact.artifact_kind,
      prepared.artifact.artifact_ref,
    );
    if (!avail.available) {
      await this.db.withTenant(ctx, (tx) =>
        this.emitter.recordAudit(tx, ctx, {
          code: M37_AUDIT_CODES.artifactUnavailable,
          entityType: 'govrelease_artifact',
          entityId: input.artifactId,
          detail: { reasonCode: REASON_CODES.artifactUnavailable },
        }),
      );
      throw governanceForbidden(REASON_CODES.artifactUnavailable, ctx.correlationId);
    }

    const contentHash = contentHashOf({
      artifactId: input.artifactId,
      environmentId: input.environmentId,
      releaseKey: input.releaseKey,
      toVersion: input.toVersion,
    });
    return this.db.withTenant(ctx, async (tx) => {
      const release = await this.repo.insertRelease(tx, {
        tenantId: ctx.tenantId,
        artifactId: input.artifactId,
        environmentId: input.environmentId,
        scope,
        releaseKey: input.releaseKey,
        fromVersion: input.fromVersion ?? null,
        toVersion: input.toVersion,
        requestedBy: actor,
        contentHash,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'release',
        targetId: release.id,
        fromStatus: null,
        toStatus: 'draft',
        reason: null,
        reasonCode: REASON_CODES.releaseRequested,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M37_AUDIT_CODES.releaseRequested,
        entityType: 'govrelease_release',
        entityId: release.id,
        detail: { releaseKey: input.releaseKey, artifactKind: prepared.artifact.artifact_kind },
      });
      await this.emitter.publishGovrelease(tx, 'ReleaseRequested', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: release.id,
          recordType: 'release',
          releaseKey: input.releaseKey,
          toStatus: 'draft',
          reasonCode: REASON_CODES.releaseRequested,
        },
      });
      return release;
    });
  }

  /** Declare a required QA gate for a release (before validation). */
  async addGate(
    ctx: RequestContext,
    actor: string | null,
    releaseId: string,
    input: { gateKey: string; kind?: string; required?: boolean },
  ): Promise<GateRow> {
    await this.authz.require(ctx, M37_PERMISSIONS.releaseAuthor);
    if (input.gateKey.trim() === '') throw badRequest('a gate key is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const release = await this.repo.getRelease(tx, releaseId);
      if (release === null) throw badRequest('unknown release.', ctx.correlationId);
      if (release.state !== 'draft' && release.state !== 'qa_pending')
        throw badRequest('gates can only be added before validation.', ctx.correlationId);
      const gate = await this.repo.insertGate(tx, {
        tenantId: ctx.tenantId,
        releaseId,
        gateKey: input.gateKey,
        kind: input.kind ?? 'quality',
        required: input.required ?? true,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M37_AUDIT_CODES.gateAdded,
        entityType: 'govrelease_gate',
        entityId: gate.id,
        detail: { releaseId, gateKey: input.gateKey, required: gate.required },
      });
      return gate;
    });
  }

  /** Record an append-only QA check result for a gate (passed/failed) and update the gate status. */
  async recordCheck(
    ctx: RequestContext,
    actor: string | null,
    gateId: string,
    input: { status: string; checkKind?: string; evidenceRef?: string | null; detail?: string | null },
  ): Promise<GateRow> {
    await this.authz.require(ctx, M37_PERMISSIONS.gateManage);
    if (!isCheckStatus(input.status))
      throw badRequest('a check status must be passed or failed.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const gate = await this.repo.getGate(tx, gateId);
      if (gate === null) throw badRequest('unknown gate.', ctx.correlationId);
      await this.repo.insertCheck(tx, {
        tenantId: ctx.tenantId,
        gateId,
        releaseId: gate.release_id,
        checkKind: input.checkKind ?? gate.kind,
        status: input.status,
        evidenceRef: input.evidenceRef ?? null,
        detail: input.detail ?? null,
        reasonCode: input.status === 'passed' ? REASON_CODES.checkRecorded : REASON_CODES.qaFailed,
        correlationId: ctx.correlationId,
        by: actor,
      });
      const moved = await this.repo.updateGateStatus(tx, gateId, gate.version, {
        status: input.status,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      // draft -> qa_pending once checks begin.
      const release = await this.repo.getRelease(tx, gate.release_id);
      if (release !== null && release.state === 'draft') {
        await this.repo.updateReleaseState(tx, release.id, release.version, {
          state: 'qa_pending',
          qaPassed: false,
          by: actor,
        });
      }
      await this.emitter.recordAudit(tx, ctx, {
        code: M37_AUDIT_CODES.checkRecorded,
        entityType: 'govrelease_gate',
        entityId: gateId,
        detail: { status: input.status },
      });
      return moved;
    });
  }

  /** Validate the release — the QA evidence gate: every REQUIRED gate must be passed/waived. */
  async validateReleaseQa(
    ctx: RequestContext,
    actor: string | null,
    releaseId: string,
    expectedVersion: number,
  ): Promise<{ passed: boolean; reasonCode: string }> {
    await this.authz.require(ctx, M37_PERMISSIONS.releaseAuthor);
    return this.db.withTenant(ctx, async (tx) => {
      const release = await this.repo.getRelease(tx, releaseId);
      if (release === null) throw badRequest('unknown release.', ctx.correlationId);
      if (release.state !== 'qa_pending' && release.state !== 'draft')
        throw badRequest('only a release in QA can be validated.', ctx.correlationId);
      const gates = await this.repo.listGatesForRelease(tx, releaseId);
      const gate = evaluateQaGate(gates.map((g) => ({ required: g.required, status: g.status })));
      if (gate.allowed) {
        const moved = await this.repo.updateReleaseState(tx, releaseId, expectedVersion, {
          state: 'qa_passed',
          qaPassed: true,
          by: actor,
        });
        if (moved === null) throw versionConflict(ctx.correlationId);
        await this.emitter.recordAudit(tx, ctx, {
          code: M37_AUDIT_CODES.qaPassed,
          entityType: 'govrelease_release',
          entityId: releaseId,
          detail: { gateCount: gates.length },
        });
        await this.emitter.publishGovrelease(tx, 'QaPassed', {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          ...(actor !== null ? { actor } : {}),
          payload: {
            recordId: releaseId,
            recordType: 'release',
            toStatus: 'qa_passed',
            reasonCode: REASON_CODES.qaPassed,
          },
        });
      } else {
        await this.emitter.recordAudit(tx, ctx, {
          code: M37_AUDIT_CODES.qaBlocked,
          entityType: 'govrelease_release',
          entityId: releaseId,
          detail: { reasonCode: gate.reasonCode },
        });
      }
      return { passed: gate.allowed, reasonCode: gate.reasonCode };
    });
  }

  async requestReview(
    ctx: RequestContext,
    actor: string | null,
    releaseId: string,
    expectedVersion: number,
  ): Promise<ReleaseRow> {
    await this.authz.require(ctx, M37_PERMISSIONS.releaseAuthor);
    if (actor === null || actor.trim() === '')
      throw badRequest('an identified requester is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const release = await this.repo.getRelease(tx, releaseId);
      if (release === null) throw badRequest('unknown release.', ctx.correlationId);
      if (release.state !== 'qa_passed')
        throw badRequest('only a QA-passed release can be sent for review.', ctx.correlationId);
      const moved = await this.repo.updateReleaseState(tx, releaseId, expectedVersion, {
        state: 'review_pending',
        qaPassed: true,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'release',
        targetId: releaseId,
        kind: 'requested',
        requestedBy: actor,
        decidedBy: null,
        reason: null,
        reasonCode: REASON_CODES.reviewRequested,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M37_AUDIT_CODES.reviewRequested,
        entityType: 'govrelease_release',
        entityId: releaseId,
        detail: { releaseKey: release.release_key },
      });
      return moved;
    });
  }

  /** Approve + promote a release to RELEASED — a controlled action (maker-checker/SoD over a passing QA gate). A prior
   * released for the same artifact/environment is superseded (rolled_back). AI never approves. */
  async approveRelease(
    ctx: RequestContext,
    actor: string | null,
    releaseId: string,
    expectedVersion: number,
  ): Promise<ReleaseRow> {
    await this.authz.require(ctx, M37_PERMISSIONS.releaseApprove);
    return this.db.withTenant(ctx, async (tx) => {
      const release = await this.repo.getRelease(tx, releaseId);
      if (release === null) throw badRequest('unknown release.', ctx.correlationId);
      await this.authorizeScope(ctx, release.scope);
      if (release.state !== 'review_pending')
        throw badRequest('only a release in review can be approved.', ctx.correlationId);
      const request = await this.repo.findOpenReviewRequest(tx, 'release', releaseId);
      const gate = evaluateApprovalGate({
        qaPassed: release.qa_passed,
        requestedBy: request?.requested_by ?? '',
        approver: actor,
      });
      if (!gate.allowed) {
        const code =
          gate.reasonCode === REASON_CODES.qaNotPassed
            ? M37_AUDIT_CODES.qaBlocked
            : M37_AUDIT_CODES.sodBlocked;
        await this.emitter.recordAudit(tx, ctx, {
          code,
          entityType: 'govrelease_release',
          entityId: releaseId,
          detail: { reasonCode: gate.reasonCode },
        });
        throw governanceForbidden(gate.reasonCode, ctx.correlationId);
      }
      // Supersede a prior released for the same artifact/environment (one released per pair).
      const prior = await this.repo.getReleasedForArtifactEnv(
        tx,
        release.artifact_id,
        release.environment_id,
      );
      if (prior !== null && prior.id !== releaseId) {
        const superseded = await this.repo.updateReleaseState(tx, prior.id, prior.version, {
          state: 'rolled_back',
          qaPassed: prior.qa_passed,
          by: actor,
        });
        if (superseded === null) throw versionConflict(ctx.correlationId);
        await this.emitter.recordAudit(tx, ctx, {
          code: M37_AUDIT_CODES.releaseRolledBack,
          entityType: 'govrelease_release',
          entityId: prior.id,
          detail: { reasonCode: 'superseded' },
        });
      }
      const released = await this.repo.updateReleaseState(tx, releaseId, expectedVersion, {
        state: 'released',
        qaPassed: true,
        by: actor,
      });
      if (released === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'release',
        targetId: releaseId,
        kind: 'approved',
        requestedBy: request?.requested_by ?? '',
        decidedBy: actor,
        reason: null,
        reasonCode: REASON_CODES.releaseApproved,
        correlationId: ctx.correlationId,
      });
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'release',
        targetId: releaseId,
        fromStatus: 'review_pending',
        toStatus: 'released',
        reason: null,
        reasonCode: REASON_CODES.releaseApproved,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M37_AUDIT_CODES.releaseApproved,
        entityType: 'govrelease_release',
        entityId: releaseId,
        detail: { releaseKey: release.release_key, toVersion: release.to_version },
      });
      await this.emitter.publishGovrelease(tx, 'ReleaseReleased', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: releaseId,
          recordType: 'release',
          releaseKey: release.release_key,
          version: release.to_version,
          toStatus: 'released',
          reasonCode: REASON_CODES.releaseApproved,
        },
      });
      return released;
    });
  }

  async rejectReview(
    ctx: RequestContext,
    actor: string | null,
    releaseId: string,
    expectedVersion: number,
    reason: string | null = null,
  ): Promise<ReleaseRow> {
    await this.authz.require(ctx, M37_PERMISSIONS.releaseApprove);
    return this.db.withTenant(ctx, async (tx) => {
      const release = await this.repo.getRelease(tx, releaseId);
      if (release === null) throw badRequest('unknown release.', ctx.correlationId);
      if (release.state !== 'review_pending')
        throw badRequest('only a release in review can be rejected.', ctx.correlationId);
      const request = await this.repo.findOpenReviewRequest(tx, 'release', releaseId);
      const sod = evaluateSodGate(request?.requested_by ?? '', actor);
      if (!sod.allowed) {
        await this.emitter.recordAudit(tx, ctx, {
          code: M37_AUDIT_CODES.sodBlocked,
          entityType: 'govrelease_release',
          entityId: releaseId,
          detail: { reasonCode: sod.reasonCode },
        });
        throw governanceForbidden(sod.reasonCode, ctx.correlationId);
      }
      const moved = await this.repo.updateReleaseState(tx, releaseId, expectedVersion, {
        state: 'rejected',
        qaPassed: release.qa_passed,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertReview(tx, {
        tenantId: ctx.tenantId,
        targetType: 'release',
        targetId: releaseId,
        kind: 'rejected',
        requestedBy: request?.requested_by ?? '',
        decidedBy: actor,
        reason,
        reasonCode: REASON_CODES.releaseRejected,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M37_AUDIT_CODES.releaseRejected,
        entityType: 'govrelease_release',
        entityId: releaseId,
        detail: {},
      });
      return moved;
    });
  }

  /** Roll back a released record (a controlled execute action). */
  async rollbackRelease(ctx: RequestContext, actor: string | null, releaseId: string): Promise<ReleaseRow> {
    await this.authz.require(ctx, M37_PERMISSIONS.releaseExecute);
    return this.db.withTenant(ctx, async (tx) => {
      const release = await this.repo.getRelease(tx, releaseId);
      if (release === null) throw badRequest('unknown release.', ctx.correlationId);
      if (release.state !== 'released')
        throw badRequest('only a released record can be rolled back.', ctx.correlationId);
      const moved = await this.repo.updateReleaseState(tx, releaseId, release.version, {
        state: 'rolled_back',
        qaPassed: release.qa_passed,
        by: actor,
      });
      if (moved === null) throw versionConflict(ctx.correlationId);
      await this.repo.insertHistory(tx, {
        tenantId: ctx.tenantId,
        targetType: 'release',
        targetId: releaseId,
        fromStatus: 'released',
        toStatus: 'rolled_back',
        reason: null,
        reasonCode: REASON_CODES.releaseRolledBack,
        by: actor,
        correlationId: ctx.correlationId,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M37_AUDIT_CODES.releaseRolledBack,
        entityType: 'govrelease_release',
        entityId: releaseId,
        detail: {},
      });
      await this.emitter.publishGovrelease(tx, 'ReleaseRolledBack', {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        ...(actor !== null ? { actor } : {}),
        payload: {
          recordId: releaseId,
          recordType: 'release',
          toStatus: 'rolled_back',
          reasonCode: REASON_CODES.releaseRolledBack,
        },
      });
      return moved;
    });
  }

  /** Attach append-only release evidence (an opaque report reference + an OPTIONAL signature as an opaque secretref). */
  async addEvidence(
    ctx: RequestContext,
    actor: string | null,
    releaseId: string,
    input: { evidenceKind: string; evidenceRef?: string | null; signatureRef?: string | null },
  ): Promise<EvidenceRow> {
    await this.authz.require(ctx, M37_PERMISSIONS.releaseAuthor);
    const findings = validateSignatureRef(input.signatureRef ?? null);
    if (findings.length > 0)
      throw governanceForbidden(findings[0]?.code ?? REASON_CODES.invalidSecretReference, ctx.correlationId);
    if (input.evidenceKind.trim() === '')
      throw badRequest('an evidence kind is required.', ctx.correlationId);
    return this.db.withTenant(ctx, async (tx) => {
      const release = await this.repo.getRelease(tx, releaseId);
      if (release === null) throw badRequest('unknown release.', ctx.correlationId);
      const evidence = await this.repo.insertEvidence(tx, {
        tenantId: ctx.tenantId,
        releaseId,
        evidenceKind: input.evidenceKind,
        evidenceRef: input.evidenceRef ?? null,
        signatureRef: input.signatureRef ?? null,
        reasonCode: REASON_CODES.evidenceAdded,
        correlationId: ctx.correlationId,
        by: actor,
      });
      await this.emitter.recordAudit(tx, ctx, {
        code: M37_AUDIT_CODES.evidenceAdded,
        entityType: 'govrelease_evidence',
        entityId: evidence.id,
        detail: { releaseId, evidenceKind: input.evidenceKind },
      });
      return evidence;
    });
  }

  async getRelease(ctx: RequestContext, id: string): Promise<ReleaseRow | null> {
    await this.authz.require(ctx, M37_PERMISSIONS.releaseRead);
    return this.db.withTenant(ctx, (tx) => this.repo.getRelease(tx, id));
  }
  async listReleases(ctx: RequestContext, page?: { limit?: number; offset?: number }): Promise<ReleaseRow[]> {
    await this.authz.require(ctx, M37_PERMISSIONS.releaseRead);
    const { limit, offset } = clampPage(page?.limit, page?.offset);
    return this.db.withTenant(ctx, (tx) => this.repo.listReleases(tx, limit, offset));
  }
}
