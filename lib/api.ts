// Client-side helpers for talking to the coordination API. Every call proves
// who we are with the session token; the server never trusts an id we send
// as our own identity.
import type { PollResponse, SignalType } from "@/lib/types";
import type { Session } from "@/lib/session";

function authHeaders(token: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function join(
  session: Session,
  lat: number,
  lng: number,
): Promise<void> {
  await fetch("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: session.id, token: session.token, lat, lng }),
  });
}

export async function poll(token: string): Promise<PollResponse> {
  const res = await fetch("/api/poll", {
    headers: authHeaders(token),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  return res.json();
}

// Resolves to false if the server rejected the signal (e.g. 409: it no
// longer matches the connection state, like accepting an expired request).
export async function sendSignal(
  token: string,
  toId: string,
  type: SignalType,
  payload?: string,
): Promise<boolean> {
  const res = await fetch("/api/signal", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ toId, type, payload }),
  });
  return res.ok;
}

// Fire-and-forget leave that survives the tab closing. The server ends our
// request/connection for the other side too. sendBeacon can't set headers,
// so the token goes in the body here.
export function leave(token: string): void {
  const body = JSON.stringify({ token });
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon("/api/leave", body);
  } else {
    void fetch("/api/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  }
}

export type StatusResult =
  | { ok: true; flare: string | null; expiresAt?: string }
  | { ok: false; error: string };

// Set (moderated server-side) or clear (null) the flare on our dot.
export async function setStatus(
  token: string,
  status: { flare: string | null },
): Promise<StatusResult> {
  try {
    const res = await fetch("/api/status", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(status),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, flare: body.flare ?? null, expiresAt: body.expiresAt };
    if (res.status === 429) return { ok: false, error: "Slow down a little and try again." };
    return { ok: false, error: body.error ?? "Couldn't update that. Try again." };
  } catch {
    return { ok: false, error: "You're offline. Try again." };
  }
}
