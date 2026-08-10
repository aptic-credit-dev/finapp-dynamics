/**
 * Safe DTO shapers for `/api/v1/integration`. They expose ids, keys, categories, directions, states and versions. A
 * connection view exposes its NON-secret config and the OPAQUE secret references (never a secret value). A run view
 * exposes status + row_count (a count, never data). RLS keeps a caller to its own tenant's rows.
 */
import type {
  ConnectorDefinitionRow,
  ConnectorCapabilityRow,
  ConnectionRow,
  ConnectionSecretRow,
  ConnectorRunRow,
} from '@finapp/m33-integration';

export function connectorView(c: ConnectorDefinitionRow) {
  return {
    id: c.id,
    scope: c.scope,
    connectorKey: c.connector_key,
    name: c.name,
    vendor: c.vendor,
    category: c.category,
    authKind: c.auth_kind,
    state: c.state,
    version: c.version,
  };
}

export function capabilityView(c: ConnectorCapabilityRow) {
  return {
    id: c.id,
    connectorId: c.connector_id,
    capabilityKey: c.capability_key,
    name: c.name,
    direction: c.direction,
    kind: c.kind,
    status: c.status,
    version: c.version,
  };
}

export function connectionView(c: ConnectionRow) {
  return {
    id: c.id,
    connectorId: c.connector_id,
    scope: c.scope,
    connectionKey: c.connection_key,
    name: c.name,
    config: c.config,
    status: c.status,
    version: c.version,
  };
}

export function secretView(s: ConnectionSecretRow) {
  return {
    id: s.id,
    connectionId: s.connection_id,
    purpose: s.purpose,
    secretRef: s.secret_ref,
    status: s.status,
    version: s.version,
  };
}

export function runView(r: ConnectorRunRow) {
  return {
    id: r.id,
    connectionId: r.connection_id,
    capabilityId: r.capability_id,
    direction: r.direction,
    status: r.status,
    rowCount: r.row_count,
    reasonCode: r.reason_code,
    runtimeKind: r.runtime_kind,
    version: r.version,
  };
}
