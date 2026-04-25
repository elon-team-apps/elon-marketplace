/** True when DB flags admin or legacy role admin. */
export function resolveIsAdmin(params: {
  is_admin_column: boolean;
  role_is_admin: boolean;
}): boolean {
  return params.is_admin_column || params.role_is_admin;
}
