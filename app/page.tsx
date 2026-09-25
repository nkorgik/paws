"use client";

import { useEffect, useRef, useState } from "react";
import EntryGate from "./components/EntryGate";
import WorldMap from "./components/WorldMap";
import ConnectionPrompt from "./components/ConnectionPrompt";
import ChatPanel, { type ChatMessage } from "./components/ChatPanel";
import VideoPanel from "./components/VideoPanel";
import TopBar from "./components/TopBar";
import StatusPill from "./components/StatusPill";
import Dock from "./components/Dock";
import FlareComposer from "./components/FlareComposer";
import SafetySheet from "./components/SafetySheet";
import { IconVideo } from "./components/icons";
import { dotColor } from "@/lib/colors";
import { describeDistance, distanceKm } from "@/lib/geo";
import {
  join,
  leave,
  poll,
  safetyAction,
  sendSignal,
  setStatus,
} from "@/lib/api";
import { createSession } from "@/lib/session";
import { PeerSession, type DescType, type PeerControl } from "@/lib/webrtc";
import { POLL_INTERVAL_MS } from "@/lib/presence";
import { type PeerDot, type SignalMsg } from "@/lib/types";

type Conn =
  | { kind: "idle" }
  | { kind: "requesting"; peerId: string }
  | { kind: "incoming"; peerId: string }
  | { kind: "connecting"; peerId: string }
  | { kind: "connected"; peerId: string };

type VideoState = "none" | "requesting" | "incoming" | "active";

const REQUEST_TIMEOUT_MS = 30_000;
const PAUSED_MESSAGE =
  "You've been paused for a little while after reports from other people. Please come back later.";

export default function Home() {
  const [phase, setPhase] = useState<"gate" | "live">("gate");
  const [session] = useState(createSession);
  const [peers, setPeers] = useState<PeerDot[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  // Same location, readable from the poll loop for re-joining.
  const locationRef = useRef<{ lat: number; lng: number } | null>(null);

  // Our flare (public note on our dot). Mirrored in a ref so the poll loop
  // can restore it after a re-join.
  const [myFlare, setMyFlare] = useState<{ text: string; expiresAt: number } | null>(
    null,
  );
  const myFlareRef = useRef(myFlare);
  const [flareOpen, setFlareOpen] = useState(false);
  const [dnd, _setDnd] = useState(false);
  const dndRef = useRef(false);
  function toggleDnd() {
    const next = !dndRef.current;
    dndRef.current = next;
    _setDnd(next);
    void setStatus(session.token, { dnd: next }).then((res) => {
      if (!res.ok) {
        dndRef.current = !next;
        _setDnd(!next);
        showNotice(res.error);
      }
    });
  }
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  useEffect(() => {
    myFlareRef.current = myFlare;
    if (!myFlare) return;
    // Drop it locally when it expires (the server already hides it).
    const t = setTimeout(() => setMyFlare(null), myFlare.expiresAt - Date.now());
    return () => clearTimeout(t);
  }, [myFlare]);

  async function postFlare(text: string): Promise<string | null> {
    const res = await setStatus(session.token, { flare: text });
    if (!res.ok) return res.error;
    if (res.flare && res.expiresAt) {
      setMyFlare({ text: res.flare, expiresAt: Date.parse(res.expiresAt) });
    }
    return null;
  }

  function clearFlare() {
    setMyFlare(null);
    void setStatus(session.token, { flare: null });
  }

  const [conn, _setConn] = useState<Conn>({ kind: "idle" });
  const connRef = useRef<Conn>(conn);
  const setConn = (c: Conn) => {
    connRef.current = c;
    _setConn(c);
  };

  const [video, _setVideo] = useState<VideoState>("none");
  const videoRef = useRef<VideoState>(video);
  const setVideo = (v: VideoState) => {
    videoRef.current = v;
    _setVideo(v);
    // Each call starts immersive (chat tucked away); ending one resets it.
    if (v === "active" || v === "none") setChatOpen(false);
  };

  // During video the chat is an overlay the user can open; count messages
  // that arrive while it's hidden for the badge on the chat button.
  const [chatOpen, _setChatOpen] = useState(false);
  const chatOpenRef = useRef(false);
  const [unread, setUnread] = useState(0);
  const setChatOpen = (open: boolean) => {
    chatOpenRef.current = open;
    _setChatOpen(open);
    setUnread(0);
  };

  const peerRef = useRef<PeerSession | null>(null);
  const msgId = useRef(0);
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showNotice(text: string) {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 3500);
  }

  function addMessage(mine: boolean, text: string) {
    setMessages((prev) => [...prev, { id: msgId.current++, mine, text }]);
    if (!mine && videoRef.current === "active" && !chatOpenRef.current) {
      setUnread((n) => n + 1);
    }
  }

  function teardown(message?: string) {
    if (requestTimer.current) clearTimeout(requestTimer.current);
    peerRef.current?.close();
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
    setMessages([]);
    setConn({ kind: "idle" });
    if (message) showNotice(message);
  }

  // The direct connection died without an "end" from the peer (tab crashed,
  // network dropped). Tell the server so both sides are freed, then clean up.
  function dropConnection(peerId: string) {
    void sendSignal(session.token, peerId, "end");
    teardown("Stranger disconnected.");
  }

  function startPeer(peerId: string, initiator: boolean) {
    const ps = new PeerSession(initiator, {
      onSignal: (type: DescType, payload: string) => {
        void sendSignal(session.token, peerId, type, payload);
      },
      onChat: (text) => addMessage(false, text),
      onControl: (ctrl) => handleControl(ctrl),
      onRemoteStream: (stream) => setRemoteStream(stream),
      onConnectionState: (state) => {
        if (state === "failed") dropConnection(peerId);
      },
      onChannelOpen: () => {
        setConn({ kind: "connected", peerId });
      },
      onChannelClose: () => dropConnection(peerId),
    });
    peerRef.current = ps;
  }

  function handleControl(ctrl: PeerControl) {
    const ps = peerRef.current;
    switch (ctrl) {
      case "video-request":
        if (videoRef.current === "none") setVideo("incoming");
        break;
      case "video-accept":
        if (videoRef.current === "requesting" && ps) {
          ps.startVideo()
            .then((stream) => {
              setLocalStream(stream);
              setVideo("active");
            })
            .catch(() => {
              setVideo("none");
              ps.sendControl("video-end");
              showNotice("Camera unavailable.");
            });
        }
        break;
      case "video-decline":
        if (videoRef.current === "requesting") {
          setVideo("none");
          showNotice("Video declined.");
        }
        break;
      case "video-end":
        ps?.stopVideo();
        setLocalStream(null);
        setRemoteStream(null);
        setVideo("none");
        break;
    }
  }

  function requestConnection(peerId: string) {
    if (connRef.current.kind !== "idle") return;
    setConn({ kind: "requesting", peerId });
    void sendSignal(session.token, peerId, "request");
    requestTimer.current = setTimeout(() => {
      if (
        connRef.current.kind === "requesting" &&
        connRef.current.peerId === peerId
      ) {
        void sendSignal(session.token, peerId, "end");
        teardown("No answer.");
      }
    }, REQUEST_TIMEOUT_MS);
  }

  function cancelRequest() {
    if (connRef.current.kind === "requesting") {
      void sendSignal(session.token, connRef.current.peerId, "end");
    }
    teardown();
  }

  function acceptIncoming() {
    if (connRef.current.kind !== "incoming") return;
    const peerId = connRef.current.peerId;
    startPeer(peerId, false);
    setConn({ kind: "connecting", peerId });
    void sendSignal(session.token, peerId, "accept").then((ok) => {
      // The request was cancelled or expired before we accepted.
      if (!ok) teardown("That request is no longer available.");
    });
  }

  function declineIncoming() {
    if (connRef.current.kind !== "incoming") return;
    void sendSignal(session.token, connRef.current.peerId, "decline");
    setConn({ kind: "idle" });
  }

  function endConnection() {
    const c = connRef.current;
    if (c.kind === "connecting" || c.kind === "connected") {
      void sendSignal(session.token, c.peerId, "end");
    }
    teardown();
  }

  function startVideoRequest() {
    if (videoRef.current !== "none" || !peerRef.current) return;
    setVideo("requesting");
    peerRef.current.sendControl("video-request");
  }

  function acceptVideo() {
    const ps = peerRef.current;
    if (!ps) return;
    ps.startVideo()
      .then((stream) => {
        setLocalStream(stream);
        ps.sendControl("video-accept");
        setVideo("active");
      })
      .catch(() => {
        ps.sendControl("video-decline");
        setVideo("none");
        showNotice("Camera unavailable.");
      });
  }

  function declineVideo() {
    peerRef.current?.sendControl("video-decline");
    setVideo("none");
  }

  function endVideo() {
    const ps = peerRef.current;
    ps?.stopVideo();
    ps?.sendControl("video-end");
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
  }

  function processSignal(sig: SignalMsg) {
    switch (sig.type) {
      case "request": {
        if (connRef.current.kind === "idle") {
          setConn({ kind: "incoming", peerId: sig.fromId });
        } else {
          void sendSignal(session.token, sig.fromId, "decline");
        }
        break;
      }
      case "accept": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current);
          startPeer(sig.fromId, true);
          setConn({ kind: "connecting", peerId: sig.fromId });
        }
        break;
      }
      case "decline": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current);
          teardown("Request declined.");
        }
        break;
      }
      case "offer":
      case "answer":
      case "ice": {
        const c = connRef.current;
        const peerId =
          c.kind === "connecting" || c.kind === "connected" ? c.peerId : null;
        if (peerRef.current && peerId === sig.fromId) {
          peerRef.current
            .handleSignal(sig.type as DescType, sig.payload ?? "")
            .catch((e) => console.warn("Failed to apply signal", e));
        }
        break;
      }
      case "end": {
        const c = connRef.current;
        if (c.kind !== "idle" && c.peerId === sig.fromId) {
          if (c.kind === "incoming") setConn({ kind: "idle" });
          else if (c.kind === "requesting") teardown("Stranger left.");
          else teardown("Stranger disconnected.");
        }
        break;
      }
    }
  }

  const processSignalRef = useRef(processSignal);
  const teardownRef = useRef(teardown);
  useEffect(() => {
    processSignalRef.current = processSignal;
    teardownRef.current = teardown;
  });

  // Poll from the moment the page opens: before joining, the globe behind
  // the entry card already shows who's online (the server returns peers but
  // no mailbox for a session that hasn't joined yet).
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const data = await poll(session.token);
        if (!active) return;
        // We were reaped as stale while this tab stayed open. Re-join so
        // others can see our dot again.
        if (!data.present && locationRef.current) {
          const { lat, lng } = locationRef.current;
          const res = await join(session, lat, lng);
          if (!res.ok && res.suspended) {
            // Paused after reports: back to the entry card with an explanation.
            teardownRef.current();
            locationRef.current = null;
            setMyLocation(null);
            setMyFlare(null);
            setGateError(PAUSED_MESSAGE);
            setPhase("gate");
          }
          // A re-join creates a fresh row; put our flare / DND back on it.
          const f = myFlareRef.current;
          const restore: { flare?: string; dnd?: boolean } = {};
          if (f && f.expiresAt > Date.now()) restore.flare = f.text;
          if (dndRef.current) restore.dnd = true;
          if (Object.keys(restore).length) void setStatus(session.token, restore);
        }
        setPeers(data.peers);
        for (const s of data.signals) processSignalRef.current(s);
      } catch {}
      if (active) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [session]);

  useEffect(() => {
    if (phase !== "live") return;
    const onLeave = () => leave(session.token);
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [session, phase]);

  // Join first, so a paused user stays on the entry card with a message
  // instead of landing on a map where nobody can see them.
  async function handleReady(lat: number, lng: number): Promise<string | null> {
    const res = await join(session, lat, lng);
    if (!res.ok) {
      return res.suspended
        ? PAUSED_MESSAGE
        : "Couldn't join right now. Please try again.";
    }
    setGateError(null);
    setMyLocation({ lat, lng });
    locationRef.current = { lat, lng };
    setPhase("live");
    return null;
  }

  // Block / report whoever we're talking to. Leave the conversation right
  // away (optimistically) so a slow network never keeps you in a chat with
  // someone you just reported; the server ends it for them without saying
  // why. If the request fails, still end the chat and say so.
  async function runSafety(action: "block" | "report") {
    const c = connRef.current;
    if (c.kind === "idle") return;
    setSafetyOpen(false);
    teardown(
      action === "report"
        ? "Reported and blocked. Thanks for keeping Pulse safe."
        : "Blocked. You won't see each other again.",
    );
    const ok = await safetyAction(session.token, c.peerId, action);
    if (!ok) {
      void sendSignal(session.token, c.peerId, "end");
      showNotice(`Chat ended, but the ${action} didn't go through. Please try again.`);
    }
  }

  function blockIncoming() {
    const c = connRef.current;
    if (c.kind !== "incoming") return;
    setConn({ kind: "idle" });
    void safetyAction(session.token, c.peerId, "block").then((ok) =>
      showNotice(ok ? "Blocked. You won't see each other again." : "Couldn't block. Please try again."),
    );
  }

  const inChat = conn.kind === "connecting" || conn.kind === "connected";
  const peerId = conn.kind === "idle" ? null : conn.peerId;

  const flareOf = (id: string) => peers.find((d) => d.id === id)?.flare ?? undefined;

  // "about 40 km away" for whoever we're dealing with, from dot positions.
  function distanceTo(id: string): string | undefined {
    const p = peers.find((d) => d.id === id);
    return p && myLocation ? describeDistance(distanceKm(myLocation, p)) : undefined;
  }

  // The map is always mounted: the entry card floats over the spinning globe,
  // and entering flies the same camera down to you.
  if (phase === "gate") {
    return (
      <main className="fixed inset-0 overflow-hidden">
        <WorldMap
          peers={peers}
          me={null}
          onPeerClick={() => {}}
          canConnect={false}
        />
        <EntryGate
          online={peers.length}
          initialError={gateError}
          onReady={handleReady}
        />
      </main>
    );
  }

  return (
    <main className="fixed inset-0 overflow-hidden">
      <WorldMap
        peers={peers}
        me={myLocation}
        myFlare={myFlare?.text ?? null}
        onPeerClick={requestConnection}
        canConnect={conn.kind === "idle"}
      />
      {video !== "active" && <TopBar online={peers.length + 1} />}

      {conn.kind === "idle" && (
        <Dock
          hint={
            peers.length === 0
              ? "No one else is here yet. Open Pulse in another window to try it."
              : "Tap a dot to start a conversation"
          }
          flare={myFlare}
          dnd={dnd}
          onOpenFlare={() => setFlareOpen(true)}
          onToggleDnd={toggleDnd}
        />
      )}

      {safetyOpen && inChat && (
        <SafetySheet onAction={runSafety} onClose={() => setSafetyOpen(false)} />
      )}

      {flareOpen && (
        <FlareComposer
          current={myFlare?.text ?? null}
          onPost={postFlare}
          onClear={clearFlare}
          onClose={() => setFlareOpen(false)}
        />
      )}

      {notice && (
        <StatusPill key={notice}>
          <span className="pr-3">{notice}</span>
        </StatusPill>
      )}

      {conn.kind === "requesting" && (
        <StatusPill>
          <span
            className="avatar-ring size-3 shrink-0 rounded-full"
            style={{ background: dotColor(conn.peerId), ["--dot" as string]: dotColor(conn.peerId) }}
          />
          <span className="truncate">Waiting for them to accept…</span>
          <button onClick={cancelRequest} className="btn btn-glass h-8 px-3.5 text-xs">
            Cancel
          </button>
        </StatusPill>
      )}

      {conn.kind === "incoming" && (
        <ConnectionPrompt
          title="Someone wants to talk"
          subtitle={`A stranger ${distanceTo(conn.peerId) ?? "somewhere on the map"} wants to connect.`}
          quote={flareOf(conn.peerId)}
          color={dotColor(conn.peerId)}
          acceptLabel="Accept"
          declineLabel="Not now"
          onAccept={acceptIncoming}
          onDecline={declineIncoming}
          onBlock={blockIncoming}
        />
      )}

      {inChat && (
        <ChatPanel
          messages={messages}
          connected={conn.kind === "connected"}
          videoBusy={video !== "none"}
          color={dotColor(conn.peerId)}
          distance={distanceTo(conn.peerId)}
          flare={flareOf(conn.peerId)}
          hidden={video === "active" && !chatOpen}
          onClose={video === "active" ? () => setChatOpen(false) : undefined}
          onSend={(text) => {
            peerRef.current?.sendChat(text);
            addMessage(true, text);
          }}
          onStartVideo={startVideoRequest}
          onSafety={() => setSafetyOpen(true)}
          onEnd={endConnection}
        />
      )}

      {video === "requesting" && (
        <StatusPill>
          <IconVideo className="size-4 shrink-0 text-emerald-300" />
          <span className="truncate">Waiting for them to turn on video…</span>
          <button onClick={endVideo} className="btn btn-glass h-8 px-3.5 text-xs">
            Cancel
          </button>
        </StatusPill>
      )}

      {video === "incoming" && peerId && (
        <ConnectionPrompt
          title="Turn on video?"
          subtitle="They'd like to see you. Your camera and mic stay off until you accept."
          color={dotColor(peerId)}
          icon={<IconVideo />}
          acceptLabel="Start video"
          declineLabel="Not now"
          onAccept={acceptVideo}
          onDecline={declineVideo}
        />
      )}

      {video === "active" && peerId && (
        <VideoPanel
          localStream={localStream}
          remoteStream={remoteStream}
          color={dotColor(peerId)}
          chatOpen={chatOpen}
          unread={unread}
          onToggleChat={() => setChatOpen(!chatOpen)}
          onSafety={() => setSafetyOpen(true)}
          onEnd={endVideo}
        />
      )}
    </main>
  );
}
