// Shape checks for signal payloads, shared by the server (before relaying)
// and the client (before handing data to RTCPeerConnection). Returns a
// canonical JSON string with only the known fields, `null` for signal types
// that carry no payload, or `undefined` if the payload is invalid.
import type { SignalType } from "@/lib/types";

const str = (v: unknown) => typeof v === "string";
const optStr = (v: unknown) => v === undefined || v === null || str(v);
const optInt = (v: unknown) =>
  v === undefined || v === null || (Number.isInteger(v) && (v as number) >= 0);

export function normalizePayload(
  type: SignalType,
  payload: unknown,
): string | null | undefined {
  if (type === "offer" || type === "answer" || type === "ice") {
    if (typeof payload !== "string") return undefined;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(payload);
    } catch {
      return undefined;
    }
    if (typeof data !== "object" || data === null) return undefined;

    if (type === "ice") {
      // RTCIceCandidateInit
      const { candidate, sdpMid, sdpMLineIndex, usernameFragment } = data;
      if (!str(candidate) || !optStr(sdpMid) || !optInt(sdpMLineIndex)) {
        return undefined;
      }
      if (!optStr(usernameFragment)) return undefined;
      return JSON.stringify({ candidate, sdpMid, sdpMLineIndex, usernameFragment });
    }

    // RTCSessionDescriptionInit — its type must match the signal's.
    if (data.type !== type || !str(data.sdp)) return undefined;
    return JSON.stringify({ type: data.type, sdp: data.sdp });
  }

  // request / accept / decline / end carry nothing.
  return payload === undefined || payload === null ? null : undefined;
}
