import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerToken, findSession } from "@/lib/auth";
import { moderateFlare } from "@/lib/moderation";
import { FLARE_TTL_MS } from "@/lib/presence";
import { LIMITS, rateLimited, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/status (Authorization: Bearer <token>) — body { flare }.
// `flare`: a short public note for your dot (moderated), or null to clear it.
// Flares expire after FLARE_TTL_MS.
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
  const { flare } = (body ?? {}) as Record<string, unknown>;

  if (flare === null) {
    await prisma.presence.update({
      where: { id: me.id },
      data: { flare: null, flareExpiresAt: null },
    });
    return Response.json({ ok: true, flare: null });
  }

  const result = moderateFlare(flare);
  if (!result.ok) {
    return Response.json({ error: result.reason }, { status: 422 });
  }
  const expiresAt = new Date(Date.now() + FLARE_TTL_MS);
  await prisma.presence.update({
    where: { id: me.id },
    data: { flare: result.text, flareExpiresAt: expiresAt },
  });
  return Response.json({
    ok: true,
    flare: result.text,
    expiresAt: expiresAt.toISOString(),
  });
}
