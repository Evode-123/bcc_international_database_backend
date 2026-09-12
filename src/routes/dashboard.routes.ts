import { Router } from 'express';
import { getDashboardStats } from '../controllers/dashboard.controller';
import { requireAuth, blockIfMustChangePassword, requirePermission } from '../middleware/auth.middleware';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth, blockIfMustChangePassword);

// All roles that can view disciples can see the dashboard
dashboardRouter.get('/stats', requirePermission('disciple.view'), getDashboardStats);
