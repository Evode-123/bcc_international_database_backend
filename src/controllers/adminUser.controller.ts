import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { AppDataSource } from '../config/data-source';
import { AdminUser } from '../entities/AdminUser';
import { Role } from '../entities/Role';
import { Site } from '../entities/Site';
import { generateTempPassword } from '../utils/password.util';
import { sendTempPasswordEmail } from '../services/email.service';
import { parseIdParam } from '../utils/params.util';
import { isSiteScopedRole } from '../utils/roleScope.util';

export async function listAdminUsers(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const adminUserRepo = AppDataSource.getRepository(AdminUser);
    const users = await adminUserRepo.find({
      relations: { role: true, site: { center: true } },
      order: { createdAt: 'DESC' },
    });

    // Super Admin accounts are only visible to other Super Admins. Someone
    // with just "user.manage" (e.g. a regular admin) can invite and manage
    // ordinary admin/teacher accounts, but should never even learn that a
    // Super Admin account exists on this system, let alone act on it.
    const isSuperAdmin = req.user!.roleName === 'super_admin';
    const visibleUsers = isSuperAdmin
      ? users
      : users.filter((u) => u.role.name !== 'super_admin');

    res.json(
      visibleUsers.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        role: u.role.name,
        isActive: u.isActive,
        mustChangePassword: u.mustChangePassword,
        profileCompleted: u.profileCompleted,
        createdAt: u.createdAt,
        siteId: u.siteId ?? null,
        siteName: u.site?.name ?? null,
        centerName: u.site?.center?.name ?? null,
      }))
    );
  } catch (err) {
    next(err);
  }
}

export async function inviteAdminUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { fullName, email, roleName, siteId } = req.body as {
      fullName?: string;
      email?: string;
      roleName?: string;
      siteId?: number | string;
    };

    if (!email || !roleName) {
      res.status(400).json({ error: 'email and roleName are required' });
      return;
    }

    const roleRepo = AppDataSource.getRepository(Role);
    const role = await roleRepo.findOne({ where: { name: roleName } });
    if (!role) {
      res.status(400).json({ error: `Unknown role: ${roleName}` });
      return;
    }

    // Belt-and-braces: the "Invite user" dropdown on the frontend already
    // never offers "super_admin" as an option to non-Super-Admins (see
    // lookup.controller.ts's getRoles), but this stops a direct API call
    // from bypassing that and minting a new Super Admin account anyway.
    if (role.name === 'super_admin' && req.user!.roleName !== 'super_admin') {
      res.status(403).json({ error: 'Only a Super Admin can create another Super Admin account' });
      return;
    }

    // Any role other than admin/super_admin is tied to exactly one site --
    // that's what scopes their view of disciples/dashboard/reports down to
    // just that site instead of the whole system (see roleScope.util.ts
    // and the site-scoping in disciple.controller.ts / dashboard.controller.ts).
    let resolvedSiteId: number | null = null;
    if (isSiteScopedRole(role.name)) {
      const parsedSiteId = typeof siteId === 'string' ? parseInt(siteId, 10) : siteId;
      if (!parsedSiteId || Number.isNaN(parsedSiteId)) {
        res.status(400).json({
          error: `Please select the site this ${role.name} belongs to.`,
        });
        return;
      }

      const siteRepo = AppDataSource.getRepository(Site);
      const site = await siteRepo.findOne({ where: { id: parsedSiteId } });
      if (!site) {
        res.status(400).json({ error: 'siteId does not match any existing site' });
        return;
      }
      resolvedSiteId = site.id;
    }

    const adminUserRepo = AppDataSource.getRepository(AdminUser);
    const existing = await adminUserRepo.findOne({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'A user with this email already exists' });
      return;
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const newUser = await adminUserRepo.save(
      adminUserRepo.create({
        fullName,
        email,
        passwordHash,
        roleId: role.id,
        // Null for admin/super_admin -- only ever set for site-scoped roles.
        siteId: resolvedSiteId,
        mustChangePassword: true,
        profileCompleted: false,
        isActive: true,
        createdById: req.user!.id,
      })
    );

    await sendTempPasswordEmail(email, fullName || email, tempPassword);

    res.status(201).json({
      id: newUser.id,
      email: newUser.email,
      role: role.name,
      siteId: newUser.siteId ?? null,
      message: 'Invite sent. The user will receive their temporary password by email.',
    });
  } catch (err) {
    next(err);
  }
}

export async function setAdminUserActive(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = parseIdParam(req.params.id);
    const { isActive } = req.body as { isActive?: boolean };

    if (typeof isActive !== 'boolean') {
      res.status(400).json({ error: 'isActive (boolean) is required' });
      return;
    }

    if (userId === req.user!.id && !isActive) {
      res.status(400).json({ error: 'You cannot deactivate your own account' });
      return;
    }

    const adminUserRepo = AppDataSource.getRepository(AdminUser);
    const target = await adminUserRepo.findOne({
      where: { id: userId },
      relations: { role: true },
    });

    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // A non-Super-Admin should never be able to activate/deactivate a
    // Super Admin account, even by guessing/crafting the request directly --
    // the frontend already hides this action for that row, this is the
    // enforcement that actually matters.
    if (target.role.name === 'super_admin' && req.user!.roleName !== 'super_admin') {
      res.status(403).json({ error: 'Only a Super Admin can manage another Super Admin account' });
      return;
    }

    await adminUserRepo.update({ id: userId }, { isActive });
    const updated = await adminUserRepo.findOneOrFail({ where: { id: userId } });

    res.json({ id: updated.id, isActive: updated.isActive });
  } catch (err) {
    next(err);
  }
}

export async function updateAdminUserRole(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = parseIdParam(req.params.id);
    const { roleName, siteId } = req.body as { roleName?: string; siteId?: number | string };

    if (!roleName) {
      res.status(400).json({ error: 'roleName is required' });
      return;
    }

    const roleRepo = AppDataSource.getRepository(Role);
    const role = await roleRepo.findOne({ where: { name: roleName } });
    if (!role) {
      res.status(400).json({ error: `Unknown role: ${roleName}` });
      return;
    }

    const isSuperAdmin = req.user!.roleName === 'super_admin';

    // Nobody except a Super Admin can hand out the Super Admin role to
    // someone else -- that would otherwise be a privilege-escalation path
    // for any admin with plain "user.manage".
    if (role.name === 'super_admin' && !isSuperAdmin) {
      res.status(403).json({ error: 'Only a Super Admin can promote a user to Super Admin' });
      return;
    }

    const adminUserRepo = AppDataSource.getRepository(AdminUser);
    const target = await adminUserRepo.findOne({
      where: { id: userId },
      relations: { role: true },
    });

    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // And nobody except a Super Admin can change what role an EXISTING
    // Super Admin has, for the same reason.
    if (target.role.name === 'super_admin' && !isSuperAdmin) {
      res.status(403).json({ error: "Only a Super Admin can change another Super Admin's role" });
      return;
    }

    // Moving INTO a site-scoped role (teacher, leader, or any other
    // non-admin role) requires a site -- either a new one sent with this
    // request, or the one the user already had. Moving OUT of a
    // site-scoped role (e.g. promoted to admin) always clears siteId, so a
    // stale site assignment never lingers on an account that shouldn't be
    // scoped anymore.
    let resolvedSiteId: number | null = null;
    if (isSiteScopedRole(role.name)) {
      const parsedSiteId = typeof siteId === 'string' ? parseInt(siteId, 10) : siteId;
      const effectiveSiteId = parsedSiteId || target.siteId || null;

      if (!effectiveSiteId) {
        res.status(400).json({ error: `Please select the site this ${role.name} belongs to.` });
        return;
      }

      const siteRepo = AppDataSource.getRepository(Site);
      const site = await siteRepo.findOne({ where: { id: effectiveSiteId } });
      if (!site) {
        res.status(400).json({ error: 'siteId does not match any existing site' });
        return;
      }
      resolvedSiteId = site.id;
    }

    await adminUserRepo.update({ id: userId }, { roleId: role.id, siteId: resolvedSiteId });

    res.json({ id: userId, role: roleName, siteId: resolvedSiteId });
  } catch (err) {
    next(err);
  }
}