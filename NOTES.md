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

## Phase 2 — Make it good

_TODO_

## Phase 3 — Make it secure

_TODO_

## Phase 4 — Make it better

_TODO_
