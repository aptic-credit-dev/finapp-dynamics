/**
 * M09 permission catalogue — the authoritative constant map consumed by controllers' `@Endpoint` decorators and
 * enforced server-side inside the services (default deny). Every code is three segments
 * `documents.<entity>.<action>` (the kernel `@Endpoint` validator rejects anything else) and MUST be listed in
 * manifests/permission-registry.yaml under the `documents.*` namespace AND seeded into the `permissions`
 * catalogue. Document ACL grants (m09) SUPPLEMENT these RBAC permissions — they never replace M02 (ADR-048).
 * `documents.platform.administer` is the platform-authority capability; there is no vague `documents.admin`.
 */
export const M09_PERMISSIONS = {
  documentRead: 'documents.document.read',
  documentCreate: 'documents.document.create',
  documentUpdateMetadata: 'documents.document.update_metadata',
  documentUploadVersion: 'documents.document.upload_version',
  documentActivate: 'documents.document.activate',
  documentArchive: 'documents.document.archive',
  documentWithdraw: 'documents.document.withdraw',
  documentDownload: 'documents.document.download',
  typeRead: 'documents.type.read',
  typeManage: 'documents.type.manage',
  retentionRead: 'documents.retention.read',
  retentionManage: 'documents.retention.manage',
  accessRead: 'documents.access.read',
  accessGrant: 'documents.access.grant',
  accessRevoke: 'documents.access.revoke',
  checkoutAcquire: 'documents.checkout.acquire',
  checkoutRelease: 'documents.checkout.release',
  checkoutForceRelease: 'documents.checkout.force_release',
  legalHoldRead: 'documents.legal_hold.read',
  legalHoldManage: 'documents.legal_hold.manage',
  dispositionRead: 'documents.disposition.read',
  dispositionRequest: 'documents.disposition.request',
  dispositionApprove: 'documents.disposition.approve',
  dispositionExecute: 'documents.disposition.execute',
  scanOverride: 'documents.scan.override',
  relationshipManage: 'documents.relationship.manage',
  platformAdminister: 'documents.platform.administer',
} as const;

export type M09Permission = (typeof M09_PERMISSIONS)[keyof typeof M09_PERMISSIONS];

export const ALL_M09_PERMISSIONS: readonly M09Permission[] = Object.values(M09_PERMISSIONS);
