"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { saveMeal, tokens } from "@/lib/api";
import type { Me } from "@/lib/contract/types";

type SessionState =
  | { status: "loading"; me: null }
  | { status: "anonymous"; me: null }
  | { status: "authenticated"; me: Me };

type SessionValue = SessionState & {
  signIn: (requestId: string, code: string) => Promise<{ isNewUser: boolean }>;
  signOut: () => Promise<void>;
  reloadMe: () => Promise<void>;
  setMe: (me: Me) => void;
};

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Restores the session from the refresh cookie (AUTH-3) on load, keeps the
 * access token in memory only, and exposes ME-1.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading", me: null });

  useEffect(() => {
    let cancelled = false;
    saveMeal
      .refresh()
      .then(async ({ accessToken }) => {
        tokens.set(accessToken);
        const me = await saveMeal.getMe();
        if (!cancelled) setState({ status: "authenticated", me });
      })
      .catch(() => {
        tokens.set(null);
        if (!cancelled) setState({ status: "anonymous", me: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (requestId: string, code: string) => {
    const res = await saveMeal.verifyOtp(requestId, code);
    tokens.set(res.accessToken);
    setState({ status: "authenticated", me: res.user });
    return { isNewUser: res.isNewUser };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await saveMeal.logout();
    } finally {
      tokens.set(null);
      setState({ status: "anonymous", me: null });
    }
  }, []);

  const reloadMe = useCallback(async () => {
    const me = await saveMeal.getMe();
    setState({ status: "authenticated", me });
  }, []);

  const setMe = useCallback((me: Me) => setState({ status: "authenticated", me }), []);

  const value = useMemo<SessionValue>(
    () => ({ ...state, signIn, signOut, reloadMe, setMe }),
    [state, signIn, signOut, reloadMe, setMe],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

/** Renders children only when signed in; otherwise sends the user to /login?next=… */
export function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  useEffect(() => {
    if (session.status === "anonymous") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [session.status, router, pathname]);
  if (session.status !== "authenticated") {
    return <p style={{ padding: "80px 20px", color: "var(--text-secondary)" }}>Đang tải…</p>;
  }
  return <>{children}</>;
}
