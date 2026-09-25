import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { SignalType } from "@/lib/types";
import { bearerToken, findSession, isValidId } from "@/lib/auth";
import { unpair } from "@/lib/pairing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES: SignalType[] = [
  "request",
  "accept",
  "decline",
  "offer",
  "answer",
  "ice",
  "end",
];

const MAX_PAYLOAD = 64 * 1024; // SDP/ICE are small; cap to be safe.

// POST /api/signal (Authorization: Bearer <token>) — body { toId, type, payload? }
// Drops one message into the recipient's mailbox. The sender is derived from
// the token, never taken from the body. Tracks who is paired with whom
// (`peerId` + `busy`) and only relays signals that fit that state; a user can
// only be in one connection at a time.
export async function POST(request: NextRequest) {
  const token = bearerToken(request);
  const me = token ? await findSession(token) : null;
  if (!me) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const fromId = me.id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { toId, type, payload } = (body ?? {}) as Record<string, unknown>;

  if (!isValidId(toId) || toId === fromId) {
    return Response.json({ error: "invalid toId" }, { status: 400 });
  }
  if (typeof type !== "string" || !VALID_TYPES.includes(type as SignalType)) {
    return Response.json({ error: "invalid type" }, { status: 400 });
  }
  if (
    payload !== undefined &&
    payload !== null &&
    (typeof payload !== "string" || payload.length > MAX_PAYLOAD)
  ) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  const signalType = type as SignalType;
  const payloadStr = typeof payload === "string" ? payload : null;

  // Every signal must fit the current connection state (see lib/pairing.ts).
  // Anything else is rejected, so nobody can mark strangers busy, free them,
  // or inject handshake data into someone else's connection.
  switch (signalType) {
    case "request": {
      // One active connection at a time.
      if (me.busy) return conflict();
      const target = await prisma.presence.findUnique({
        where: { id: toId },
        select: { busy: true },
      });
      if (!target || target.busy) {
        // Offline or already connected — auto-decline instead of delivering.
        await deliver(toId, fromId, "decline", null);
        return Response.json({ ok: true, autoDeclined: true });
      }
      await prisma.presence.update({
        where: { id: fromId },
        data: { peerId: toId },
      });
      break;
    }
    case "accept": {
      // Only a pending request from `toId` to us can be accepted. Claiming
      // the requester with a conditional update means a stale or forged
      // accept matches nothing.
      if (me.busy) return conflict();
      const claimed = await prisma.presence.updateMany({
        where: { id: toId, peerId: fromId, busy: false },
        data: { busy: true },
      });
      if (claimed.count === 0) return conflict();
      await prisma.presence.update({
        where: { id: fromId },
        data: { peerId: toId, busy: true },
      });
      break;
    }
    case "decline": {
      // Only a pending request from `toId` to us can be declined. Frees the
      // requester only — we may be busy in another connection.
      const cleared = await prisma.presence.updateMany({
        where: { id: toId, peerId: fromId, busy: false },
        data: { peerId: null },
      });
      if (cleared.count === 0) return conflict();
      break;
    }
    case "end": {
      if (!(await unpair(me, toId))) return conflict();
      break;
    }
    default: {
      // offer / answer / ice: only between two users connected to each other.
      if (!me.busy || me.peerId !== toId) return conflict();
    }
  }

  await deliver(fromId, toId, signalType, payloadStr);
  return Response.json({ ok: true });
}

function conflict() {
  return Response.json(
    { error: "signal doesn't match connection state" },
    { status: 409 },
  );
}

async function deliver(
  fromId: string,
  toId: string,
  type: SignalType,
  payload: string | null,
) {
  await prisma.signal.create({ data: { fromId, toId, type, payload } });
}
