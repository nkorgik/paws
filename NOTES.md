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

## Phase 2 — Make it good

_TODO_

## Phase 3 — Make it secure

_TODO_

## Phase 4 — Make it better

_TODO_
