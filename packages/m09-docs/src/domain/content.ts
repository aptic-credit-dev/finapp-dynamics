/**
 * Content safety — filename normalization (with a strict path-traversal guard), media-type validation, and
 * content-hash format checks (ADR-047, prompt §F). All PURE and deterministic; no filesystem, no network. The
 * module never constructs a filesystem path or a remote URL from a filename — a normalized filename is a safe
 * display/label value only; the real object location is an opaque storage reference the adapter owns.
 */
import { DOC_LIMITS, DocError } from './limits.ts';

// Reserved characters for a filename LABEL (path separators handled by CONTROL_OR_SLASH). Space, digits and
// letters are allowed. Control characters are rejected separately (a filename must never carry them).
const UNSAFE_FILENAME_CHARS = /[<>:"|?*]/;
const CONTROL_OR_SLASH = /[/\\]/;

export interface FilenameResult {
  readonly ok: boolean;
  readonly value?: string;
  readonly error?: string;
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Normalize a supplied filename to a safe label, or refuse. Rejects: empty, over-limit, path separators,
 * traversal (`.` / `..` / any embedded slash), control characters, and reserved shell/Windows characters. The
 * result is a leaf name only — it can never escape a directory because it can never CONTAIN a directory.
 */
export function normalizeFilename(raw: unknown): FilenameResult {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, error: 'filename is required' };
  const value = raw.trim();
  if (value.length > DOC_LIMITS.maxFilenameChars) return { ok: false, error: 'filename too long' };
  if (value === '.' || value === '..') return { ok: false, error: 'filename must not be a path segment' };
  if (CONTROL_OR_SLASH.test(value)) return { ok: false, error: 'filename must not contain a path separator' };
  if (hasControlChar(value)) return { ok: false, error: 'filename must not contain control characters' };
  if (UNSAFE_FILENAME_CHARS.test(value)) return { ok: false, error: 'filename contains unsafe characters' };
  if (value.includes('..')) return { ok: false, error: 'filename must not contain a traversal sequence' };
  return { ok: true, value };
}

export function requireFilename(raw: unknown): string {
  const r = normalizeFilename(raw);
  if (!r.ok || r.value === undefined) throw new DocError('INVALID_FILENAME', r.error ?? 'invalid filename');
  return r.value;
}

const MEDIA_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

/** Validate a media type against a strict grammar and (optionally) an allow-list from the document type. */
export function validateMediaType(mediaType: unknown, allowed?: readonly string[]): string {
  if (
    typeof mediaType !== 'string' ||
    !MEDIA_TYPE_RE.test(mediaType) ||
    mediaType.length > DOC_LIMITS.maxMediaTypeChars
  ) {
    throw new DocError('INVALID_MEDIA_TYPE', 'media type is malformed');
  }
  const norm = mediaType.toLowerCase();
  if (allowed !== undefined && allowed.length > 0 && !allowed.map((a) => a.toLowerCase()).includes(norm)) {
    throw new DocError('MEDIA_TYPE_NOT_ALLOWED', 'media type is not allowed for this document type');
  }
  return norm;
}

const CONTENT_HASH_RE = /^sha256:[0-9a-f]{64}$/;

/** A committed version must carry a canonical `sha256:<hex>` content hash (immutability evidence). */
export function requireContentHash(hash: unknown): string {
  if (typeof hash !== 'string' || !CONTENT_HASH_RE.test(hash)) {
    throw new DocError('INVALID_CONTENT_HASH', 'content hash must be sha256:<64-hex>');
  }
  return hash;
}

export function requireByteSize(size: unknown): number {
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 0 || size > DOC_LIMITS.maxByteSize) {
    throw new DocError('INVALID_BYTE_SIZE', 'byte size must be a non-negative integer within the limit');
  }
  return size;
}

/** Verify a client-claimed upload against the adapter's actual observed object (server-side truth, §E5). */
export function verifyUpload(
  claimed: { contentHash: string; byteSize: number },
  observed: { contentHash: string; byteSize: number },
): void {
  if (claimed.contentHash !== observed.contentHash) {
    throw new DocError('CONTENT_HASH_MISMATCH', 'claimed content hash does not match the stored object');
  }
  if (claimed.byteSize !== observed.byteSize) {
    throw new DocError('BYTE_SIZE_MISMATCH', 'claimed byte size does not match the stored object');
  }
}
