"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, ScreenHeader, TextField } from "@/components/ui";
import { saveMeal } from "@/lib/api";
import { ApiError } from "@/lib/contract/errors";
import { detectChannel, safeNext } from "./LoginScreen";
import { useSession } from "./SessionProvider";
import styles from "./auth.module.css";

/** Figma V1 40 · Xác minh OTP: 6-digit code, resend countdown (AUTH-2, AUTH-1). */
export function OtpScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const session = useSession();
  const [requestId, setRequestId] = useState(params.get("rid") ?? "");
  const to = params.get("to") ?? "";
  const next = safeNext(params.get("next"));
  const len = Number(params.get("len") ?? 6);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(60);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (code.length !== len) {
      setError(`Nhập đủ ${len} số.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { isNewUser } = await session.signIn(requestId, code);
      router.replace(isNewUser ? `/login/name?next=${encodeURIComponent(next)}` : next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không xác minh được. Vui lòng thử lại.");
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      const res = await saveMeal.requestOtp(detectChannel(to), to);
      setRequestId(res.requestId);
      setWait(res.resendAfterSec);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không gửi lại được mã.");
    }
  }

  const mm = String(Math.floor(wait / 60)).padStart(2, "0");
  const ss = String(wait % 60).padStart(2, "0");

  return (
    <>
      <ScreenHeader title="Xác minh tài khoản" backHref={`/login?next=${encodeURIComponent(next)}`} />
      <section className={styles.screen}>
        <h1 className={styles.title}>Nhập mã xác minh</h1>
        <p className={styles.lead}>
          Mã {len} số đã gửi tới <b>{to}</b>.
        </p>
        <form className={styles.form} onSubmit={verify} noValidate>
          <TextField
            label="Mã xác minh"
            className={styles.code}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={len}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, len))}
            error={error}
            autoFocus
          />
          <Button type="submit" disabled={busy}>
            {busy ? "Đang xác minh…" : "Xác minh & tiếp tục"}
          </Button>
        </form>
        {wait > 0 ? (
          <p className={styles.muted}>
            Gửi lại mã sau {mm}:{ss}
          </p>
        ) : (
          <button type="button" className={styles.link} onClick={resend}>
            Gửi lại mã
          </button>
        )}
      </section>
    </>
  );
}
