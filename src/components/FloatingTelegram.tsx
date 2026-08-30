import { Send } from "lucide-react";

export function FloatingTelegram() {
  return (
    <a
      href="https://t.me/Elonmarketplace99"
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-6 right-6 z-[9999] group flex items-center justify-center"
      aria-label="Join our Telegram"
    >
      {/* Tooltip */}
      <div className="absolute right-full mr-4 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs font-bold shadow-xl border border-slate-200 dark:border-white/10 opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 transition-all duration-300 pointer-events-none whitespace-nowrap">
        Join our Telegram
      </div>
      
      {/* Button */}
      <div className="relative">
        {/* Pulse effect */}
        <div className="absolute inset-0 rounded-full bg-[#2AABEE] animate-ping opacity-25" />
        
        <div className="relative h-14 w-14 rounded-full bg-[#2AABEE] flex items-center justify-center text-white shadow-lg shadow-[#2AABEE]/30 hover:scale-110 active:scale-95 transition-all duration-300">
          <Send className="h-6 w-6 ml-[-2px]" />
        </div>
      </div>
    </a>
  );
}
