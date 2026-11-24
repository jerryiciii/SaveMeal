"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Notice } from "@/components/ui";
import { useSession } from "@/features/auth/SessionProvider";
import {
  countUnreadNotifications,
  fetchNotifications,
  loadSeenIds,
  markNotificationsSeen,
  type NotificationItem,
} from "./notificationFeed";
import styles from "./notifications.module.css";

type FilterTab = "all" | "urgent" | "buyer" | "seller";

function formatRelativeTime(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (diffSec < 60) return "Vừa xong";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} phút trước`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} giờ trước`;
  return `${Math.floor(diffSec / 86400)} ngày trước`;
}

export function NotificationsScreen() {
  const session = useSession();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [seen, setSeen] = useState<Set<string>>(() => loadSeenIds());
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<FilterTab>("all");

  const load = useCallback(async () => {
    if (session.status !== "authenticated") return;
    try {
      const next = await fetchNotifications();
      setItems(next);
      setSeen(loadSeenIds());
    } finally {
      setLoaded(true);
    }
  }, [session.status]);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    let cancelled = false;
    void fetchNotifications()
      .then((next) => {
        if (cancelled) return;
        setItems(next);
        setSeen(loadSeenIds());
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    const t = setInterval(() => void load(), 20_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [load, session.status]);

  const loading = session.status === "loading" || (session.status === "authenticated" && !loaded);

  const unreadCount = useMemo(() => countUnreadNotifications(items, seen), [items, seen]);
  const filtered = useMemo(() => {
    if (filter === "urgent") return items.filter((i) => i.urgent);
    if (filter === "buyer") return items.filter((i) => i.role === "buyer");
    if (filter === "seller") return items.filter((i) => i.role === "seller");
    return items;
  }, [items, filter]);

  function markAllRead() {
    const ids = items.map((i) => i.id);
    markNotificationsSeen(ids);
    setSeen(loadSeenIds());
  }

  function markOneRead(id: string) {
    markNotificationsSeen([id]);
    setSeen(loadSeenIds());
  }

  if (session.status === "anonymous") {
    return (
      <section className={styles.screen}>
        <header className={styles.header}>
          <h1 className={styles.title}>Thông báo</h1>
        </header>
        <div className={styles.emptyCard}>
          <p className={styles.emptyTitle}>Đăng nhập để xem thông báo đơn hàng</p>
          <p className={styles.emptyDesc}>
            Nhận cập nhật ngay khi có biên lai chuyển khoản cần duyệt, mã QR nhận món sẵn sàng hoặc trạng thái đơn thay đổi.
          </p>
          <Link href="/login?next=%2Fnotifications" className={styles.primaryLink}>
            Đăng nhập ngay
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.screen} aria-label="Thông báo">
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>Thông báo</h1>
          {unreadCount > 0 ? <span className={styles.unreadPill}>{unreadCount} mới</span> : null}
        </div>
        {unreadCount > 0 ? (
          <button type="button" className={styles.markAllBtn} onClick={markAllRead}>
            Đánh dấu đã đọc
          </button>
        ) : null}
      </header>

      <div className={styles.track} role="tablist" aria-label="Lọc thông báo">
        {(
          [
            ["all", "Tất cả"],
            ["urgent", "Cần xử lý"],
            ["buyer", "Đơn mua"],
            ["seller", "Đơn bán"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            className={[styles.trackBtn, filter === key ? styles.trackBtnOn : ""].filter(Boolean).join(" ")}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className={styles.skeletonList} aria-busy="true">
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyCard}>
          <p className={styles.emptyTitle}>Chưa có thông báo nào</p>
          <p className={styles.emptyDesc}>
            Khi bạn đặt giữ món, có người mua đơn của bạn hoặc có biên lai cần xác nhận, thông báo sẽ hiện ngay tại đây.
          </p>
          <div className={styles.emptyActions}>
            <Link href="/" className={styles.primaryLink}>
              Khám phá món quanh bạn
            </Link>
            <Link href="/settings" className={styles.secondaryLink}>
              Bật email báo món mới gần đây
            </Link>
          </div>
        </div>
      ) : (
        <ul className={styles.list}>
          {filtered.map((item) => {
            const unread = !seen.has(item.id);
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className={[styles.card, unread ? styles.cardUnread : ""].filter(Boolean).join(" ")}
                  onClick={() => markOneRead(item.id)}
                >
                  <div className={styles.cardTop}>
                    <span className={[styles.tag, styles[`tone_${item.tone}`]].join(" ")}>{item.tag}</span>
                    <div className={styles.cardTopRight}>
                      <span className={styles.time}>{formatRelativeTime(item.timestamp)}</span>
                      {unread ? <span className={styles.redDot} aria-label="Chưa đọc" /> : null}
                    </div>
                  </div>
                  <p className={styles.cardTitle}>{item.title}</p>
                  <p className={styles.cardBody}>{item.body}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {session.status === "authenticated" && !session.me.nearbyAlerts?.enabled ? (
        <Notice>
          <p>
            Muốn nhận email tự động khi có món mới đăng quanh bạn?{" "}
            <Link href="/settings" className={styles.inlineLink}>
              Bật trong Cài đặt →
            </Link>
          </p>
        </Notice>
      ) : null}

      {!loading && items.length > 0 ? (
        <Button variant="secondary" onClick={() => void load()}>
          Làm mới thông báo
        </Button>
      ) : null}
    </section>
  );
}
