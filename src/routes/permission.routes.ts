import { Router } from 'express';
import {
  getPermissionsMatrix,
  setRolePermission,
  createRole,
} from '../controllers/permission.controller';
import {
  requireAuth,
  blockIfMustChangePassword,
  requirePermission,
} from '../middleware/auth.middleware';

export const permissionRouter = Router();

// Its own dedicated permission -- deliberately separate from user.manage.
// Being able to grant/revoke permissions (including granting user.manage
// or role.manage itself) is more sensitive than day-to-day admin-user
// management, so it shouldn't come bundled in automatically.
permissionRouter.use(requireAuth, blockIfMustChangePassword, requirePermission('role.manage'));

permissionRouter.get('/matrix', getPermissionsMatrix);
permissionRouter.post('/roles', createRole);
permissionRouter.put('/roles/:roleId/permissions/:permissionId', setRolePermission);
