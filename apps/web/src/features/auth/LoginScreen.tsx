"use client";

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

/** Figma V1 10 · Sign in / Sign up: one form for both (OTP creates the account on first verify). */
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
    <section className={styles.screen}>
      <p className={styles.brand}>✦ SaveMeal</p>
      <h1 className={styles.title}>Chào mừng trở lại.</h1>
      <p className={styles.lead}>Một tài khoản để vừa mua vừa đăng món.</p>
      <form className={styles.form} onSubmit={submit} noValidate>
        <TextField
          label={isMockApi ? "Số điện thoại hoặc email" : "Email"}
          placeholder={isMockApi ? "Nhập email hoặc số điện thoại" : "ban@example.com"}
          type={isMockApi ? "text" : "email"}
          inputMode="email"
          autoComplete={isMockApi ? "username" : "email"}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          hint={!isMockApi ? "Nhập email của bạn để nhận mã OTP 6 số từ SaveMeal." : undefined}
          error={error}
        />
        <Button type="submit" disabled={busy}>
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
  );
}
