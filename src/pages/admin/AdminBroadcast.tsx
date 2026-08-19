import { useState } from "react";
import { Mail, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabaseClient";

export default function AdminBroadcast() {
  const [subject, setSubject] = useState("");
  const [htmlBody, setHtmlBody] = useState("");
  const [sending, setSending] = useState(false);
  const { toast } = useToast();

  const handleSend = async () => {
    if (!subject.trim() || !htmlBody.trim()) {
      toast({ title: "Validation Error", description: "Subject and Body are required.", variant: "destructive" });
      return;
    }
    
    if (!confirm("Are you sure you want to broadcast this email to ALL registered users? This cannot be undone.")) return;

    setSending(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      if (!token) throw new Error("Missing auth session.");

      const response = await fetch("/api/admin/broadcast-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ subject, htmlBody }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Could not send broadcast.");
      }

      toast({
        title: "Broadcast Complete",
        description: `Successfully attempted to send to ${payload.stats?.totalAttempted} users. (${payload.stats?.successCount} successful, ${payload.stats?.failCount} failed)`,
      });

      setSubject("");
      setHtmlBody("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Broadcast failed.";
      toast({ title: "Broadcast Failed", description: message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">Email Broadcast</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Send an announcement email to all registered users via Resend.
          </p>
        </div>
      </div>
      <div className="glass-card p-5 space-y-4 max-w-3xl">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-accent" />
          <h2 className="font-heading font-semibold text-sm text-foreground">Compose Broadcast</h2>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="text-sm font-semibold text-foreground mb-1.5 block">Subject Line</label>
            <Input 
              value={subject} 
              onChange={(e) => setSubject(e.target.value)} 
              placeholder="e.g. Big Update: New Assets Available!" 
              className="text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-foreground mb-1.5 block">Email Body (HTML/Text)</label>
            <textarea
              value={htmlBody}
              onChange={(e) => setHtmlBody(e.target.value)}
              placeholder="<p>Hello! Check out our new update...</p>"
              className="w-full h-64 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t border-slate-200 dark:border-white/6 mt-4">
          <Button onClick={handleSend} disabled={sending} className="gap-2">
            {sending && <Loader2 className="h-4 w-4 animate-spin" />}
            {sending ? "Sending..." : "Send Broadcast"}
          </Button>
        </div>
      </div>
    </div>
  );
}
