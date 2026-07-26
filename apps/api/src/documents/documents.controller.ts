import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { DocumentService, M09_AUDIT_CODES, M09_PERMISSIONS } from '@finapp/m09-docs';
import { ActorContextFactory } from '@finapp/m02-identity';
import {
  optionalLimit,
  optionalOffset,
  requireString,
  requireTenantScope,
  requireVersion,
} from '../identity/http.ts';
import { documentView, versionView, scanView } from './views.ts';

/**
 * Documents + immutable versions, under `/api/v1/documents`. Create/metadata/classification/lifecycle + the
 * server-verified upload flow (initiate → complete) + activate + safe metadata search + server-mediated
 * download. Idempotency by the `idempotency-key` header. Version views redact the internal storage reference.
 */
interface CreateBody {
  code?: unknown;
  title?: unknown;
  description?: unknown;
  documentType?: unknown;
  classification?: unknown;
  sensitivity?: unknown;
  ownerId?: unknown;
  custodianId?: unknown;
  metadata?: unknown;
  effectiveAt?: unknown;
  expiresAt?: unknown;
  originModule?: unknown;
  originEntityType?: unknown;
  originEntityId?: unknown;
}
interface MetadataBody {
  expectedVersion?: unknown;
  title?: unknown;
  description?: unknown;
  metadata?: unknown;
}
interface ClassificationBody {
  expectedVersion?: unknown;
  classification?: unknown;
}
interface InitiateBody {
  filename?: unknown;
  mediaType?: unknown;
  changeSummary?: unknown;
  source?: unknown;
}
interface CompleteBody {
  expectedVersion?: unknown;
  contentHash?: unknown;
  byteSize?: unknown;
}
interface ActionBody {
  expectedVersion?: unknown;
  reason?: unknown;
}

@Controller('documents')
export class DocumentsController {
  private readonly service: DocumentService;
  private readonly actors: ActorContextFactory;
  constructor(service: DocumentService, actors: ActorContextFactory) {
    this.service = service;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, reason: string) {
    return this.actors.forRequest(h, reason).then(requireTenantScope);
  }

  @Endpoint({
    permission: M09_PERMISSIONS.documentCreate,
    auditCode: M09_AUDIT_CODES.documentCreated,
    description: 'Create a document record.',
  })
  @Post('documents')
  async create(@Body() b: CreateBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'create document (m09)');
    const cid = s.correlationId;
    const idem = h['idempotency-key'];
    return documentView(
      await this.service.create(s.ctx, s.actor.identityId, {
        code: requireString(b.code, 'code', cid),
        title: requireString(b.title, 'title', cid),
        documentType: requireString(b.documentType, 'documentType', cid),
        ...(typeof b.description === 'string' ? { description: b.description } : {}),
        ...(typeof b.classification === 'string' ? { classification: b.classification } : {}),
        ...(typeof b.sensitivity === 'string' ? { sensitivity: b.sensitivity } : {}),
        ...(typeof b.ownerId === 'string' ? { ownerId: b.ownerId } : {}),
        ...(typeof b.custodianId === 'string' ? { custodianId: b.custodianId } : {}),
        ...(typeof b.metadata === 'object' && b.metadata !== null
          ? { metadata: b.metadata as Record<string, unknown> }
          : {}),
        ...(typeof b.effectiveAt === 'string' ? { effectiveAt: b.effectiveAt } : {}),
        ...(typeof b.expiresAt === 'string' ? { expiresAt: b.expiresAt } : {}),
        ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
        ...(typeof b.originModule === 'string' ? { originModule: b.originModule } : {}),
        ...(typeof b.originEntityType === 'string' ? { originEntityType: b.originEntityType } : {}),
        ...(typeof b.originEntityId === 'string' ? { originEntityId: b.originEntityId } : {}),
      }),
    );
  }

  @Endpoint({
    permission: M09_PERMISSIONS.documentUpdateMetadata,
    auditCode: M09_AUDIT_CODES.metadataUpdated,
    description: 'Update document metadata.',
  })
  @Post('documents/:id/metadata')
  async updateMetadata(
    @Param('id') id: string,
    @Body() b: MetadataBody,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'update document metadata (m09)');
    return documentView(
      await this.service.updateMetadata(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b.expectedVersion, s.correlationId),
        title: requireString(b.title, 'title', s.correlationId),
        ...(typeof b.description === 'string' ? { description: b.description } : {}),
        ...(typeof b.metadata === 'object' && b.metadata !== null
          ? { metadata: b.metadata as Record<string, unknown> }
          : {}),
      }),
    );
  }

  @Endpoint({
    permission: M09_PERMISSIONS.documentUpdateMetadata,
    auditCode: M09_AUDIT_CODES.classificationChanged,
    description: 'Change document classification (downgrade needs platform authority).',
  })
  @Post('documents/:id/classification')
  async changeClassification(
    @Param('id') id: string,
    @Body() b: ClassificationBody,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'change document classification (m09)');
    return documentView(
      await this.service.changeClassification(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b.expectedVersion, s.correlationId),
        classification: requireString(b.classification, 'classification', s.correlationId),
      }),
    );
  }

  @Endpoint({
    permission: M09_PERMISSIONS.documentUploadVersion,
    auditCode: M09_AUDIT_CODES.versionInitiated,
    description: 'Initiate an upload (creates a pending version).',
  })
  @Post('documents/:id/versions/initiate')
  async initiate(@Param('id') id: string, @Body() b: InitiateBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'initiate upload (m09)');
    const idem = h['idempotency-key'];
    const r = await this.service.initiateUpload(s.ctx, s.actor.identityId, id, {
      filename: requireString(b.filename, 'filename', s.correlationId),
      mediaType: requireString(b.mediaType, 'mediaType', s.correlationId),
      ...(typeof b.changeSummary === 'string' ? { changeSummary: b.changeSummary } : {}),
      ...(typeof b.source === 'string' ? { source: b.source } : {}),
      ...(typeof idem === 'string' && idem !== '' ? { idempotencyKey: idem } : {}),
    });
    // The raw storage reference is NOT returned; a real adapter returns a short-lived upload URL. Framework Only.
    return { version: versionView(r.version), scanRequired: r.scanRequired };
  }

  @Endpoint({
    permission: M09_PERMISSIONS.documentUploadVersion,
    auditCode: M09_AUDIT_CODES.versionCompleted,
    description: 'Complete an upload (server verifies the stored object).',
  })
  @Post('versions/:id/complete')
  async complete(@Param('id') id: string, @Body() b: CompleteBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'complete upload (m09)');
    const r = await this.service.completeUpload(s.ctx, s.actor.identityId, id, {
      expectedVersion: requireVersion(b.expectedVersion, s.correlationId),
      contentHash: requireString(b.contentHash, 'contentHash', s.correlationId),
      byteSize: typeof b.byteSize === 'number' ? b.byteSize : -1,
    });
    return { version: versionView(r.version), scan: scanView(r.scan) };
  }

  @Endpoint({
    permission: M09_PERMISSIONS.documentActivate,
    auditCode: M09_AUDIT_CODES.versionActivated,
    description: 'Activate a committed version.',
  })
  @Post('versions/:id/activate')
  async activate(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'activate version (m09)');
    return versionView(
      await this.service.activateVersion(s.ctx, s.actor.identityId, id, {
        expectedVersion: requireVersion(b.expectedVersion, s.correlationId),
      }),
    );
  }

  @Endpoint({
    permission: M09_PERMISSIONS.documentArchive,
    auditCode: M09_AUDIT_CODES.documentArchived,
    description: 'Archive a document.',
  })
  @Post('documents/:id/archive')
  async archive(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'archive document (m09)');
    return documentView(await this.service.archive(s.ctx, s.actor.identityId, id));
  }

  @Endpoint({
    permission: M09_PERMISSIONS.documentWithdraw,
    auditCode: M09_AUDIT_CODES.documentWithdrawn,
    description: 'Withdraw a document.',
  })
  @Post('documents/:id/withdraw')
  async withdraw(@Param('id') id: string, @Body() b: ActionBody, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'withdraw document (m09)');
    return documentView(
      await this.service.withdraw(
        s.ctx,
        s.actor.identityId,
        id,
        typeof b.reason === 'string' ? b.reason : null,
      ),
    );
  }

  @Endpoint({
    permission: M09_PERMISSIONS.documentDownload,
    auditCode: M09_AUDIT_CODES.documentDownloaded,
    description: 'Download a version (server-mediated).',
  })
  @Post('versions/:id/download')
  async download(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'download version (m09)');
    const r = await this.service.authorizeDownload(s.ctx, s.actor.identityId, id);
    return { version: versionView(r.version), contentBase64: Buffer.from(r.bytes).toString('base64') };
  }

  // --- reads ------------------------------------------------------------------------------------
  @Get('documents/:id')
  async get(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'get document (m09)');
    return documentView(await this.service.get(s.ctx, id));
  }
  @Get('documents/:id/versions')
  async listVersions(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list versions (m09)');
    return { versions: (await this.service.listVersions(s.ctx, id)).map(versionView) };
  }
  @Get('versions/:id/scans')
  async scans(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'list scans (m09)');
    return { scans: (await this.service.scanResults(s.ctx, id)).map(scanView) };
  }
  @Get('documents')
  async search(
    @Headers() h: Record<string, string>,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('classification') classification?: string,
    @Query('code') code?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const s = await this.scoped(h, 'search documents (m09)');
    const rows = await this.service.search(s.ctx, {
      ...(typeof type === 'string' ? { documentType: type } : {}),
      ...(typeof status === 'string' ? { status } : {}),
      ...(typeof classification === 'string' ? { classification } : {}),
      ...(typeof code === 'string' ? { codeLike: code } : {}),
      limit: optionalLimit(limit, s.correlationId).limit ?? 50,
      offset: optionalOffset(offset, s.correlationId).offset ?? 0,
    });
    return { documents: rows.map(documentView) };
  }
}
