import crypto from 'crypto';

/**
 * Generates a readable random temporary password, e.g. "bV4-kP9q-Lw2x".
 * Avoids ambiguous characters (0/O, 1/l/I) to reduce data-entry mistakes
 * when someone types it in from an email.
 */
export function generateTempPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const randomChunk = (length: number) =>
    Array.from(crypto.randomFillSync(new Uint8Array(length)))
      .map((b) => alphabet[b % alphabet.length])
      .join('');

  return `${randomChunk(4)}-${randomChunk(4)}-${randomChunk(4)}`;
}
