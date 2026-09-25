// Client-side session identity, created once per tab and kept only in memory.
// `id` is public (it's our dot's address, visible to everyone); `token` is a
// secret that proves to the server we own that id. Closing the tab forgets
// both, so every tab/session is a fresh anonymous identity.
export interface Session {
  id: string;
  token: string;
}

export function createSession(): Session {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return { id: crypto.randomUUID(), token };
}
