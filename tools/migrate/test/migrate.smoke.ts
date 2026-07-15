import { defineSuite } from '@finapp/test-runner';
import {
  orderedModules,
  moduleRank,
  MIGRATION_ORDER,
  orderMigrationFilenames,
  validateMigrationFilename,
  sequenceOf,
  checksum,
} from '@finapp/migrate';

/**
 * Migration runner PURE smoke suite — the ordering and integrity logic, with no database.
 */
export default defineSuite('migrate', (t) => {
  // --- module order --------------------------------------------------------------------------------
  const modules = orderedModules();
  t.equal(new Set(modules).size, modules.length, 'no module appears twice in the migration order');
  t.equal(MIGRATION_ORDER[0]?.stage, 0, 'the order starts at stage 0');
  t.equal(
    MIGRATION_ORDER[0]?.modules.length,
    0,
    'stage 0 owns no tables — kernel and contracts are code-only',
  );

  // Dependency order is the whole point of the list; these are the edges that actually matter.
  t.ok(
    moduleRank('m01-tenant') < moduleRank('m02-identity'),
    'm01 (tenants) precedes m02 — composite FK target',
  );
  t.ok(moduleRank('m03-audit') < moduleRank('m12-feedback'), 'the audit spine precedes any business module');
  t.ok(moduleRank('m06-workflow') < moduleRank('m13-case'), 'the outbox owner precedes its first publisher');
  t.ok(
    moduleRank('m19-finance') < moduleRank('m21-journal'),
    'finance operations precede the journal engine',
  );
  t.ok(moduleRank('m21-journal') < moduleRank('m22-approval'), 'the journal precedes its approval workflow');
  t.equal(moduleRank('m99-nonexistent'), -1, 'an unknown module has no rank');

  const stages = MIGRATION_ORDER.map((s) => s.stage);
  t.deepEqual(
    stages,
    [...stages].sort((a, b) => a - b),
    'stages are listed in ascending order',
  );

  // --- filename validation -------------------------------------------------------------------------
  t.equal(validateMigrationFilename('0001_create_tenants.sql'), null, 'a well-formed filename is accepted');
  t.ok(validateMigrationFilename('1_create_tenants.sql') !== null, 'a short sequence is rejected');
  t.ok(validateMigrationFilename('0001-create-tenants.sql') !== null, 'kebab-case is rejected');
  t.ok(validateMigrationFilename('0001_CreateTenants.sql') !== null, 'PascalCase is rejected');
  t.ok(validateMigrationFilename('create_tenants.sql') !== null, 'a missing sequence is rejected');

  t.equal(sequenceOf('0042_add_index.sql'), 42, 'the sequence is parsed');
  t.equal(sequenceOf('0007_x.sql'), 7, 'a leading-zero sequence is not read as octal');

  // --- ordering ------------------------------------------------------------------------------------
  t.deepEqual(
    orderMigrationFilenames('m01-tenant', ['0010_c.sql', '0002_b.sql', '0001_a.sql']),
    ['0001_a.sql', '0002_b.sql', '0010_c.sql'],
    'migrations sort by sequence, not lexically',
  );
  t.deepEqual(orderMigrationFilenames('m01-tenant', []), [], 'a module with no migrations is fine');
  t.deepEqual(
    orderMigrationFilenames('m01-tenant', ['0001_a.sql', 'README.md']),
    ['0001_a.sql'],
    'non-SQL files are ignored',
  );
  t.throws(
    () => orderMigrationFilenames('m01-tenant', ['0001_a.sql', '0001_b.sql']),
    'a duplicate sequence is a hard error — two branches must resolve the collision deliberately',
  );
  t.throws(() => orderMigrationFilenames('m01-tenant', ['nope.sql']), 'a malformed filename is a hard error');

  // --- checksum ------------------------------------------------------------------------------------
  t.equal(checksum('SELECT 1;'), checksum('SELECT 1;'), 'the checksum is stable');
  t.notEqual(checksum('SELECT 1;'), checksum('SELECT 2;'), 'different SQL checksums differently');
  t.equal(
    checksum('CREATE TABLE t (\r\n  id int\r\n);'),
    checksum('CREATE TABLE t (\n  id int\n);'),
    'CRLF and LF checksum identically — a Windows checkout must not look like tampering',
  );
  t.equal(checksum('').length, 64, 'the checksum is a sha256 hex digest');
});
