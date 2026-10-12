import { Router } from 'express';
import {
  login,
  changePassword,
  completeProfile,
  changeEmail,
  me,
  forgotPassword,
  resetPassword,
} from '../controllers/auth.controller';
import { requireAuth, blockIfMustChangePassword } from '../middleware/auth.middleware';
import { accountChangeRateLimiter, passwordResetRateLimiter } from '../middleware/rateLimit.middleware';

export const authRouter = Router();

authRouter.post('/login', login);
authRouter.get('/me', requireAuth, me);

// Forgot / reset password. Public on purpose -- the person can't log in.
// Rate-limited because forgot-password sends an email on every call.
authRouter.post('/forgot-password', passwordResetRateLimiter, forgotPassword);
authRouter.post('/reset-password', passwordResetRateLimiter, resetPassword);

// Note: deliberately NOT behind blockIfMustChangePassword --
// a user with a temp password must be able to call this route
// before anything else works.
authRouter.post('/change-password', requireAuth, changePassword);
authRouter.post('/complete-profile', requireAuth, completeProfile);

// Changing your own email is treated as a sensitive account action:
//  - requireAuth: must have a valid session
//  - blockIfMustChangePassword: only reachable once onboarding is done,
//    i.e. from the real Settings page, not mid-forced-password-change
//  - accountChangeRateLimiter: rate-limited separately from login, keyed
//    per-account rather than per-IP (see middleware/rateLimit.middleware.ts)
authRouter.post(
  '/change-email',
  requireAuth,
  blockIfMustChangePassword,
  accountChangeRateLimiter,
  changeEmail
);