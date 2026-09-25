import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { bearerToken, findSession, isValidId } from "@/lib/auth";
import {
  LIMITS,
  clientIpKey,
  rateLimited,
  tooManyRequests,
} from "@/lib/ratelimit";
import { blockUser, reportUser } from "@/lib/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/safety (Authorization: Bearer <token>) — body { peerId, action }.
// action "block": hide each other and end any chat between you.
// action "report": block, take down their flare, and count the report
// towards a temporary pause of their IP (see lib/safety.ts).
export async function POST(request: NextRequest) {
  const token = bearerToken(request);
  const me = token ? await findSession(token) : null;
  if (!me) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (await rateLimited(`safety:${me.id}`, LIMITS.safetyPerSession)) {
    return tooManyRequests();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const { peerId, action } = (body ?? {}) as Record<string, unknown>;
  if (!isValidId(peerId) || peerId === me.id) {
    return Response.json({ error: "invalid peerId" }, { status: 400 });
  }
  if (action !== "block" && action !== "report") {
    return Response.json({ error: "invalid action" }, { status: 400 });
  }

  await blockUser(me, peerId);

  if (action === "report") {
    const reported = await prisma.presence.findUnique({
      where: { id: peerId },
      select: { id: true, ipKey: true },
    });
    if (reported) {
      await reportUser({ id: me.id, ipKey: clientIpKey(request) }, reported);
    }
  }

  // Deliberately the same answer either way: the reporter doesn't learn
  // whether their report tipped someone into a pause.
  return Response.json({ ok: true });
}
