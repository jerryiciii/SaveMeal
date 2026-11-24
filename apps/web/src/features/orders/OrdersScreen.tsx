"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Chip, Notice } from "@/components/ui";
import { saveMeal } from "@/lib/api";
import { formatPickupDay, formatPickupWindow } from "@/lib/format";
import { useLoad } from "@/lib/useLoad";
import { RESERVATION_STATUS_LABEL } from "./labels";
import styles from "./orders.module.css";

/** Figma V1 17 · Đơn của tôi (8:2): "Đang nhận" / "Lịch sử" (RES-2, polled every 30 s). */
export function OrdersScreen() {
  const [tab, setTab] = useState<"upcoming" | "history">("upcoming");
  const { state, reload } = useLoad(() => saveMeal.myReservations(tab), [tab], 30_000);

  return (
    <section className={styles.body} style={{ paddingTop: 56 }}>
      <h1 style={{ margin: 0, fontSize: 28 }}>Đơn của tôi</h1>
      <p style={{ margin: "-6px 0 0", color: "var(--text-secondary)", fontSize: 14 }}>Theo dõi các suất đã giữ</p>
      <div className={styles.tabs} role="tablist">
        <Chip selected={tab === "upcoming"} onClick={() => setTab("upcoming")} role="tab" aria-selected={tab === "upcoming"}>
          Đang nhận
        </Chip>
        <Chip selected={tab === "history"} onClick={() => setTab("history")} role="tab" aria-selected={tab === "history"}>
          Lịch sử
        </Chip>
      </div>
      {state.kind === "loading" ? (
        <p className={styles.orderMeta}>Đang tải…</p>
      ) : state.kind === "error" ? (
        <>
          <Notice tone="error">{state.error.message}</Notice>
          <Button variant="secondary" onClick={reload}>
            Thử lại
          </Button>
        </>
      ) : state.data.data.length === 0 ? (
        <Notice>
          {tab === "upcoming" ? (
            <p>
              Bạn chưa giữ suất nào. <Link href="/">Khám phá món gần bạn</Link>
            </p>
          ) : (
            <p>Các đơn hoàn thành sẽ nằm ở Lịch sử.</p>
          )}
        </Notice>
      ) : (
        <ul className={styles.list}>
          {state.data.data.map((r) => (
            <li key={r.id}>
              <Link className={styles.order} href={`/orders/${r.id}`}>
                <span className={styles.orderTop}>
                  <span>{r.listing.title}</span>
                  <span className={r.status === "RESERVED" || r.status === "COMPLETED" ? styles.status : styles.statusMuted}>
                    {RESERVATION_STATUS_LABEL[r.status]}
                  </span>
                </span>
                <span className={styles.orderMeta}>
                  {r.seller.name} · {r.code} · {r.quantity} suất
                </span>
                <span className={styles.orderMeta}>
                  {formatPickupDay(r.listing.pickupStart)} · {formatPickupWindow(r.listing.pickupStart, r.listing.pickupEnd)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
