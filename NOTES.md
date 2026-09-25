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

_TODO_

## Phase 4 — Make it better

_TODO_
