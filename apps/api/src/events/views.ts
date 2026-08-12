/**
 * Safe DTO shapers for `/api/v1/webhooks` + `/api/v1/events`. They expose ids, keys, the endpoint URL, event family/type,
 * statuses and versions. An endpoint view NEVER exposes the signing secret reference content — only whether one is set. A
 * delivery view exposes the status + attempt only (never a body/secret). RLS keeps a caller to its own tenant's rows.
 */
import type { EndpointRow, SubscriptionRow, DeliveryRow, StreamRow, CursorRow } from '@finapp/m36-events';

export function endpointView(e: EndpointRow) {
  return {
    id: e.id,
    scope: e.scope,
    endpointKey: e.endpoint_key,
    url: e.url,
    hasSigningSecret: e.signing_secret_ref !== null,
    state: e.state,
    version: e.version,
  };
}

export function subscriptionView(s: SubscriptionRow) {
  return {
    id: s.id,
    endpointId: s.endpoint_id,
    eventFamily: s.event_family,
    eventType: s.event_type,
    status: s.status,
    version: s.version,
  };
}

export function deliveryView(d: DeliveryRow) {
  return {
    id: d.id,
    endpointId: d.endpoint_id,
    eventFamily: d.event_family,
    eventType: d.event_type,
    status: d.status,
    attemptNo: d.attempt_no,
    reasonCode: d.reason_code,
  };
}

export function streamView(s: StreamRow) {
  return {
    id: s.id,
    scope: s.scope,
    streamKey: s.stream_key,
    status: s.status,
    version: s.version,
  };
}

export function cursorView(c: CursorRow) {
  return {
    id: c.id,
    streamId: c.stream_id,
    consumerKey: c.consumer_key,
    position: c.position,
    status: c.status,
    version: c.version,
  };
}
