"use client";

import { useState } from "react";
import { Chip, Notice } from "@/components/ui";
import {
  adminApi,
  REPORT_ACTIONS,
  REPORT_TYPES,
  type AdminAccount,
  type AdminMetrics,
} from "@/lib/api/adminEndpoints";
import { vnDate } from "@/lib/time";
import { useLoad } from "@/lib/useLoad";
import styles from "./admin.module.css";
import { formatHours, formatPercent, REPORT_ACTION_LABEL, REPORT_TYPE_LABEL } from "./labels";

type Preset = "7d" | "30d" | "today" | "all";

function rangeForPreset(preset: Preset): { from: string; to: string } {
  const today = vnDate(0);
  if (preset === "today") return { from: today, to: today };
  if (preset === "7d") return { from: vnDate(-6), to: today };
  if (preset === "30d") return { from: vnDate(-29), to: today };
  return { from: "", to: "" };
}

export function KpisScreen() {
  const [preset, setPreset] = useState<Preset>("30d");
  const initial = rangeForPreset("30d");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [sellerId, setSellerId] = useState("");

  const sellersLoad = useLoad<AdminAccount[]>(
    () => adminApi.listAccounts({ sellerOnly: true, limit: 50 }).then((r) => r.data),
    [],
  );

  const metricsLoad = useLoad<AdminMetrics>(
    () =>
      adminApi.getMetrics({
        from: from || undefined,
        to: to || undefined,
        sellerId: sellerId || undefined,
      }),
    [from, to, sellerId],
  );

  function applyPreset(next: Preset) {
    setPreset(next);
    const range = rangeForPreset(next);
    setFrom(range.from);
    setTo(range.to);
  }

  return (
    <>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Chỉ số vận hành (KPIs)</h1>
          <p className={styles.pageSubtitle}>Theo dõi bàn giao, tỷ lệ hoàn tất, giảm giá thực tế và an toàn thực phẩm.</p>
        </div>
        <button type="button" className={styles.compactButton} onClick={metricsLoad.reload}>
          Làm mới
        </button>
      </div>

      <section className={styles.filterPanel} aria-label="Bộ lọc thời gian và người bán">
        <div className={styles.chipRow}>
          {(
            [
              ["today", "Hôm nay"],
              ["7d", "7 ngày qua"],
              ["30d", "30 ngày qua"],
              ["all", "Tất cả thời gian"],
            ] as const
          ).map(([id, label]) => (
            <Chip key={id} selected={preset === id} onClick={() => applyPreset(id)}>
              {label}
            </Chip>
          ))}
        </div>

        <div className={styles.filterControls}>
          <label className={styles.compactInputWrap}>
            <span className={styles.compactLabel}>Từ ngày</span>
            <input
              type="date"
              className={styles.compactInput}
              value={from}
              onChange={(e) => {
                setPreset("all");
                setFrom(e.target.value);
              }}
            />
          </label>
          <label className={styles.compactInputWrap}>
            <span className={styles.compactLabel}>Đến ngày</span>
            <input
              type="date"
              className={styles.compactInput}
              value={to}
              onChange={(e) => {
                setPreset("all");
                setTo(e.target.value);
              }}
            />
          </label>
          <label className={styles.compactInputWrap}>
            <span className={styles.compactLabel}>Người bán (tùy chọn)</span>
            <select
              className={styles.compactInput}
              value={sellerId}
              onChange={(e) => setSellerId(e.target.value)}
            >
              <option value="">Tất cả người bán</option>
              {sellersLoad.state.kind === "ready"
                ? sellersLoad.state.data.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.seller.name ?? acc.displayName ?? acc.id}
                    </option>
                  ))
                : null}
            </select>
          </label>
        </div>
      </section>

      {metricsLoad.state.kind === "loading" ? (
        <div className={styles.emptyBox}>Đang tải chỉ số vận hành…</div>
      ) : metricsLoad.state.kind === "error" ? (
        <Notice tone="error">
          <p>{metricsLoad.state.error.message}</p>
        </Notice>
      ) : (
        <KpiMetricsView metrics={metricsLoad.state.data} />
      )}
    </>
  );
}

function KpiMetricsView({ metrics }: { metrics: AdminMetrics }) {
  const blockedFromReports = metrics.reports.byAction.LISTING_BLOCKED ?? 0;
  const maxReportTypeCount = Math.max(1, ...REPORT_TYPES.map((t) => metrics.reports.byType[t] ?? 0));
  const maxReportActionCount = Math.max(1, ...REPORT_ACTIONS.map((a) => metrics.reports.byAction[a] ?? 0));

  return (
    <>
      <section className={styles.kpiGrid} aria-label="Các chỉ số KPI chính">
        {/* 1. Suất đã bàn giao — NEVER label as "lượng thực phẩm cứu được" / "waste avoided" (DOMAIN §8) */}
        <article className={styles.kpiCard}>
          <h2 className={styles.kpiLabel}>Suất đã bàn giao</h2>
          <p className={`${styles.kpiValue} ${styles.kpiValueMint}`}>
            {metrics.portionsHandedOver.toLocaleString("vi-VN")}
          </p>
          <p className={styles.kpiHint}>Tổng số suất từ các đơn đã hoàn tất bàn giao trực tiếp tại điểm nhận.</p>
        </article>

        {/* 2. Tỷ lệ hoàn tất */}
        <article className={styles.kpiCard}>
          <h2 className={styles.kpiLabel}>Tỷ lệ hoàn tất</h2>
          <p className={`${styles.kpiValue} ${styles.kpiValueMint}`}>
            {metrics.reservations.created > 0 ? formatPercent(metrics.completionRate) : "—"}
          </p>
          <div className={styles.progressTrack} aria-hidden="true">
            <div
              className={styles.progressBarMint}
              style={{ width: `${Math.min(100, Math.round(metrics.completionRate * 100))}%` }}
            />
          </div>
          <div className={styles.miniStats}>
            <div className={styles.miniStat}>
              <span className={styles.miniStatLabel}>Đơn đã tạo</span>
              <span className={styles.miniStatVal}>{metrics.reservations.created}</span>
            </div>
            <div className={styles.miniStat}>
              <span className={styles.miniStatLabel}>Hoàn tất</span>
              <span className={styles.miniStatVal}>{metrics.reservations.completed}</span>
            </div>
            <div className={styles.miniStat}>
              <span className={styles.miniStatLabel}>Đã hủy</span>
              <span className={styles.miniStatVal}>{metrics.reservations.cancelled}</span>
            </div>
            <div className={styles.miniStat}>
              <span className={styles.miniStatLabel}>Hết giờ</span>
              <span className={styles.miniStatVal}>{metrics.reservations.expired}</span>
            </div>
          </div>
        </article>

        {/* 3. Tỷ lệ tin hết hạn còn suất */}
        <article className={styles.kpiCard}>
          <h2 className={styles.kpiLabel}>Tỷ lệ tin hết hạn còn suất</h2>
          <p className={`${styles.kpiValue} ${styles.kpiValueOrange}`}>
            {metrics.listings.published > 0 ? formatPercent(metrics.listingExpiredRate) : "—"}
          </p>
          <div className={styles.progressTrack} aria-hidden="true">
            <div
              className={styles.progressBarOrange}
              style={{ width: `${Math.min(100, Math.round(metrics.listingExpiredRate * 100))}%` }}
            />
          </div>
          <div className={styles.miniStats}>
            <div className={styles.miniStat}>
              <span className={styles.miniStatLabel}>Tin đã đăng</span>
              <span className={styles.miniStatVal}>{metrics.listings.published}</span>
            </div>
            <div className={styles.miniStat}>
              <span className={styles.miniStatLabel}>Hết hạn còn suất</span>
              <span className={styles.miniStatVal}>{metrics.listings.expiredWithStock}</span>
            </div>
          </div>
        </article>

        {/* 4. Mức giảm giá thực tế */}
        <article className={styles.kpiCard}>
          <h2 className={styles.kpiLabel}>Mức giảm giá thực tế</h2>
          <p className={`${styles.kpiValue} ${styles.kpiValueSky}`}>
            {metrics.discount.samples > 0 ? formatPercent(metrics.discount.avgRate) : "—"}
          </p>
          <div className={styles.progressTrack} aria-hidden="true">
            <div
              className={styles.progressBarSky}
              style={{ width: `${Math.min(100, Math.round(metrics.discount.avgRate * 100))}%` }}
            />
          </div>
          <p className={styles.kpiHint}>
            Cỡ mẫu: <b>{metrics.discount.samples}</b> đơn hoàn tất có giá gốc tham chiếu.
          </p>
        </article>
      </section>

      {/* 5. Báo cáo & an toàn */}
      <section className={styles.sectionCard} aria-label="Báo cáo và an toàn">
        <h2 className={styles.sectionTitle}>Báo cáo &amp; an toàn</h2>

        <div className={styles.safetySummaryGrid}>
          <div className={styles.miniStat}>
            <span className={styles.miniStatLabel}>Tổng báo cáo</span>
            <span className={styles.miniStatVal}>{metrics.reports.total}</span>
          </div>
          <div className={styles.miniStat}>
            <span className={styles.miniStatLabel}>Đang mở / chờ xử lý</span>
            <span className={styles.miniStatVal} style={{ color: metrics.reports.open > 0 ? "var(--color-alert)" : undefined }}>
              {metrics.reports.open}
            </span>
          </div>
          <div className={styles.miniStat}>
            <span className={styles.miniStatLabel}>Thời gian xử lý trung vị</span>
            <span className={styles.miniStatVal}>{formatHours(metrics.reports.medianHandlingHours)}</span>
          </div>
          <div className={styles.miniStat}>
            <span className={styles.miniStatLabel}>Tin bị khóa từ báo cáo</span>
            <span className={styles.miniStatVal}>{blockedFromReports}</span>
          </div>
        </div>

        <div className={styles.breakdownGrid}>
          <div className={styles.breakdownBox}>
            <h3 className={styles.breakdownHeading}>Phân loại báo cáo (byType)</h3>
            {REPORT_TYPES.map((type) => {
              const count = metrics.reports.byType[type] ?? 0;
              const pct = count > 0 ? Math.round((count / maxReportTypeCount) * 100) : 0;
              return (
                <div key={type} className={styles.breakdownRow}>
                  <div className={styles.breakdownRowTop}>
                    <span>{REPORT_TYPE_LABEL[type]}</span>
                    <span className={styles.breakdownCount}>{count}</span>
                  </div>
                  <div className={styles.progressTrack} aria-hidden="true">
                    <div
                      className={type === "UNSAFE_FOOD" ? styles.progressBarOrange : styles.progressBarSky}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className={styles.breakdownBox}>
            <h3 className={styles.breakdownHeading}>Hướng xử lý (byAction)</h3>
            {REPORT_ACTIONS.map((action) => {
              const count = metrics.reports.byAction[action] ?? 0;
              const pct = count > 0 ? Math.round((count / maxReportActionCount) * 100) : 0;
              return (
                <div key={action} className={styles.breakdownRow}>
                  <div className={styles.breakdownRowTop}>
                    <span>{REPORT_ACTION_LABEL[action]}</span>
                    <span className={styles.breakdownCount}>{count}</span>
                  </div>
                  <div className={styles.progressTrack} aria-hidden="true">
                    <div className={styles.progressBarMint} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <Notice>
        <p>
          Các chỉ số được tính trực tiếp từ lịch sử giao dịch và báo cáo trong kỳ. Dữ liệu nền về thất thoát thực phẩm
          được thu thập độc lập ngoài ứng dụng.
        </p>
      </Notice>
    </>
  );
}
