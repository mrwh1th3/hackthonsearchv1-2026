"use client";

import { RefreshCw } from "lucide-react";

export default function HypothesesError({ reset }: { reset: () => void }) {
  return <main className="mx-auto flex min-h-[55vh] max-w-lg flex-col items-center justify-center px-6 text-center">
    <h1 className="mb-3 text-2xl font-medium tracking-tight text-[#45553a]">Saved outputs are unavailable</h1>
    <p className="mb-6 text-sm leading-7 text-[#7b837a]">The investigation records could not be loaded. Try again to reconnect.</p>
    <button onClick={reset} className="flex items-center gap-2 rounded-lg border border-[#dce4d4] bg-white px-4 py-2.5 text-xs text-[#617955]"><RefreshCw size={14} aria-hidden />Try again</button>
  </main>;
}
