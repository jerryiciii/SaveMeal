"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, FoodCard, Notice, ScreenHeader } from "@/components/ui";
import { saveMeal } from "@/lib/api";
import { ApiError } from "@/lib/contract/errors";
import { DECLARATION_KEYS, type ChecklistKey, type DeclarationKey, type ListingOwnerView } from "@/lib/contract/types";
import { formatPickupDay, formatPickupWindow } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { CHECKLIST_LABEL } from "./labels";
import { declarationStorageKey } from "./PostChecklist";
import styles from "./post.module.css";

function readDeclaration(id: string): Record<DeclarationKey, boolean> | null {
  try {
    const raw = sessionStorage.getItem(declarationStorageKey(id));
    if (!raw) return null;
    const d = JSON.parse(raw) as Record<DeclarationKey, boolean>;
    return DECLARATION_KEYS.every((k) => d[k] === true) ? d : null;
  } catch {
    return null;
  }
}

/** Figma V1 27 · Xem trước tin đăng (9:254) → LIST-6 publish → 28 · Đăng thành công. */
export function PostPreview({ id }: { id: string }) {
  const router = useRouter();
  const { state } = useLoad(() => saveMeal.getListing(id) as Promise<ListingOwnerView>, [id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<ChecklistKey[]>([]);

  if (state.kind === "loading") return <ScreenHeader title="Xem trước tin" />;
  if (state.kind === "error") {
    return (
      <>
        <ScreenHeader title="Xem trước tin" />
        <div className={styles.body}>
          <Notice tone="error">{state.error.message}</Notice>
        </div>
      </>
    );
  }
  const l = state.data;
  const shownMissing = missing.length ? missing : l.missing;

  async function publish() {
    const declaration = readDeclaration(id);
    if (!declaration) {
      router.push(`/post/${id}/checklist`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveMeal.publishListing(id, declaration);
      try {
        sessionStorage.removeItem(declarationStorageKey(id));
      } catch {
        // ignore
      }
      router.replace(`/post/${id}/done`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "LISTING_INCOMPLETE" && Array.isArray(err.details?.missing)) {
        setMissing(err.details.missing as ChecklistKey[]);
      }
      setError(err instanceof ApiError ? err.message : "Không đăng được tin.");
      setBusy(false);
    }
  }

  return (
    <>
      <ScreenHeader title="Xem trước tin" subtitle="Người mua sẽ thấy tin như sau" />
      <div className={styles.body}>
        <FoodCard listing={l} />
        <Notice>
          <p>
            Còn {l.quantityTotal} suất · Nhận {formatPickupDay(l.pickupStart)} {formatPickupWindow(l.pickupStart, l.pickupEnd)}
            <br />
            Điểm nhận: {l.pickup.address}
            {l.ingredients ? (
              <>
                <br />
                Thành phần: {l.ingredients}
              </>
            ) : null}
          </p>
        </Notice>
        {shownMissing.length ? (
          <Notice tone="error">
            <p>Tin còn thiếu: {shownMissing.map((k) => CHECKLIST_LABEL[k]).join(", ")}.</p>
          </Notice>
        ) : null}
        {error && !shownMissing.length ? <Notice tone="error">{error}</Notice> : null}
        {shownMissing.length ? (
          <Link className={styles.linkBtnSecondary} href={`/post/${id}/details`}>
            Sửa thông tin nhận hàng
          </Link>
        ) : null}
        <Button onClick={publish} disabled={busy || shownMissing.length > 0}>
          {busy ? "Đang đăng…" : "Đăng món lên bản đồ"}
        </Button>
      </div>
    </>
  );
}

/** Figma V1 28 · Đăng thành công (9:274). */
export function PostDone({ id }: { id: string }) {
  const { state } = useLoad(() => saveMeal.getListing(id) as Promise<ListingOwnerView>, [id]);
  return (
    <section className={styles.done}>
      <span className={styles.tick} aria-hidden="true">
        ✓
      </span>
      <h1 className={styles.h1} style={{ marginTop: 8 }}>
        Đăng món thành công!
      </h1>
      {state.kind === "ready" ? (
        <p className={styles.lead}>
          {state.data.title} · {state.data.isFree ? "Miễn phí" : `${state.data.price.toLocaleString("vi-VN")}đ`} · {state.data.quantityTotal} suất
          <br />
          Nhận {formatPickupWindow(state.data.pickupStart, state.data.pickupEnd)}
        </p>
      ) : null}
      <Link className={styles.linkBtn} href="/my-listings">
        Xem tin của tôi
      </Link>
      <Link className={styles.linkBtnSecondary} href="/">
        Tiếp tục khám phá
      </Link>
    </section>
  );
}
