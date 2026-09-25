// Abuse limits. Counters live in Postgres (the only shared state across
// serverless instances); client IPs are only ever stored as a keyed hash.
import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";

export const LIMITS = {
  joinPerIp: { limit: 20, windowSec: 60 }, // new sessions + re-joins
  livePerIp: 10, // concurrent sessions (dots) per IP
  pollPerIp: { limit: 100, windowSec: 10 }, // ~15 tabs polling every 1.5s
  signalPerSession: { limit: 60, windowSec: 10 }, // handshakes burst ~20-30
  mailbox: 100, // pending signals per recipient
  payloadBytes: 16 * 1024, // SDP offers/answers are a few KB
};

// Server-only secret for the IP hash, so the stored key can't be reversed by
// hashing all IPv4 addresses. Falls back to DATABASE_URL, which is already a
// server-only secret, so deployments work without extra config.
const SECRET =
  process.env.RATE_LIMIT_SECRET ?? process.env.DATABASE_URL ?? "pulse-dev";

// On Vercel both headers are set by the platform (client-supplied values are
// overwritten). Locally they're absent and everyone shares one bucket.
export function clientIpKey(request: Request): string {
  const ip =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  return createHmac("sha256", SECRET).update(ip).digest("hex").slice(0, 32);
}

// Fixed-window counter: one atomic upsert per call (uses the database clock
// throughout). Returns true when this call is over the limit.
export async function rateLimited(
  key: string,
  { limit, windowSec }: { limit: number; windowSec: number },
): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "count", "resetAt")
    VALUES (${key}::text, 1, now() + make_interval(secs => ${windowSec}::float8))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."resetAt" <= now()
                     THEN 1 ELSE "RateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" <= now()
                       THEN EXCLUDED."resetAt" ELSE "RateLimit"."resetAt" END
    RETURNING "count"`;
  return rows[0].count > limit;
}

// Drop expired counters. Called from /api/poll (occasionally).
export async function sweepRateLimits(): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "RateLimit" WHERE "resetAt" < now() - interval '1 minute'`;
}

export function tooManyRequests(): Response {
  return Response.json(
    { error: "too many requests" },
    { status: 429, headers: { "Retry-After": "10" } },
  );
}
