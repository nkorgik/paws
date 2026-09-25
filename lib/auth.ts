// Server-side session auth. Each browser tab holds a random secret token; the
// server stores only its SHA-256 hash and derives the caller's identity from
// it. The public session id (visible to everyone as a dot) is just an address
// and is never trusted as proof of identity.
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

const TOKEN_RE = /^[0-9a-f]{64}$/; // 32 random bytes, hex
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isValidToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

export function isValidId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

// Tokens are 256-bit random values, so a plain (unsalted) SHA-256 is enough —
// there is nothing to brute-force.
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Two numbers in [0, 1) derived from the session token, used as the privacy
// offset's distance and bearing so a session's dot stays put across
// re-joins. Domain-separated from `hashToken`, so the stored hash can't be
// used to recompute anyone's offset.
export function offsetSeed(token: string): [number, number] {
  const h = createHash("sha256").update(`privacy-offset:${token}`).digest();
  return [h.readUInt32BE(0) / 2 ** 32, h.readUInt32BE(4) / 2 ** 32];
}

// Token from an `Authorization: Bearer <token>` header, if well-formed.
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return isValidToken(token) ? token : null;
}

// The caller's presence row, or null if the token is unknown (never joined,
// left, or reaped as stale).
export function findSession(token: string) {
  return prisma.presence.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, busy: true, peerId: true },
  });
}
