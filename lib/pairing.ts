// Server-side connection state. A presence row's `peerId` is who that user
// has requested (busy=false) or is connected to (busy=true); signals are only
// relayed when they fit that state.
import { prisma } from "@/lib/prisma";

// End whatever links `me` and `otherId`: my request to / connection with
// them, and/or their request to / connection with me. Returns false if there
// was no link, i.e. the "end" doesn't belong to any real request/connection.
export async function unpair(
  me: { id: string; peerId: string | null },
  otherId: string,
): Promise<boolean> {
  let linked = false;
  if (me.peerId === otherId) {
    await prisma.presence.update({
      where: { id: me.id },
      data: { peerId: null, busy: false },
    });
    linked = true;
  }
  const other = await prisma.presence.updateMany({
    where: { id: otherId, peerId: me.id },
    data: { peerId: null, busy: false },
  });
  return linked || other.count > 0;
}
