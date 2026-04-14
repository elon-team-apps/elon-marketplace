import { useApp } from "@/context/AppContext";
import { isSuperAdminEmail } from "@/lib/adminAccess";

/**
 * Thin auth facade for routes and layouts. Delegates to `AppContext`
 * (admin includes superadmin email bypass when profile sync fails).
 */
export function useAuth() {
  const {
    currentUser,
    profileLoaded,
    isAdmin,
    isAdminView,
    profileSyncWarning,
    clearSessionAndHardRefresh,
    refreshProfile,
    toggleAdminView,
  } = useApp();

  const emailAdminOverride = isSuperAdminEmail(currentUser?.email);
  const resolvedIsAdmin = isAdmin || emailAdminOverride;

  return {
    user: currentUser,
    profileLoaded,
    isAdmin: resolvedIsAdmin,
    isAdminView,
    profileSyncWarning,
    clearSessionAndHardRefresh,
    refreshProfile,
    toggleAdminView,
  };
}
