import { useState, useEffect } from "react";
import { X, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TelegramPopup() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Check if user has already dismissed or clicked the popup recently (e.g. within 7 days)
    const lastShown = localStorage.getItem("telegram_popup_shown");
    const now = new Date().getTime();
    
    // If we haven't shown it, or it's been more than 7 days
    if (!lastShown || now - parseInt(lastShown) > 7 * 24 * 60 * 60 * 1000) {
      // Show after 3 seconds
      const timer = setTimeout(() => {
        setIsVisible(true);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleClose = () => {
    setIsVisible(false);
    localStorage.setItem("telegram_popup_shown", new Date().getTime().toString());
  };

  const handleJoin = () => {
    window.open("https://t.me/+fxC4mCK8pX8wMTY0", "_blank");
    handleClose();
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-8 fade-in duration-500 max-w-sm w-[calc(100%-2rem)]">
      <div className="relative overflow-hidden rounded-2xl border border-blue-500/30 bg-white/95 dark:bg-[#0A1628]/95 backdrop-blur-md shadow-2xl p-5">
        {/* Glow effect */}
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-blue-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <button 
          onClick={handleClose}
          className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors bg-black/5 dark:bg-white/5 rounded-full p-1"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex gap-4">
          <div className="flex-shrink-0 mt-1">
            <div className="w-10 h-10 rounded-full bg-[#0088cc] flex items-center justify-center shadow-lg shadow-blue-500/30">
              <MessageCircle className="h-5 w-5 text-white" fill="currentColor" />
            </div>
          </div>
          
          <div className="flex-1">
            <h3 className="font-heading font-bold text-base text-foreground leading-tight">
              Join Our Community!
            </h3>
            <p className="text-sm text-muted-foreground mt-1.5 mb-4 leading-relaxed">
              Stay updated with the latest premium digital assets, exclusive offers, and get fast support in our Telegram group.
            </p>
            
            <div className="flex gap-2">
              <Button 
                onClick={handleJoin} 
                className="flex-1 bg-[#0088cc] hover:bg-[#0077b5] text-white border-0 shadow-md shadow-blue-500/20 transition-all font-semibold"
              >
                Join Telegram
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
