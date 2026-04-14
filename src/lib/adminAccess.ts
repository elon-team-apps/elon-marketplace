/** Primary account that gets full admin in the UI when profile/RLS misbehaves (e.g. recursion on `profiles`). */
export const SUPERADMIN_EMAIL = "growthprofesors@gmail.com";

const SUPERADMIN_ALIASES = new Set([
  SUPERADMIN_EMAIL.toLowerCase(),
  // Common spelling variant if the inbox was registered with double "s"
  "growthprofessors@gmail.com",
]);

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return e.length > 0 && SUPERADMIN_ALIASES.has(e);
}

/** True when DB flags admin, legacy role admin, or superadmin email (session email). */
export function resolveIsAdmin(params: {
  is_admin_column: boolean;
  role_is_admin: boolean;
  email: string | null | undefined;
}): boolean {
  return params.is_admin_column || params.role_is_admin || isSuperAdminEmail(params.email);
}
