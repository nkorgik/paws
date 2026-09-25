"use client";

import { useState } from "react";
import { IconShield, IconX, Spinner } from "./icons";

// "Keep Pulse safe" sheet: block, or report (which also blocks). Both end
// the conversation straight away.
export default function SafetySheet({
  onAction,
  onClose,
}: {
  onAction: (action: "block" | "report") => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<"block" | "report" | null>(null);

  async function run(action: "block" | "report") {
    setBusy(action);
    await onAction(action);
  }

  return (
    <div className="absolute inset-0 z-50 flex items-end justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center">
      <div
        aria-hidden="true"
        onClick={busy ? undefined : onClose}
        className="absolute inset-0 animate-fade-in bg-zinc-950/50 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-labelledby="safety-title"
        className="glass glass-strong relative w-full max-w-sm animate-sheet-in rounded-[28px] p-5 sm:animate-glass-in"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-white/10 text-emerald-300">
              <IconShield />
            </span>
            <h2 id="safety-title" className="text-lg font-semibold tracking-tight">
              Keep Pulse safe
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={!!busy}
            aria-label="Close"
            className="btn btn-glass size-9 shrink-0"
          >
            <IconX className="size-4" />
          </button>
        </div>

        <div className="mt-5 space-y-2">
          <button
            onClick={() => void run("block")}
            disabled={!!busy}
            className="btn btn-glass h-auto w-full flex-col items-start gap-0.5 rounded-2xl px-4 py-3 text-left"
          >
            <span className="flex items-center gap-2 text-[15px] font-semibold">
              {busy === "block" && <Spinner />} Block
            </span>
            <span className="text-xs font-normal text-zinc-400">
              Ends the chat. You won&apos;t see each other or be able to reach
              each other again this session.
            </span>
          </button>
          <button
            onClick={() => void run("report")}
            disabled={!!busy}
            className="btn h-auto w-full flex-col items-start gap-0.5 rounded-2xl bg-red-500/15 px-4 py-3 text-left text-red-200 shadow-[inset_0_0_0_1px_rgb(248_113_113/0.3)] hover:bg-red-500/25"
          >
            <span className="flex items-center gap-2 text-[15px] font-semibold">
              {busy === "report" && <Spinner />} Report &amp; block
            </span>
            <span className="text-xs font-normal text-red-200/70">
              Also flags them. When several people report someone, they&apos;re
              paused from Pulse for a while.
            </span>
          </button>
        </div>

        <p className="mt-4 text-center text-xs text-zinc-500">
          They won&apos;t be told who blocked or reported them.
        </p>
      </div>
    </div>
  );
}
