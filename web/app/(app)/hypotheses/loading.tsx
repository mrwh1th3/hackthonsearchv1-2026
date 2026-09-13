import { GitBranch } from "lucide-react";

export default function HypothesesLoading() {
  return <main className="mx-auto max-w-[1420px] px-[18px] py-3" aria-busy="true" aria-label="Loading saved hypotheses">
    <div className="mb-8 flex items-center gap-2 text-[11px] text-[#758170]"><GitBranch size={14} aria-hidden />Hypotheses</div>
    <div className="mb-6 h-[120px] rounded-[14px] border border-[#e5e8e2] bg-white/70 motion-safe:animate-pulse" />
    <div className="rounded-xl border border-[#e5e8e2] bg-white p-6"><p role="status" className="mb-6 text-xs text-[#7b837a]">Reading saved agent outputs…</p>{[1, 2, 3].map(row => <div key={row} aria-hidden className="mb-5 h-16 rounded-lg bg-[#f3f5ef] motion-safe:animate-pulse" />)}</div>
  </main>;
}
