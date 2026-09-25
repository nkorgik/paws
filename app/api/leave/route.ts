import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { findSession, isValidToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/leave — body { token }. Removes the caller's presence row and any
// pending signals to/from them, and ends their request/connection for the
// other side. Called via navigator.sendBeacon on tab close, which can't set
// headers, so the token travels in the body; the body may also arrive as
// text — parse defensively.
export async function POST(request: NextRequest) {
  let token: unknown;
  try {
    const text = await request.text();
    token = text ? JSON.parse(text)?.token : undefined;
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

  // Everyone linked to us, taken from server state (never from the client):
  // whoever we requested / are connected to, plus whoever requested us.
  const linked = await prisma.presence.findMany({
    where: { peerId: id },
    select: { id: true },
  });
  const peers = new Set(linked.map((p) => p.id));
  if (me.peerId) peers.add(me.peerId);

  // Independent cleanup deletes — no atomicity needed (and interactive
  // transactions are unreliable over a PgBouncer pooler).
  await prisma.signal.deleteMany({
    where: { OR: [{ toId: id }, { fromId: id }] },
  });
  await prisma.presence.deleteMany({ where: { id } });
  // Blocks only mean something between live sessions.
  await prisma.block.deleteMany({
    where: { OR: [{ blockerId: id }, { blockedId: id }] },
  });

  // Free each linked peer and tell them it ended. Done after the deletes
  // above so these "end"s aren't wiped along with our other signals.
  for (const peerId of peers) {
    await prisma.presence.updateMany({
      where: { id: peerId, peerId: id },
      data: { peerId: null, busy: false },
    });
    await prisma.signal.create({
      data: { fromId: id, toId: peerId, type: "end", payload: null },
    });
  }

  return Response.json({ ok: true });
}
