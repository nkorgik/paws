import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { STALE_MS, SIGNAL_TTL_MS } from "@/lib/presence";
import type { PollResponse } from "@/lib/types";
import { blockedPeers, sweepSafety } from "@/lib/safety";
import { bearerToken, hashToken } from "@/lib/auth";
import {
  LIMITS,
  clientIpKey,
  rateLimited,
  sweepRateLimits,
  tooManyRequests,
} from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/poll (Authorization: Bearer <token>) — the single endpoint that
// drives the live map. It (1) heartbeats the caller, (2) reaps stale presence
// + orphan signals, (3) returns the filtered online peers, and (4) drains this
// user's mailbox. The caller is identified by their token, never by an id.
export async function GET(request: NextRequest) {
  const token = bearerToken(request);
  if (!token) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (await rateLimited(`poll:${clientIpKey(request)}`, LIMITS.pollPerIp)) {
    return tooManyRequests();
  }

  const now = Date.now();
  const staleCutoff = new Date(now - STALE_MS);
  const signalCutoff = new Date(now - SIGNAL_TTL_MS);

  // 1) Heartbeat — refresh lastSeen for the caller. If no row matches the
  // token, the caller was reaped as stale (sleep, offline, throttled
  // background tab) and must re-join, since the heartbeat can't recreate the
  // row on its own. They still get the peer list, but no mailbox.
  // updateManyAndReturn (not update) so a missing row — normal before the
  // first join — is an empty result rather than a logged Prisma error.
  const [me] = await prisma.presence.updateManyAndReturn({
    where: { tokenHash: hashToken(token) },
    data: { lastSeen: new Date(now) },
    select: { id: true },
  });
  const id = me?.id ?? null;

  // 2) Reap stale presence rows and orphaned signals (independent deletes —
  // no atomicity needed, and avoids transactions over a PgBouncer pooler).
  await prisma.presence.deleteMany({ where: { lastSeen: { lt: staleCutoff } } });
  await prisma.signal.deleteMany({ where: { createdAt: { lt: signalCutoff } } });
  // Expired rate-limit counters don't need sweeping on every poll.
  if (Math.random() < 0.1) {
    await sweepRateLimits();
    await sweepSafety();
  }

  // 3) Online peers, excluding self.
  const peers = await prisma.presence.findMany({
    where: {
      ...(id ? { id: { not: id } } : {}),
      lastSeen: { gte: staleCutoff },
    },
    select: {
      id: true,
      lat: true,
      lng: true,
      busy: true,
      flare: true,
      flareExpiresAt: true,
      dnd: true,
    },
  });

  // 4) Drain this user's mailbox: read, then delete exactly what we read so a
  // concurrently-inserted signal is never lost.
  const inbox = id
    ? await prisma.signal.findMany({
        where: { toId: id },
        orderBy: { createdAt: "asc" },
      })
    : [];
  if (inbox.length > 0) {
    await prisma.signal.deleteMany({
      where: { id: { in: inbox.map((s) => s.id) } },
    });
  }

  // People you blocked, or who blocked you, don't see each other.
  const hidden = id ? await blockedPeers(id) : new Set<string>();

  const response: PollResponse = {
    present: id !== null,
    peers: peers.filter((p) => !hidden.has(p.id)).map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      busy: p.busy,
      // Expired flares are simply not shown (no sweep needed).
      flare:
        p.flare && p.flareExpiresAt && p.flareExpiresAt.getTime() > now
          ? p.flare
          : null,
      dnd: p.dnd,
    })),
    signals: inbox.map((s) => ({
      id: s.id,
      fromId: s.fromId,
      toId: s.toId,
      type: s.type as PollResponse["signals"][number]["type"],
      payload: s.payload,
      createdAt: s.createdAt.toISOString(),
    })),
  };

  return Response.json(response);
}
