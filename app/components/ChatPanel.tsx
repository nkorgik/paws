"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_CHAT_LENGTH } from "@/lib/webrtc";
import { IconLock, IconPhoneEnd, IconSend, IconVideo, Spinner } from "./icons";

export interface ChatMessage {
  id: number;
  mine: boolean;
  text: string;
}

// Floating glass chat. Bottom sheet on phones, a panel on the right on larger
// screens (below the top bar).
export default function ChatPanel({
  messages,
  connected,
  videoBusy,
  color,
  distance,
  hidden = false,
  onSend,
  onStartVideo,
  onEnd,
}: {
  messages: ChatMessage[];
  connected: boolean;
  videoBusy: boolean;
  /** The stranger's dot color, used for their avatar. */
  color: string;
  distance?: string;
  /** Kept mounted (draft + scroll survive) but out of view, e.g. during video. */
  hidden?: boolean;
  onSend: (text: string) => void;
  onStartVideo: () => void;
  onEnd: () => void;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // Ready to type the moment the connection opens.
  useEffect(() => {
    if (connected && !hidden) inputRef.current?.focus();
  }, [connected, hidden]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !connected) return;
    onSend(text);
    setDraft("");
  }

  return (
    <section
      aria-label="Chat with stranger"
      className={`glass glass-strong absolute inset-x-2 top-[38%] bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-20 flex animate-sheet-in flex-col overflow-hidden rounded-[28px] sm:inset-x-auto sm:top-[calc(max(1rem,env(safe-area-inset-top))+3.5rem)] sm:right-4 sm:bottom-4 sm:w-[380px] sm:animate-glass-in ${
        hidden ? "hidden" : ""
      }`}
    >
      <header className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        <span
          aria-hidden="true"
          className="size-9 shrink-0 rounded-full border-2 border-white/90"
          style={{ background: color }}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight">
            Stranger
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-400">
            {connected ? (
              <span className="size-1.5 shrink-0 rounded-full bg-emerald-400" />
            ) : (
              <Spinner className="size-3 shrink-0 border-[1.5px]" />
            )}
            <span className="truncate">
              {connected ? "Encrypted" : "Connecting…"}
              {distance && ` · ${distance}`}
            </span>
          </p>
        </div>
        <button
          onClick={onStartVideo}
          disabled={!connected || videoBusy}
          aria-label="Start video call"
          title="Start video call"
          className="btn btn-glass size-10"
        >
          <IconVideo />
        </button>
        <button
          onClick={onEnd}
          aria-label="End chat"
          title="End chat"
          className="btn btn-danger size-10"
        >
          <IconPhoneEnd />
        </button>
      </header>

      <div
        className="flex-1 overflow-y-auto px-3 py-4 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black_calc(100%-8px),transparent)]"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <span className="glass flex size-12 items-center justify-center rounded-full text-emerald-300">
              <IconLock />
            </span>
            <p className="mt-4 text-sm font-medium text-zinc-200">
              {connected ? "Say hello" : "Opening a private line…"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              Messages go straight to them, peer-to-peer. Nothing touches our
              server and nothing is stored.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {messages.map((m) => (
              <li
                key={m.id}
                className={`flex animate-glass-in ${m.mine ? "justify-end" : "justify-start"}`}
              >
                <span
                  className={`max-w-[80%] whitespace-pre-wrap break-words px-3.5 py-2 text-[15px] leading-snug ${
                    m.mine
                      ? "rounded-[20px] rounded-br-md bg-gradient-to-b from-emerald-300 to-emerald-400 text-zinc-950 shadow-[inset_0_1px_0_rgb(255_255_255/0.5)]"
                      : "rounded-[20px] rounded-bl-md bg-white/[0.09] text-zinc-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.08),inset_0_0_0_1px_rgb(255_255_255/0.06)]"
                  }`}
                >
                  {m.text}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 p-3 pt-2">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_CHAT_LENGTH}
          placeholder={connected ? "Message" : "Connecting…"}
          aria-label="Message"
          disabled={!connected}
          enterKeyHint="send"
          className="h-11 min-w-0 flex-1 rounded-full bg-white/[0.06] px-4 text-[15px] text-zinc-100 outline-none ring-1 ring-white/10 transition placeholder:text-zinc-500 focus:bg-white/[0.09] focus:ring-emerald-400/60 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!connected || !draft.trim()}
          aria-label="Send"
          className="btn btn-primary size-11 shrink-0"
        >
          <IconSend />
        </button>
      </form>
    </section>
  );
}
