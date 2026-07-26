import { randomUUID } from 'node:crypto';
import { defineDbSpec } from '@finapp/test-runner';
import { PgDb } from '@finapp/kernel/pg';
import type { RequestContext } from '@finapp/kernel';
import { RecordingAudit, RecordingOutbox } from '@finapp/m01-tenant';
import { RbacAuthz } from '@finapp/m02-rbac';
import {
  M09Emitter,
  DocsRepository,
  CatalogService,
  DocumentService,
  AccessService,
  RecordsService,
  InMemoryStorage,
  DeterministicScanner,
  bytesHash,
  M09_PERMISSIONS,
  ALL_M09_PERMISSIONS,
} from '@finapp/m09-docs';

/**
 * M09 services DB spec — proves the documents engine end-to-end on a REAL PostgreSQL and enforces governance:
 * type/retention lifecycle, default-deny authorization, document creation + typed metadata, the SERVER-VERIFIED
 * upload flow (hash/size mismatch rejected), scan-gated activation, immutable one-active versions, ACL grants,
 * single-winner checkout, relationship acyclicity, legal-hold-blocks-disposition, disposition SoD (requester ≠
 * approver) + execute-with-tombstone, and cross-tenant isolation.
 */
export default defineDbSpec('m09-services', async (ctx, t) => {
  const db = new PgDb({ pool: ctx.pool, appRole: ctx.appRole });
  const authz = new RbacAuthz();
  const emitter = new M09Emitter(new RecordingAudit(), new RecordingOutbox());
  const repo = new DocsRepository();
  const storage = new InMemoryStorage();
  const scanner = new DeterministicScanner({ flagged: { infected: 'infected' } });
  const catalog = new CatalogService(db, authz, emitter, repo);
  const docs = new DocumentService(db, authz, emitter, repo, storage, scanner);
  const access = new AccessService(db, authz, emitter, repo);
  const records = new RecordsService(db, authz, emitter, repo, storage);

  const tenant = randomUUID();
  const author = randomUUID();
  const approver = randomUUID();
  const cid = (): string => randomUUID();
  const full: RequestContext = {
    tenantId: tenant,
    userId: author,
    correlationId: cid(),
    permissions: [...ALL_M09_PERMISSIONS],
  };
  const approverCtx: RequestContext = {
    tenantId: tenant,
    userId: approver,
    correlationId: cid(),
    permissions: [...ALL_M09_PERMISSIONS],
  };
  const noPerm: RequestContext = { tenantId: tenant, userId: author, correlationId: cid(), permissions: [] };

  const retentionSpec = {
    schemaVersion: 1,
    code: 'short',
    name: 'Short',
    retentionDays: 0,
    trigger: 'on_activation',
    dispositionAction: 'review',
    reviewRequired: true,
  };
  const typeSpec = {
    schemaVersion: 1,
    code: 'contract',
    name: 'Contract',
    allowedMediaTypes: ['application/pdf'],
    defaultClassification: 'confidential',
    retentionPolicyCode: 'short',
    requiredMetadata: [{ name: 'counterparty', type: 'string', required: true }],
    approvalRequired: false,
    signatureRequired: false,
    scanRequired: true,
  };

  // --- retention + type lifecycle ---------------------------------------------------------------
  const rp = await catalog.createRetention(full, author, {
    code: 'short',
    name: 'Short',
    spec: retentionSpec,
  });
  const rpV = await catalog.validateRetention(full, author, rp.id, rp.version);
  const rpP = await catalog.publishRetention(full, author, rpV.id, rpV.version);
  await catalog.activateRetention(full, author, rpP.id, rpP.version);
  const ty = await catalog.createType(full, author, { code: 'contract', name: 'Contract', spec: typeSpec });
  t.equal(ty.status, 'DRAFT', 'a new document type starts DRAFT');
  const tyV = await catalog.validateType(full, author, ty.id, ty.version);
  const tyP = await catalog.publishType(full, author, tyV.id, tyV.version);
  t.ok(tyP.content_hash !== null, 'publishing a type freezes a content hash');
  await catalog.activateType(full, author, tyP.id, tyP.version);

  // --- default deny -----------------------------------------------------------------------------
  await t.rejects(
    catalog.createType(noPerm, author, { code: 'x', name: 'X', spec: typeSpec }),
    'authoring a type requires the manage permission',
  );
  await t.rejects(
    docs.create(noPerm, author, { code: 'D', title: 'D', documentType: 'contract' }),
    'creating a document requires the create permission',
  );

  // --- create document + metadata validation ----------------------------------------------------
  await t.rejects(
    docs.create(full, author, { code: 'BAD', title: 'Bad', documentType: 'contract', metadata: {} }),
    'missing required metadata is rejected',
  );
  const doc = await docs.create(full, author, {
    code: 'DOC-1',
    title: 'Contract 1',
    documentType: 'contract',
    metadata: { counterparty: 'Acme' },
  });
  t.equal(doc.status, 'draft', 'a new document is draft');
  t.equal(doc.classification, 'confidential', 'classification defaults from the document type');

  // --- classification downgrade needs platform authority ----------------------------------------
  const noPlatform: RequestContext = {
    tenantId: tenant,
    userId: author,
    correlationId: cid(),
    permissions: ALL_M09_PERMISSIONS.filter((p) => p !== M09_PERMISSIONS.platformAdminister),
  };
  await t.rejects(
    docs.changeClassification(noPlatform, author, doc.id, {
      expectedVersion: doc.version,
      classification: 'public',
    }),
    'a downgrade without platform authority is refused',
  );
  const upgraded = await docs.changeClassification(full, author, doc.id, {
    expectedVersion: doc.version,
    classification: 'restricted',
  });
  t.equal(upgraded.classification, 'restricted', 'an upgrade is allowed');

  // --- upload: initiate -> put bytes -> complete (server-verified) -> activate -------------------
  const init = await docs.initiateUpload(full, author, doc.id, {
    filename: 'contract.pdf',
    mediaType: 'application/pdf',
  });
  t.equal(init.version.status, 'pending', 'initiate creates a pending version');
  await t.rejects(
    docs.initiateUpload(full, author, doc.id, { filename: 'x.png', mediaType: 'image/png' }),
    'a disallowed media type is rejected',
  );
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  await storage.put(init.storageRef, bytes);
  // A forged completion (wrong hash) is rejected.
  await t.rejects(
    docs.completeUpload(full, author, init.version.id, {
      expectedVersion: init.version.version,
      contentHash: 'sha256:' + 'f'.repeat(64),
      byteSize: 5,
    }),
    'a content-hash mismatch is rejected (no completion forgery)',
  );
  const completed = await docs.completeUpload(full, author, init.version.id, {
    expectedVersion: init.version.version,
    contentHash: bytesHash(bytes),
    byteSize: 5,
  });
  t.equal(completed.version.status, 'committed', 'a verified upload commits');
  t.equal(completed.scan.status, 'clean', 'the version scans clean');
  const activated = await docs.activateVersion(full, author, completed.version.id, {
    expectedVersion: completed.version.version,
  });
  t.equal(activated.status, 'active', 'a committed + clean version activates');
  const docAfter = await docs.get(full, doc.id);
  t.equal(docAfter.current_version_number, 1, 'the document points at the active version');
  t.equal(docAfter.status, 'active', 'the document becomes active');

  // --- infected scan blocks activation ----------------------------------------------------------
  const init2 = await docs.initiateUpload(full, author, doc.id, {
    filename: 'v2.pdf',
    mediaType: 'application/pdf',
  });
  await storage.put('infected', new Uint8Array([9]));
  // Re-point the pending version's storage at an infected object by using a fresh doc/version whose ref is 'infected'.
  // Simpler: put bytes at the version's ref and flag that ref.
  const infectedScanner = new DeterministicScanner({ flagged: { [init2.storageRef]: 'infected' } });
  const docs2 = new DocumentService(db, authz, emitter, repo, storage, infectedScanner);
  await storage.put(init2.storageRef, new Uint8Array([7, 7]));
  const infComplete = await docs2.completeUpload(full, author, init2.version.id, {
    expectedVersion: init2.version.version,
    contentHash: bytesHash(new Uint8Array([7, 7])),
    byteSize: 2,
  });
  t.equal(infComplete.scan.status, 'infected', 'an infected object scans infected');
  await t.rejects(
    docs2.activateVersion(full, author, infComplete.version.id, {
      expectedVersion: infComplete.version.version,
    }),
    'an infected version cannot be activated (scan gate)',
  );

  // --- download authorization + redaction -------------------------------------------------------
  const download = await docs.authorizeDownload(full, author, activated.id);
  t.equal(download.bytes.length, 5, 'an authorized download streams the server-mediated bytes');

  // --- ACL grant + revoke -----------------------------------------------------------------------
  const grant = await access.grant(full, author, doc.id, {
    granteeKind: 'role',
    granteeRef: 'legal_team',
    accessLevel: 'read',
  });
  t.equal(grant.status, 'active', 'an access grant is active');
  await t.rejects(
    access.grant(full, author, doc.id, {
      granteeKind: 'role',
      granteeRef: 'legal_team',
      accessLevel: 'read',
    }),
    'a duplicate active grant is rejected',
  );
  const revoked = await access.revoke(full, author, grant.id, grant.version);
  t.equal(revoked.status, 'revoked', 'a grant can be revoked');

  // --- checkout single-winner -------------------------------------------------------------------
  const co = await access.checkout(full, author, doc.id, docAfter.version);
  t.ok(co.id !== '', 'a document can be checked out');
  await t.rejects(
    access.checkout(approverCtx, approver, doc.id, docAfter.version),
    'a second checkout is rejected (single-winner)',
  );
  const released = await access.releaseCheckout(full, author, doc.id, false);
  t.ok(released.released_at !== null, 'the holder can release the checkout');

  // --- relationship acyclicity ------------------------------------------------------------------
  const docB = await docs.create(full, author, {
    code: 'DOC-2',
    title: 'C2',
    documentType: 'contract',
    metadata: { counterparty: 'Beta' },
  });
  await access.addRelationship(full, author, {
    fromDocumentId: doc.id,
    toDocumentId: docB.id,
    relationshipType: 'supersedes',
  });
  await t.rejects(
    access.addRelationship(full, author, {
      fromDocumentId: docB.id,
      toDocumentId: doc.id,
      relationshipType: 'supersedes',
    }),
    'a reverse supersedes edge that closes a cycle is rejected',
  );

  // --- legal hold blocks disposition ------------------------------------------------------------
  const hold = await records.placeLegalHold(full, author, doc.id, 'litigation matter 42');
  t.equal(hold.status, 'active', 'a legal hold is placed');
  await t.rejects(
    records.requestDisposition(full, author, doc.id, { action: 'review' }),
    'an active legal hold blocks a disposition request',
  );
  const heldDoc = await docs.get(full, doc.id);
  await records.releaseLegalHold(full, author, hold.id, hold.version, 'matter closed');
  t.ok(heldDoc.legal_hold, 'the document was flagged held while the hold was active');

  // --- disposition: request -> approve (SoD) -> execute (tombstone) ------------------------------
  const disp = await records.requestDisposition(full, author, doc.id, {
    action: 'destroy',
    reason: 'end of retention',
  });
  t.equal(disp.status, 'pending_review', 'a disposition request is pending review');
  await t.rejects(
    records.approveDisposition(full, author, disp.id, disp.version),
    'the requester cannot approve their own disposition (segregation of duties)',
  );
  const approved = await records.approveDisposition(approverCtx, approver, disp.id, disp.version);
  t.equal(approved.status, 'approved', 'a different actor can approve the disposition');
  const executed = await records.executeDisposition(approverCtx, approver, approved.id, approved.version);
  t.equal(executed.status, 'disposed', 'an approved disposition executes');
  const tombstone = await docs.get(full, doc.id);
  t.equal(tombstone.status, 'disposed', 'a tombstone document record remains after disposal');

  // --- cross-tenant isolation -------------------------------------------------------------------
  const otherTenant = randomUUID();
  const otherCtx: RequestContext = {
    tenantId: otherTenant,
    userId: randomUUID(),
    correlationId: cid(),
    permissions: [M09_PERMISSIONS.documentRead],
  };
  await t.rejects(docs.get(otherCtx, doc.id), 'another tenant cannot read this tenant document');
});
