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

  const [amount, setAmount]           = useState("");
  const [note, setNote]               = useState("");
  const [file, setFile]               = useState<File | null>(null);
  const [loading, setLoading]         = useState(false);
  const [submitted, setSubmitted]     = useState(false);
  const [submittedAmount, setSubmittedAmount] = useState(0); // captured for WhatsApp link

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
    setSubmittedAmount(naira);
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
        <div className="bg-accent/10 border border-accent/20 rounded-xl px-5 py-5 space-y-4">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-accent mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-accent">Deposit request submitted!</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Your payment slip has been sent for review. Notify the admin on WhatsApp
                so they can approve it faster and credit your wallet.
              </p>
            </div>
          </div>

          {/* WhatsApp notify button */}
          <a
            href={`https://wa.me/2348127692456?text=${encodeURIComponent(
              `Hello Admin, I have just made a deposit of ₦${submittedAmount.toLocaleString()} on Elon Marketplace. Please approve my request. Email: ${currentUser.email}`
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2.5 w-full rounded-xl py-3 px-4 font-semibold text-sm text-white transition-colors"
            style={{ backgroundColor: "#25D366" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#1ebe5d")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#25D366")}
          >
            {/* WhatsApp SVG icon */}
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white shrink-0" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            Notify Admin on WhatsApp
          </a>

          <button
            onClick={() => { setSubmitted(false); setSubmittedAmount(0); }}
            className="text-xs text-muted-foreground underline w-full text-center"
          >
            Submit another deposit
          </button>
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
