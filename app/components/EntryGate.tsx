"use client";

import { useState } from "react";
import { IconPin, IconShield, IconSpark, Spinner } from "./icons";

// How long the card takes to dissolve before the camera flies to you.
const EXIT_MS = 260;

export default function EntryGate({
  online,
  onReady,
}: {
  online: number;
  onReady: (lat: number, lng: number) => void;
}) {
  const [status, setStatus] = useState<"idle" | "locating" | "leaving" | "error">(
    "idle",
  );
  const [error, setError] = useState<string>("");

  function enter() {
    if (!("geolocation" in navigator)) {
      setStatus("error");
      setError("Your browser doesn't support location access.");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStatus("leaving");
        window.setTimeout(
          () => onReady(pos.coords.latitude, pos.coords.longitude),
          EXIT_MS,
        );
      },
      (err) => {
        setStatus("error");
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission is needed to place you on the map. Allow it in your browser and try again."
            : "Couldn't get your location. Please try again.",
        );
      },
      // High accuracy + maximumAge:0 forces a fresh fix (Wi-Fi/GPS scan)
      // instead of reusing the browser's cached IP-based location.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  const busy = status === "locating" || status === "leaving";

  return (
    <div
      className={`absolute inset-0 z-40 flex items-end justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center ${
        status === "leaving" ? "pointer-events-none" : ""
      }`}
    >
      {/* Vignette so the card reads clearly while the globe stays visible. */}
      <div
        aria-hidden="true"
        className={`absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,rgb(9_9_11/0.75)_85%)] transition-opacity duration-700 ${
          status === "leaving" ? "opacity-0" : "opacity-100"
        }`}
      />

      <div
        className={`glass relative w-full max-w-sm rounded-[28px] p-7 ${
          status === "leaving" ? "animate-glass-out" : "animate-glass-in"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <span className="size-2.5 rounded-full bg-emerald-400 animate-live" />
          <h1 className="text-[28px] font-semibold tracking-tight">Pulse</h1>
        </div>
        <p className="mt-2 text-[15px] leading-relaxed text-zinc-300">
          A living globe of anonymous strangers. Drop onto the map, tap a dot,
          start talking.
        </p>

        <p className="mt-5 flex items-center gap-2 text-sm text-zinc-400">
          <span className="relative flex size-2">
            <span className="absolute inset-0 rounded-full bg-emerald-400/60 motion-safe:animate-ping" />
            <span className="relative size-2 rounded-full bg-emerald-400" />
          </span>
          {online === 0
            ? "Be the first one here"
            : `${online} ${online === 1 ? "person" : "people"} online right now`}
        </p>

        <button
          onClick={enter}
          disabled={busy}
          className="btn btn-primary mt-6 h-12 w-full text-[15px]"
        >
          {busy ? (
            <>
              <Spinner /> Finding you…
            </>
          ) : (
            "Enter Pulse"
          )}
        </button>

        {status === "error" && (
          <p
            role="alert"
            className="mt-3 animate-fade-in text-center text-sm text-red-300"
          >
            {error}
          </p>
        )}

        <ul className="mt-6 grid grid-cols-3 gap-2 text-center text-[11px] leading-tight text-zinc-400">
          <li className="flex flex-col items-center gap-1.5">
            <IconSpark className="size-4 text-zinc-300" />
            No sign-up
          </li>
          <li className="flex flex-col items-center gap-1.5">
            <IconPin className="size-4 text-zinc-300" />
            Placed 1–3&nbsp;km from you
          </li>
          <li className="flex flex-col items-center gap-1.5">
            <IconShield className="size-4 text-zinc-300" />
            Nothing stored
          </li>
        </ul>
      </div>
    </div>
  );
}
