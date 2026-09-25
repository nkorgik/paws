"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconChat,
  IconEye,
  IconEyeOff,
  IconShield,
  IconMic,
  IconMicOff,
  IconPhoneEnd,
  IconVideo,
  IconVideoOff,
} from "./icons";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Full-bleed call view: remote video fills the screen, your mirrored
// self-view floats in glass, and a glass control bar sits at the bottom.
export default function VideoPanel({
  localStream,
  remoteStream,
  color,
  chatOpen,
  unread,
  onToggleChat,
  onEnd,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  /** The stranger's dot color, for the waiting avatar. */
  color: string;
  chatOpen: boolean;
  unread: number;
  onToggleChat: () => void;
  onEnd: () => void;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  // Consent-first: their video starts blurred until you choose to see it,
  // and you can blur it again any time. Purely local — nothing is sent.
  const [revealed, setRevealed] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (localRef.current && localRef.current.srcObject !== localStream) {
      localRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteRef.current && remoteRef.current.srcObject !== remoteStream) {
      remoteRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    const started = Date.now();
    const t = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, []);

  // Muting just disables the local track: the peer gets silence / black
  // frames, no renegotiation needed.
  function toggle(kind: "audio" | "video") {
    const tracks =
      kind === "audio"
        ? localStream?.getAudioTracks()
        : localStream?.getVideoTracks();
    const next = kind === "audio" ? !micOn : !camOn;
    tracks?.forEach((t) => (t.enabled = next));
    if (kind === "audio") setMicOn(next);
    else setCamOn(next);
  }

  return (
    <div className="absolute inset-0 z-10 animate-fade-in bg-zinc-950">
      {/* Remote */}
      <video
        ref={remoteRef}
        autoPlay
        playsInline
        className={`h-full w-full object-cover transition-[filter,transform] duration-700 ease-glass ${
          revealed ? "" : "scale-110 blur-[48px] saturate-50"
        }`}
      />
      {remoteStream && !revealed && (
        <div className="absolute inset-0 z-[1] flex items-center justify-center p-6">
          <div className="glass glass-strong w-full max-w-xs animate-glass-in rounded-[28px] p-6 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-white/10 text-emerald-300">
              <IconShield />
            </span>
            <h2 className="mt-4 text-lg font-semibold tracking-tight">
              Their video is blurred
            </h2>
            <p className="mt-1 text-sm text-zinc-300">
              You decide when to see it. If anything feels off, just end the
              video.
            </p>
            <button
              onClick={() => setRevealed(true)}
              autoFocus
              className="btn btn-primary mt-5 h-11 w-full text-sm"
            >
              <IconEye className="size-4" /> Reveal video
            </button>
          </div>
        </div>
      )}
      {!remoteStream && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <span
            className="avatar-ring size-20 rounded-full border-2 border-white/90"
            style={{ background: color, ["--dot" as string]: color }}
          />
          <p className="text-sm text-zinc-400">Waiting for their video…</p>
        </div>
      )}
      {/* Soft top/bottom shading so the glass controls read on any frame. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgb(0_0_0/0.35),transparent_20%,transparent_75%,rgb(0_0_0/0.45))]"
      />

      {/* Call timer */}
      <div className="absolute top-[max(1rem,env(safe-area-inset-top))] left-4">
        <div className="glass flex h-10 items-center gap-2 rounded-full px-4 text-sm">
          <span className="size-2 rounded-full bg-red-400 animate-pulse" />
          <span className="tabular-nums text-zinc-100">{formatTime(elapsed)}</span>
        </div>
      </div>

      {/* Self view (mirrored, like a mirror). While chat is open it slides
          left of the panel on large screens and steps aside on smaller ones
          (the chat has its own "back to video" and end buttons). */}
      <div
        className={`glass absolute top-[max(1rem,env(safe-area-inset-top))] right-4 h-40 w-28 overflow-hidden rounded-2xl p-0 transition-[right] duration-500 ease-glass sm:h-56 sm:w-40 ${
          chatOpen ? "max-lg:hidden lg:right-[calc(380px+2rem)]" : ""
        }`}
      >
        <video
          ref={localRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full -scale-x-100 object-cover transition-opacity duration-300 ${
            camOn ? "opacity-100" : "opacity-0"
          }`}
        />
        {!camOn && (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-400">
            <IconVideoOff />
          </div>
        )}
      </div>

      {/* Controls */}
      <div
        className={`absolute inset-x-0 bottom-[max(1.25rem,env(safe-area-inset-bottom))] flex justify-center px-4 transition-[padding] duration-500 ease-glass ${
          chatOpen ? "max-lg:hidden lg:pr-[calc(380px+2rem)]" : ""
        }`}
      >
        <div className="glass flex animate-glass-in items-center gap-2 rounded-full p-2">
          <button
            onClick={() => toggle("audio")}
            aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
            aria-pressed={!micOn}
            className={`btn size-12 ${micOn ? "btn-glass" : "bg-white text-zinc-900"}`}
          >
            {micOn ? <IconMic /> : <IconMicOff />}
          </button>
          <button
            onClick={() => toggle("video")}
            aria-label={camOn ? "Turn camera off" : "Turn camera on"}
            aria-pressed={!camOn}
            className={`btn size-12 ${camOn ? "btn-glass" : "bg-white text-zinc-900"}`}
          >
            {camOn ? <IconVideo /> : <IconVideoOff />}
          </button>
          <button
            onClick={() => setRevealed(!revealed)}
            disabled={!remoteStream}
            aria-label={revealed ? "Blur their video" : "Reveal their video"}
            aria-pressed={!revealed}
            title={revealed ? "Blur their video" : "Reveal their video"}
            className={`btn size-12 ${revealed ? "btn-glass" : "bg-white text-zinc-900"}`}
          >
            {revealed ? <IconEyeOff /> : <IconEye />}
          </button>
          <button
            onClick={onToggleChat}
            aria-label={chatOpen ? "Hide chat" : "Show chat"}
            aria-pressed={chatOpen}
            className={`btn relative size-12 ${chatOpen ? "bg-white text-zinc-900" : "btn-glass"}`}
          >
            <IconChat />
            {unread > 0 && !chatOpen && (
              <span className="absolute -top-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-emerald-400 text-[11px] font-bold text-zinc-950">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
          <button
            onClick={onEnd}
            aria-label="End video"
            title="End video (keep chatting)"
            className="btn btn-danger h-12 px-5 text-sm"
          >
            <IconPhoneEnd />
            <span className="hidden lg:inline">End video</span>
          </button>
        </div>
      </div>
    </div>
  );
}
