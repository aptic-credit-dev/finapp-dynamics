/**
 * M36 permission catalogue — the `events.*` namespace (GAP-4 resolution) covering BOTH the `/api/v1/webhooks` and
 * `/api/v1/events` surfaces. Three-segment `events.<area>.<action>` (the kernel @Endpoint rule); enforced server-side in
 * every service (default deny); registered in manifests/permission-registry.yaml + seeded (migration 0001).
 * `events.control.administer` is the cross-tenant CONTROL-PLANE permission a tenant admin never holds by default. WEBHOOK
 * ENDPOINT APPROVAL (activating an external egress endpoint) and DELIVERY REPLAY are privileged CONTROLLED actions. There
 * is NO `events.admin`/wildcard bypass; a request-supplied identifier creates no authority; a feature flag can never
 * substitute a permission (RBAC m02 stays authoritative).
 */
export const M36_PERMISSIONS = {
  webhookRead: 'events.webhook.read',
  webhookManage: 'events.webhook.manage',
  webhookApprove: 'events.webhook.approve',
  subscriptionManage: 'events.subscription.manage',
  streamRead: 'events.stream.read',
  streamManage: 'events.stream.manage',
  deliveryReplay: 'events.delivery.replay',
  administer: 'events.control.administer',
} as const;

export type M36Permission = (typeof M36_PERMISSIONS)[keyof typeof M36_PERMISSIONS];
export const ALL_M36_PERMISSIONS: readonly M36Permission[] = Object.values(M36_PERMISSIONS);

/** The CONTROL-PLANE permission — a tenant admin never holds it by default; platform-scope endpoints/streams require it. */
export const M36_PLATFORM_PERMISSIONS: readonly M36Permission[] = [M36_PERMISSIONS.administer];

/** The privileged subset — endpoint approval, delivery replay + the control-plane permission. */
export const M36_PRIVILEGED_PERMISSIONS: readonly M36Permission[] = [
  M36_PERMISSIONS.webhookApprove,
  M36_PERMISSIONS.deliveryReplay,
  M36_PERMISSIONS.administer,
];

export function isPlatformPermission(p: string): boolean {
  return (M36_PLATFORM_PERMISSIONS as readonly string[]).includes(p);
}
