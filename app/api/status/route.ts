import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerToken, findSession } from "@/lib/auth";
import { moderateFlare } from "@/lib/moderation";
import { FLARE_TTL_MS } from "@/lib/presence";
import { LIMITS, rateLimited, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/status (Authorization: Bearer <token>) — body { flare?, dnd? }.
// `flare`: a short public note for your dot (moderated), or null to clear it.
// Flares expire after FLARE_TTL_MS.
// `dnd`: do not disturb — stay on the map but auto-decline requests.
export async function POST(request: NextRequest) {
  const token = bearerToken(request);
  const me = token ? await findSession(token) : null;
  if (!me) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (await rateLimited(`status:${me.id}`, LIMITS.statusPerSession)) {
    return tooManyRequests();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const input = (body ?? {}) as Record<string, unknown>;
  const data: {
    flare?: string | null;
    flareExpiresAt?: Date | null;
    dnd?: boolean;
  } = {};

  if ("dnd" in input) {
    if (typeof input.dnd !== "boolean") {
      return Response.json({ error: "invalid dnd" }, { status: 400 });
    }
    data.dnd = input.dnd;
  }

  if ("flare" in input) {
    if (input.flare === null) {
      data.flare = null;
      data.flareExpiresAt = null;
    } else {
      const result = moderateFlare(input.flare);
      if (!result.ok) {
        return Response.json({ error: result.reason }, { status: 422 });
      }
      data.flare = result.text;
      data.flareExpiresAt = new Date(Date.now() + FLARE_TTL_MS);
    }
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "nothing to update" }, { status: 400 });
  }

  const updated = await prisma.presence.update({
    where: { id: me.id },
    data,
    select: { flare: true, flareExpiresAt: true, dnd: true },
  });
  return Response.json({
    ok: true,
    flare: updated.flare,
    expiresAt: updated.flareExpiresAt?.toISOString(),
    dnd: updated.dnd,
  });
}
