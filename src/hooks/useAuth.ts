import { useApp } from "@/context/AppContext";

/**
 * Thin auth facade for routes and layouts. Delegates to `AppContext`.
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

  return {
    user: currentUser,
    profileLoaded,
    isAdmin,
    isAdminView,
    profileSyncWarning,
    clearSessionAndHardRefresh,
    refreshProfile,
    toggleAdminView,
  };
}
