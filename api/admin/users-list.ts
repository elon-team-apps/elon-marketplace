import { createClient } from "@supabase/supabase-js";

type ApiHeaders = Record<string, string | string[] | undefined>;
type ApiRequest = { method?: string; headers: ApiHeaders };
type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void; end: () => void };
};

type ProfileRow = {
  id: string;
  email: string | null;
  wallet_balance: number | null;
  role: string | null;
  is_admin: boolean | null;
  created_at: string | null;
};

function headerValue(headers: ApiHeaders, key: string): string {
  const raw = headers[key];
  if (Array.isArray(raw)) return String(raw[0] ?? "");
  return String(raw ?? "");
}

function isAdminProfile(profile: { role?: string | null; is_admin?: unknown } | null): boolean {
  if (!profile) return false;
  const role = String(profile.role ?? "").toLowerCase();
  const adminFlag =
    profile.is_admin === true || profile.is_admin === "true" || profile.is_admin === "t";
  return adminFlag || role === "admin";
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const authHeader = headerValue(req.headers, "authorization");
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    res.status(401).json({ error: "Missing bearer token." });
    return;
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: "Missing bearer token." });
    return;
  }

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    res.status(500).json({ error: "Server misconfigured for users list." });
    return;
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: callerProfile, error: callerProfileError } = await adminClient
    .from("profiles")
    .select("role, is_admin")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (callerProfileError || !isAdminProfile(callerProfile)) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }

  const allUsers: Array<{ id: string; email: string | null; created_at: string | null }> = [];
  let page = 1;
  const perPage = 200;
  while (true) {
    const { data: listed, error: listError } = await adminClient.auth.admin.listUsers({
      page,
      perPage,
    });
    if (listError) {
      res.status(500).json({ error: listError.message || "Failed to list auth users." });
      return;
    }
    const users = listed?.users ?? [];
    if (users.length === 0) break;
    for (const user of users) {
      allUsers.push({
        id: user.id,
        email: user.email ?? null,
        created_at: user.created_at ?? null,
      });
    }
    if (users.length < perPage) break;
    page += 1;
  }

  const { data: profilesData, error: profilesError } = await adminClient
    .from("profiles")
    .select("id, email, wallet_balance, role, is_admin, created_at");
  if (profilesError) {
    res.status(500).json({ error: profilesError.message || "Failed to fetch profiles." });
    return;
  }

  const profileMap = new Map<string, ProfileRow>();
  for (const profile of (profilesData ?? []) as ProfileRow[]) {
    profileMap.set(profile.id, profile);
  }

  const merged = allUsers.map((u) => {
    const p = profileMap.get(u.id);
    return {
      id: u.id,
      email: p?.email ?? u.email ?? "",
      wallet_balance: Number(p?.wallet_balance ?? 0),
      role: p?.role ?? "user",
      is_admin: p?.is_admin ?? false,
      created_at: p?.created_at ?? u.created_at ?? new Date().toISOString(),
    };
  });

  merged.sort((a, b) => {
    const left = new Date(a.created_at).getTime();
    const right = new Date(b.created_at).getTime();
    return right - left;
  });

  res.status(200).json({ users: merged });
}
