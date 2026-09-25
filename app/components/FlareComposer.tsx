"use client";

import { useState } from "react";
import { FLARE_MAX_LENGTH } from "@/lib/presence";
import { IconSpark, IconX, Spinner } from "./icons";

const SUGGESTIONS = [
  "☕ Up for a chat",
  "🌙 Can't sleep",
  "🎵 Let's talk music",
  "🗣️ Practicing English",
  "♟️ Chess, anyone?",
  "🌍 Tell me about your city",
];

// Glass sheet for writing a flare: a short public note on your dot that
// gives strangers a reason to tap it. Moderated server-side; errors show
// inline.
export default function FlareComposer({
  current,
  onPost,
  onClear,
  onClose,
}: {
  current: string | null;
  onPost: (text: string) => Promise<string | null>; // resolves to an error, or null
  onClear: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const length = [...text].length;

  async function post(value: string) {
    if (!value.trim() || sending) return;
    setSending(true);
    setError(null);
    const err = await onPost(value.trim());
    setSending(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-zinc-950/40 backdrop-blur-[2px]"
      />
      <form
        role="dialog"
        aria-labelledby="flare-title"
        onSubmit={(e) => {
          e.preventDefault();
          void post(text);
        }}
        className="glass relative w-full max-w-md animate-sheet-in rounded-[28px] p-5 sm:animate-glass-in"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="flare-title" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <IconSpark className="size-4 text-emerald-300" />
              Send up a flare
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              A short note on your dot so people know why to say hi. Everyone
              sees it for 15 minutes.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn btn-glass size-9 shrink-0"
          >
            <IconX className="size-4" />
          </button>
        </div>

        <div className="relative mt-4">
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            maxLength={FLARE_MAX_LENGTH + 10}
            autoFocus
            placeholder="anyone up for chess?"
            aria-label="Flare text"
            aria-invalid={!!error}
            className="h-12 w-full rounded-2xl bg-white/[0.06] pr-14 pl-4 text-[15px] text-zinc-100 outline-none ring-1 ring-white/10 transition placeholder:text-zinc-500 focus:bg-white/[0.09] focus:ring-emerald-400/60 aria-[invalid=true]:ring-red-400/70"
          />
          <span
            className={`absolute top-1/2 right-4 -translate-y-1/2 text-xs tabular-nums ${
              length > FLARE_MAX_LENGTH ? "text-red-300" : "text-zinc-500"
            }`}
          >
            {FLARE_MAX_LENGTH - length}
          </span>
        </div>
        {error && (
          <p role="alert" className="mt-2 animate-fade-in text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void post(s)}
              disabled={sending}
              className="btn btn-glass h-8 px-3 text-xs font-medium"
            >
              {s}
            </button>
          ))}
        </div>

        <p className="mt-4 text-xs text-zinc-500">
          No links, contact info or handles. Keep it kind.
        </p>

        <div className="mt-4 flex gap-3">
          {current && (
            <button
              type="button"
              onClick={() => {
                onClear();
                onClose();
              }}
              className="btn btn-glass h-11 flex-1 text-sm"
            >
              Take it down
            </button>
          )}
          <button
            type="submit"
            disabled={!text.trim() || sending || length > FLARE_MAX_LENGTH}
            className="btn btn-primary h-11 flex-1 text-sm"
          >
            {sending ? <Spinner /> : current ? "Update flare" : "Send it up"}
          </button>
        </div>
      </form>
    </div>
  );
}
