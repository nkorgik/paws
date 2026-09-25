# NOTES

## Setup

- **Node 24.** Prisma 7 requires Node 20.19+, 22.12+ or 24+, and `npm install` failed on Node 23. Added `.nvmrc` pinned to 24 (also picked up by Vercel).
- **Database:** Neon Postgres, using the pooled connection string.

## Phase 1 — Make it run

### 1. Dots stayed on the map after users left

- **Symptom:** after users closed the app, their dots stayed on the map for a long time.
- **Cause:** in `/api/poll`, the heartbeat used `updateMany({ where: {} })`. The empty filter matched every row, so any single user's poll refreshed `lastSeen` for everyone. While anyone was online, nobody ever went past the 15s stale cutoff, so nobody was cleaned up.
- **Fix:** `where: { id }`, so each poll only refreshes the caller's own row. Users who stop polling are removed after ~15s.
- **File:** `app/api/poll/route.ts`

### 2. Connection never established (stuck on "Connecting…")

- **Symptom:** A requests, B accepts, and both sides stay on "Connecting…" forever with no error.
- **Cause:** the offer/answer (the other peer's connection settings) and its ICE candidates (the other peer's network addresses) arrive together in the same poll. `handleSignal` is called for each without waiting. An ICE candidate can only be added after `setRemoteDescription()`, so candidates that arrive early are saved in `pendingCandidates`. Before the fix, `handleSignal` flushed `pendingCandidates` first, while it was still empty, and only then called `setRemoteDescription()`, which takes time. During that wait the candidates were saved into `pendingCandidates`, but nothing ever flushed the list again, so they were never passed to `addIceCandidate()`. Neither peer had the other's addresses, ICE never connected, and the data channel never opened.
- **Fix:** swapped the order: `setRemoteDescription()` first, then `flushPendingCandidates()`.
- **File:** `lib/webrtc.ts`

### 3. Chat messages never reached the other user

- **Symptom:** the connection is established, but sent messages only appear for the sender.
- **Cause:** chat goes peer-to-peer over the data channel as JSON with a `t` field for the message type. The sender (`sendChat`) sent `t: "msg"`, but the receiver only handles `t: "chat"` (and `"ctrl"` for video controls), so every chat message was silently dropped on arrival. The sender still saw their own message because it is added to their chat locally.
- **Fix:** the sender now uses `t: "chat"`, matching the receiver.
- **File:** `lib/webrtc.ts`

### 4. No way to end a video call ("End video" button missing)

- **Symptom:** during a video call there's no button to end it.
- **Cause:** the video panel is a full-screen flex column: the video area (`flex-1`) and a bottom bar holding "End video". Flex items don't shrink below their content size by default. The `<video>` is full width and keeps its aspect ratio, so on a wide window it's taller than the screen. It pushed the bottom bar below the viewport, where `overflow-hidden` on `main` cut it off.
- **Fix:** added `min-h-0` to the video area so it shrinks to fit the remaining space and the bar stays visible.
- **File:** `app/components/VideoPanel.tsx`

### 5. Users couldn't connect again after ending a chat

- **Symptom:** after two users end a chat, any new request to either of them is instantly "declined", and their dots stay dimmed.
- **Cause:** `/api/signal` keeps a `busy` flag on each user so they can only be in one connection at a time. `accept` sets both users to `busy: true`, but only `decline` set them back to `false`. `end` didn't, even though the comment above that code says "decline/end: free both peers". After the first chat, both users stayed busy for the rest of the session, and every new request to them was auto-declined.
- **Fix:** `end` now also sets both users back to `busy: false`.
- **File:** `app/api/signal/route.ts`

### 6. Closing the tab mid-chat left the other user stuck

- **Symptom:** if one user closes their tab instead of clicking End, the other user stays on a dead chat screen and is still marked `busy`, so nobody can connect to them afterwards. This breaks the requirement "if either user disconnects, the chat ends for both".
- **Cause:** on tab close the app only called `/api/leave`, which deletes the leaving user's own row. No `end` was sent, so the peer's `busy` flag was never cleared and the peer was never told. The peer only noticed when WebRTC reported `failed` (which can take up to ~30s), and even then it cleaned up locally without telling the server, so it stayed `busy`.
- **Fix, in two parts:**
  - **Clean close:** the leave beacon now includes the `peerId` the user was connected to (or requesting). `/api/leave` frees that peer's `busy` flag and puts an `end` in their mailbox, so they see "Stranger disconnected" on their next poll. A pending request that gets cancelled this way now shows "Stranger left."
  - **Crash or no beacon:** `PeerSession` now reports when the data channel is closed by the other side (`onChannelClose`), not by us. On that, or on a `failed` connection, the client sends `end` itself (which frees its `busy` flag) and tears down.
- **Files:** `lib/api.ts`, `app/api/leave/route.ts`, `lib/webrtc.ts`, `app/page.tsx`

### 7. A user who went briefly offline became invisible for good

- **Symptom:** if a tab stops polling for more than 15s (laptop sleep, Wi-Fi drop, background tab throttled by the browser, page restored via Back/Forward), its dot disappears for others and never comes back, even though the tab is open and still sees everyone else.
- **How I reproduced it:** two windows, set one to **Offline** in DevTools → Network for ~20s, then back online. Its dot never came back in the other window, and its `Presence` row was gone in Neon.
- **Cause:** `/api/poll` removes stale rows, which is correct. But its heartbeat is `updateMany where id`, which only updates an existing row and never creates one. Once the row was deleted, polling kept working but the user never reappeared.
- **Fix:** poll now returns `present: false` when the heartbeat updated no row. The client then calls `/api/join` again with its saved location (which also picks a fresh 1–3 km offset).
- **Files:** `app/api/poll/route.ts`, `lib/types.ts`, `app/page.tsx`

## Phase 2 — Make it good

_TODO_

## Phase 3 — Make it secure

I reviewed all four API routes (`join`, `poll`, `signal`, `leave`) plus the client code that calls them. Findings, ranked by impact:

| # | Severity | Issue |
|---|---|---|
| 1 | **Critical** | No authentication: the public session ID is the only credential |
| 2 | **High** | No server-side connection state: signals aren't checked against a real request/connection |
| 3 | **High** | Real location can be triangulated from repeated privacy offsets |
| 4 | **High** | No rate limiting or resource caps |
| 5 | Medium | Weak input validation (IDs, signal payloads) |
| 6 | Medium | Missing security headers (clickjacking, permissions) |
| 7 | Medium | The de facto credential (the ID) is sent in the URL query string |
| 8 | Low | Hard-coded fallback Mapbox token, and the token isn't domain-restricted |
| 9 | Low | Leftover dev config (`allowedDevOrigins` with an ngrok host) |
| 10 | Low | No length limit on chat messages |
| 11 | Low / inherent | A peer learns your public IP once you accept a connection |

**1. No authentication (Critical).** Every user's session ID is returned to everyone by `/api/poll` (it's how dots are drawn), and every endpoint simply trusts the ID in the request. Knowing someone's ID is enough to *be* them:
- `GET /api/poll?id=<victim>` reads **and deletes** the victim's mailbox. The attacker gets their connection requests and WebRTC handshake data (which includes the victim's IP addresses), and the victim never receives them.
- `POST /api/signal` accepts any `fromId`, so an attacker can send requests, accepts and handshake messages as anyone. Because the keys that encrypt a WebRTC call are exchanged through this signaling, an attacker who can inject their own offer/answer can put themselves in the middle of a "private" chat or video call.
- `POST /api/leave` with a victim's ID removes them from the map, and `POST /api/join` with their ID moves their dot.

**2. No server-side connection state (High).** The server doesn't check that a signal belongs to an actual request or connection. `accept` sent to anyone, without a request, marks both users `busy`, so a script can mark every user busy and nobody can connect. `end`/`decline` can free anyone, and handshake messages can be sent to users you never connected with.

**3. Location triangulation (High).** Each join picks a fresh random 1–3 km offset around the real location, so averaging many offsets for the same user converges on their real location. Combined with #1 this can be forced: kick the victim with `/api/leave`, the client automatically re-joins (Phase 1 bug 7 fix) with a new offset, repeat.

**4. No rate limiting or caps (High).** A script can create thousands of fake dots, fill the database or one victim's mailbox with 64 KB signals, and hammer `/api/poll`, which runs ~6 queries per call including table-wide deletes.

**5–7 (Medium).** IDs aren't format- or length-checked, and signal payloads aren't validated (the client `JSON.parse`s whatever arrives). No security headers, so the app can be framed on another site to trick users into granting camera/mic/location permissions or accepting connections. The ID sits in the poll URL, so it ends up in server and proxy logs.

**8–11 (Low).** A dummy Mapbox token is hard-coded as a fallback in `WorldMap.tsx`, and the real token should be restricted to the deployed domain in the Mapbox dashboard. The `allowedDevOrigins` ngrok host is leftover dev config. Chat messages have no size limit, so a peer can send huge ones. Once you accept a connection, the peer can see your public IP. That's inherent to peer-to-peer WebRTC; hiding it would need a relay-only TURN setup, which is out of scope.

**Checked and fine:** XSS (chat text is rendered by React and escaped; marker HTML is static). SQL injection (Prisma parameterizes queries). Raw location is never stored (only the offset position is saved).

### Fixes

_In progress._

## Phase 4 — Make it better

_TODO_
