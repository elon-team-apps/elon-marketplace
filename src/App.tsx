import { Component, ReactNode, Suspense, lazy, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "./context/AppContext";
import { useAuth } from "./hooks/useAuth";

const loadLandingPage = () => import("./app/page");
const loadAuthPage = () => import("./pages/AuthPage");
const loadDashboardLayout = () => import("./components/DashboardLayout");
const loadDashboardHome = () => import("./pages/DashboardHome");
const loadProductsPage = () => import("./pages/ProductsPage");
const loadOrdersPage = () => import("./pages/OrdersPage");
const loadPaymentsPage = () => import("./pages/PaymentsPage");
const loadSettingsPage = () => import("./pages/SettingsPage");
const loadSupportPage = () => import("./pages/SupportPage");
const loadWalletPage = () => import("./pages/WalletPage");
const loadNotFound = () => import("./pages/NotFound");
const loadAdminDashboard = () => import("./pages/admin/AdminDashboard");
const loadAdminProducts = () => import("./pages/admin/AdminProducts");
const loadAdminUsers = () => import("./pages/admin/AdminUsers");
const loadAdminOrders = () => import("./pages/admin/AdminOrders");
const loadAdminDeposits = () => import("./pages/admin/AdminDeposits");

const LandingPage = lazy(loadLandingPage);
const AuthPage = lazy(loadAuthPage);
const DashboardLayout = lazy(loadDashboardLayout);
const DashboardHome = lazy(loadDashboardHome);
const ProductsPage = lazy(loadProductsPage);
const OrdersPage = lazy(loadOrdersPage);
const PaymentsPage = lazy(loadPaymentsPage);
const SettingsPage = lazy(loadSettingsPage);
const SupportPage = lazy(loadSupportPage);
const WalletPage = lazy(loadWalletPage);
const NotFound = lazy(loadNotFound);
const AdminDashboard = lazy(loadAdminDashboard);
const AdminProducts = lazy(loadAdminProducts);
const AdminUsers = lazy(loadAdminUsers);
const AdminOrders = lazy(loadAdminOrders);
const AdminDeposits = lazy(loadAdminDeposits);

const queryClient = new QueryClient();

function RouteLoading() {
  return (
    <div className="min-h-screen bg-background/95 flex flex-col items-center justify-center gap-3">
      <div className="h-9 w-9 rounded-full border-2 border-[#0f172a] border-t-transparent animate-spin" />
      <p className="text-sm text-slate-700">Loading page...</p>
    </div>
  );
}

class RouteErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
          <div className="glass-card max-w-md w-full p-6 text-center space-y-3">
            <h2 className="text-lg font-bold text-foreground">Page failed to load</h2>
            <p className="text-sm text-muted-foreground">Please refresh to retry loading this page.</p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { profileLoaded, currentUser } = useApp();
  if (!profileLoaded) return <RouteLoading />;
  if (!currentUser?.id) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

/**
 * Prevent /auth <-> /dashboard ping-pong:
 * - Wait until auth/profile bootstrap is done.
 * - If user is already authenticated, send to dashboard unless caller explicitly requested fresh auth.
 */
function AuthRoute({ children }: { children: ReactNode }) {
  const { profileLoaded, currentUser } = useApp();
  const [searchParams] = useSearchParams();
  if (!profileLoaded) return <RouteLoading />;
  if (currentUser?.id && !searchParams.has("fresh")) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/** Admin pages — DB admin, legacy role admin, or superadmin email bypass (see `adminAccess.ts`). */
function AdminRoute({ children }: { children: ReactNode }) {
  const { profileLoaded, isAdmin } = useAuth();
  if (!profileLoaded) return <RouteLoading />;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AdminChunkPrefetcher() {
  const { profileLoaded, isAdmin } = useAuth();
  useEffect(() => {
    if (!profileLoaded || !isAdmin) return;
    void loadAdminDashboard();
    void loadAdminProducts();
    void loadAdminUsers();
    void loadAdminOrders();
    void loadAdminDeposits();
  }, [profileLoaded, isAdmin]);
  return null;
}

function AppRoutes() {
  return (
    <>
      <AdminChunkPrefetcher />
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route
            path="/auth"
            element={
              <AuthRoute>
                <AuthPage />
              </AuthRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            {/* User routes */}
            <Route index element={<DashboardHome />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="payments" element={<PaymentsPage />} />
            <Route path="wallet" element={<WalletPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="support" element={<SupportPage />} />
            {/* Admin routes */}
            <Route
              path="admin"
              element={
                <AdminRoute>
                  <AdminDashboard />
                </AdminRoute>
              }
            />
            <Route
              path="admin/products"
              element={
                <AdminRoute>
                  <AdminProducts />
                </AdminRoute>
              }
            />
            <Route
              path="admin/users"
              element={
                <AdminRoute>
                  <AdminUsers />
                </AdminRoute>
              }
            />
            <Route
              path="admin/deposits"
              element={
                <AdminRoute>
                  <AdminDeposits />
                </AdminRoute>
              }
            />
            <Route
              path="admin/orders"
              element={
                <AdminRoute>
                  <AdminOrders />
                </AdminRoute>
              }
            />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <RouteErrorBoundary>
          <AppRoutes />
        </RouteErrorBoundary>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
