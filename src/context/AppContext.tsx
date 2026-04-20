import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from "react";
import { supabase } from "@/lib/supabaseClient";
import { resolveLogoUrlFromTitle } from "@/lib/logoResolver";
import { isSuperAdminEmail } from "@/lib/adminAccess";
import { toast } from "sonner";

export interface Product {
  id: string;
  title: string;
  category: string;
  price: number;
  description: string;
  /** Optional DB pin flag for landing-page merchandising. */
  is_featured?: boolean;
  /** Optional admin-entered fallback shown when no live log_items exist yet. */
  manual_stock?: number;
  stock_count: number;
  // Backward-compat alias while remaining screens migrate.
  stock?: number;
  logs: string[];
  createdAt: string;
  image_url?: string;
  logo_url?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  wallet_balance: number;
  role: "admin" | "user" | "";  // mirrors profiles.role; "" while loading
  /** True when profiles.is_admin is true or role is admin (legacy). */
  is_admin: boolean;
  createdAt: string;
}

export interface Order {
  id: string;
  userId: string;
  userName: string;
  productId: string;
  productTitle: string;
  category: string;
  amount: number;
  deliveredLog: string;
  createdAt: string;
}

interface AppContextType {
  currentUser: User;
  profileLoaded: boolean;   // false until Supabase profile has been fetched
  /** Admin from DB flags, legacy role, or superadmin email bypass (see `adminAccess.ts`). */
  isAdmin: boolean;
  isAdminView: boolean;
  /** Non-null when profile fetch failed or threw (e.g. RLS / recursion); UI can show a soft warning. */
  profileSyncWarning: string | null;
  /** Clears app + auth storage, signs out, redirects to `/auth` for a clean session. */
  clearSessionAndHardRefresh: () => Promise<void>;
  products: Product[];
  users: User[];
  orders: Order[];
  toggleAdminView: () => void;
  addProduct: (product: Omit<Product, "id" | "createdAt">) => void;
  updateProduct: (id: string, updates: Partial<Omit<Product, "id" | "createdAt">>) => void;
  deleteProduct: (id: string) => void;
  purchaseProduct: (productId: string) => Promise<{ success: boolean; deliveredLog?: string; message: string }>;
  adjustWallet: (userId: string, amount: number, type: "add" | "deduct") => { success: boolean; message: string };
  topUpWallet: (amount: number) => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshProducts: () => Promise<void>;
  /** Merge one `products` row from Supabase into local state (e.g. right after admin insert). */
  mergeProductRowFromDb: (row: Record<string, unknown>) => void;
}

const STORAGE_KEY = "elon_marketplace_v2";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Neutral placeholder shown while the Supabase profile fetch is in-flight.
// is_admin stays false until syncProfile() loads `profiles.is_admin` / `role` from the database.
const loadingUser: User = {
  id: "",
  name: "",
  email: "",
  wallet_balance: 0,
  role: "",
  is_admin: false,
  createdAt: "",
};

const seedProducts: Product[] = [
  {
    id: "65ce3aaa-ab6f-4e6d-ab43-50625dab2646",
    title: "PURE Random Country FACEBOOK | 2007–2024",
    category: "Social Media",
    price: 1500,
    description: "Aged Facebook account with full profile, friends list, and genuine activity history. Verified email attached.",
    stock_count: 5,
    stock: 5,
    logs: [
      "john.smith@gmail.com:SecurePass123!:AQVDwERT...",
      "mary.jones@yahoo.com:MyPass456#:BRC9YUIO...",
      "bob.wilson@hotmail.com:Pass789$:CSD0HJKL...",
      "alice.brown@gmail.com:SecPass012%:DTE1MNBV...",
      "charlie.davis@outlook.com:Pass345^:EUF2QWER...",
    ],
    createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
    logo_url: "https://upload.wikimedia.org/wikipedia/commons/b/b8/2021_Facebook_icon.svg?v=2",
  },
  {
    id: "prod-2",
    title: "Aged INSTAGRAM Accounts | 2010–2023",
    category: "Social Media",
    price: 2000,
    description: "Established Instagram account with organic followers and post history. High trust score.",
    stock_count: 3,
    stock: 3,
    logs: [
      "ig.user1@gmail.com:IGPass123!:AQW7RTYU...",
      "ig.user2@yahoo.com:IGPass456#:BRX8UIOP...",
      "ig.user3@hotmail.com:IGPass789$:CSY9ASDF...",
    ],
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    logo_url: "https://upload.wikimedia.org/wikipedia/commons/e/e7/Instagram_logo_2016.svg?v=2",
  },
  {
    id: "prod-3",
    title: "Premium NETFLIX Accounts | Ready to Stream",
    category: "Streaming",
    price: 5000,
    description: "Streaming-ready Netflix account logs for immediate access.",
    stock_count: 2,
    stock: 2,
    logs: [
      "netflix.user1@gmail.com:NFPass123!:RecoveryMail1",
      "netflix.user2@yahoo.com:NFPass456#:RecoveryMail2",
    ],
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    logo_url: "https://upload.wikimedia.org/wikipedia/commons/0/08/Netflix_2015_logo.svg?v=2",
  },
];

const seedUsers: User[] = [
  loadingUser,
  {
    id: "user-2",
    name: "John Doe",
    email: "john@example.com",
    wallet_balance: 10000,
    role: "user" as const,
    is_admin: false,
    createdAt: new Date(Date.now() - 86400000 * 14).toISOString(),
  },
  {
    id: "user-3",
    name: "Jane Smith",
    email: "jane@example.com",
    wallet_balance: 3500,
    role: "user" as const,
    is_admin: false,
    createdAt: new Date(Date.now() - 86400000 * 8).toISOString(),
  },
  {
    id: "user-4",
    name: "Emeka Obi",
    email: "emeka@example.com",
    wallet_balance: 0,
    role: "user" as const,
    is_admin: false,
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
];

const seedOrders: Order[] = [
  {
    id: "order-seed-1",
    userId: "user-2",
    userName: "John Doe",
    productId: "65ce3aaa-ab6f-4e6d-ab43-50625dab2646",
    productTitle: "PURE Random Country FACEBOOK | 2007–2024",
    category: "FB",
    amount: 1500,
    deliveredLog: "john.smith@gmail.com:SecurePass123!:AQVDwERT...",
    createdAt: new Date(Date.now() - 86400000 * 4).toISOString(),
  },
  {
    id: "order-seed-2",
    userId: "user-3",
    userName: "Jane Smith",
    productId: "prod-2",
    productTitle: "Aged INSTAGRAM Accounts | 2010–2023",
    category: "IG",
    amount: 2000,
    deliveredLog: "ig.user1@gmail.com:IGPass123!:AQW7RTYU...",
    createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
  },
];

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveState(data: object) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function buildProfileSyncWarning(errorMessage: string | null | undefined, errorCode?: string | null) {
  const message = (errorMessage ?? "").toLowerCase();
  if ((errorCode ?? "").toUpperCase() === "42P17" || message.includes("recursion")) {
    return "Profile sync hit a recursion error. Basic account mode is active; admin access remains available for whitelisted email accounts.";
  }
  return `Could not load profile from Supabase. (${errorCode ?? "unknown"}) ${errorMessage ?? "No details"}`;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const stored = loadState();

  // Always start from loadingUser — never trust a cached profile from localStorage.
  // wallet_balance and role are fetched exclusively from Supabase on every load.
  const [currentUser, setCurrentUser] = useState<User>(loadingUser);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [isAdminView, setIsAdminView] = useState(false);
  const [profileSyncWarning, setProfileSyncWarning] = useState<string | null>(null);

  const isAdmin =
    currentUser.is_admin === true ||
    currentUser.role === "admin" ||
    isSuperAdminEmail(currentUser.email);

  const clearSessionAndHardRefresh = useCallback(async () => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    try {
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
    if (typeof window !== "undefined" && "caches" in window) {
      try {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
      } catch (e) {
        console.warn("[AppContext] CacheStorage clear during hard refresh:", e);
      }
    }
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch (e) {
        console.warn("[AppContext] signOut during hard refresh:", e);
      }
    }
    const hardRefreshUrl = new URL(`${window.location.origin}/auth`);
    hardRefreshUrl.searchParams.set("fresh", Date.now().toString());
    window.location.replace(hardRefreshUrl.toString());
  }, []);
  const [products, setProducts] = useState<Product[]>(stored?.products ?? seedProducts);
  const [users, setUsers] = useState<User[]>(stored?.users ?? seedUsers);
  const [orders, setOrders] = useState<Order[]>(stored?.orders ?? seedOrders);

  // Tracks whether the admin view was manually toggled so we can auto-exit
  // when the user signs out and their role reverts to 'user'
  const isAdminViewRef = useRef(isAdminView);
  useEffect(() => { isAdminViewRef.current = isAdminView; }, [isAdminView]);

  // ── Supabase auth + profile sync ──────────────────────────────────────────
  // Ref tracks latest user state without stale closures.
  const currentUserRef = useRef<User>(loadingUser);
  useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);
  const authBootstrapDoneRef = useRef(false);

  const syncProfile = useCallback(async (authUser: { id: string; email?: string }) => {
    if (!authUser?.id || !UUID_REGEX.test(authUser.id)) {
      console.warn("[AppContext] syncProfile skipped: invalid auth user id.", authUser?.id);
      setProfileLoaded(true);
      return;
    }

    const fallbackName = authUser.email?.split("@")[0] ?? "User";
    const sessionEmail = (authUser.email ?? "").trim();
    console.log("[AppContext] syncProfile start — uid:", authUser.id, "email:", sessionEmail);

    if (!supabase) {
      console.warn("[AppContext] Supabase not configured — running in offline mode.");
      setCurrentUser({
        ...loadingUser,
        id: authUser.id,
        email: sessionEmail,
        name: fallbackName,
        role: isSuperAdminEmail(sessionEmail) ? "admin" : "",
        is_admin: isSuperAdminEmail(sessionEmail),
      });
      setProfileLoaded(true);
      return;
    }

    try {
      const { data: currentSessionData } = await supabase.auth.getSession();
      const activeUser = currentSessionData.session?.user;
      if (!activeUser || activeUser.id !== authUser.id) {
        console.warn("[AppContext] syncProfile skipped: stale auth user or signed out.", {
          expected: authUser.id,
          active: activeUser?.id ?? "none",
        });
        return;
      }

      let profile: Record<string, unknown> | null = null;
      let lastError: { message: string; code: string } | null = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        if (attempt > 1) await new Promise<void>((r) => setTimeout(r, attempt * 250));

        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", authUser.id)
          .single();

        if (data) {
          profile = data;
          console.log("[AppContext] Profile fetched on attempt", attempt, "→ role:", data.role, "balance:", data.wallet_balance);
          break;
        }

        lastError = error as typeof lastError;
        console.warn(`[AppContext] Profile fetch attempt ${attempt} failed:`, error?.code, error?.message);

        const code = String(error?.code ?? "").toUpperCase();
        if (code === "42P17") {
          const warn = buildProfileSyncWarning(error?.message, code);
          setProfileSyncWarning(warn);
          if (isSuperAdminEmail(sessionEmail)) {
            setCurrentUser({
              id: authUser.id,
              email: sessionEmail,
              name: fallbackName,
              wallet_balance: 0,
              role: "admin",
              is_admin: true,
              createdAt: "",
            });
          } else {
            setCurrentUser({
              ...loadingUser,
              id: authUser.id,
              email: sessionEmail,
              name: fallbackName,
            });
          }
          return;
        }
      }

      if (profile) {
        const { data: latestSessionData } = await supabase.auth.getSession();
        const latestUser = latestSessionData.session?.user;
        if (!latestUser || latestUser.id !== authUser.id) {
          console.warn("[AppContext] Profile fetched but session changed; ignoring stale profile update.", {
            expected: authUser.id,
            active: latestUser?.id ?? "none",
          });
          return;
        }

        const email = ((profile.email as string) || authUser.email || "").trim();
        const roleRaw = ((profile.role as string) ?? "").toLowerCase();
        const roleFromDb = roleRaw === "admin" ? "admin" : "user";
        const flagRaw = profile.is_admin;
        const fromColumn = flagRaw === true || flagRaw === "true" || flagRaw === "t";
        const resolvedAdmin = fromColumn || roleFromDb === "admin" || isSuperAdminEmail(email);
        const resolvedRole: "admin" | "user" = resolvedAdmin ? "admin" : "user";

        setProfileSyncWarning(null);
        setCurrentUser({
          id: String(profile.id ?? authUser.id),
          name: fallbackName,
          email,
          wallet_balance: (profile.wallet_balance as number) ?? 0,
          role: resolvedRole,
          is_admin: resolvedAdmin,
          createdAt: (profile.created_at as string) ?? "",
        });
        if (!resolvedAdmin && isAdminViewRef.current) setIsAdminView(false);
        return;
      }

      console.error("[AppContext] All profile fetch retries failed. Last error:", lastError);
      const warn = buildProfileSyncWarning(lastError?.message, lastError?.code);
      setProfileSyncWarning(warn);

      const existing = currentUserRef.current;
      if (existing.id === authUser.id && (existing.role !== "" || existing.is_admin)) {
        console.log("[AppContext] Keeping existing loaded profile after fetch failure (no downgrade).");
        return;
      }

      if (isSuperAdminEmail(sessionEmail)) {
        setCurrentUser({
          id: authUser.id,
          email: sessionEmail,
          name: fallbackName,
          wallet_balance: 0,
          role: "admin",
          is_admin: true,
          createdAt: "",
        });
        return;
      }

      setCurrentUser({
        ...loadingUser,
        id: authUser.id,
        email: sessionEmail,
        name: fallbackName,
      });
      toast.error("Profile sync failed", {
        description: `${warn} Use “Clear session & reload” in the banner if this persists.`,
        duration: 10000,
      });
    } catch (err) {
      console.error("[AppContext] syncProfile threw:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setProfileSyncWarning(buildProfileSyncWarning(msg, "thrown"));
      if (isSuperAdminEmail(sessionEmail)) {
        setCurrentUser({
          id: authUser.id,
          email: sessionEmail,
          name: fallbackName,
          wallet_balance: 0,
          role: "admin",
          is_admin: true,
          createdAt: "",
        });
      } else {
        setCurrentUser({
          ...loadingUser,
          id: authUser.id,
          email: sessionEmail,
          name: fallbackName,
        });
      }
    } finally {
      setProfileLoaded(true);
    }
  }, []);

  // ── Auth subscription ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) {
      console.warn("[AppContext] Supabase not configured — skipping auth subscription.");
      setProfileLoaded(true);
      return;
    }

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("[AppContext] onAuthStateChange:", event, "— uid:", session?.user?.id ?? "none");

      // TOKEN_REFRESHED doesn't change role/balance — skip to avoid churn.
      if (event === "TOKEN_REFRESHED") return;

      // INITIAL_SESSION can briefly emit null before persisted storage is restored.
      // Let getSession() below resolve first auth state to avoid login bounce loops.
      if (event === "INITIAL_SESSION" && !session?.user) return;

      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "USER_UPDATED") && session?.user) {
        syncProfile(session.user);
        return;
      }

      if (event === "SIGNED_OUT") {
        // On cold boot some browsers briefly emit SIGNED_OUT before persisted
        // session hydration finishes. Ignore until initial getSession resolves.
        if (!authBootstrapDoneRef.current) {
          console.log("[AppContext] Ignoring early SIGNED_OUT during bootstrap.");
          return;
        }
        console.log("[AppContext] Signed out — clearing user state.");
        setCurrentUser(loadingUser);
        setIsAdminView(false);
        setProfileSyncWarning(null);
        setProfileLoaded(true);
      }
    });

    // Belt-and-suspenders: in some browsers INITIAL_SESSION fires before storage
    // is restored, delivering a null session. getSession() always reads the real
    // persisted session. Two concurrent calls are fine — both setCurrentUser with
    // the same data.
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error("[AppContext] getSession error:", error.message);
      authBootstrapDoneRef.current = true;
      if (data.session?.user) {
        syncProfile(data.session.user);
      } else {
        // Explicitly no session on mount — ensure profileLoaded so the guard fires
        console.log("[AppContext] getSession: no active session on mount.");
        setProfileLoaded(true);
      }
    });

    return () => { listener.subscription.unsubscribe(); };
  }, [syncProfile]);

  const refreshProducts = useCallback(async () => {
    if (!supabase) return;

    const applyRows = async (data: Record<string, unknown>[]) => {
      const baseRows = data.map((row) => ({
        id:          String(row.id ?? ""),
        title:       String(row.title ?? ""),
        category:    String(row.category ?? ""),
        price:       Number(row.price ?? 0),
        description: String(row.description ?? ""),
        is_featured: row.is_featured === true || row.is_featured === "true" || row.is_featured === "t",
        manual_stock: row.manual_stock === null || row.manual_stock === undefined
          ? null
          : Number(row.manual_stock),
        stock_count: row.stock_count === null || row.stock_count === undefined
          ? null
          : Number(row.stock_count),
        legacy_stock: Number(row.stock ?? 0),
        logs:        Array.isArray(row.logs) ? (row.logs as string[]) : [],
        createdAt:   String(row.created_at ?? ""),
        image_url:   String(row.image_url ?? ""),
        logo_url:    (() => {
          const s = String(row.logo_url ?? "").trim();
          return s || resolveLogoUrlFromTitle(String(row.title ?? ""), String(row.category ?? "")) || "";
        })(),
      }));

      const allIds = baseRows.map((r) => r.id).filter((id) => UUID_REGEX.test(id));
      let liveByProduct: Record<string, number> | null = null;
      if (allIds.length > 0) {
        const live = await supabase
          .from("log_items")
          .select("product_id")
          .in("product_id", allIds)
          .eq("is_delivered", false);
        if (!live.error && live.data) {
          liveByProduct = {};
          for (const row of live.data as Array<{ product_id?: string }>) {
            const pid = String(row.product_id ?? "");
            if (!pid) continue;
            liveByProduct[pid] = (liveByProduct[pid] ?? 0) + 1;
          }
        } else {
          const fb = await supabase
            .from("log_items")
            .select("product_id")
            .in("product_id", allIds)
            .eq("status", "available");
          if (!fb.error && fb.data) {
            liveByProduct = {};
            for (const row of fb.data as Array<{ product_id?: string }>) {
              const pid = String(row.product_id ?? "");
              if (!pid) continue;
              liveByProduct[pid] = (liveByProduct[pid] ?? 0) + 1;
            }
          } else if (live.error) {
            console.warn("[AppContext] log_items live stock count error:", live.error.message);
          }
        }
      }

      setProducts(
        baseRows.map((r) => {
          const resolvedStock =
            liveByProduct !== null
              ? Math.max(0, liveByProduct[r.id] ?? 0)
              : Math.max(0, Number(r.stock_count ?? r.legacy_stock ?? 0));
          return {
            id: r.id,
            title: r.title,
            category: r.category,
            price: r.price,
            description: r.description,
            is_featured: Boolean(r.is_featured),
            manual_stock: r.manual_stock === null ? undefined : Number(r.manual_stock),
            stock_count: resolvedStock,
            stock: resolvedStock,
            logs: r.logs,
            createdAt: r.createdAt,
            image_url: r.image_url,
            logo_url: r.logo_url,
          };
        }),
      );
    };

    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data != null) {
      if (data.length === 0) {
        setProducts([]);
        return;
      }
      await applyRows(data);
      return;
    }

    if (error) {
      console.warn("[AppContext] Products fetch (ordered) error:", error.message, "— retrying without order.");
    }

    const { data: d2, error: e2 } = await supabase.from("products").select("*");
    if (e2) {
      console.warn("[AppContext] Products fetch error:", e2.message);
      return;
    }
    if (d2 != null) {
      if (d2.length === 0) {
        setProducts([]);
        return;
      }
      await applyRows(d2);
    }
  }, []);

  // ── Fetch live products from Supabase ─────────────────────────────────────
  useEffect(() => {
    void refreshProducts();
  }, [refreshProducts]);

  // Live wallet/role sync for navbar and dashboard stats.
  useEffect(() => {
    if (!supabase || !currentUser?.id) return;
    const channel = supabase
      .channel(`profile:${currentUser.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${currentUser.id}` },
        (payload) => {
          const next = payload.new as {
            wallet_balance?: number;
            role?: string;
            email?: string;
            is_admin?: boolean | string;
          };
          setCurrentUser((prev) => {
            const r = (next.role ?? prev.role) as string;
            const roleNorm = r === "admin" ? "admin" : "user";
            const col = next.is_admin;
            const adminFlag =
              col === true || col === "true" || col === "t" || roleNorm === "admin";
            return {
              ...prev,
              wallet_balance: typeof next.wallet_balance === "number" ? next.wallet_balance : prev.wallet_balance,
              role: adminFlag ? "admin" : "user",
              is_admin: adminFlag,
              email: next.email ?? prev.email,
            };
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser?.id]);

  // currentUser intentionally excluded — wallet_balance and role are owned
  // by Supabase. Persisting them to localStorage would create a stale cache
  // that shows wrong values on the next load before the DB responds.
  useEffect(() => {
    saveState({ products, users, orders });
  }, [products, users, orders]);

  const toggleAdminView = () => setIsAdminView((v) => !v);

  // Manually re-fetch profile from Supabase (the ↻ Sync button in the header).
  // Clears currentUserRef.role so the retry logic doesn't skip the fetch.
  const refreshProfile = useCallback(async () => {
    if (!supabase) return;
    setProfileSyncWarning(null);
    currentUserRef.current = { ...currentUserRef.current, role: "" };
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) await syncProfile(session.user);
  }, [syncProfile]);

  const addProduct = (product: Omit<Product, "id" | "createdAt">) => {
    const newProd: Product = {
      ...product,
      logo_url: product.logo_url || resolveLogoUrlFromTitle(product.title, product.category),
      id: `prod-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    setProducts((prev) => [newProd, ...prev]);
  };

  const updateProduct = (id: string, updates: Partial<Omit<Product, "id" | "createdAt">>) => {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  };

  const deleteProduct = (id: string) => {
    setProducts((prev) => prev.filter((p) => p.id !== id));
  };

  const mergeProductRowFromDb = useCallback((row: Record<string, unknown>) => {
    const id = String(row.id ?? "");
    if (!id) return;
    const title = String(row.title ?? "");
    const category = String(row.category ?? "");
    const storedLogo = String(row.logo_url ?? "").trim();
    const inferred = resolveLogoUrlFromTitle(title, category);
    const logo_url = storedLogo || inferred || undefined;
    const resolvedStock = Math.max(0, Number(row.stock_count ?? row.stock ?? 0));
    const next: Product = {
      id,
      title,
      category,
      price: Number(row.price ?? 0),
      description: String(row.description ?? ""),
      is_featured: row.is_featured === true || row.is_featured === "true" || row.is_featured === "t",
      manual_stock: row.manual_stock === null || row.manual_stock === undefined
        ? undefined
        : Math.max(0, Number(row.manual_stock ?? 0)),
      stock_count: resolvedStock,
      stock: resolvedStock,
      logs: [],
      createdAt: String(row.created_at ?? new Date().toISOString()),
      image_url: String(row.image_url ?? ""),
      logo_url,
    };
    setProducts((prev) => [next, ...prev.filter((p) => p.id !== id)]);
  }, []);

  const purchaseProduct = async (productId: string): Promise<{ success: boolean; deliveredLog?: string; message: string }> => {
    // ── Supabase path: atomic purchase via SECURITY DEFINER function ──────────
    if (supabase && currentUser?.id) {
      if (!UUID_REGEX.test(currentUser.id)) {
        return { success: false, message: "Your session is still loading. Please wait a moment and try again." };
      }
      // Guard: reject non-UUID product IDs immediately with a clear message
      if (!UUID_REGEX.test(productId)) {
        console.error("[DEBUG] Invalid product ID — not a UUID:", productId, "| Clearing stale cache.");
        // Wipe cached products so the correct DB rows load on next render
        localStorage.removeItem("elon_marketplace_v2");
        return { success: false, message: "Product data is outdated. Please refresh the page and try again." };
      }

      const { data, error } = await supabase.rpc("purchase_log", {
        p_user_id: currentUser.id,
        p_product_id: productId,
      });

      if (error || !data) {
        return { success: false, message: error?.message ?? "Purchase failed. Please try again." };
      }
      if (!data.success) {
        return { success: false, message: data.message };
      }

      // Optimistically update local state so the UI reflects the change immediately
      const product = products.find((p) => p.id === productId);
      if (product) {
        setCurrentUser((prev) => ({ ...prev, wallet_balance: prev.wallet_balance - product.price }));
        setProducts((prev) =>
          prev.map((p) => {
            if (p.id !== productId) return p;
            const nextStock = Math.max(0, (p.stock_count ?? p.stock ?? 0) - 1);
            return { ...p, stock_count: nextStock, stock: nextStock };
          })
        );
        // Push into local orders so OrdersPage shows it without a DB refetch
        const order: Order = {
          id: data.transaction_id,
          userId: currentUser.id,
          userName: currentUser.name,
          productId: product.id,
          productTitle: product.title,
          category: product.category,
          amount: product.price,
          deliveredLog: data.credentials,
          createdAt: new Date().toISOString(),
        };
        setOrders((prev) => [order, ...prev]);
      }

      return { success: true, deliveredLog: data.credentials, message: "Purchase successful!" };
    }

    // ── Offline / localStorage fallback ──────────────────────────────────────
    const product = products.find((p) => p.id === productId);
    if (!product) return { success: false, message: "Product not found." };
    const availableStock = product.stock_count ?? product.stock ?? 0;
    if (availableStock <= 0) return { success: false, message: "Out of stock." };
    const balance = currentUser?.wallet_balance ?? 0;
    if (balance < product.price) {
      return { success: false, message: `Insufficient balance. Need ₦${(product.price - balance).toLocaleString()} more.` };
    }

    const logToDeliver = product.logs[Math.max(0, availableStock - 1)];

    const updatedUser = { ...currentUser, wallet_balance: balance - product.price };
    setCurrentUser(updatedUser);
    setUsers((prev) => prev.map((u) => (u.id === currentUser?.id ? updatedUser : u)));
    updateProduct(productId, {
      stock_count: Math.max(0, availableStock - 1),
      stock: Math.max(0, availableStock - 1),
    });

    const order: Order = {
      id: `order-${Date.now()}`,
      userId: currentUser?.id ?? "",
      userName: currentUser?.name ?? "",
      productId: product.id,
      productTitle: product.title,
      category: product.category,
      amount: product.price,
      deliveredLog: logToDeliver,
      createdAt: new Date().toISOString(),
    };
    setOrders((prev) => [order, ...prev]);

    return { success: true, deliveredLog: logToDeliver, message: "Purchase successful!" };
  };

  const adjustWallet = (userId: string, amount: number, type: "add" | "deduct") => {
    const user = users.find((u) => u.id === userId);
    if (!user) return { success: false, message: "User not found." };
    const newBalance = type === "add" ? user.wallet_balance + amount : user.wallet_balance - amount;
    if (newBalance < 0) return { success: false, message: "Balance cannot go below zero." };
    const updated = { ...user, wallet_balance: newBalance };
    setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
    if (userId === currentUser?.id) setCurrentUser(updated);
    return { success: true, message: `₦${amount.toLocaleString()} ${type === "add" ? "credited" : "debited"} successfully.` };
  };

  // topUpWallet: called by WalletPage once the Supabase `transactions` row is
  // confirmed as "completed". We re-fetch the profile from Supabase so the
  // balance shown is the exact DB value — not a local estimate.
  // The `amount` param is kept for the success toast shown in WalletPage.
  const topUpWallet = async (_amount: number) => {
    await refreshProfile();
  };

  return (
    <AppContext.Provider
      value={{
        currentUser,
        profileLoaded,
        isAdmin,
        isAdminView,
        profileSyncWarning,
        clearSessionAndHardRefresh,
        products,
        users,
        orders,
        toggleAdminView,
        addProduct,
        updateProduct,
        deleteProduct,
        purchaseProduct,
        adjustWallet,
        topUpWallet,
        refreshProfile,
        refreshProducts,
        mergeProductRowFromDb,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
