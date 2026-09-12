// Central place for the "which roles are tied to a single site" rule.
//
// Roles are created dynamically (see permission.controller.ts's createRole
// -- a super_admin can name a role anything, e.g. "leader"), so we can't
// keep a hardcoded list of site-scoped role names in sync by hand. Instead
// the rule is: admin and super_admin see everything across every site;
// every other role (teacher, leader, or anything else created later) is
// tied to exactly one site.
export const UNSCOPED_ROLE_NAMES = new Set(['admin', 'super_admin']);

export function isSiteScopedRole(roleName: string | undefined | null): boolean {
  if (!roleName) return false;
  return !UNSCOPED_ROLE_NAMES.has(roleName);
}