"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/contract/errors";

export type LoadState<T> =
  | { kind: "loading" }
  | { kind: "error"; error: ApiError }
  | { kind: "ready"; data: T };

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError(0, "INTERNAL", "Đã có lỗi xảy ra. Vui lòng thử lại.");
}

/**
 * Minimal data loader: runs `fn` when `deps` change, optional polling (DOMAIN §9 D9:
 * order screens poll every 30 s), `reload()` for a manual retry. State is keyed by
 * `deps`, so a deps change shows "loading" without a synchronous setState in an effect.
 */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], pollMs?: number) {
  const key = JSON.stringify(deps);
  const [entry, setEntry] = useState<{ key: string; state: LoadState<T> }>({ key, state: { kind: "loading" } });
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  const run = useCallback(
    (silent: boolean, forKey: string, isCurrent: () => boolean) => {
      fnRef
        .current()
        .then((data) => {
          if (isCurrent()) setEntry({ key: forKey, state: { kind: "ready", data } });
        })
        .catch((err: unknown) => {
          if (isCurrent() && !silent) setEntry({ key: forKey, state: { kind: "error", error: toApiError(err) } });
        });
    },
    [],
  );

  useEffect(() => {
    let live = true;
    const isCurrent = () => live;
    run(false, key, isCurrent);
    const t = pollMs
      ? setInterval(() => {
          if (document.visibilityState === "visible") run(true, key, isCurrent);
        }, pollMs)
      : undefined;
    return () => {
      live = false;
      if (t) clearInterval(t);
    };
  }, [key, nonce, pollMs, run]);

  const state: LoadState<T> = entry.key === key ? entry.state : { kind: "loading" };
  return {
    state,
    reload: () => {
      setEntry({ key, state: { kind: "loading" } });
      setNonce((n) => n + 1);
    },
    setData: (data: T) => setEntry({ key, state: { kind: "ready", data } }),
  };
}

export { toApiError };
