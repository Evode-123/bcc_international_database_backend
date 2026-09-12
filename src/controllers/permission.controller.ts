import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/data-source';
import { Role } from '../entities/Role';
import { Permission } from '../entities/Permission';
import { RolePermission } from '../entities/RolePermission';
import { parseIdParam } from '../utils/params.util';

/**
 * Returns every role and every permission, plus which (role, permission)
 * pairs are currently granted -- exactly the shape the Roles & Permissions
 * matrix screen needs to render its checkbox grid in one request, rather
 * than the frontend stitching together three separate calls itself.
 *
 * The "super_admin" role itself is stripped out unless the requester is a
 * Super Admin. Someone with only "role.manage" (e.g. a regular admin who
 * was trusted with this page) should be able to configure what admins and
 * teachers can do -- but should never see, let alone edit, what the Super
 * Admin role is allowed to do. Mirrors how listAdminUsers hides Super
 * Admin accounts from non-Super-Admins.
 */
export async function getPermissionsMatrix(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const roleRepo = AppDataSource.getRepository(Role);
    const permissionRepo = AppDataSource.getRepository(Permission);
    const rolePermissionRepo = AppDataSource.getRepository(RolePermission);

    const [allRoles, permissions, allGrants] = await Promise.all([
      roleRepo.find({ order: { id: 'ASC' } }),
      permissionRepo.find({ order: { id: 'ASC' } }),
      rolePermissionRepo.find(),
    ]);

    const isSuperAdmin = req.user?.roleName === 'super_admin';
    const visibleRoles = isSuperAdmin
      ? allRoles
      : allRoles.filter((r) => r.name !== 'super_admin');
    const visibleRoleIds = new Set(visibleRoles.map((r) => r.id));

    // Drop any grant rows that belong to a role the requester can't even
    // see -- no reason to leak which permissions Super Admin has via this
    // array even if the role row itself is filtered out above.
    const visibleGrants = allGrants.filter((g) => visibleRoleIds.has(g.roleId));

    res.json({
      roles: visibleRoles.map((r) => ({ id: r.id, name: r.name, description: r.description })),
      permissions: permissions.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
      })),
      // [[roleId, permissionId], ...] -- compact, the frontend builds its
      // own lookup set from this rather than nesting permissions inside
      // each role, which would duplicate permission data once per role.
      grants: visibleGrants.map((g) => [g.roleId, g.permissionId]),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Grants or revokes a single permission on a single role. Idempotent in
 * both directions: granting an already-granted permission, or revoking
 * an already-absent one, both succeed without error.
 */
export async function setRolePermission(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const roleId = parseIdParam(req.params.roleId, 'roleId');
    const permissionId = parseIdParam(req.params.permissionId, 'permissionId');
    const { granted } = req.body as { granted?: boolean };

    if (typeof granted !== 'boolean') {
      res.status(400).json({ error: 'granted (boolean) is required' });
      return;
    }

    const roleRepo = AppDataSource.getRepository(Role);
    const permissionRepo = AppDataSource.getRepository(Permission);
    const rolePermissionRepo = AppDataSource.getRepository(RolePermission);

    const role = await roleRepo.findOne({ where: { id: roleId } });
    if (!role) {
      res.status(404).json({ error: 'Role not found' });
      return;
    }
    const permission = await permissionRepo.findOne({ where: { id: permissionId } });
    if (!permission) {
      res.status(404).json({ error: 'Permission not found' });
      return;
    }

    // Enforcement that actually matters -- the matrix already hides the
    // Super Admin column from non-Super-Admins above, but this is what
    // stops a crafted direct request (bypassing the UI entirely) from
    // still being able to add or remove a permission on that role.
    if (role.name === 'super_admin' && req.user!.roleName !== 'super_admin') {
      res.status(403).json({
        error: 'Only a Super Admin can change permissions for the Super Admin role',
      });
      return;
    }

    const existingGrant = await rolePermissionRepo.findOne({
      where: { roleId, permissionId },
    });

    if (granted && !existingGrant) {
      await rolePermissionRepo.save(rolePermissionRepo.create({ roleId, permissionId }));
    } else if (!granted && existingGrant) {
      await rolePermissionRepo.delete({ id: existingGrant.id });
    }
    // else: already in the desired state, nothing to do.

    res.json({ roleId, permissionId, granted });
  } catch (err) {
    next(err);
  }
}

/**
 * Creates a new role with zero permissions granted -- matching the
 * "New role" button in the mockup, which starts blank and lets the
 * super_admin check on only what that role needs.
 */
export async function createRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, description } = req.body as { name?: string; description?: string };

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const trimmedName = name.trim();

    // Belt-and-braces alongside the unique-name check below: stops anyone
    // who isn't already a Super Admin from naming a brand-new role
    // "super_admin" to sneak around the restrictions above.
    if (trimmedName.toLowerCase() === 'super_admin' && req.user!.roleName !== 'super_admin') {
      res.status(403).json({ error: 'Only a Super Admin can create a role named "super_admin"' });
      return;
    }

    const roleRepo = AppDataSource.getRepository(Role);
    const existing = await roleRepo.findOne({ where: { name: trimmedName } });
    if (existing) {
      res.status(409).json({ error: 'A role with this name already exists' });
      return;
    }

    const role = await roleRepo.save(roleRepo.create({ name: trimmedName, description }));
    res.status(201).json(role);
  } catch (err) {
    next(err);
  }
}