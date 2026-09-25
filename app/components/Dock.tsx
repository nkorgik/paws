"use client";

import { useEffect, useState } from "react";
import { IconMoon, IconSpark } from "./icons";

// Bottom-center controls while you're on the map: a one-line hint, your
// flare (tap to add / edit it) and a do-not-disturb toggle.
export default function Dock({
  hint,
  flare,
  dnd,
  onOpenFlare,
  onToggleDnd,
}: {
  hint: string;
  flare: { text: string; expiresAt: number } | null;
  dnd: boolean;
  onOpenFlare: () => void;
  onToggleDnd: () => void;
}) {
  // Re-render every 30s so "12m left" stays roughly current.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const minutesLeft = flare
    ? Math.max(1, Math.round((flare.expiresAt - now) / 60_000))
    : 0;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 flex flex-col items-center gap-2 px-4">
      <p className="animate-fade-in text-center text-xs text-zinc-300 [text-shadow:0_1px_8px_rgb(0_0_0/0.8)]">
        {dnd ? "Do not disturb is on. Requests to you are declined." : hint}
      </p>
      <div className="flex max-w-full items-center gap-2">
        <button
          onClick={onOpenFlare}
          className="glass btn pointer-events-auto h-11 min-w-0 animate-glass-in gap-2 px-4 text-sm font-medium"
        >
          <IconSpark className="size-4 shrink-0 text-emerald-300" />
          {flare ? (
            <>
              <span className="truncate">{flare.text}</span>
              <span className="shrink-0 text-xs font-normal text-zinc-400">
                {minutesLeft}m left
              </span>
            </>
          ) : (
            "Add a flare"
          )}
        </button>
        <button
          onClick={onToggleDnd}
          aria-pressed={dnd}
          aria-label={dnd ? "Turn off do not disturb" : "Turn on do not disturb"}
          title={dnd ? "Do not disturb is on" : "Do not disturb"}
          className={`btn pointer-events-auto size-11 shrink-0 animate-glass-in ${
            dnd ? "bg-indigo-300 text-zinc-950" : "glass text-zinc-200"
          }`}
        >
          <IconMoon />
        </button>
      </div>
    </div>
  );
}
