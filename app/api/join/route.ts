import type { NextRequest } from "next/server";
import { isPrismaError, prisma } from "@/lib/prisma";
import { applyPrivacyOffset, isValidLatLng } from "@/lib/geo";
import { hashToken, isValidId, isValidToken, offsetSeed } from "@/lib/auth";
import {
  LIMITS,
  clientIpKey,
  rateLimited,
  tooManyRequests,
} from "@/lib/ratelimit";
import { suspendedUntil } from "@/lib/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/join — body { id, token, lat, lng } (raw coords).
// Registers (or re-registers after being reaped) the tab's session: `id` is
// the public dot id, `token` the tab's secret. Only the token's hash is
// stored, and an existing id can only be updated by the token that created
// it. Applies a 1–3 km privacy offset that's fixed per session (derived from
// the token), so re-joining doesn't reveal a new sample of the real location.
// Raw coordinates are never stored.
export async function POST(request: NextRequest) {
  const ipKey = clientIpKey(request);
  if (await rateLimited(`join:${ipKey}`, LIMITS.joinPerIp)) {
    return tooManyRequests();
  }
  // Paused after repeated reports from other people.
  const until = await suspendedUntil(ipKey);
  if (until) {
    return Response.json(
      { error: "suspended", until: until.toISOString() },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { id, token, lat, lng } = (body ?? {}) as Record<string, unknown>;

  if (!isValidId(id)) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }
  if (!isValidToken(token)) {
    return Response.json({ error: "invalid token" }, { status: 400 });
  }
  if (!isValidLatLng(lat, lng)) {
    return Response.json({ error: "invalid coordinates" }, { status: 400 });
  }

  const tokenHash = hashToken(token);
  const offset = applyPrivacyOffset(
    lat as number,
    lng as number,
    ...offsetSeed(token),
  );

  const existing = await prisma.presence.findUnique({
    where: { id },
    select: { tokenHash: true },
  });

  if (existing) {
    if (existing.tokenHash !== tokenHash) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    await prisma.presence.update({
      where: { id },
      data: { lat: offset.lat, lng: offset.lng, lastSeen: new Date() },
    });
  } else {
    // Cap live sessions per IP so one client can't flood the map with dots.
    const live = await prisma.presence.count({ where: { ipKey } });
    if (live >= LIMITS.livePerIp) return tooManyRequests();
    try {
      await prisma.presence.create({
        data: {
          id,
          tokenHash,
          ipKey,
          lat: offset.lat,
          lng: offset.lng,
          busy: false,
          lastSeen: new Date(),
        },
      });
    } catch (e) {
      // Unique violation: the id or token was claimed concurrently.
      if (isPrismaError(e, "P2002")) {
        return Response.json({ error: "conflict" }, { status: 409 });
      }
      throw e;
    }
  }

  return Response.json({ ok: true });
}
