import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Request } from 'express';

/**
 * Rate-limits login attempts. Keyed by IP + the email being attempted
 * (not just IP alone) so that:
 *  - a brute-force sweep against ONE account from one IP gets blocked fast
 *  - many different legitimate users behind the same office/shared IP
 *    don't lock each other out by coincidence
 *
 * Uses express-rate-limit's ipKeyGenerator helper (rather than the raw
 * req.ip string) because IPv6 addresses can be represented many
 * equivalent ways -- without normalizing via this helper, someone could
 * vary their IPv6 representation slightly on each request and bypass the
 * limit entirely.
 *
 * 10 attempts per 15 minutes per (IP, email) pair is generous enough for
 * genuine typos but tight enough to make password-guessing impractical.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : 'unknown';
    return `${ipKeyGenerator(req.ip || '')}:${email}`;
  },
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too many login attempts. Please wait a few minutes and try again.',
    });
  },
});

/**
 * Rate-limits sensitive, ALREADY-AUTHENTICATED account actions that
 * re-verify the current password -- currently just change-email, but
 * built generically so change-password or similar can reuse it later.
 *
 * Keyed by the authenticated user's id (this middleware always runs
 * after requireAuth, so req.user is guaranteed to be populated) rather
 * than by IP/email like loginRateLimiter above. That distinction matters
 * here: the attacker in this scenario already holds a valid session for
 * a specific account and is trying to guess that ONE account's current
 * password to hijack it -- so the limit needs to follow the account, not
 * the guessed credential. Falls back to IP if req.user is somehow absent,
 * which should never happen given the middleware ordering but keeps this
 * limiter safe to use defensively.
 *
 * 5 attempts per 15 minutes is intentionally tighter than login's 10 --
 * a legitimate user rarely mistypes their own current password more than
 * once or twice in a row.
 */
export const accountChangeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    const userId = req.user?.id;
    return userId ? `account-change:${userId}` : `account-change:${ipKeyGenerator(req.ip || '')}`;
  },
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too many attempts. Please wait a few minutes and try again.',
    });
  },
});