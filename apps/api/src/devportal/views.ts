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
