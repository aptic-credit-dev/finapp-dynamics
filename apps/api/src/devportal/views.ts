/**
 * Safe DTO shapers for `/api/v1/developer` (the developer-portal surface). They expose ids, keys, categories, statuses and
 * versions. A credential view exposes only the PUBLIC key id + status — NEVER the hash or the secret reference content. The
 * ISSUED-credential view additionally returns the freshly-generated plaintext secret ONCE (only when the service generated
 * it); it is never persisted, logged, audited or evented. RLS keeps a caller to its own tenant's rows.
 */
import type {
  AppRow,
  ProductRow,
  ProductScopeRow,
  CredentialRow,
  SubscriptionRow,
  IssuedCredential,
  AppReadRow,
  ProductReadRow,
  CredentialMetaRow,
  SubscriptionReadRow,
} from '@finapp/m35-devportal';

export function appView(a: AppRow) {
  return {
    id: a.id,
    scope: a.scope,
    appKey: a.app_key,
    name: a.name,
    status: a.status,
    version: a.version,
  };
}

export function productView(p: ProductRow) {
  return {
    id: p.id,
    scope: p.scope,
    productKey: p.product_key,
    title: p.title,
    category: p.category,
    visibility: p.visibility,
    sourceKind: p.source_kind,
    sourceRef: p.source_ref,
    state: p.state,
    version: p.version,
  };
}

export function scopeView(s: ProductScopeRow) {
  return {
    id: s.id,
    productId: s.product_id,
    operationRef: s.operation_ref,
    requiredPermission: s.required_permission,
  };
}

/** A stored credential — PUBLIC key id + status only; never the hash or reference content. */
export function credentialView(c: CredentialRow) {
  return {
    id: c.id,
    appId: c.app_id,
    keyId: c.key_id,
    purpose: c.purpose,
    status: c.status,
    version: c.version,
  };
}

/** The result of issuing/rotating — the credential + the plaintext secret returned ONCE (null when a secretref was supplied). */
export function issuedCredentialView(i: IssuedCredential) {
  return {
    credential: credentialView(i.credential),
    secret: i.plaintextSecret,
  };
}

export function subscriptionView(s: SubscriptionRow) {
  return {
    id: s.id,
    appId: s.app_id,
    productId: s.product_id,
    status: s.status,
    version: s.version,
  };
}

// ---- READ-MODEL views (developer-portal surface) — safe descriptive + lifecycle metadata; still zero secret material.

/** An application's detail: descriptive + lifecycle metadata (never a credential/secret). */
export function appDetailView(a: AppReadRow) {
  return {
    id: a.id,
    scope: a.scope,
    appKey: a.app_key,
    name: a.name,
    description: a.description,
    homepageUrl: a.homepage_url,
    ownerRef: a.owner_ref,
    status: a.status,
    version: a.version,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  };
}

/** Credential METADATA — id/key/purpose/status/version + instants. NEVER the secret hash or the secretref content. */
export function credentialMetaView(c: CredentialMetaRow) {
  return {
    id: c.id,
    appId: c.app_id,
    keyId: c.key_id,
    purpose: c.purpose,
    status: c.status,
    version: c.version,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

/** A product's catalog detail: title/summary/category/visibility/source + state (never an upstream body). */
export function productDetailView(p: ProductReadRow) {
  return {
    id: p.id,
    scope: p.scope,
    productKey: p.product_key,
    title: p.title,
    summary: p.summary,
    category: p.category,
    visibility: p.visibility,
    sourceKind: p.source_kind,
    sourceRef: p.source_ref,
    state: p.state,
    validationPassed: p.validation_passed,
    version: p.version,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

/** A subscription read-row — includes the governed maker/checker evidence (requested/approved by) + instants. */
export function subscriptionReadView(s: SubscriptionReadRow) {
  return {
    id: s.id,
    appId: s.app_id,
    productId: s.product_id,
    status: s.status,
    requestedBy: s.requested_by,
    approvedBy: s.approved_by,
    version: s.version,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
}
