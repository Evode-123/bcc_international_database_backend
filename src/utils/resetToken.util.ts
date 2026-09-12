import crypto from 'crypto';

/**
 * Generates a cryptographically random reset token (the plaintext value
 * that goes in the email link) and its SHA-256 hash (the value stored in
 * the database). SHA-256 is appropriate here, unlike bcrypt for passwords --
 * this token is already high-entropy random data, not a human-chosen
 * secret, so there's no need for a slow, salted hash to resist guessing.
 */
export function generateResetToken(): { plaintext: string; hash: string } {
  const plaintext = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(plaintext).digest('hex');
  return { plaintext, hash };
}

export function hashResetToken(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}
