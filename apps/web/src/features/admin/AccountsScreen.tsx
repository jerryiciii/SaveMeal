"use client";

import { useState, type FormEvent } from "react";
import { Chip, Notice, TextArea, TextField } from "@/components/ui";
import { adminApi, type AdminAccount } from "@/lib/api/adminEndpoints";
import { ApiError } from "@/lib/contract/errors";
import type { AccountStatus } from "@/lib/contract/types";
import { useLoad } from "@/lib/useLoad";
import styles from "./admin.module.css";
import { ACCOUNT_STATUS_LABEL, formatDateOnly, SELLER_TYPE_LABEL } from "./labels";

type OpenAction =
  | { accountId: string; kind: "status" }
  | { accountId: string; kind: "verify" }
  | null;

export function AccountsScreen() {
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<AccountStatus | "">("");
  const [sellerOnly, setSellerOnly] = useState(false);
  const [openAction, setOpenAction] = useState<OpenAction>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useLoad<AdminAccount[]>(
    () =>
      adminApi
        .listAccounts({
          q: q || undefined,
          status: statusFilter || undefined,
          sellerOnly: sellerOnly ? true : undefined,
          limit: 50,
        })
        .then((r) => r.data),
    [q, statusFilter, sellerOnly],
  );

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    setQ(searchInput.trim());
  }

  function handleStatusUpdated(id: string, nextStatus: AccountStatus) {
    if (load.state.kind === "ready") {
      load.setData(load.state.data.map((a) => (a.id === id ? { ...a, status: nextStatus } : a)));
    }
    setOpenAction(null);
    setFlash(
      nextStatus === "SUSPENDED"
        ? `Đã tạm khóa tài khoản #${id}.`
        : `Đã kích hoạt lại tài khoản #${id}.`,
    );
  }

  function handleVerificationUpdated(id: string, seller: AdminAccount["seller"]) {
    if (load.state.kind === "ready") {
      load.setData(load.state.data.map((a) => (a.id === id ? { ...a, seller } : a)));
    }
    setOpenAction(null);
    setFlash(
      seller.verified
        ? `Đã cấp huy hiệu "Đã xác minh" cho người bán #${id}.`
        : `Đã gỡ huy hiệu "Đã xác minh" của người bán #${id}.`,
    );
  }

  return (
    <>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Quản lý tài khoản</h1>
          <p className={styles.pageSubtitle}>
            Tra cứu tài khoản, tạm khóa / mở khóa và quản lý huy hiệu &ldquo;Đã xác minh&rdquo; cho người bán.
          </p>
        </div>
        <button type="button" className={styles.compactButton} onClick={load.reload}>
          Làm mới
        </button>
      </div>

      {flash ? (
        <Notice tone="success">
          <p>{flash}</p>
        </Notice>
      ) : null}

      <section className={styles.filterPanel} aria-label="Bộ lọc tài khoản">
        <form className={styles.filterControls} onSubmit={submitSearch}>
          <label className={styles.compactInputWrap}>
            <span className={styles.compactLabel}>Tìm theo tên, số điện thoại hoặc email</span>
            <input
              type="search"
              className={styles.compactInput}
              placeholder="Ví dụ: Tiệm bánh Mây, +8490…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </label>
          <div className={styles.actionRow}>
            <button type="submit" className={`${styles.compactButton} ${styles.compactButtonPrimary}`}>
              Tìm kiếm
            </button>
            {q ? (
              <button
                type="button"
                className={styles.compactButton}
                onClick={() => {
                  setSearchInput("");
                  setQ("");
                }}
              >
                Xóa tìm kiếm
              </button>
            ) : null}
          </div>
        </form>

        <div className={styles.chipRow}>
          <Chip selected={statusFilter === ""} onClick={() => setStatusFilter("")}>
            Tất cả trạng thái
          </Chip>
          <Chip selected={statusFilter === "ACTIVE"} onClick={() => setStatusFilter("ACTIVE")}>
            {ACCOUNT_STATUS_LABEL.ACTIVE}
          </Chip>
          <Chip selected={statusFilter === "SUSPENDED"} onClick={() => setStatusFilter("SUSPENDED")}>
            {ACCOUNT_STATUS_LABEL.SUSPENDED}
          </Chip>
          <Chip selected={sellerOnly} onClick={() => setSellerOnly((v) => !v)}>
            Chỉ người bán
          </Chip>
        </div>
      </section>

      {load.state.kind === "loading" ? (
        <div className={styles.emptyBox}>Đang tải danh sách tài khoản…</div>
      ) : load.state.kind === "error" ? (
        <Notice tone="error">
          <p>{load.state.error.message}</p>
        </Notice>
      ) : load.state.data.length === 0 ? (
        <div className={styles.emptyBox}>Không tìm thấy tài khoản nào phù hợp.</div>
      ) : (
        <div className={styles.cardList}>
          {load.state.data.map((acc) => {
            const isStatusOpen = openAction?.accountId === acc.id && openAction.kind === "status";
            const isVerifyOpen = openAction?.accountId === acc.id && openAction.kind === "verify";

            return (
              <article key={acc.id} className={styles.itemCard}>
                <div className={styles.itemHeader}>
                  <div className={styles.itemTitleGroup}>
                    <div className={styles.badgeRow}>
                      <span
                        className={`${styles.badge} ${
                          acc.status === "ACTIVE" ? styles.badgeMint : styles.badgeAlert
                        }`}
                      >
                        {ACCOUNT_STATUS_LABEL[acc.status]}
                      </span>
                      {acc.seller.verified ? (
                        <span className={`${styles.badge} ${styles.badgeSky}`}>Đã xác minh</span>
                      ) : null}
                      {acc.seller.type ? (
                        <span className={`${styles.badge} ${styles.badgeMuted}`}>
                          {SELLER_TYPE_LABEL[acc.seller.type]}
                        </span>
                      ) : null}
                    </div>

                    <h2 className={styles.itemTitle}>
                      {acc.displayName ?? "(Chưa đặt tên)"}
                      {acc.seller.name && acc.seller.name !== acc.displayName ? ` · ${acc.seller.name}` : ""}
                    </h2>

                    <p className={styles.itemMeta}>
                      <span className={styles.mono}>#{acc.id}</span>
                      <span>SĐT: {acc.phone ?? "—"}</span>
                      <span>Email: {acc.email ?? "—"}</span>
                      <span>Tham gia: {formatDateOnly(acc.createdAt)}</span>
                    </p>

                    {acc.seller.defaultPickup?.address ? (
                      <p className={styles.itemMeta}>
                        <span>Điểm nhận mặc định: {acc.seller.defaultPickup.address}</span>
                      </p>
                    ) : null}
                  </div>

                  <div className={styles.actionRow}>
                    <button
                      type="button"
                      className={`${styles.compactButton} ${
                        acc.status === "ACTIVE" ? styles.compactButtonDanger : styles.compactButtonPrimary
                      }`}
                      onClick={() =>
                        setOpenAction(isStatusOpen ? null : { accountId: acc.id, kind: "status" })
                      }
                    >
                      {acc.status === "ACTIVE" ? "Tạm khóa" : "Mở khóa"}
                    </button>

                    <button
                      type="button"
                      className={`${styles.compactButton} ${styles.compactButtonSky}`}
                      onClick={() =>
                        setOpenAction(isVerifyOpen ? null : { accountId: acc.id, kind: "verify" })
                      }
                    >
                      {acc.seller.verified ? "Gỡ xác minh" : "Xác minh người bán"}
                    </button>
                  </div>
                </div>

                {isStatusOpen ? (
                  <AccountStatusForm
                    account={acc}
                    onCancel={() => setOpenAction(null)}
                    onSaved={(nextStatus) => handleStatusUpdated(acc.id, nextStatus)}
                  />
                ) : null}

                {isVerifyOpen ? (
                  <SellerVerifyForm
                    account={acc}
                    onCancel={() => setOpenAction(null)}
                    onSaved={(seller) => handleVerificationUpdated(acc.id, seller)}
                  />
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

function AccountStatusForm({
  account,
  onCancel,
  onSaved,
}: {
  account: AdminAccount;
  onCancel: () => void;
  onSaved: (nextStatus: AccountStatus) => void;
}) {
  const nextStatus: AccountStatus = account.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("Vui lòng nhập lý do thay đổi trạng thái tài khoản.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.setAccountStatus(account.id, nextStatus, trimmed);
      onSaved(res.status);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không thể cập nhật trạng thái tài khoản.");
      setBusy(false);
    }
  }

  return (
    <form className={styles.inlineForm} onSubmit={onSubmit}>
      {nextStatus === "SUSPENDED" ? (
        <Notice tone="error">
          <p>
            Tạm khóa tài khoản sẽ thu hồi phiên đăng nhập, ẩn toàn bộ tin đang đăng và chặn đặt mới. Các đơn đang giữ
            chỗ hiện có vẫn giữ nguyên để quản trị viên xem xét riêng.
          </p>
        </Notice>
      ) : (
        <Notice>
          <p>Kích hoạt lại tài khoản sẽ cho phép người dùng đăng nhập và sử dụng SaveMeal trở lại.</p>
        </Notice>
      )}

      <TextArea
        id={`acc-status-reason-${account.id}`}
        label={`Lý do ${nextStatus === "SUSPENDED" ? "tạm khóa" : "mở khóa"} (bắt buộc)`}
        placeholder="Nhập lý do cụ thể để lưu nhật ký vận hành…"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        error={error}
      />

      <div className={styles.actionRow}>
        <button
          type="submit"
          disabled={busy}
          className={`${styles.compactButton} ${
            nextStatus === "SUSPENDED" ? styles.compactButtonDanger : styles.compactButtonPrimary
          }`}
        >
          {busy ? "Đang xử lý…" : nextStatus === "SUSPENDED" ? "Xác nhận tạm khóa" : "Xác nhận mở khóa"}
        </button>
        <button type="button" disabled={busy} className={styles.compactButton} onClick={onCancel}>
          Hủy
        </button>
      </div>
    </form>
  );
}

function SellerVerifyForm({
  account,
  onCancel,
  onSaved,
}: {
  account: AdminAccount;
  onCancel: () => void;
  onSaved: (seller: AdminAccount["seller"]) => void;
}) {
  const nextVerified = !account.seller.verified;
  const [note, setNote] = useState(nextVerified ? "Đã kiểm tra thông tin cơ sở" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.setSellerVerification(account.id, nextVerified, note.trim() || null);
      onSaved(res.seller);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không thể cập nhật trạng thái xác minh.");
      setBusy(false);
    }
  }

  return (
    <form className={styles.inlineForm} onSubmit={onSubmit}>
      <Notice>
        <p>
          Huy hiệu <b>&ldquo;Đã xác minh&rdquo;</b> đánh dấu người bán đã được quản trị viên đối chiếu thông tin cơ sở (không phải
          chứng nhận an toàn thực phẩm).
        </p>
      </Notice>

      <TextField
        id={`verify-note-${account.id}`}
        label="Ghi chú xác minh"
        placeholder="Ví dụ: Đã kiểm tra thông tin cơ sở…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        error={error}
      />

      <div className={styles.actionRow}>
        <button type="submit" disabled={busy} className={`${styles.compactButton} ${styles.compactButtonPrimary}`}>
          {busy ? "Đang lưu…" : nextVerified ? 'Cấp huy hiệu "Đã xác minh"' : 'Gỡ huy hiệu "Đã xác minh"'}
        </button>
        <button type="button" disabled={busy} className={styles.compactButton} onClick={onCancel}>
          Hủy
        </button>
      </div>
    </form>
  );
}
