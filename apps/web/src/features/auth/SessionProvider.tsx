"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import loadingStyles from "@/app/loading.module.css";
import { saveMeal, tokens } from "@/lib/api";
import type { Me } from "@/lib/contract/types";

type SessionState =
  | { status: "loading"; me: null }
  | { status: "anonymous"; me: null }
  | { status: "authenticated"; me: Me };

type BootResult =
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
 * Module-level boot promise so React StrictMode double-mounts or Provider
 * remounts never fire two concurrent POST /auth/refresh calls with the same
 * rotating refresh token (which would revoke the token family).
 */
let bootPromise: Promise<BootResult> | null = null;

function bootSession(): Promise<BootResult> {
  if (!bootPromise) {
    bootPromise = saveMeal
      .refresh()
      .then(async ({ accessToken }) => {
        tokens.set(accessToken);
        const me = await saveMeal.getMe();
        return { status: "authenticated" as const, me };
      })
      .catch(() => {
        tokens.set(null);
        return { status: "anonymous" as const, me: null };
      });
  }
  return bootPromise;
}

/**
 * Restores the session from the refresh cookie (AUTH-3) on load, keeps the
 * access token in memory only, and exposes ME-1.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading", me: null });
  const settledByActionRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    bootSession().then((result) => {
      if (!cancelled && !settledByActionRef.current) {
        setState(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (requestId: string, code: string) => {
    bootPromise = null;
    const res = await saveMeal.verifyOtp(requestId, code);
    settledByActionRef.current = true;
    tokens.set(res.accessToken);
    setState({ status: "authenticated", me: res.user });
    return { isNewUser: res.isNewUser };
  }, []);

  const signOut = useCallback(async () => {
    bootPromise = null;
    settledByActionRef.current = true;
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
    return (
      <div className={loadingStyles.screen} role="status" aria-live="polite" aria-busy="true">
        <div className={loadingStyles.card}>
          <span className={loadingStyles.spinner} aria-hidden="true" />
          <p className={loadingStyles.label}>Chờ mình kiểm tra chút nha…</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
