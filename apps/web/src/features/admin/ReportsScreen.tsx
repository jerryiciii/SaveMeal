"use client";

import Image from "next/image";
import { useState, type FormEvent } from "react";
import { Chip, Notice, SelectField, TextArea } from "@/components/ui";
import {
  adminApi,
  REPORT_ACTIONS,
  REPORT_STATUSES,
  REPORT_TYPES,
  type AdminReport,
  type ReportAction,
  type ReportStatus,
} from "@/lib/api/adminEndpoints";
import { ApiError } from "@/lib/contract/errors";
import type { ReportType } from "@/lib/contract/types";
import { useLoad } from "@/lib/useLoad";
import styles from "./admin.module.css";
import {
  formatDateTime,
  REPORT_ACTION_LABEL,
  REPORT_STATUS_LABEL,
  REPORT_TYPE_LABEL,
} from "./labels";

function reportStatusBadge(status: ReportStatus): string {
  if (status === "OPEN") return styles.badgeAlert ?? "";
  if (status === "IN_REVIEW") return styles.badgeOrange ?? "";
  if (status === "RESOLVED") return styles.badgeMint ?? "";
  return styles.badgeMuted ?? "";
}

export function ReportsScreen() {
  const [statusFilter, setStatusFilter] = useState<ReportStatus | "">("");
  const [typeFilter, setTypeFilter] = useState<ReportType | "">("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useLoad<AdminReport[]>(
    () =>
      adminApi
        .listReports({
          status: statusFilter || undefined,
          type: typeFilter || undefined,
          limit: 50,
        })
        .then((r) => r.data),
    [statusFilter, typeFilter],
  );

  function handleUpdated(updated: AdminReport) {
    if (load.state.kind === "ready") {
      load.setData(load.state.data.map((r) => (r.id === updated.id ? updated : r)));
    }
    setActiveId(null);
    setFlash(`Đã cập nhật báo cáo #${updated.id} → ${REPORT_STATUS_LABEL[updated.status]}.`);
  }

  return (
    <>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Báo cáo vi phạm</h1>
          <p className={styles.pageSubtitle}>Xem xét, xử lý báo cáo chất lượng và quản lý trạng thái đang xem xét.</p>
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

      <section className={styles.filterPanel} aria-label="Bộ lọc báo cáo">
        <div className={styles.chipRow}>
          <Chip selected={statusFilter === ""} onClick={() => setStatusFilter("")}>
            Tất cả trạng thái
          </Chip>
          {REPORT_STATUSES.map((s) => (
            <Chip key={s} selected={statusFilter === s} onClick={() => setStatusFilter(s)}>
              {REPORT_STATUS_LABEL[s]}
            </Chip>
          ))}
        </div>

        <div className={styles.filterControls}>
          <label className={styles.compactInputWrap}>
            <span className={styles.compactLabel}>Loại báo cáo</span>
            <select
              className={styles.compactInput}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as ReportType | "")}
            >
              <option value="">Tất cả loại</option>
              {REPORT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {REPORT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {load.state.kind === "loading" ? (
        <div className={styles.emptyBox}>Đang tải danh sách báo cáo…</div>
      ) : load.state.kind === "error" ? (
        <Notice tone="error">
          <p>{load.state.error.message}</p>
        </Notice>
      ) : load.state.data.length === 0 ? (
        <div className={styles.emptyBox}>Không có báo cáo nào phù hợp với bộ lọc hiện tại.</div>
      ) : (
        <section className={styles.tableCard} aria-label="Danh sách báo cáo vi phạm">
          <div className={styles.tableCardHeader}>
            <span>Báo cáo &amp; bằng chứng</span>
            <span className={styles.tabular}>{load.state.data.length} báo cáo</span>
          </div>
          {load.state.data.map((report) => (
            <article key={report.id} className={styles.tableRowItem}>
              <div className={styles.itemHeader}>
                <div className={styles.itemTitleGroup}>
                  <div className={styles.badgeRow}>
                    <span
                      className={`${styles.badge} ${
                        report.type === "UNSAFE_FOOD" ? styles.badgeAlert : styles.badgeOrange
                      }`}
                    >
                      {REPORT_TYPE_LABEL[report.type]}
                    </span>
                    <span className={`${styles.badge} ${reportStatusBadge(report.status)}`}>
                      {REPORT_STATUS_LABEL[report.status]}
                    </span>
                    {report.action ? (
                      <span className={`${styles.badge} ${styles.badgeSky}`}>
                        {REPORT_ACTION_LABEL[report.action]}
                      </span>
                    ) : null}
                  </div>
                  <p className={styles.itemMeta}>
                    <span className={styles.mono}>#{report.id}</span>
                    <span>Gửi lúc {formatDateTime(report.createdAt)}</span>
                    <span>Người báo cáo: {report.reporter?.displayName ?? "—"}</span>
                  </p>
                </div>

                <div className={styles.actionRow}>
                  <button
                    type="button"
                    className={`${styles.compactButton} ${activeId === report.id ? "" : styles.compactButtonPrimary}`}
                    onClick={() => setActiveId(activeId === report.id ? null : report.id)}
                  >
                    {activeId === report.id ? "Đóng biểu mẫu" : "Xử lý báo cáo"}
                  </button>
                </div>
              </div>

              <p className={styles.itemBody}>{report.description}</p>

              <p className={styles.itemMeta}>
                <span>
                  Tài khoản bị báo cáo: <span className={styles.mono}>{report.reportedAccountId}</span>
                </span>
                {report.listingId ? (
                  <span>
                    Tin đăng: <span className={styles.mono}>{report.listingId}</span>
                  </span>
                ) : null}
                {report.reservationId ? (
                  <span>
                    Đơn giữ chỗ: <span className={styles.mono}>{report.reservationId}</span>
                  </span>
                ) : null}
              </p>

              {report.images.length > 0 ? (
                <div className={styles.evidenceGrid}>
                  {report.images.map((img) => (
                    <Image
                      key={img.id}
                      src={img.url}
                      alt="Ảnh minh chứng báo cáo"
                      width={72}
                      height={72}
                      unoptimized
                      className={styles.evidenceImg}
                    />
                  ))}
                </div>
              ) : null}

              {report.resolution || report.handledAt ? (
                <Notice>
                  <p>
                    <b>Kết quả xử lý:</b> {report.resolution ?? "Không có ghi chú"}
                    {report.handledAt ? ` · Xử lý lúc ${formatDateTime(report.handledAt)}` : ""}
                  </p>
                </Notice>
              ) : null}

              {activeId === report.id ? (
                <ReportActionForm
                  report={report}
                  onCancel={() => setActiveId(null)}
                  onSaved={handleUpdated}
                />
              ) : null}
            </article>
          ))}
        </section>
      )}
    </>
  );
}

function ReportActionForm({
  report,
  onCancel,
  onSaved,
}: {
  report: AdminReport;
  onCancel: () => void;
  onSaved: (updated: AdminReport) => void;
}) {
  const [status, setStatus] = useState<"IN_REVIEW" | "RESOLVED" | "DISMISSED">(
    report.status === "OPEN" ? "RESOLVED" : report.status,
  );
  const [action, setAction] = useState<ReportAction>(report.action ?? "NONE");
  const [resolution, setResolution] = useState(report.resolution ?? "");
  const [clearReview, setClearReview] = useState(Boolean(report.listingId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await adminApi.updateReport(report.id, {
        status,
        action,
        resolution: resolution.trim(),
        clearReview: report.listingId ? clearReview : false,
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không thể cập nhật báo cáo.");
      setBusy(false);
    }
  }

  return (
    <form className={styles.inlineForm} onSubmit={onSubmit}>
      <div className={styles.inlineFormGrid}>
        <SelectField
          id={`rep-status-${report.id}`}
          label="Trạng thái báo cáo"
          value={status}
          onChange={(e) => setStatus(e.target.value as "IN_REVIEW" | "RESOLVED" | "DISMISSED")}
        >
          <option value="IN_REVIEW">{REPORT_STATUS_LABEL.IN_REVIEW}</option>
          <option value="RESOLVED">{REPORT_STATUS_LABEL.RESOLVED}</option>
          <option value="DISMISSED">{REPORT_STATUS_LABEL.DISMISSED}</option>
        </SelectField>

        <SelectField
          id={`rep-action-${report.id}`}
          label="Hành động áp dụng"
          value={action}
          onChange={(e) => setAction(e.target.value as ReportAction)}
        >
          {REPORT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {REPORT_ACTION_LABEL[a]}
            </option>
          ))}
        </SelectField>
      </div>

      {action === "LISTING_BLOCKED" ? (
        <Notice tone="error">
          <p>
            Chọn <b>Khóa tin đăng</b> sẽ chuyển tin sang trạng thái Bị khóa và tự động hủy tất cả các đơn đang giữ suất
            của tin này.
          </p>
        </Notice>
      ) : null}

      {action === "ACCOUNT_SUSPENDED" ? (
        <Notice tone="error">
          <p>
            Chọn <b>Tạm khóa tài khoản</b> sẽ thu hồi phiên đăng nhập, ẩn toàn bộ tin đang đăng và chặn đặt mới của tài
            khoản bị báo cáo.
          </p>
        </Notice>
      ) : null}

      <TextArea
        id={`rep-resolution-${report.id}`}
        label="Ghi chú xử lý (resolution)"
        placeholder="Mô tả kết quả xác minh và lý do áp dụng biện pháp…"
        value={resolution}
        onChange={(e) => setResolution(e.target.value)}
      />

      {report.listingId ? (
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={clearReview}
            onChange={(e) => setClearReview(e.target.checked)}
          />
          <span>Gỡ cờ đang xem xét (clearReview) để tin không còn bị tạm ẩn sau khi xử lý</span>
        </label>
      ) : null}

      {error ? (
        <Notice tone="error">
          <p>{error}</p>
        </Notice>
      ) : null}

      <div className={styles.actionRow}>
        <button type="submit" disabled={busy} className={`${styles.compactButton} ${styles.compactButtonPrimary}`}>
          {busy ? "Đang lưu…" : "Lưu kết quả xử lý"}
        </button>
        <button type="button" disabled={busy} className={styles.compactButton} onClick={onCancel}>
          Hủy
        </button>
      </div>
    </form>
  );
}
