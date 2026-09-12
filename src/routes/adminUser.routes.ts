import { Router } from 'express';
import {
  listAdminUsers,
  inviteAdminUser,
  setAdminUserActive,
  updateAdminUserRole,
} from '../controllers/adminUser.controller';
import {
  requireAuth,
  blockIfMustChangePassword,
  requirePermission,
} from '../middleware/auth.middleware';

export const adminUserRouter = Router();

adminUserRouter.use(requireAuth, blockIfMustChangePassword, requirePermission('user.manage'));

adminUserRouter.get('/', listAdminUsers);
adminUserRouter.post('/invite', inviteAdminUser);
adminUserRouter.patch('/:id/active', setAdminUserActive);
adminUserRouter.patch('/:id/role', updateAdminUserRole);
