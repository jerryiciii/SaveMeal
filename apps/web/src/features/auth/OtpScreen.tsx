"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, ScreenHeader } from "@/components/ui";
import { saveMeal } from "@/lib/api";
import { ApiError } from "@/lib/contract/errors";
import { detectChannel, safeNext } from "./LoginScreen";
import { useSession } from "./SessionProvider";
import styles from "./auth.module.css";

/** Figma V2.1 40 · Xác minh OTP: 6 white rounded-16 digit boxes, resend countdown (AUTH-2, AUTH-1). */
export function OtpScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const session = useSession();
  const [requestId, setRequestId] = useState(params.get("rid") ?? "");
  const to = params.get("to") ?? "";
  const next = safeNext(params.get("next"));
  const len = Math.max(4, Math.min(8, Number(params.get("len") ?? 6) || 6));
  const [code, setCode] = useState("");
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(60);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const isEmail = detectChannel(to) === "EMAIL";
  const mm = String(Math.floor(wait / 60)).padStart(2, "0");
  const ss = String(wait % 60).padStart(2, "0");
  const activeIdx = Math.min(code.length, len - 1);

  return (
    <div className={styles.otpShell}>
      <ScreenHeader title="Xác minh tài khoản" backHref={`/login?next=${encodeURIComponent(next)}`} />
      <section className={styles.otpScreen}>
        <h1 className={styles.title}>Nhập mã xác minh</h1>
        <p className={styles.lead}>
          {isEmail ? (
            <>
              Mã {len} số đã gửi tới email <b>{to}</b>. Kiểm tra cả hộp thư rác nếu chưa thấy.
            </>
          ) : (
            <>
              Mã {len} số đã gửi tới <b>{to}</b>.
            </>
          )}
        </p>

        <form className={styles.form} onSubmit={verify} noValidate>
          <div className={styles.otpField}>
            <label htmlFor="otp-code-input" className={styles.otpLabel}>
              Mã xác minh ({len} số)
            </label>
            <div
              className={styles.otpBoxesWrap}
              onClick={() => inputRef.current?.focus()}
            >
              <input
                ref={inputRef}
                id="otp-code-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={len}
                value={code}
                disabled={busy}
                autoFocus
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "otp-error-msg" : undefined}
                className={styles.otpHiddenInput}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, len);
                  setCode(digits);
                  if (error) setError(null);
                }}
              />
              <div className={styles.otpBoxes} aria-hidden="true">
                {Array.from({ length: len }, (_, idx) => {
                  const char = code[idx] ?? "";
                  const isActive = focused && !busy && idx === activeIdx;
                  return (
                    <span
                      key={idx}
                      className={[
                        styles.otpBox,
                        char ? styles.otpBoxFilled : "",
                        isActive ? styles.otpBoxActive : "",
                        error ? styles.otpBoxError : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {char}
                    </span>
                  );
                })}
              </div>
            </div>
            {error ? (
              <p id="otp-error-msg" className={styles.otpError} role="alert">
                {error}
              </p>
            ) : null}
          </div>

          {busy ? (
            <div className={styles.verifyingBox} role="status" aria-live="polite">
              <span className={styles.spinner} aria-hidden="true" />
              <span>Chờ mình kiểm tra mã chút nha...</span>
            </div>
          ) : null}

          <Button type="submit" disabled={busy} className={styles.submitBtn}>
            {busy ? "Chờ mình kiểm tra mã chút nha..." : "Xác minh & tiếp tục"}
          </Button>
        </form>

        <div className={styles.resendWrap}>
          {wait > 0 ? (
            <p className={styles.muted}>
              Gửi lại mã sau <span className={styles.countdown}>{mm}:{ss}</span>
            </p>
          ) : (
            <button type="button" className={styles.link} onClick={resend}>
              Gửi lại mã
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
