import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type BinaryLike } from 'node:crypto';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { ARGON2_POLICY, type Argon2Params } from './domain/policy.ts';

/**
 * Argon2id is @node-rs/argon2's default algorithm, so `hash()` produces an `$argon2id$` verifier without
 * naming the algorithm. We do not import the `Algorithm` enum: it is an ambient const enum in the library's
 * types, which `verbatimModuleSyntax` forbids referencing. The produced encoded string is asserted to be
 * argon2id by the smoke suite.
 */

/** Manually-typed scrypt promise — `promisify` mis-infers the overload that takes an options bag. */
function scryptAsync(
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Password hashing (ADR-016) and token hashing (ADR-015). The single place any cryptographic material is
 * produced or checked.
 *
 * PASSWORDS: Argon2id via @node-rs/argon2 is the primary hasher; `node:crypto.scrypt` is the documented
 * fallback used ONLY when Argon2id cannot operate in an approved runtime (selected explicitly, never a
 * silent downgrade — see `selectPasswordHasher`). Verification is constant-time (the library's own, or
 * `timingSafeEqual` for scrypt). No plaintext or hash is ever logged or returned to a caller.
 *
 * TOKENS: session and refresh secrets are 256-bit random values. A random secret needs no slow KDF — its
 * entropy is the strength — so it is stored as a SHA-256 hash (collision-resistant), which is enough to
 * stop a database read from yielding a usable token. The raw token is returned to the client exactly once.
 */

export interface HashedCredential {
  readonly algorithm: string;
  readonly params: Argon2Params;
  /** The encoded verifier (Argon2 PHC string, or the scrypt self-describing string). Never a plaintext. */
  readonly encoded: string;
}

export interface PasswordHasher {
  readonly algorithm: string;
  hash(password: string): Promise<HashedCredential>;
  verify(encoded: string, password: string): Promise<boolean>;
}

/** Argon2id — the primary. */
export const argon2idHasher: PasswordHasher = {
  algorithm: 'argon2id',
  async hash(password) {
    const encoded = await argon2Hash(password, {
      memoryCost: ARGON2_POLICY.memoryCost,
      timeCost: ARGON2_POLICY.timeCost,
      parallelism: ARGON2_POLICY.parallelism,
    });
    return { algorithm: 'argon2id', params: { ...ARGON2_POLICY }, encoded };
  },
  async verify(encoded, password) {
    try {
      return await argon2Verify(encoded, password);
    } catch {
      // A malformed stored hash must read as "does not verify", never throw a 500 into the login path.
      return false;
    }
  },
};

/**
 * scrypt fallback. Self-describing encoded form: `scrypt$N$r$p$saltB64$hashB64`. Its `algorithm` is
 * `scrypt`, so policy.needsRehash() always flags it for upgrade to Argon2id on the next successful login.
 */
const SCRYPT_N = 1 << 17;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

export const scryptHasher: PasswordHasher = {
  algorithm: 'scrypt',
  async hash(password) {
    const salt = randomBytes(16);
    const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 256 * 1024 * 1024,
    });
    const encoded = `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`;
    // params carries the scrypt cost under the Argon2Params shape only so the column is uniform; it is
    // never used to verify (the encoded string is authoritative) and needsRehash flags scrypt regardless.
    return {
      algorithm: 'scrypt',
      params: { memoryCost: SCRYPT_N, timeCost: SCRYPT_R, parallelism: SCRYPT_P },
      encoded,
    };
  },
  async verify(encoded, password) {
    const parts = encoded.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4] ?? '', 'base64');
    const expected = Buffer.from(parts[5] ?? '', 'base64');
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || expected.length === 0) {
      return false;
    }
    const derived = await scryptAsync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: 256 * 1024 * 1024,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  },
};

/**
 * Selects the password hasher. Default Argon2id. `FINAPP_PASSWORD_HASHER=scrypt` selects the fallback
 * EXPLICITLY — there is no automatic downgrade, because a silent fall-back to a weaker KDF in production is
 * exactly the failure ADR-016 forbids. Verification always dispatches on the STORED algorithm, so a
 * credential hashed under either can always be checked regardless of the current default.
 */
export function selectPasswordHasher(env: NodeJS.ProcessEnv = process.env): PasswordHasher {
  return env['FINAPP_PASSWORD_HASHER'] === 'scrypt' ? scryptHasher : argon2idHasher;
}

/** Verifies against whichever algorithm the credential was stored under. */
export async function verifyPassword(
  storedAlgorithm: string,
  encoded: string,
  password: string,
): Promise<boolean> {
  if (storedAlgorithm === 'scrypt') return scryptHasher.verify(encoded, password);
  return argon2idHasher.verify(encoded, password);
}

// --- tokens ---------------------------------------------------------------------------------------

/** A fresh 256-bit random secret, URL-safe. Returned to the client once; never stored raw. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex of a token — what is stored and what a lookup compares against. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * A stable, non-reversible reference for a login identifier, so `login_attempts` can rate-limit by
 * identifier without storing it (and without storing the password, ever). Domain-separated from token
 * hashing so the two spaces never collide.
 */
export function hashLoginRef(normalizedIdentifier: string): string {
  return createHash('sha256').update(`login-ref:${normalizedIdentifier}`, 'utf8').digest('hex');
}
