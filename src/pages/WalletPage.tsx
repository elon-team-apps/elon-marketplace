import { useState } from "react";
import {
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  Loader2,
  CheckCircle,
  AlertCircle,
  Copy,
  Upload,
  Banknote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";

// ─── Bank details ─────────────────────────────────────────────────────────────
const BANK = {
  accountNumber: "8127692456",
  bank:          "Palmpay",
  accountName:   "David Chizoba Godwin",
};

// ─── Quick-select amounts ─────────────────────────────────────────────────────
const QUICK_AMOUNTS = [1_000, 2_500, 5_000, 10_000, 25_000, 50_000];

// ─── Component ────────────────────────────────────────────────────────────────
export default function WalletPage() {
  const { currentUser } = useApp();
  const { toast } = useToast();

  const [amount, setAmount]         = useState("");
  const [note, setNote]             = useState("");
  const [file, setFile]             = useState<File | null>(null);
  const [loading, setLoading]       = useState(false);
  const [submitted, setSubmitted]   = useState(false);

  // ── Copy account number to clipboard ────────────────────────────────────────
  const copyAccount = () => {
    navigator.clipboard.writeText(BANK.accountNumber).then(() => {
      toast({ title: "Copied!", description: "Account number copied to clipboard." });
    });
  };

  // ── Submit deposit request ──────────────────────────────────────────────────
  const handleSubmit = async () => {
    const naira = parseInt(amount, 10);
    if (isNaN(naira) || naira < 100) {
      toast({ title: "Minimum deposit is ₦100", variant: "destructive" });
      return;
    }
    if (!file) {
      toast({ title: "Please upload your payment slip", variant: "destructive" });
      return;
    }
    if (!currentUser?.id || currentUser.id === "") {
      toast({ title: "Profile not ready. Please wait and try again.", variant: "destructive" });
      return;
    }
    if (!supabase) {
      toast({ title: "Service unavailable", description: "Supabase is not configured.", variant: "destructive" });
      return;
    }

    setLoading(true);

    // 1. Upload screenshot to Supabase Storage ─────────────────────────────
    const BUCKET   = "deposit-screenshots";
    const ext      = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const filePath = `${currentUser.id}/${Date.now()}.${ext}`;

    console.log("[WalletPage] Uploading screenshot →", BUCKET, filePath, "| size:", file.size, "| type:", file.type);

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, file, { upsert: false, contentType: file.type });

    let publicUrl: string | null = null;

    if (uploadError) {
      // Log the full error object so we can see the exact Supabase error code
      console.error("[WalletPage] Storage upload failed — full error:", uploadError);
      console.error("[WalletPage] error.message:", uploadError.message);
      console.error("[WalletPage] Bucket attempted:", BUCKET, "| Path:", filePath);

      const isNotFound = uploadError.message?.toLowerCase().includes("not found") ||
                         uploadError.message?.toLowerCase().includes("bucket");

      if (isNotFound) {
        // Bucket hasn't been created yet — give an actionable error
        toast({
          title: "Storage bucket missing",
          description: `Create a public bucket named "${BUCKET}" in Supabase → Storage, then retry.`,
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // For other storage errors, still block submission — admin needs the proof
      toast({
        title: "Upload failed",
        description: `${uploadError.message} — check the browser console for details.`,
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    // Get the public URL for the uploaded file
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(uploadData.path);
    publicUrl = urlData.publicUrl;
    console.log("[WalletPage] Upload success → public URL:", publicUrl);

    // 2. Insert pending deposit record ──────────────────────────────────────
    console.log("[WalletPage] Inserting deposit — user:", currentUser.id, "amount:", naira);

    const { error: insertError } = await supabase.from("deposits").insert({
      user_id:        currentUser.id,
      amount:         naira,
      status:         "pending",
      screenshot_url: publicUrl,
      note:           note.trim() || null,
    });

    if (insertError) {
      console.error("[WalletPage] Deposit insert failed — full error:", insertError);
      console.error("[WalletPage] insert error.message:", insertError.message);
      console.error("[WalletPage] insert error.code:", insertError.code);
      toast({
        title: "Submission failed",
        description: `${insertError.message} (${insertError.code}) — check the browser console.`,
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    console.log("[WalletPage] Deposit submitted successfully.");
    setLoading(false);
    setSubmitted(true);
    setAmount("");
    setNote("");
    setFile(null);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Page header */}
      <div>
        <h1 className="font-heading text-2xl font-bold">Wallet</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Fund your wallet by making a bank transfer and submitting your proof of payment.
        </p>
      </div>

      {/* Success banner */}
      {submitted && (
        <div className="flex items-start gap-3 bg-accent/10 border border-accent/20 rounded-xl px-5 py-4">
          <CheckCircle className="h-5 w-5 text-accent mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-accent">Deposit request submitted!</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Your payment slip has been sent for review. An admin will approve it
              and your balance will be updated shortly. You will see the change when
              you refresh your balance.
            </p>
            <button
              onClick={() => setSubmitted(false)}
              className="text-xs text-accent underline mt-2"
            >
              Submit another deposit
            </button>
          </div>
        </div>
      )}

      {/* Balance card */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <Wallet className="h-5 w-5 text-accent" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Available Balance</p>
            <p className="font-heading text-3xl font-bold">
              ₦{(currentUser?.wallet_balance ?? 0).toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {/* Bank details */}
      <div className="glass-card p-6 space-y-4">
        <h2 className="font-heading font-semibold text-lg flex items-center gap-2">
          <Banknote className="h-5 w-5 text-accent" />
          Bank Transfer Details
        </h2>
        <p className="text-sm text-muted-foreground">
          Transfer the exact amount to the account below, then submit your payment slip.
        </p>

        <div className="rounded-xl border border-accent/20 bg-accent/5 divide-y divide-accent/10">
          {/* Account number */}
          <div className="flex items-center justify-between px-5 py-3.5">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-0.5">
                Account Number
              </p>
              <p className="font-mono font-bold text-xl tracking-widest text-foreground">
                {BANK.accountNumber}
              </p>
            </div>
            <button
              onClick={copyAccount}
              className="flex items-center gap-1.5 text-xs text-accent border border-accent/30 rounded-lg px-3 py-1.5 hover:bg-accent/10 transition-colors"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </button>
          </div>

          {/* Bank */}
          <div className="px-5 py-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-0.5">
              Bank
            </p>
            <p className="font-semibold text-foreground">{BANK.bank}</p>
          </div>

          {/* Account name */}
          <div className="px-5 py-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-0.5">
              Account Name
            </p>
            <p className="font-semibold text-foreground">{BANK.accountName}</p>
          </div>
        </div>
      </div>

      {/* Deposit form */}
      {!submitted && (
        <div className="glass-card p-6 space-y-5">
          <h2 className="font-heading font-semibold text-lg flex items-center gap-2">
            <ArrowDownLeft className="h-5 w-5 text-accent" />
            Submit Payment Proof
          </h2>

          {/* Quick-select */}
          <div>
            <Label className="mb-2 block">Amount Sent</Label>
            <div className="flex flex-wrap gap-2 mb-3">
              {QUICK_AMOUNTS.map((preset) => (
                <button
                  key={preset}
                  onClick={() => setAmount(preset.toString())}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-medium border transition-all duration-150 ${
                    amount === preset.toString()
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-transparent text-muted-foreground border-border hover:border-accent/50 hover:text-foreground"
                  }`}
                >
                  ₦{preset.toLocaleString()}
                </button>
              ))}
            </div>
            <Input
              type="number"
              min={100}
              step={100}
              placeholder="Or enter custom amount e.g. 7500"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1.5">Minimum deposit: ₦100</p>
          </div>

          {/* Screenshot upload */}
          <div>
            <Label htmlFor="slip" className="mb-1.5 block">
              Payment Slip / Screenshot
            </Label>
            <label
              htmlFor="slip"
              className={`flex flex-col items-center justify-center gap-2 w-full rounded-xl border-2 border-dashed transition-colors cursor-pointer py-8 px-4 text-center ${
                file
                  ? "border-accent/50 bg-accent/5"
                  : "border-border hover:border-accent/40 hover:bg-accent/3"
              }`}
            >
              <Upload className={`h-7 w-7 ${file ? "text-accent" : "text-muted-foreground"}`} />
              {file ? (
                <>
                  <p className="text-sm font-semibold text-accent">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB — click to change
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">Click to upload screenshot</p>
                  <p className="text-xs text-muted-foreground">PNG, JPG, WEBP — max 5 MB</p>
                </>
              )}
              <input
                id="slip"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (f && f.size > 5 * 1024 * 1024) {
                    toast({ title: "File too large", description: "Maximum size is 5 MB.", variant: "destructive" });
                    return;
                  }
                  setFile(f);
                }}
              />
            </label>
          </div>

          {/* Optional note */}
          <div>
            <Label htmlFor="note" className="mb-1.5 block">
              Note <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="note"
              placeholder="e.g. Transferred from GTB at 3pm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <Button
            className="w-full gap-2 bg-accent text-accent-foreground hover:bg-accent/90"
            onClick={handleSubmit}
            disabled={loading || !amount || parseInt(amount) < 100 || !file}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Submitting…
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4" />
                Submit Deposit Request
              </>
            )}
          </Button>
        </div>
      )}

      {/* How it works */}
      <div className="glass-card p-6">
        <h3 className="font-heading font-semibold mb-4 flex items-center gap-2">
          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          How it works
        </h3>
        <ol className="space-y-3">
          {[
            `Transfer your desired amount to ${BANK.bank} — ${BANK.accountNumber} (${BANK.accountName}).`,
            "Take a screenshot or photo of the payment confirmation.",
            "Enter the amount and upload your payment proof above.",
            "Click 'Submit Deposit Request' — an admin will review it.",
            "Once approved, your wallet balance is updated and you can buy products.",
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
              <span className="flex-shrink-0 h-5 w-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>

      {/* Warning */}
      <div className="flex items-start gap-3 bg-amber-500/8 border border-amber-500/20 rounded-xl px-5 py-4">
        <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground">
          Always transfer the <strong>exact amount</strong> shown in your request and keep your receipt.
          Deposits without a valid screenshot cannot be approved.
        </p>
      </div>
    </div>
  );
}
