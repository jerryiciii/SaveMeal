"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Button, TextField } from "@/components/ui";
import { safeNext } from "@/features/auth/LoginScreen";
import { RequireAuth, useSession } from "@/features/auth/SessionProvider";
import styles from "@/features/auth/auth.module.css";
import { saveMeal } from "@/lib/api";
import { ApiError } from "@/lib/contract/errors";

/** First sign-in: ask only for a display name (privacy: nothing else is collected). ME-2. */
function NameForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const session = useSession();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      session.setMe(await saveMeal.updateMe({ displayName: name.trim() }));
      router.replace(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không lưu được tên.");
      setBusy(false);
    }
  }

  return (
    <section className={styles.screen}>
      <h1 className={styles.title}>Bạn tên là gì?</h1>
      <p className={styles.lead}>Người bán sẽ thấy tên này khi bạn đến nhận món.</p>
      <form className={styles.form} onSubmit={save} noValidate>
        <TextField label="Tên hiển thị" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} error={error} autoFocus />
        <Button type="submit" disabled={busy || name.trim().length < 2}>
          Lưu & tiếp tục
        </Button>
      </form>
    </section>
  );
}

export default function NamePage() {
  return (
    <RequireAuth>
      <Suspense>
        <NameForm />
      </Suspense>
    </RequireAuth>
  );
}
