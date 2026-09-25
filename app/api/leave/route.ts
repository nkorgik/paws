import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { findSession, isValidId, isValidToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/leave — body { token, peerId? }. Removes the caller's presence row
// and any pending signals to/from them. If the caller was in (or setting up)
// a connection, `peerId` is the other side: free them and tell them it ended.
// Called via navigator.sendBeacon on tab close, which can't set headers, so
// the token travels in the body; the body may also arrive as text — parse
// defensively.
export async function POST(request: NextRequest) {
  let token: unknown;
  let peerId: unknown;
  try {
    const text = await request.text();
    const body = text ? JSON.parse(text) : undefined;
    token = body?.token;
    peerId = body?.peerId;
  } catch {
    token = undefined;
  }

  if (!isValidToken(token)) {
    return Response.json({ error: "invalid token" }, { status: 400 });
  }

  const me = await findSession(token);
  if (!me) {
    // Already gone (left earlier or reaped) — nothing to do.
    return Response.json({ ok: true });
  }
  const id = me.id;

  // Independent cleanup deletes — no atomicity needed (and interactive
  // transactions are unreliable over a PgBouncer pooler).
  await prisma.signal.deleteMany({
    where: { OR: [{ toId: id }, { fromId: id }] },
  });
  await prisma.presence.deleteMany({ where: { id } });

  // End the connection for the peer. Done after the deletes above so this
  // "end" isn't wiped along with the leaving user's other signals.
  if (isValidId(peerId) && peerId !== id) {
    await prisma.presence.updateMany({
      where: { id: peerId },
      data: { busy: false },
    });
    await prisma.signal.create({
      data: { fromId: id, toId: peerId, type: "end", payload: null },
    });
  }

  return Response.json({ ok: true });
}
