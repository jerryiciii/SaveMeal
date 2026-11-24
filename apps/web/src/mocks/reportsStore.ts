import type { Report, ReportAction, ReportStatus } from "@/lib/api/trustEndpoints";
import type { Image, ReportType } from "@/lib/contract/types";
import type { Db, DbAccount } from "./db";

/**
 * In-memory / localStorage store for mock reports (kept separate from db.ts so
 * parallel workers do not conflict on db.ts).
 */
export type DbReport = {
  id: string;
  reporterId: string;
  type: ReportType;
  listingId: string | null;
  reservationId: string | null;
  reportedAccountId: string;
  description: string;
  imageIds: string[];
  status: ReportStatus;
  action: ReportAction | null;
  resolution: string | null;
  handledBy: string | null;
  handledAt: string | null;
  createdAt: string;
};

/** Optional extension fields persisted on DbAccount objects in mock mode. */
export type DbAccountTrustFields = DbAccount & {
  avatarImageId?: string | null;
  deletedAt?: string | null;
};

const REPORTS_STORAGE_KEY = "sm-mock-reports";
const MINUTE = 60_000;

let memoryReports: DbReport[] = [];

/** Default demo reports seeded alongside the mock DB so Admin screens have realistic data. */
export function seedDemoReports(now: Date = new Date()): DbReport[] {
  const t = now.getTime();
  return [
    {
      id: "rep-demo-1",
      reporterId: "acc-minh",
      type: "WRONG_INFO",
      listingId: "l-com-ga",
      reservationId: null,
      reportedAccountId: "acc-an-thuong",
      description: "Khung giờ nhận ghi 17:30 nhưng đến nơi quán đóng cửa sớm hơn 15 phút.",
      imageIds: [],
      status: "OPEN",
      action: null,
      resolution: null,
      handledBy: null,
      handledAt: null,
      createdAt: new Date(t - 90 * MINUTE).toISOString(),
    },
    {
      id: "rep-demo-2",
      reporterId: "acc-minh",
      type: "UNSAFE_FOOD",
      listingId: "l-banhmi-bo-toi",
      reservationId: null,
      reportedAccountId: "acc-bep-may",
      description: "Bao bì bị rách và có mùi lạ khi nhận hàng tại quầy.",
      imageIds: [],
      status: "RESOLVED",
      action: "WARNING",
      resolution: "Đã liên hệ nhắc nhở người bán kiểm tra bao bì và điều kiện bảo quản.",
      handledBy: "acc-admin",
      handledAt: new Date(t - 30 * MINUTE).toISOString(),
      createdAt: new Date(t - 240 * MINUTE).toISOString(),
    },
  ];
}

function browserStorage(): globalThis.Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadReports(): DbReport[] {
  const ls = browserStorage();
  if (ls) {
    try {
      const raw = ls.getItem(REPORTS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as DbReport[];
      }
    } catch {
      // fall through to empty list
    }
  }
  return memoryReports;
}

export function saveReports(reports: DbReport[]): void {
  memoryReports = reports;
  const ls = browserStorage();
  if (ls) {
    try {
      ls.setItem(REPORTS_STORAGE_KEY, JSON.stringify(reports));
    } catch {
      // ignore storage quota errors in mock mode
    }
  }
}

export function addReport(report: DbReport): DbReport {
  const next = [...loadReports(), report];
  saveReports(next);
  return report;
}

export function resetReports(): void {
  memoryReports = [];
  const ls = browserStorage();
  if (ls) {
    try {
      ls.removeItem(REPORTS_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

export function getAccountAvatarImageId(acc: DbAccount): string | null {
  return (acc as DbAccountTrustFields).avatarImageId ?? null;
}

export function setAccountAvatarImageId(acc: DbAccount, imageId: string | null): void {
  (acc as DbAccountTrustFields).avatarImageId = imageId;
}

export function getAccountDeletedAt(acc: DbAccount): string | null {
  return (acc as DbAccountTrustFields).deletedAt ?? null;
}

export function markAccountDeleted(acc: DbAccount, isoNow: string): void {
  (acc as DbAccountTrustFields).deletedAt = isoNow;
}

function imageOf(db: Db, id: string): Image | null {
  const img = db.images.find((i) => i.id === id);
  return img ? { id: img.id, url: img.url, width: img.width, height: img.height } : null;
}

/** Converts a stored DbReport into the API contract `Report` DTO. */
export function toReportView(db: Db, r: DbReport, includeReporter = false): Report {
  const reporter = includeReporter ? db.accounts.find((a) => a.id === r.reporterId) : undefined;
  return {
    id: r.id,
    type: r.type,
    description: r.description,
    images: r.imageIds.map((id) => imageOf(db, id)).filter((x): x is Image => x !== null),
    listingId: r.listingId,
    reservationId: r.reservationId,
    reportedAccountId: r.reportedAccountId,
    status: r.status,
    action: r.action,
    resolution: r.resolution,
    createdAt: r.createdAt,
    handledAt: r.handledAt,
    reporter:
      includeReporter && reporter
        ? { id: reporter.id, displayName: reporter.displayName ?? "Người dùng SaveMeal" }
        : null,
  };
}
