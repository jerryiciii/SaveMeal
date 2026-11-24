"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Notice, TextField } from "@/components/ui";
import { useSession } from "@/features/auth/SessionProvider";
import { DELETE_ACCOUNT_CONFIRM, deleteMe } from "@/lib/api/trustEndpoints";
import { ApiError } from "@/lib/contract/errors";
import styles from "./settings.module.css";

type ActiveItemsError = {
  activeReservations: number;
  activeListings: number;
};

/**
 * Account deletion section for SaveMeal V2.1 · 36 · Cài đặt & PWA.
 * Calls ME-3 (`DELETE /me`) requiring exact confirmation `"XOA TAI KHOAN"`,
 * explains anonymisation (CLAUDE.md §7), and handles `409 ACCOUNT_HAS_ACTIVE_ITEMS`.
 */
export function DeleteAccountSection() {
  const router = useRouter();
  const session = useSession();
  const [expanded, setExpanded] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeItems, setActiveItems] = useState<ActiveItemsError | null>(null);

  const canSubmit = confirm === DELETE_ACCOUNT_CONFIRM && !busy;

  async function onDelete(e: FormEvent) {
    e.preventDefault();
    if (confirm !== DELETE_ACCOUNT_CONFIRM) {
      setError(`Vui lòng nhập chính xác "${DELETE_ACCOUNT_CONFIRM}".`);
      return;
    }
    setBusy(true);
    setError(null);
    setActiveItems(null);
    try {
      await deleteMe(confirm);
      try {
        await session.signOut();
      } catch {
        // Session may already be revoked by DELETE /me.
      }
      router.replace("/login");
    } catch (err) {
      if (err instanceof ApiError && err.code === "ACCOUNT_HAS_ACTIVE_ITEMS") {
        const resCount = Number(err.details?.activeReservations ?? 0);
        const listCount = Number(err.details?.activeListings ?? 0);
        setActiveItems({
          activeReservations: Number.isFinite(resCount) ? resCount : 0,
          activeListings: Number.isFinite(listCount) ? listCount : 0,
        });
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : "Không thể xóa tài khoản lúc này. Vui lòng thử lại.");
      }
      setBusy(false);
    }
  }

  return (
    <section className={styles.dangerCard} aria-label="Vùng nguy hiểm — Xóa tài khoản">
      <div className={styles.cardHeadLeft}>
        <span className={styles.icnDanger} aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <h2 className={styles.dangerTitle}>Xóa tài khoản</h2>
      </div>
      <p className={styles.dangerDesc}>
        Yêu cầu xóa và ẩn danh dữ liệu cá nhân theo quy định bảo mật của SaveMeal. Thao tác này không thể hoàn tác.
      </p>

      {!expanded ? (
        <button
          type="button"
          className={styles.dangerButton}
          onClick={() => {
            setExpanded(true);
            setError(null);
            setActiveItems(null);
          }}
        >
          Yêu cầu xóa tài khoản
        </button>
      ) : (
        <form onSubmit={onDelete} noValidate className={styles.dangerForm}>
          <ul className={styles.bulletList}>
            <li>Số điện thoại, email, ảnh đại diện và thông tin người bán sẽ bị xóa khỏi tài khoản.</li>
            <li>Tên hiển thị sẽ được ẩn danh thành &ldquo;Người dùng đã xóa&rdquo;.</li>
            <li>Các tin nháp chưa đăng sẽ bị xóa; lịch sử đơn hàng và báo cáo được giữ ở dạng ẩn danh.</li>
            <li>Bạn cần hoàn tất, hủy đơn đang giữ và gỡ tin đang đăng trước khi xóa tài khoản.</li>
          </ul>

          <TextField
            label={`Nhập chính xác "${DELETE_ACCOUNT_CONFIRM}" để xác nhận`}
            placeholder={DELETE_ACCOUNT_CONFIRM}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />

          {activeItems ? (
            <Notice tone="error">
              <p>
                <span className={styles.strongText}>Chưa thể xóa tài khoản:</span> bạn đang có{" "}
                {activeItems.activeReservations > 0 ? `${activeItems.activeReservations} đơn đang giữ chỗ` : null}
                {activeItems.activeReservations > 0 && activeItems.activeListings > 0 ? " và " : null}
                {activeItems.activeListings > 0 ? `${activeItems.activeListings} tin đang đăng` : null}.
              </p>
              <div className={styles.inlineLinks}>
                {activeItems.activeReservations > 0 ? (
                  <Link className={styles.inlineLink} href="/orders">
                    Xem đơn đang giữ →
                  </Link>
                ) : null}
                {activeItems.activeListings > 0 ? (
                  <Link className={styles.inlineLink} href="/my-listings">
                    Quản lý tin đang đăng →
                  </Link>
                ) : null}
              </div>
            </Notice>
          ) : error ? (
            <Notice tone="error">{error}</Notice>
          ) : null}

          <button type="submit" className={styles.dangerButton} disabled={!canSubmit}>
            {busy ? "Đang xóa tài khoản…" : "Xác nhận xóa vĩnh viễn"}
          </button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setExpanded(false);
              setConfirm("");
              setError(null);
              setActiveItems(null);
            }}
          >
            Hủy bỏ
          </Button>
        </form>
      )}
    </section>
  );
}
