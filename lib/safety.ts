// Blocking, reporting and report-based pauses. All of it is transient and
// keyed on session ids / hashed IPs, never on identity.
import { prisma } from "@/lib/prisma";
import { unpair } from "@/lib/pairing";

// Reports from this many *different* IPs within the window pause the
// reported IP. Distinct IPs so one person with many tabs can't get someone
// paused on their own.
export const REPORT_THRESHOLD = 3;
export const REPORT_WINDOW_MS = 30 * 60_000;
export const SUSPENSION_MS = 15 * 60_000;
const BLOCK_MAX_AGE_MS = 6 * 60 * 60_000; // safety net; normally gone on leave

// Is there a block between these two users, in either direction?
export async function isBlockedPair(a: string, b: string): Promise<boolean> {
  const block = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { blockerId: true },
  });
  return block !== null;
}

// Everyone `id` has blocked or been blocked by (hidden from each other).
export async function blockedPeers(id: string): Promise<Set<string>> {
  const rows = await prisma.block.findMany({
    where: { OR: [{ blockerId: id }, { blockedId: id }] },
    select: { blockerId: true, blockedId: true },
  });
  return new Set(rows.map((r) => (r.blockerId === id ? r.blockedId : r.blockerId)));
}

export async function suspendedUntil(ipKey: string): Promise<Date | null> {
  const s = await prisma.suspension.findUnique({ where: { ipKey } });
  return s && s.until.getTime() > Date.now() ? s.until : null;
}

// Block `otherId` for `me`, ending any request/connection between them and
// telling the other side it ended (without saying why).
export async function blockUser(
  me: { id: string; peerId: string | null },
  otherId: string,
): Promise<void> {
  await prisma.block.upsert({
    where: { blockerId_blockedId: { blockerId: me.id, blockedId: otherId } },
    create: { blockerId: me.id, blockedId: otherId },
    update: {},
  });
  if (await unpair(me, otherId)) {
    await prisma.signal.create({
      data: { fromId: me.id, toId: otherId, type: "end", payload: null },
    });
  }
}

// Record a report and pause the reported IP if enough independent reports
// have come in. Returns whether a pause was applied.
export async function reportUser(
  reporter: { id: string; ipKey: string },
  reported: { id: string; ipKey: string | null },
): Promise<boolean> {
  // Take their flare down right away: it's the most visible thing to abuse.
  await prisma.presence.updateMany({
    where: { id: reported.id },
    data: { flare: null, flareExpiresAt: null },
  });
  if (!reported.ipKey) return false;

  await prisma.report.upsert({
    where: {
      reporterId_reportedId: { reporterId: reporter.id, reportedId: reported.id },
    },
    create: {
      reporterId: reporter.id,
      reportedId: reported.id,
      reporterIpKey: reporter.ipKey,
      reportedIpKey: reported.ipKey,
    },
    update: {},
  });

  const since = new Date(Date.now() - REPORT_WINDOW_MS);
  const reporters = await prisma.report.findMany({
    where: {
      reportedIpKey: reported.ipKey,
      createdAt: { gte: since },
      // Reports from the same IP as the reported user don't count.
      reporterIpKey: { not: reported.ipKey },
    },
    distinct: ["reporterIpKey"],
    select: { reporterIpKey: true },
  });
  if (reporters.length < REPORT_THRESHOLD) return false;

  const until = new Date(Date.now() + SUSPENSION_MS);
  await prisma.suspension.upsert({
    where: { ipKey: reported.ipKey },
    create: { ipKey: reported.ipKey, until },
    update: { until },
  });
  // Take every session from that IP off the map now. Their clients see
  // they're gone on the next poll, try to re-join, and are told they're
  // paused. Their peers get an "end" so nobody is left hanging.
  const kicked = await prisma.presence.findMany({
    where: { ipKey: reported.ipKey },
    select: { id: true, peerId: true },
  });
  for (const k of kicked) {
    const linked = await prisma.presence.findMany({
      where: { peerId: k.id },
      select: { id: true },
    });
    const peers = new Set(linked.map((p) => p.id));
    if (k.peerId) peers.add(k.peerId);
    for (const peerId of peers) {
      await prisma.presence.updateMany({
        where: { id: peerId, peerId: k.id },
        data: { peerId: null, busy: false },
      });
      await prisma.signal.create({
        data: { fromId: k.id, toId: peerId, type: "end", payload: null },
      });
    }
  }
  await prisma.presence.deleteMany({ where: { ipKey: reported.ipKey } });
  return true;
}

// Occasional cleanup (called from /api/poll).
export async function sweepSafety(): Promise<void> {
  const now = Date.now();
  await prisma.report.deleteMany({
    where: { createdAt: { lt: new Date(now - REPORT_WINDOW_MS) } },
  });
  await prisma.suspension.deleteMany({ where: { until: { lt: new Date(now) } } });
  await prisma.block.deleteMany({
    where: { createdAt: { lt: new Date(now - BLOCK_MAX_AGE_MS) } },
  });
}
