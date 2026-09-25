"use client";

import type { ReactNode } from "react";

// A floating glass pill for transient status: toasts, "waiting…" states and
// hints. Top pills sit just under the top bar; bottom pills above the edge.
export default function StatusPill({
  children,
  position = "top",
  quiet = false,
}: {
  children: ReactNode;
  position?: "top" | "bottom";
  quiet?: boolean;
}) {
  return (
    <div
      role="status"
      className={`pointer-events-none absolute inset-x-0 z-30 flex justify-center px-4 ${
        position === "top"
          ? "top-[calc(max(1rem,env(safe-area-inset-top))+3.5rem)]"
          : "bottom-[calc(max(1rem,env(safe-area-inset-bottom))+0.25rem)]"
      }`}
    >
      <div
        className={`glass pointer-events-auto flex min-h-10 max-w-full animate-glass-in items-center gap-3 rounded-full py-1.5 pr-1.5 pl-4 text-sm ${
          quiet ? "text-zinc-300" : "text-zinc-100"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
