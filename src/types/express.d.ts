export interface AuthenticatedUser {
  id: number;
  email: string;
  roleId: number;
  roleName: string;
  mustChangePassword: boolean;
  profileCompleted: boolean;
  // Present (non-null) only for site-scoped roles -- see roleScope.util.ts.
  // Always null/undefined for admin/super_admin.
  siteId?: number | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}