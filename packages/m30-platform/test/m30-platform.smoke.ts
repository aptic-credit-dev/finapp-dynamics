import { defineSuite } from '@finapp/test-runner';
import {
  M30_LIMITS,
  PlatformError,
  SCOPES,
  isScope,
  isPlatformScope,
  METADATA_CATEGORIES,
  isMetadataCategory,
  VALUE_TYPES,
  isValueType,
  SPEC_STATUSES,
  isSpecFrozen,
  SECRET_REF_STATUSES,
  isSecretReference,
  REASON_CODES,
  ALL_REASON_CODES,
  evaluateFeature,
  evaluateAbsoluteAssignmentGate,
  evaluateConfigValueGate,
  clampPage,
  ALL_M30_PERMISSIONS,
  M30_PERMISSIONS,
  M30_PLATFORM_PERMISSIONS,
  M30_PRIVILEGED_PERMISSIONS,
  isPlatformPermission,
  ALL_M30_AUDIT_CODES,
  PLATFORM_AUDIT_PREFIX,
} from '../src/index.ts';

export default defineSuite('m30-platform', (t) => {
  // --- scope (platform control-plane vs tenant) ------------------------------------------------
  t.equal(SCOPES.length, 2, 'two scopes (platform, tenant)');
  t.ok(isScope('platform') && isScope('tenant') && !isScope('global'), 'scope recognized');
  t.ok(isPlatformScope('platform') && !isPlatformScope('tenant'), 'platform scope detected');

  // --- metadata categories (controlled vocabulary) --------------------------------------------
  t.equal(METADATA_CATEGORIES.length, 6, 'six metadata categories');
  t.ok(
    isMetadataCategory('capability') && isMetadataCategory('branding') && !isMetadataCategory('tenants'),
    'metadata category recognized (not a tenant mirror)',
  );

  // --- config value types ----------------------------------------------------------------------
  t.equal(VALUE_TYPES.length, 5, 'five value types');
  t.ok(
    isValueType('secret_ref') && isValueType('boolean') && !isValueType('binary'),
    'value type recognized',
  );

  // --- statuses --------------------------------------------------------------------------------
  t.equal(SPEC_STATUSES.length, 4, 'four spec statuses');
  t.ok(isSpecFrozen('active') && !isSpecFrozen('draft'), 'a published definition is frozen');
  t.equal(SECRET_REF_STATUSES.length, 3, 'three secret-reference statuses');

  // --- secret reference (opaque pointer only) --------------------------------------------------
  t.ok(isSecretReference('secretref:vault/kv/db-password'), 'a well-formed secretref is valid');
  t.ok(
    !isSecretReference('hunter2') && !isSecretReference('') && !isSecretReference('password=x'),
    'a raw secret / bad shape is NOT a valid reference',
  );

  // --- FEATURE EVALUATION (deterministic; absolute ignores tenant override) --------------------
  t.equal(
    evaluateFeature({ defaultEnabled: true, isAbsolute: false, assignmentEnabled: null }),
    true,
    'no assignment => default',
  );
  t.equal(
    evaluateFeature({ defaultEnabled: true, isAbsolute: false, assignmentEnabled: false }),
    false,
    'a tenant override applies to a non-absolute flag',
  );
  t.equal(
    evaluateFeature({ defaultEnabled: true, isAbsolute: true, assignmentEnabled: false }),
    true,
    'an ABSOLUTE flag ignores the tenant override (cannot be weakened)',
  );
  t.equal(
    evaluateFeature({ defaultEnabled: false, isAbsolute: true, assignmentEnabled: true }),
    false,
    'an ABSOLUTE off flag stays off regardless of override',
  );

  // --- ABSOLUTE-CONTROL assignment gate --------------------------------------------------------
  t.ok(evaluateAbsoluteAssignmentGate(false).allowed, 'a non-absolute flag may be assigned');
  const abs = evaluateAbsoluteAssignmentGate(true);
  t.ok(
    !abs.allowed && abs.reasonCode === REASON_CODES.absoluteControlNotOverridable,
    'an absolute flag can NEVER be overridden by a tenant assignment',
  );

  // --- SECRETS-SEAM config-value gate ----------------------------------------------------------
  t.ok(
    evaluateConfigValueGate({ secretBearing: false, hasPlainValue: true, secretRef: null }).allowed,
    'a non-secret value with a plain value is allowed',
  );
  t.ok(
    evaluateConfigValueGate({ secretBearing: true, hasPlainValue: false, secretRef: 'secretref:vault/x' })
      .allowed,
    'a secret-bearing value with an opaque reference is allowed',
  );
  const rawSecret = evaluateConfigValueGate({ secretBearing: true, hasPlainValue: true, secretRef: null });
  t.ok(
    !rawSecret.allowed && rawSecret.reasonCode === REASON_CODES.secretValueForbidden,
    'a secret-bearing value can NEVER carry a raw value (no secret stored)',
  );
  const badRef = evaluateConfigValueGate({
    secretBearing: true,
    hasPlainValue: false,
    secretRef: 'not-a-ref',
  });
  t.ok(
    !badRef.allowed && badRef.reasonCode === REASON_CODES.invalidSecretReference,
    'a secret-bearing value with an invalid reference is refused',
  );
  const refOnNonSecret = evaluateConfigValueGate({
    secretBearing: false,
    hasPlainValue: false,
    secretRef: 'secretref:vault/x',
  });
  t.ok(
    !refOnNonSecret.allowed && refOnNonSecret.reasonCode === REASON_CODES.secretValueForbidden,
    'a non-secret setting cannot carry a secret reference',
  );

  // --- pagination ------------------------------------------------------------------------------
  t.deepEqual(clampPage(undefined, undefined), { limit: 50, offset: 0 }, 'page defaults');
  t.deepEqual(clampPage(9999, -3), { limit: 200, offset: 0 }, 'page clamped');
  t.equal(M30_LIMITS.maxPageSize, 200, 'max page 200');

  // --- reason codes ----------------------------------------------------------------------------
  t.equal(
    REASON_CODES.absoluteControlNotOverridable,
    'absolute_control_not_overridable',
    'absolute-control reason code',
  );
  t.equal(REASON_CODES.secretValueForbidden, 'secret_value_forbidden', 'no-secret-value reason code');
  t.ok(
    ALL_REASON_CODES.includes('feature_not_authorization_substitute') &&
      ALL_REASON_CODES.includes('invalid_secret_reference'),
    'governance reason codes present',
  );
  t.ok(new Set(ALL_REASON_CODES).size === ALL_REASON_CODES.length, 'no reason code declared twice');

  // --- permissions (platform.* namespace; GAP-2 resolved) --------------------------------------
  t.equal(ALL_M30_PERMISSIONS.length, 9, 'm30 declares 9 platform.* permissions');
  t.ok(
    ALL_M30_PERMISSIONS.every((p) => p.startsWith('platform.') && p.split('.').length === 3),
    'every permission is a 3-segment platform.<area>.<action> code',
  );
  t.ok(new Set(ALL_M30_PERMISSIONS).size === ALL_M30_PERMISSIONS.length, 'no permission declared twice');
  t.equal(M30_PRIVILEGED_PERMISSIONS.length, 6, 'six privileged permissions');
  t.ok(
    isPlatformPermission(M30_PERMISSIONS.administer) && !isPlatformPermission(M30_PERMISSIONS.metadataRead),
    'platform.administer is the control-plane permission; reads are not',
  );
  t.ok(
    M30_PLATFORM_PERMISSIONS.length === 1 && M30_PLATFORM_PERMISSIONS[0] === M30_PERMISSIONS.administer,
    'the platform control-plane permission is platform.administer',
  );
  t.ok(!ALL_M30_PERMISSIONS.includes('platform.admin' as never), 'there is NO platform.admin bypass');

  // --- audit codes (PLATFORM_ prefix) ----------------------------------------------------------
  t.equal(ALL_M30_AUDIT_CODES.length, 11, 'm30 declares 11 PLATFORM_ audit codes');
  t.ok(
    ALL_M30_AUDIT_CODES.every((c) => c.startsWith(PLATFORM_AUDIT_PREFIX) && c.split('_').length >= 3),
    'every audit code is PLATFORM_ SCREAMING_SNAKE with >= 3 segments',
  );
  t.ok(new Set(ALL_M30_AUDIT_CODES).size === ALL_M30_AUDIT_CODES.length, 'no audit code declared twice');

  // --- error type ------------------------------------------------------------------------------
  t.ok(new PlatformError('X', 'y') instanceof Error, 'PlatformError is an Error');
});
