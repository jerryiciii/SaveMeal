/**
 * Access token lives in memory only (contract §0). The refresh token is the
 * httpOnly cookie `lb_rt`; JavaScript never sees it.
 */
export type TokenStore = {
  get(): string | null;
  set(token: string | null): void;
  subscribe(listener: (token: string | null) => void): () => void;
};

export function createTokenStore(initial: string | null = null): TokenStore {
  let token = initial;
  const listeners = new Set<(token: string | null) => void>();
  return {
    get: () => token,
    set(next) {
      token = next;
      listeners.forEach((l) => l(token));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
