"use client";

import type { ReactNode } from "react";

// Glass prompt for "someone wants to connect" / "start video?". A bottom
// sheet on phones, a centered card on larger screens.
export default function ConnectionPrompt({
  title,
  subtitle,
  quote,
  color,
  icon,
  acceptLabel,
  declineLabel,
  onAccept,
  onDecline,
  onBlock,
}: {
  title: string;
  subtitle?: string;
  /** Their flare, shown as a quote so you know what they're about. */
  quote?: string;
  /** The other person's dot color, used for the avatar. */
  color: string;
  icon?: ReactNode;
  acceptLabel: string;
  declineLabel: string;
  onAccept: () => void;
  onDecline: () => void;
  /** Optional quiet escape hatch for repeated / unwanted requests. */
  onBlock?: () => void;
}) {
  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center">
      <div
        aria-hidden="true"
        className="absolute inset-0 animate-fade-in bg-zinc-950/40 backdrop-blur-[2px]"
      />
      <div
        role="alertdialog"
        aria-labelledby="prompt-title"
        className="glass relative w-full max-w-sm animate-sheet-in rounded-[28px] p-6 text-center sm:animate-glass-in"
      >
        <div
          className="avatar-ring mx-auto flex size-14 items-center justify-center rounded-full border-2 border-white/90 text-zinc-950"
          style={{ background: color, ["--dot" as string]: color }}
        >
          {icon}
        </div>
        <h2 id="prompt-title" className="mt-4 text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
        {quote && (
          <blockquote
            className="mx-auto mt-4 max-w-full rounded-2xl bg-white/[0.06] px-4 py-2.5 text-[15px] text-zinc-100"
            style={{ boxShadow: `inset 3px 0 0 0 ${color}, inset 0 0 0 1px rgb(255 255 255 / 0.08)` }}
          >
            “{quote}”
          </blockquote>
        )}
        <div className="mt-6 flex gap-3">
          <button onClick={onDecline} className="btn btn-glass h-11 flex-1 text-sm">
            {declineLabel}
          </button>
          <button
            onClick={onAccept}
            autoFocus
            className="btn btn-primary h-11 flex-1 text-sm"
          >
            {acceptLabel}
          </button>
        </div>
        {onBlock && (
          <button
            onClick={onBlock}
            className="mt-4 text-xs text-zinc-500 underline-offset-4 transition hover:text-zinc-300 hover:underline"
          >
            Block this person
          </button>
        )}
      </div>
    </div>
  );
}
