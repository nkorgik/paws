"use client";

// Floating glass chrome over the live map: brand on the left, live count on
// the right. Pointer events pass through the bar itself to the map.
export default function TopBar({ online }: { online: number }) {
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="glass pointer-events-auto flex h-10 animate-glass-in items-center gap-2 rounded-full pr-4 pl-3.5">
        <span className="size-2 rounded-full bg-emerald-400 animate-live" />
        <span className="text-[15px] font-semibold tracking-tight">Pulse</span>
      </div>
      <div
        className="glass pointer-events-auto flex h-10 animate-glass-in items-center gap-2 rounded-full px-4 text-sm text-zinc-200"
        aria-live="polite"
      >
        <span className="size-1.5 rounded-full bg-emerald-400" />
        <span className="tabular-nums">{online}</span> online
      </div>
    </header>
  );
}
