"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Notice, TextField } from "@/components/ui";
import { isMockApi, saveMeal } from "@/lib/api";
import { ApiError } from "@/lib/contract/errors";
import { DEMO_ADMIN_PHONE, DEMO_BUYER_PHONE, DEMO_SELLER_PHONE } from "@/mocks/db";
import styles from "./auth.module.css";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "0901 234 567" → SMS, "a@b.vn" → EMAIL (AUTH-1 channel). */
export function detectChannel(identifier: string): "SMS" | "EMAIL" {
  return identifier.includes("@") ? "EMAIL" : "SMS";
}

export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

/** Figma V2.1 10 · Đăng nhập Email OTP: dark hero + warm cream sheet. */
export function LoginScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = identifier.trim();
    if (!value) {
      setError(isMockApi ? "Nhập số điện thoại hoặc email." : "Vui lòng nhập địa chỉ email hợp lệ để nhận mã OTP.");
      return;
    }
    if (!isMockApi && !EMAIL_RE.test(value)) {
      setError("Vui lòng nhập địa chỉ email hợp lệ để nhận mã OTP.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await saveMeal.requestOtp(detectChannel(value), value);
      const q = new URLSearchParams({ rid: res.requestId, to: value, next, len: String(res.codeLength) });
      router.push(`/login/otp?${q.toString()}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "FEATURE_DISABLED") {
        setError("Đăng nhập bằng SMS chưa hỗ trợ. Vui lòng nhập địa chỉ email hợp lệ để nhận mã OTP.");
      } else {
        setError(err instanceof ApiError ? err.message : "Không gửi được mã. Vui lòng thử lại.");
      }
      setBusy(false);
    }
  }

  return (
    <div className={styles.loginShell}>
      <header className={styles.hero}>
        <div className={styles.brandLockup}>
          <span className={styles.sparkBadge} aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 1.5L9.75 6.25L14.5 8L9.75 9.75L8 14.5L6.25 9.75L1.5 8L6.25 6.25L8 1.5Z"
                fill="#111111"
              />
            </svg>
          </span>
          <span className={styles.wordmark}>SaveMeal</span>
        </div>
        <div className={styles.heroArt}>
          <Image
            src="/illustrations/login-hero.png"
            alt=""
            fill
            priority
            sizes="(max-width: 430px) 280px, 320px"
            className={styles.heroImg}
          />
        </div>
      </header>

      <section className={styles.loginSheet}>
        <h1 className={styles.title}>Chào mừng đến SaveMeal</h1>
        <p className={styles.lead}>Một tài khoản để vừa mua vừa đăng món.</p>

        <form className={styles.form} onSubmit={submit} noValidate>
          <TextField
            className={styles.loginField}
            label={isMockApi ? "Số điện thoại hoặc email" : "Email"}
            placeholder={isMockApi ? "Nhập email hoặc số điện thoại" : "ban@example.com"}
            type={isMockApi ? "text" : "email"}
            inputMode="email"
            autoComplete={isMockApi ? "username" : "email"}
            value={identifier}
            onChange={(e) => {
              setIdentifier(e.target.value);
              if (error) setError(null);
            }}
            hint={!isMockApi ? "Nhập email của bạn để nhận mã OTP 6 số từ SaveMeal." : undefined}
            error={error}
          />
          <Button type="submit" disabled={busy} className={styles.submitBtn}>
            {busy ? "Đang gửi mã…" : "Tiếp tục"}
          </Button>
        </form>

        {isMockApi ? (
          <Notice>
            <p>
              Chế độ demo (mock): người bán <b>{DEMO_SELLER_PHONE}</b>, người mua <b>{DEMO_BUYER_PHONE}</b>, quản trị{" "}
              <b>{DEMO_ADMIN_PHONE}</b>. Mã OTP luôn là <b>123456</b>.
            </p>
          </Notice>
        ) : null}
      </section>
    </div>
  );
}
