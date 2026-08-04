import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import logo from "@/assets/logo-transparent.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Loader2, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";

const AuthPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"signin" | "signup">(
    searchParams.get("tab") === "signup" ? "signup" : "signin"
  );

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const clearMsg = () => setMessage(null);

  // ── Sign In ──────────────────────────────────────────────────────────────
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMsg();

    if (!supabase) {
      setMessage({ text: "Database connection is not configured.", ok: false });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPassword = password.trim();
    if (!normalizedEmail.includes("@")) {
      setMessage({ text: "Please enter a valid email address.", ok: false });
      return;
    }
    if (!normalizedPassword) {
      setMessage({ text: "Password is required.", ok: false });
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password: normalizedPassword,
    });
    setLoading(false);

    if (error) {
      const raw = error.message || "";
      const normalized = raw.toLowerCase();
      if (normalized.includes("email not confirmed")) {
        setMessage({
          text: "Your email is not confirmed yet. Please check your inbox (and spam folder), verify your account, then sign in.",
          ok: false,
        });
      } else if (normalized.includes("invalid login credentials")) {
        setMessage({
          text: "Invalid email or password. Please check your credentials and try again.",
          ok: false,
        });
      } else if (normalized.includes("invalid email")) {
        setMessage({ text: "The email format is invalid.", ok: false });
      } else {
        setMessage({ text: raw, ok: false });
      }
      return;
    }

    // AppContext.onAuthStateChange fires → syncProfile runs → currentUser populated.
    navigate("/dashboard");
  };

  // ── Sign Up ──────────────────────────────────────────────────────────────
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMsg();

    if (!supabase) {
      setMessage({ text: "Supabase is not configured — check your .env file.", ok: false });
      return;
    }
    if (password.length < 6) {
      setMessage({ text: "Password must be at least 6 characters.", ok: false });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPassword = password.trim();
    if (!normalizedEmail.includes("@")) {
      setMessage({ text: "Please enter a valid email address.", ok: false });
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: { name: name.trim() || normalizedEmail.split("@")[0] },
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    });

    if (error) {
      setLoading(false);
      setMessage({ text: error.message, ok: false });
      return;
    }

    // If email confirmation is disabled in Supabase, session is available immediately.
    if (data.session) {
      setLoading(false);
      navigate("/dashboard");
      return;
    }

    // Fallback: try immediate sign-in so UX stays smooth even if signUp does not return session.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password: normalizedPassword,
    });
    setLoading(false);
    if (!signInError) {
      navigate("/dashboard");
      return;
    }

    setMessage({
      text: "Account created, but automatic login failed. Please sign in now.",
      ok: true,
    });
    setTab("signin");
    setPassword("");
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ background: "#05080a" }}>
      {/* Logo */}
      <Link to="/" className="flex items-center mb-10 group">
        <img
          src={logo}
          alt="Logo"
          className="h-12 w-auto object-contain drop-shadow-[0_0_10px_rgba(16,185,129,0.40)]"
        />
      </Link>

      {/* Card */}
      <div className="w-full glass-card p-8" style={{ maxWidth: 440 }}>
        {/* Tabs */}
        <div className="flex rounded-lg border border-white/10 mb-6 overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
          {(["signin", "signup"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); clearMsg(); }}
              className={`flex-1 py-2.5 text-sm font-semibold transition-all duration-150 ${
                tab === t ? "bg-accent text-white" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {t === "signin" ? "Sign In" : "Sign Up"}
            </button>
          ))}
        </div>

        {/* Banner */}
        {message && (
          <div
            className={`mb-5 px-4 py-3 rounded-lg text-sm border ${
              message.ok
                ? "bg-accent/10 border-accent/25 text-accent"
                : "bg-red-500/10 border-red-500/25 text-red-400"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* ── Sign In ─────────────────────────────────────────────────── */}
        {tab === "signin" && (
          <form onSubmit={handleSignIn} className="space-y-4">
            <div>
              <Label htmlFor="si-email" className="text-slate-300 text-sm mb-1.5 block">Email</Label>
              <Input
                id="si-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-600"
              />
            </div>
            <div>
              <Label htmlFor="si-password" className="text-slate-300 text-sm mb-1.5 block">Password</Label>
              <div className="relative">
                <Input
                  id="si-password"
                  type={showPass ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  tabIndex={-1}
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-accent hover:bg-accent/90 text-white font-semibold h-11 mt-1"
            >
              {loading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <><span>Sign In</span><ArrowRight className="ml-2 h-4 w-4" /></>}
            </Button>
            <p className="text-center text-xs text-slate-600">
              No account?{" "}
              <button type="button" className="text-accent font-medium hover:underline" onClick={() => { setTab("signup"); clearMsg(); }}>
                Sign up free
              </button>
            </p>
          </form>
        )}

        {/* ── Sign Up ─────────────────────────────────────────────────── */}
        {tab === "signup" && (
          <form onSubmit={handleSignUp} className="space-y-4">
            <div>
              <Label htmlFor="su-name" className="text-slate-300 text-sm mb-1.5 block">Full Name</Label>
              <Input
                id="su-name"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-600"
              />
            </div>
            <div>
              <Label htmlFor="su-email" className="text-slate-300 text-sm mb-1.5 block">Email</Label>
              <Input
                id="su-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-600"
              />
            </div>
            <div>
              <Label htmlFor="su-password" className="text-slate-300 text-sm mb-1.5 block">Password</Label>
              <div className="relative">
                <Input
                  id="su-password"
                  type={showPass ? "text" : "password"}
                  placeholder="Min. 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="bg-white/5 border-white/10 text-white placeholder:text-slate-600 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  tabIndex={-1}
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-accent hover:bg-accent/90 text-white font-semibold h-11 mt-1"
            >
              {loading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <><span>Create Account</span><ArrowRight className="ml-2 h-4 w-4" /></>}
            </Button>
            <p className="text-center text-xs text-slate-600">
              Already have an account?{" "}
              <button type="button" className="text-accent font-medium hover:underline" onClick={() => { setTab("signin"); clearMsg(); }}>
                Sign in
              </button>
            </p>
          </form>
        )}
      </div>

      <p className="mt-6 text-xs text-slate-700">
        © {new Date().getFullYear()} Elon Marketplace
      </p>
    </div>
  );
};

export default AuthPage;
