import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppDataSource } from '../config/data-source';
import { AdminUser } from '../entities/AdminUser';
import { RolePermission } from '../entities/RolePermission';
import { AuthenticatedUser } from '../types/express';

/**
 * Verifies the JWT, loads the current admin user + role from the database
 * (not just trusting stale data in the token), and attaches it to req.user.
 *
 * Re-fetching on every request is deliberate: if an admin deactivates a user
 * mid-session, that user is locked out on their very next request, not just
 * after their token expires.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or malformed Authorization header' });
      return;
    }

    const token = header.slice('Bearer '.length);
    const decoded = jwt.verify(token, env.jwtSecret as string);

    if (typeof decoded === 'string' || typeof decoded.sub !== 'string') {
      res.status(401).json({ error: 'Invalid token payload' });
      return;
    }

    const userId = parseInt(decoded.sub, 10);
    if (Number.isNaN(userId)) {
      res.status(401).json({ error: 'Invalid token payload' });
      return;
    }

    const adminUserRepo = AppDataSource.getRepository(AdminUser);
    const user = await adminUserRepo.findOne({
      where: { id: userId },
      relations: { role: true },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Account not found or deactivated' });
      return;
    }

    const authedUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      roleId: user.roleId,
      roleName: user.role.name,
      mustChangePassword: user.mustChangePassword,
      profileCompleted: user.profileCompleted,
      siteId: user.siteId ?? null,
    };

    req.user = authedUser;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Blocks access until the user has changed their temporary password.
 * Apply this after requireAuth on every route except the
 * "change password" route itself.
 */
export function blockIfMustChangePassword(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.user?.mustChangePassword) {
    res.status(403).json({
      error: 'Password change required before continuing',
      code: 'MUST_CHANGE_PASSWORD',
    });
    return;
  }
  next();
}

/**
 * Permission-based authorization. Checks the role_permissions table for the
 * current user's role rather than hardcoding role names in route logic --
 * this is what lets you add new roles or change a role's permissions later
 * without touching any controller code.
 */
export function requirePermission(permissionName: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const rolePermissionRepo = AppDataSource.getRepository(RolePermission);
    const grant = await rolePermissionRepo.findOne({
      where: {
        roleId: req.user.roleId,
        permission: { name: permissionName },
      },
      relations: { permission: true },
    });

    if (!grant) {
      res.status(403).json({
        error: `Missing required permission: ${permissionName}`,
      });
      return;
    }

    next();
  };
}