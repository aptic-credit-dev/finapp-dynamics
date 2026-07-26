/**
 * Hard limits + shared vocabulary for the documents domain. Every bound is enforced fail-closed so a malicious
 * filename, an oversized upload, or unbounded metadata is rejected deterministically rather than turned into a
 * denial-of-service (ADR-047). These are DATA, shared by the validators and the services.
 */
export const DOC_LIMITS = {
  maxTitleChars: 512,
  maxCodeChars: 128,
  maxFilenameChars: 255,
  maxMediaTypeChars: 255,
  maxByteSize: 5_368_709_120, // 5 GiB — an adapter/type may lower this.
  maxMetadataKeys: 100,
  maxMetadataKeyChars: 128,
  maxMetadataValueChars: 8_000,
  maxTags: 50,
  maxRelationshipsPerDocument: 500,
  maxChangeSummaryChars: 2_000,
} as const;

/** A structured, safe-to-surface domain error. Never carries secrets, raw content, or storage credentials. */
export class DocError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DocError';
    this.code = code;
  }
}

/**
 * Classification levels, ordered least→most sensitive (mirrors the contracts DataClassification vocab).
 * Ordering is what lets the service detect a DOWNGRADE (which needs privileged authority + audit, ADR-049).
 */
export const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export function isClassification(v: unknown): v is Classification {
  return typeof v === 'string' && (CLASSIFICATIONS as readonly string[]).includes(v);
}

export function classificationRank(c: Classification): number {
  return CLASSIFICATIONS.indexOf(c);
}

/** True when moving from `from` to `to` LOWERS sensitivity (a downgrade — privileged + audited). */
export function isDowngrade(from: Classification, to: Classification): boolean {
  return classificationRank(to) < classificationRank(from);
}
