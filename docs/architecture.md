# Pulse — Architecture

## Tech stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript 5 |
| Styling | Tailwind CSS v4 (via `@tailwindcss/postcss`) |
| Map | Mapbox GL JS v3 (`dark-v11` style), loaded client-side only |
| API | Next.js Route Handlers (`app/api/*/route.ts`), Node runtime, `force-dynamic`. Callers are authenticated by a per-tab secret token (`Authorization: Bearer`) |
| Data access | Prisma 7 with the `@prisma/adapter-pg` driver adapter (`pg`) |
| Database | PostgreSQL (Neon / Vercel Postgres); used only for short-lived coordination data |
| Realtime transport | HTTP polling every 1.5 s (no WebSockets, because it runs on Vercel serverless) |
| Peer-to-peer | WebRTC: a data channel for chat and video control messages, media tracks for video. STUN only (Google), no TURN |
| Hosting | Vercel |

## System overview

```mermaid
flowchart TB
    A["<b>Browser — User A</b><br/>app/page.tsx: state machine + poll loop<br/>lib/api.ts: fetch wrappers<br/>lib/webrtc.ts: PeerSession<br/>WorldMap: Mapbox GL"]
    B["<b>Browser — User B</b><br/>app/page.tsx: state machine + poll loop<br/>lib/api.ts: fetch wrappers<br/>lib/webrtc.ts: PeerSession<br/>WorldMap: Mapbox GL"]

    API["<b>Vercel — Next.js Route Handlers</b><br/>POST /api/join: add dot (1–3 km offset)<br/>GET /api/poll: heartbeat, peers, drain mailbox<br/>POST /api/signal: send request / SDP / ICE<br/>POST /api/leave: remove dot<br/>auth: session token · rate limits<br/>via lib/prisma.ts (Prisma 7 + pg)"]

    P2P{{"<b>WebRTC peer-to-peer</b><br/>chat (DataChannel) + video<br/>never touches the server"}}

    DB[("<b>PostgreSQL</b><br/>Presence: who is online + who is paired<br/>Signal: message mailbox<br/>RateLimit: abuse counters")]

    Ext["<b>External</b><br/>Mapbox: map tiles<br/>Google STUN: find public IP"]

    A -- "HTTP every 1.5 s" --> API
    B -- "HTTP every 1.5 s" --> API
    A <==> P2P
    B <==> P2P
    A -.-> Ext
    B -.-> Ext
    API --> DB
```

**Main idea:** the server only handles *coordination*, meaning who is online and relaying the
WebRTC handshake. Chat text and video go directly between the two browsers.

## Connection lifecycle

```mermaid
sequenceDiagram
    autonumber
    participant A as Browser A
    participant S as Next.js API
    participant D as Postgres
    participant B as Browser B

    Note over A,B: Entry
    A->>S: POST /api/join {id, token, lat, lng}
    S->>D: insert Presence (offset coords, sha256(token))
    B->>S: POST /api/join
    S->>D: insert Presence

    loop every 1.5 s (each client)
        A->>S: GET /api/poll (Bearer token)
        S->>D: heartbeat, reap stale, list peers, drain A's mailbox
        S-->>A: { peers[], signals[] }
    end

    Note over A,B: Connection request (via server mailbox)
    A->>S: POST /api/signal {type: request, to: B}
    S->>D: A.peerId = B, insert Signal(to B)
    B->>S: poll → receives "request"
    B->>S: POST /api/signal {type: accept, to: A}
    S->>D: check A requested B, pair + mark both busy, insert Signal(to A)
    A->>S: poll → receives "accept"

    Note over A,B: WebRTC handshake (SDP/ICE relayed through the mailbox)
    A->>S: signal "offer" (SDP)
    B->>S: poll → offer, then signal "answer"
    A->>S: poll → answer
    A-->>B: "ice" candidates both ways (via mailbox)

    Note over A,B: Direct peer-to-peer from here
    A->>B: DataChannel open → chat messages
    A->>B: ctrl "video-request" (DataChannel)
    B->>A: ctrl "video-accept" + media tracks

    Note over A,B: Teardown
    A->>S: signal "end" to B
    A->>S: POST /api/leave (sendBeacon on pagehide)
    S->>D: delete Presence + Signals for A, free B, send B "end"
```

## Key files

- `app/page.tsx` — the whole client: session id, poll loop, signal handling, connection/video state machines.
- `app/components/*` — UI only (map, prompts, chat, video).
- `lib/api.ts` — thin `fetch` wrappers for the four endpoints, sending the session token.
- `lib/session.ts` — creates the tab's public `id` and secret `token`.
- `lib/auth.ts` — token hashing, session lookup, id/token validation, privacy-offset seed.
- `lib/pairing.ts` — server-side connection state (`peerId` + `busy`); signals must match it.
- `lib/payload.ts` — shape checks for SDP / ICE payloads (server and client).
- `lib/ratelimit.ts` — Postgres-backed rate limits and caps.
- `lib/webrtc.ts` — `PeerSession` class, using the "perfect negotiation" pattern (polite/impolite peers).
- `lib/geo.ts` — privacy offset and lat/lng validation.
- `lib/presence.ts` — timing constants (stale = 15 s, signal TTL = 60 s, poll = 1.5 s).
- `prisma/schema.prisma` — `Presence`, `Signal`, and `RateLimit`.
