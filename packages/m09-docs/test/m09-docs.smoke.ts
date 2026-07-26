import { defineSuite } from '@finapp/test-runner';
import {
  normalizeFilename,
  validateMediaType,
  requireContentHash,
  requireByteSize,
  verifyUpload,
} from '../src/domain/content.ts';
import { CLASSIFICATIONS, isClassification, isDowngrade, DocError } from '../src/domain/limits.ts';
import {
  checkDocumentTransition,
  isDocumentTerminal,
  checkVersionTransition,
  isVersionCommitted,
  checkSpecTransition,
  isSpecFrozen,
  checkDispositionTransition,
  isDispositionTerminal,
} from '../src/domain/lifecycles.ts';
import {
  validateDocumentTypeSpec,
  validateRetentionPolicySpec,
  type DocumentTypeSpec,
  type RetentionPolicySpec,
} from '../src/domain/doctype.ts';
import { validateMetadata } from '../src/domain/metadata.ts';
import {
  earliestDispositionMs,
  evaluateDisposition,
  assertNotHeld,
  isExpired,
} from '../src/domain/retention.ts';
import {
  wouldCreateCycle,
  assertAcyclic,
  isRelationshipType,
  isGranteeKind,
  isAccessLevel,
} from '../src/domain/relationships.ts';
import { bytesHash, contentHashOf } from '../src/hash.ts';
import { InMemoryStorage } from '../src/storage.ts';
import { DeterministicScanner, scanPermitsRelease } from '../src/scan.ts';

function goodType(): DocumentTypeSpec {
  return {
    schemaVersion: 1,
    code: 'contract',
    name: 'Contract',
    allowedMediaTypes: ['application/pdf'],
    maxByteSize: 10_000_000,
    defaultClassification: 'confidential',
    retentionPolicyCode: 'seven_years',
    requiredMetadata: [
      { name: 'counterparty', type: 'string', required: true },
      { name: 'value', type: 'number', required: false },
    ],
    approvalRequired: true,
    signatureRequired: false,
    scanRequired: true,
  };
}
function goodRetention(): RetentionPolicySpec {
  return {
    schemaVersion: 1,
    code: 'seven_years',
    name: '7y',
    retentionDays: 2555,
    trigger: 'on_activation',
    dispositionAction: 'review',
    reviewRequired: true,
  };
}

export default defineSuite('m09-docs', async (t) => {
  // --- filename safety / traversal --------------------------------------------------------------
  t.equal(normalizeFilename('  Contract v2.pdf ').value, 'Contract v2.pdf', 'filename trimmed');
  t.ok(!normalizeFilename('../../etc/passwd').ok, 'path traversal rejected');
  t.ok(!normalizeFilename('a/b.pdf').ok, 'embedded slash rejected');
  t.ok(!normalizeFilename('a\\b.pdf').ok, 'embedded backslash rejected');
  t.ok(!normalizeFilename('..').ok, 'dot-dot rejected');
  t.ok(!normalizeFilename('.').ok, 'dot rejected');
  t.ok(!normalizeFilename('').ok, 'empty filename rejected');
  t.ok(!normalizeFilename('bad*name?.pdf').ok, 'unsafe characters rejected');
  t.ok(normalizeFilename('report-2026.pdf').ok, 'safe filename accepted');

  // --- media type -------------------------------------------------------------------------------
  t.equal(validateMediaType('application/PDF'), 'application/pdf', 'media type normalized');
  t.throws(() => validateMediaType('not-a-media-type'), 'malformed media type rejected');
  t.throws(
    () => validateMediaType('image/png', ['application/pdf']),
    'media type not in allow-list rejected',
  );
  t.equal(
    validateMediaType('application/pdf', ['application/pdf']),
    'application/pdf',
    'allowed media type accepted',
  );

  // --- content hash + size + upload verification ------------------------------------------------
  t.ok(requireContentHash('sha256:' + 'a'.repeat(64)) !== '', 'valid content hash accepted');
  t.throws(() => requireContentHash('md5:abc'), 'non-sha256 hash rejected');
  t.throws(() => requireContentHash('sha256:xyz'), 'malformed hash rejected');
  t.equal(requireByteSize(1024), 1024, 'valid byte size accepted');
  t.throws(() => requireByteSize(-1), 'negative byte size rejected');
  const observed = { contentHash: 'sha256:' + 'a'.repeat(64), byteSize: 100 };
  verifyUpload({ contentHash: observed.contentHash, byteSize: 100 }, observed);
  t.throws(() => {
    verifyUpload({ contentHash: 'sha256:' + 'b'.repeat(64), byteSize: 100 }, observed);
  }, 'hash mismatch rejected (no completion forgery)');
  t.throws(() => {
    verifyUpload({ contentHash: observed.contentHash, byteSize: 999 }, observed);
  }, 'size mismatch rejected');

  // --- classification + downgrade ---------------------------------------------------------------
  t.equal(CLASSIFICATIONS.length, 4, 'four classifications');
  t.ok(isClassification('restricted') && !isClassification('secret'), 'classification recognized');
  t.ok(isDowngrade('restricted', 'public'), 'restricted -> public is a downgrade');
  t.ok(!isDowngrade('internal', 'confidential'), 'internal -> confidential is an upgrade');

  // --- lifecycles -------------------------------------------------------------------------------
  t.ok(checkDocumentTransition('draft', 'active').ok, 'draft -> active ok');
  t.ok(!checkDocumentTransition('disposed', 'active').ok, 'disposed is terminal');
  t.ok(isDocumentTerminal('disposed') && !isDocumentTerminal('active'), 'document terminals');
  t.ok(checkVersionTransition('pending', 'committed').ok, 'pending -> committed ok');
  t.ok(!checkVersionTransition('active', 'pending').ok, 'version cannot revert');
  t.ok(!isVersionCommitted('pending') && isVersionCommitted('committed'), 'version committed check');
  t.ok(checkSpecTransition('DRAFT', 'validate').ok, 'spec DRAFT -> validate ok');
  t.ok(!checkSpecTransition('DRAFT', 'publish').ok, 'spec DRAFT -> publish rejected');
  t.ok(!isSpecFrozen('DRAFT') && isSpecFrozen('PUBLISHED'), 'spec frozen at publish');
  t.ok(
    checkDispositionTransition('pending_review', 'approved').ok,
    'disposition pending_review -> approved ok',
  );
  t.ok(!checkDispositionTransition('disposed', 'approved').ok, 'disposed is terminal');
  t.ok(isDispositionTerminal('disposed') && isDispositionTerminal('rejected'), 'disposition terminals');

  // --- doctype + retention spec -----------------------------------------------------------------
  t.ok(validateDocumentTypeSpec(goodType()).ok, 'good document type validates');
  t.ok(
    !validateDocumentTypeSpec({ ...goodType(), allowedMediaTypes: [] }).ok,
    'type without media types rejected',
  );
  t.ok(
    !validateDocumentTypeSpec({ ...goodType(), defaultClassification: 'nope' }).ok,
    'invalid default classification rejected',
  );
  t.ok(
    !validateDocumentTypeSpec({ ...goodType(), requiredMetadata: [{ name: 'x', type: 'nope' as 'string' }] })
      .ok,
    'invalid metadata field type rejected',
  );
  t.ok(validateRetentionPolicySpec(goodRetention()).ok, 'good retention policy validates');
  t.ok(
    !validateRetentionPolicySpec({ ...goodRetention(), retentionDays: -1 }).ok,
    'negative retention rejected',
  );
  t.ok(
    !validateRetentionPolicySpec({ ...goodRetention(), dispositionAction: 'nuke' as 'destroy' }).ok,
    'invalid disposition action rejected',
  );

  // --- metadata validation ----------------------------------------------------------------------
  const schema = goodType().requiredMetadata;
  t.ok(validateMetadata(schema, { counterparty: 'Acme', value: 100 }).ok, 'valid metadata accepted');
  t.ok(!validateMetadata(schema, { value: 100 }).ok, 'missing required metadata rejected');
  t.ok(!validateMetadata(schema, { counterparty: 123 }).ok, 'metadata type mismatch rejected');
  t.ok(
    !validateMetadata(schema, { counterparty: 'Acme', unknown: 'x' }).ok,
    'unknown metadata field rejected',
  );

  // --- retention + disposition + legal hold -----------------------------------------------------
  const anchor = 1_700_000_000_000;
  const earliest = earliestDispositionMs(goodRetention(), anchor);
  t.ok(earliest > anchor, 'earliest disposition is after the anchor');
  t.equal(
    evaluateDisposition({ earliestDispositionMs: earliest, nowMs: anchor, legalHold: false }).reason,
    'retained',
    'not yet disposable before the date',
  );
  t.equal(
    evaluateDisposition({ earliestDispositionMs: earliest, nowMs: earliest + 1, legalHold: false }).reason,
    'eligible',
    'disposable after the date',
  );
  t.equal(
    evaluateDisposition({ earliestDispositionMs: earliest, nowMs: earliest + 1, legalHold: true }).reason,
    'legal_hold',
    'legal hold blocks disposal even after retention',
  );
  t.throws(() => {
    assertNotHeld(true);
  }, 'assertNotHeld throws under a hold');
  t.ok(
    isExpired(anchor, anchor + 1) && !isExpired(anchor, anchor - 1) && !isExpired(null, anchor),
    'expiry check',
  );

  // --- relationships (acyclicity) ---------------------------------------------------------------
  t.ok(isRelationshipType('supersedes') && !isRelationshipType('nope'), 'relationship type recognized');
  t.ok(isGranteeKind('role') && !isGranteeKind('alien'), 'grantee kind recognized');
  t.ok(isAccessLevel('download') && !isAccessLevel('godmode'), 'access level recognized');
  t.ok(wouldCreateCycle('A', 'A', []), 'self-edge is a cycle');
  t.ok(wouldCreateCycle('A', 'B', [{ from: 'B', to: 'A' }]), 'A->B with existing B->A is a cycle');
  t.ok(!wouldCreateCycle('A', 'B', [{ from: 'C', to: 'D' }]), 'unrelated edges are acyclic');
  t.throws(() => {
    assertAcyclic('supersedes', 'A', 'B', [{ from: 'B', to: 'A' }]);
  }, 'acyclic assertion throws on a cycle');

  // --- hash --------------------------------------------------------------------------------------
  t.equal(
    bytesHash(new Uint8Array([1, 2, 3])),
    bytesHash(new Uint8Array([1, 2, 3])),
    'byte hash is deterministic',
  );
  t.equal(
    contentHashOf({ a: 1, b: 2 }),
    contentHashOf({ b: 2, a: 1 }),
    'canonical spec hash is key-order independent',
  );

  // --- storage + scan test doubles --------------------------------------------------------------
  const storage = new InMemoryStorage();
  const head = await storage.put('ref-1', new Uint8Array([1, 2, 3, 4]));
  t.equal(head.byteSize, 4, 'in-memory storage reports the byte size');
  const readBack = await storage.head('ref-1');
  t.equal(readBack?.contentHash, head.contentHash, 'storage head matches the put hash');
  await storage.purge('ref-1');
  t.equal(await storage.head('ref-1'), null, 'purge removes the object');
  const scanner = new DeterministicScanner({ flagged: { 'bad-ref': 'infected' } });
  t.equal((await scanner.scan('good-ref')).status, 'clean', 'deterministic scanner returns clean by default');
  t.equal((await scanner.scan('bad-ref')).status, 'infected', 'a flagged ref scans infected');
  t.ok(scanPermitsRelease('clean') && !scanPermitsRelease('infected'), 'only clean/bypassed permit release');

  t.ok(new DocError('X', 'y') instanceof Error, 'DocError is an Error');
});
