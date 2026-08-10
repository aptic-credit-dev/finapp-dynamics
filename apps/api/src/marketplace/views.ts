/**
 * Safe DTO shapers for `/api/v1/connectors` (the marketplace surface). They expose ids, keys, opaque connector references,
 * categories, statuses and versions. An installation view exposes its NON-secret config; a secret view exposes only the
 * OPAQUE reference (never a value). RLS keeps a caller to its own tenant's rows.
 */
import type {
  ListingRow,
  ListingCapabilityRow,
  InstallationRow,
  ConsentRow,
  InstallSecretRow,
  UpgradeRow,
} from '@finapp/m34-marketplace';

export function listingView(l: ListingRow) {
  return {
    id: l.id,
    scope: l.scope,
    listingKey: l.listing_key,
    connectorRef: l.connector_ref,
    title: l.title,
    category: l.category,
    visibility: l.visibility,
    state: l.state,
    version: l.version,
  };
}

export function capabilityView(c: ListingCapabilityRow) {
  return {
    id: c.id,
    listingId: c.listing_id,
    capabilityRef: c.capability_ref,
    requiredScope: c.required_scope,
  };
}

export function installationView(i: InstallationRow) {
  return {
    id: i.id,
    listingId: i.listing_id,
    connectorRef: i.connector_ref,
    scope: i.scope,
    installKey: i.install_key,
    config: i.config,
    status: i.status,
    installedVersion: i.installed_version,
    version: i.version,
  };
}

export function consentView(c: ConsentRow) {
  return {
    id: c.id,
    installationId: c.installation_id,
    scopes: c.scopes,
    status: c.status,
    version: c.version,
  };
}

export function secretView(s: InstallSecretRow) {
  return {
    id: s.id,
    installationId: s.installation_id,
    purpose: s.purpose,
    secretRef: s.secret_ref,
    status: s.status,
    version: s.version,
  };
}

export function upgradeView(u: UpgradeRow) {
  return {
    id: u.id,
    installationId: u.installation_id,
    fromVersion: u.from_version,
    toVersion: u.to_version,
    status: u.status,
  };
}
