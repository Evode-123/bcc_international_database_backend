import bcrypt from 'bcrypt';
import { AppDataSource } from '../config/data-source';
import { Role } from '../entities/Role';
import { Permission } from '../entities/Permission';
import { RolePermission } from '../entities/RolePermission';
import { Language } from '../entities/Language';
import { AdminUser } from '../entities/AdminUser';
import { env } from '../config/env';
import { generateTempPassword } from '../utils/password.util';
import { sendTempPasswordEmail } from './email.service';

const PERMISSIONS = [
  { name: 'disciple.view', description: 'View disciple records' },
  { name: 'disciple.create', description: 'Add new disciple records' },
  { name: 'disciple.edit', description: 'Edit existing disciple records' },
  { name: 'disciple.delete', description: 'Delete disciple records' },
  { name: 'report.generate', description: 'Generate and export reports' },
  { name: 'user.manage', description: 'Create, edit, deactivate other admin users' },
  // Split out from user.manage so that granting one no longer silently
  // grants the others -- each now maps to exactly one sidebar link and
  // one set of backend routes.
  {
    name: 'location.manage',
    description: 'Add, edit, and delete continents, countries, centers, and sites',
  },
  {
    name: 'role.manage',
    description: 'Create roles and grant or revoke permissions on the Roles & Permissions page',
  },
] as const;

const ROLE_PERMISSION_MAP: Record<string, string[]> = {
  super_admin: PERMISSIONS.map((p) => p.name),
  // Admins run day-to-day training operations, including keeping the
  // location tree (centers/sites) up to date -- but they don't create
  // other admin accounts or touch the permissions matrix itself.
  admin: PERMISSIONS.filter(
    (p) => p.name !== 'user.manage' && p.name !== 'role.manage'
  ).map((p) => p.name),
  // Teachers are the most restricted: no deleting disciples, no managing
  // locations, no managing users or roles.
  teacher: PERMISSIONS.filter(
    (p) =>
      p.name !== 'user.manage' &&
      p.name !== 'role.manage' &&
      p.name !== 'location.manage' &&
      p.name !== 'disciple.delete'
  ).map((p) => p.name),
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  super_admin: 'Full system access, including managing other admin users',
  admin: 'Manage disciples, locations, and reports, cannot manage other admin users or roles',
  teacher: 'View and add disciples, generate reports, cannot delete',
};

const STARTER_LANGUAGES = ['Kinyarwanda', 'English', 'French'];

/**
 * Idempotent seed -- safe to run every time the server starts.
 * Uses find-then-create (TypeORM has no built-in upsert-by-unique-key
 * helper as simple as Prisma's) so re-running never creates duplicates.
 *
 * Note: this only ever ADDS a grant that's currently missing -- it never
 * removes one. So if a super_admin later unchecks a box in Roles &
 * Permissions, restarting the server will NOT silently re-grant it. This
 * is also why adding location.manage/role.manage here is safe on an
 * already-running system: existing roles simply pick up the sensible
 * defaults below the first time the server restarts after this change,
 * and can be adjusted from the Roles & Permissions page afterwards like
 * any other permission.
 */
export async function runSeed(): Promise<void> {
  const roleRepo = AppDataSource.getRepository(Role);
  const permissionRepo = AppDataSource.getRepository(Permission);
  const rolePermissionRepo = AppDataSource.getRepository(RolePermission);
  const languageRepo = AppDataSource.getRepository(Language);
  const adminUserRepo = AppDataSource.getRepository(AdminUser);

  // 1. Permissions
  for (const perm of PERMISSIONS) {
    const existing = await permissionRepo.findOne({ where: { name: perm.name } });
    if (!existing) {
      await permissionRepo.save(permissionRepo.create(perm));
    }
  }

  // 2. Roles
  for (const roleName of Object.keys(ROLE_PERMISSION_MAP)) {
    const existing = await roleRepo.findOne({ where: { name: roleName } });
    if (!existing) {
      await roleRepo.save(
        roleRepo.create({ name: roleName, description: ROLE_DESCRIPTIONS[roleName] })
      );
    }
  }

  // 3. role_permissions junction rows
  for (const [roleName, permissionNames] of Object.entries(ROLE_PERMISSION_MAP)) {
    const role = await roleRepo.findOneOrFail({ where: { name: roleName } });

    for (const permissionName of permissionNames) {
      const permission = await permissionRepo.findOneOrFail({
        where: { name: permissionName },
      });

      const existingGrant = await rolePermissionRepo.findOne({
        where: { roleId: role.id, permissionId: permission.id },
      });

      if (!existingGrant) {
        await rolePermissionRepo.save(
          rolePermissionRepo.create({ roleId: role.id, permissionId: permission.id })
        );
      }
    }
  }

  // 4. Starter languages
  for (const name of STARTER_LANGUAGES) {
    const existing = await languageRepo.findOne({ where: { name } });
    if (!existing) {
      await languageRepo.save(languageRepo.create({ name }));
    }
  }

  // 5. Auto-seed the very first super_admin account, only if none exists yet.
  //    createdById stays NULL for this one user -- it has no human creator.
  const existingSuperAdmin = await adminUserRepo.findOne({
    where: { role: { name: 'super_admin' } },
    relations: { role: true },
  });

  if (!existingSuperAdmin) {
    const superAdminRole = await roleRepo.findOneOrFail({ where: { name: 'super_admin' } });

    // Generated fresh on every deployment that has no super_admin yet --
    // nobody, including you, needs to know or set this in advance. It only
    // ever reaches the super_admin via email, exactly like every other
    // invited user.
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    await adminUserRepo.save(
      adminUserRepo.create({
        fullName: env.superAdmin.fullName,
        email: env.superAdmin.email,
        passwordHash,
        roleId: superAdminRole.id,
        mustChangePassword: true,
        profileCompleted: false,
        isActive: true,
        createdById: null,
      })
    );

    try {
      await sendTempPasswordEmail(env.superAdmin.email, env.superAdmin.fullName, tempPassword);
      console.log(
        `[seed] Auto-created super_admin account and emailed credentials to ${env.superAdmin.email}.`
      );
    } catch (err) {
      console.error(
        `[seed] Created super_admin account for ${env.superAdmin.email}, ` +
          `but FAILED to send the credentials email:`,
        err
      );
      console.error(
        `[seed] Temporary password (since the email failed -- save this now): ${tempPassword}`
      );
    }
  }

  console.log('[seed] Roles, permissions, and languages are up to date.');
}