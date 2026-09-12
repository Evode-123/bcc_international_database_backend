import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../config/data-source';
import { AdminUser } from '../entities/AdminUser';
import { LoginAttempt } from '../entities/LoginAttempt';
import { PasswordResetToken } from '../entities/PasswordResetToken';
import { RolePermission } from '../entities/RolePermission';
import { env } from '../config/env';
import { generateResetToken, hashResetToken } from '../utils/resetToken.util';
import { sendPasswordResetEmail, sendEmailChangedNotice } from '../services/email.service';

/**
 * Shapes the site info attached to login/me responses -- null for
 * admin/super_admin (unscoped), populated for every other role so the
 * frontend can lock the location cascade on the disciple forms to this
 * user's own site instead of showing the full continent→country→center→site
 * picker (see roleScope.util.ts for the scoping rule itself).
 */
function shapeSiteInfo(user: AdminUser) {
  if (!user.site) return null;
  return {
    id: user.site.id,
    name: user.site.name,
    centerId: user.site.center?.id ?? null,
    centerName: user.site.center?.name ?? null,
    countryId: user.site.center?.country?.id ?? null,
    countryName: user.site.center?.country?.name ?? null,
    continentId: user.site.center?.country?.continentId ?? null,
  };
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Returns the flat list of permission names (e.g. "disciple.edit") granted
 * to a role right now. This is what lets the frontend show/hide buttons
 * and sidebar links to match reality, instead of guessing from the role
 * name alone -- so when a super_admin unchecks "disciple.delete" for the
 * "teacher" role in Roles & Permissions, every teacher's delete button
 * disappears without anyone touching frontend code.
 */
async function getPermissionNamesForRole(roleId: number): Promise<string[]> {
  const rolePermissionRepo = AppDataSource.getRepository(RolePermission);
  const grants = await rolePermissionRepo.find({
    where: { roleId },
    relations: { permission: true },
  });
  return grants.map((g) => g.permission.name);
}

/**
 * Records one row per login attempt, success or failure. Never throws --
 * a logging failure should never block or break the login flow itself.
 */
async function recordLoginAttempt(
  req: Request,
  email: string,
  successful: boolean,
  failureReason?: string
): Promise<void> {
  try {
    const loginAttemptRepo = AppDataSource.getRepository(LoginAttempt);
    await loginAttemptRepo.save(
      loginAttemptRepo.create({
        email,
        successful,
        failureReason,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']?.toString().slice(0, 255),
      })
    );
  } catch (err) {
    console.error('[auth] Failed to record login attempt:', err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const adminUserRepo = AppDataSource.getRepository(AdminUser);
    const user = await adminUserRepo.findOne({
      where: { email },
      relations: { role: true, site: { center: { country: true } } },
    });

    if (!user) {
      await recordLoginAttempt(req, email, false, 'user_not_found');
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    if (!user.isActive) {
      await recordLoginAttempt(req, email, false, 'account_deactivated');
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      await recordLoginAttempt(req, email, false, 'wrong_password');
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    await recordLoginAttempt(req, email, true);

    const token = jwt.sign({ sub: String(user.id) }, env.jwtSecret as string, {
      expiresIn: env.jwtExpiresIn,
    } as jwt.SignOptions);

    const permissions = await getPermissionNamesForRole(user.roleId);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        role: user.role.name,
        // Exact list of what this user is allowed to do -- e.g.
        // ["disciple.view", "disciple.create", "report.generate"].
        // The frontend uses this to decide what buttons/links to show.
        permissions,
        // Null for admin/super_admin. For every other role, this is the
        // one site their disciple data is locked to on both ends -- the
        // frontend uses it to auto-select/lock the site picker, and the
        // backend independently enforces the same restriction regardless
        // of what the frontend sends.
        site: shapeSiteInfo(user),
        mustChangePassword: user.mustChangePassword,
        profileCompleted: user.profileCompleted,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Sets a new password for the currently logged-in user. Used both for the
 * FORCED first-time change (mustChangePassword: true) and for a user who
 * simply wants to change their password later, voluntarily -- there's
 * nothing first-time-specific about this endpoint; it always accepts a
 * new password for whoever the valid JWT belongs to.
 */
export async function changePassword(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { newPassword } = req.body as { newPassword?: string };

    if (!newPassword || newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    const adminUserRepo = AppDataSource.getRepository(AdminUser);
    await adminUserRepo.update(
      { id: req.user!.id },
      { passwordHash, mustChangePassword: false }
    );

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    next(err);
  }
}

export async function completeProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { fullName, phoneNumber } = req.body as {
      fullName?: string;
      phoneNumber?: string;
    };

    if (!fullName) {
      res.status(400).json({ error: 'Full name is required' });
      return;
    }

    const adminUserRepo = AppDataSource.getRepository(AdminUser);
    await adminUserRepo.update(
      { id: req.user!.id },
      { fullName, phoneNumber, profileCompleted: true }
    );

    res.json({ message: 'Profile completed successfully' });
  } catch (err) {
    next(err);
  }
}

/**
 * Changes the current user's own email address. Deliberately treated as a
 * sensitive, security-relevant action rather than a plain profile edit:
 *
 *  - Requires the CURRENT password to be re-entered, even though the
 *    request is already authenticated by JWT. This is what stops someone
 *    who merely has an active session (a stolen token, an XSS-read
 *    cookie, an unlocked shared computer) from silently taking over the
 *    account by swapping the email and then using "forgot password" on
 *    the new address.
 *  - Rejects duplicates case-insensitively. The `email` column's unique
 *    constraint is case-sensitive, so without this check
 *    "Bob@example.com" and "bob@example.com" could otherwise both exist.
 *  - Sends a best-effort notification to the OLD address on success, so
 *    the real account owner is alerted even if they weren't the one who
 *    made the change. Never blocks the response if that email fails to
 *    send -- the change itself has already succeeded by that point.
 *  - Does NOT log the user out server-side (this JWT design has no token
 *    revocation/blocklist), but the frontend discards its local token and
 *    forces a fresh login with the new email as a UX/security measure.
 */
export async function changeEmail(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { newEmail, currentPassword } = req.body as {
      newEmail?: string;
      currentPassword?: string;
    };

    if (!newEmail || !currentPassword) {
      res.status(400).json({ error: 'New email and current password are required' });
      return;
    }

    const normalizedEmail = newEmail.trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      res.status(400).json({ error: 'Please enter a valid email address' });
      return;
    }

    const adminUserRepo = AppDataSource.getRepository(AdminUser);
    const user = await adminUserRepo.findOne({ where: { id: req.user!.id } });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const passwordMatches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordMatches) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    if (normalizedEmail === user.email.toLowerCase()) {
      res.status(400).json({ error: 'This is already your current email address' });
      return;
    }

    const existing = await adminUserRepo
      .createQueryBuilder('u')
      .where('LOWER(u.email) = :email', { email: normalizedEmail })
      .getOne();

    if (existing) {
      res.status(409).json({ error: 'That email address is already in use' });
      return;
    }

    const oldEmail = user.email;
    user.email = normalizedEmail;
    await adminUserRepo.save(user);

    try {
      await sendEmailChangedNotice(oldEmail, user.fullName || oldEmail, normalizedEmail);
    } catch (err) {
      console.error(`[auth] Failed to send email-change notice to ${oldEmail}:`, err);
    }

    res.json({ message: 'Email address updated successfully', email: normalizedEmail });
  } catch (err) {
    next(err);
  }
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const adminUserRepo = AppDataSource.getRepository(AdminUser);
    const user = await adminUserRepo.findOne({
      where: { id: req.user!.id },
      relations: { role: true, site: { center: { country: true } } },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Always re-read from role_permissions rather than trusting anything
    // cached on the token -- this is what makes a super_admin's change in
    // Roles & Permissions take effect for that user the moment their app
    // next calls /auth/me (see AuthContext's refreshPermissions, called on
    // every page load), without needing them to log out and back in.
    const permissions = await getPermissionNamesForRole(user.roleId);

    res.json({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      role: user.role.name,
      permissions,
      site: shapeSiteInfo(user),
      mustChangePassword: user.mustChangePassword,
      profileCompleted: user.profileCompleted,
      createdAt: user.createdAt,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Starts a password reset: generates a single-use token, emails a reset
 * link, and stores only the token's hash. Always responds with the same
 * generic message regardless of whether the email matched a real account
 * -- this prevents the endpoint being used to discover which emails have
 * accounts on the system.
 */
export async function forgotPassword(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email } = req.body as { email?: string };
    const genericResponse = {
      message: 'If that email is associated with an account, a reset link has been sent.',
    };

    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const adminUserRepo = AppDataSource.getRepository(AdminUser);
    const user = await adminUserRepo.findOne({ where: { email } });

    if (!user || !user.isActive) {
      res.json(genericResponse);
      return;
    }

    const { plaintext, hash } = generateResetToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    const resetTokenRepo = AppDataSource.getRepository(PasswordResetToken);
    await resetTokenRepo.save(
      resetTokenRepo.create({
        adminUserId: user.id,
        tokenHash: hash,
        expiresAt,
      })
    );

    const resetUrl = `${env.clientUrl}/reset-password?token=${plaintext}`;

    try {
      await sendPasswordResetEmail(user.email, user.fullName || user.email, resetUrl);
    } catch (err) {
      console.error(`[auth] Failed to send password reset email to ${user.email}:`, err);
    }

    res.json(genericResponse);
  } catch (err) {
    next(err);
  }
}

/**
 * Completes a password reset using the token from the emailed link.
 * The token is single-use (marked usedAt on success) and time-limited
 * (expiresAt, checked against the current time).
 */
export async function resetPassword(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { token, newPassword } = req.body as { token?: string; newPassword?: string };

    if (!token || !newPassword) {
      res.status(400).json({ error: 'token and newPassword are required' });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters' });
      return;
    }

    const tokenHash = hashResetToken(token);

    const resetTokenRepo = AppDataSource.getRepository(PasswordResetToken);
    const resetToken = await resetTokenRepo.findOne({ where: { tokenHash } });

    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt.getTime() < Date.now()
    ) {
      res.status(400).json({ error: 'This reset link is invalid or has expired' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    const adminUserRepo = AppDataSource.getRepository(AdminUser);
    await adminUserRepo.update(
      { id: resetToken.adminUserId },
      { passwordHash, mustChangePassword: false }
    );

    resetToken.usedAt = new Date();
    await resetTokenRepo.save(resetToken);

    res.json({ message: 'Password has been reset. You can now log in.' });
  } catch (err) {
    next(err);
  }
}