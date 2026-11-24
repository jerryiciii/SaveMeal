import type { ApiClient } from "./client";
import { api } from "./index";
import type {
  AccountStatus,
  Envelope,
  Image,
  ListEnvelope,
  ListingOwnerView,
  ListingStatus,
  PickupLocation,
  ReportType,
  Reservation,
  ReservationStatus,
  SellerType,
} from "@/lib/contract/types";

export const REPORT_STATUSES = ["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_ACTIONS = ["NONE", "WARNING", "LISTING_BLOCKED", "ACCOUNT_SUSPENDED"] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

export const REPORT_TYPES = ["WRONG_INFO", "UNSAFE_FOOD", "NOT_RECEIVED", "SELLER_ABSENT", "OTHER"] as const;

/** Contract §1 Report (admin view includes `reporter`). */
export type AdminReport = {
  id: string;
  type: ReportType;
  description: string;
  images: Image[];
  listingId: string | null;
  reservationId: string | null;
  reportedAccountId: string;
  status: ReportStatus;
  action: ReportAction | null;
  resolution: string | null;
  createdAt: string;
  handledAt: string | null;
  reporter: { id: string; displayName: string } | null;
};

/** Contract §9 ADM-6 account row (contact data is admin-only). */
export type AdminAccount = {
  id: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  status: AccountStatus;
  seller: {
    name: string | null;
    type: SellerType | null;
    verified: boolean;
    defaultPickup: PickupLocation | null;
  };
  createdAt: string;
};

/** Contract §9 ADM-9 / DOMAIN §8 KPIs. */
export type AdminMetrics = {
  portionsHandedOver: number;
  reservations: {
    created: number;
    completed: number;
    cancelled: number;
    expired: number;
  };
  completionRate: number;
  listings: {
    published: number;
    expiredWithStock: number;
  };
  listingExpiredRate: number;
  discount: {
    avgRate: number;
    samples: number;
  };
  reports: {
    total: number;
    byType: Partial<Record<ReportType, number>>;
    open: number;
    medianHandlingHours: number | null;
    byAction: Partial<Record<ReportAction, number>>;
  };
};

export type AdminReportsQuery = {
  status?: ReportStatus;
  type?: ReportType;
  cursor?: string;
  limit?: number;
};

export type UpdateReportInput = {
  status: "IN_REVIEW" | "RESOLVED" | "DISMISSED";
  action: ReportAction;
  resolution?: string | null;
  clearReview?: boolean;
};

export type AdminAccountsQuery = {
  q?: string;
  status?: AccountStatus;
  sellerOnly?: boolean;
  cursor?: string;
  limit?: number;
};

export type AdminListingsQuery = {
  status?: ListingStatus;
  underReview?: boolean;
  sellerId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
};

export type AdminReservationsQuery = {
  status?: ReservationStatus;
  sellerId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
};

export type AdminMetricsQuery = {
  from?: string;
  to?: string;
  sellerId?: string;
};

const unwrap = <T>(p: Promise<Envelope<T>>) => p.then((r) => r.data);

/** Typed wrappers for docs/API_CONTRACT.md §9 (ADM-1..9, MVP only). */
export function adminEndpoints(client: ApiClient) {
  return {
    /** ADM-1 · GET /admin/reports */
    listReports: (query: AdminReportsQuery = {}) =>
      client.request<ListEnvelope<AdminReport>>("GET", "/admin/reports", { query }),

    /** ADM-2 · PATCH /admin/reports/{reportId} */
    updateReport: (reportId: string, body: UpdateReportInput) =>
      unwrap(
        client.request<Envelope<AdminReport>>("PATCH", `/admin/reports/${encodeURIComponent(reportId)}`, {
          body: {
            status: body.status,
            action: body.action,
            resolution: body.resolution?.trim() ?? "",
            clearReview: body.clearReview ?? false,
          },
        }),
      ),

    /** ADM-3 · POST /admin/listings/{listingId}/block */
    blockListing: (listingId: string, reason: string) =>
      unwrap(
        client.request<Envelope<ListingOwnerView>>("POST", `/admin/listings/${encodeURIComponent(listingId)}/block`, {
          body: { reason },
        }),
      ),

    /** ADM-4 · POST /admin/accounts/{accountId}/status */
    setAccountStatus: (accountId: string, status: AccountStatus, reason: string) =>
      unwrap(
        client.request<Envelope<{ id: string; status: AccountStatus }>>(
          "POST",
          `/admin/accounts/${encodeURIComponent(accountId)}/status`,
          { body: { status, reason } },
        ),
      ),

    /** ADM-5 · POST /admin/accounts/{accountId}/seller-verification */
    setSellerVerification: (accountId: string, verified: boolean, note?: string | null) =>
      unwrap(
        client.request<Envelope<{ id: string; seller: AdminAccount["seller"] }>>(
          "POST",
          `/admin/accounts/${encodeURIComponent(accountId)}/seller-verification`,
          { body: { verified, note: note?.trim() ?? "" } },
        ),
      ),

    /** ADM-6 · GET /admin/accounts */
    listAccounts: (query: AdminAccountsQuery = {}) =>
      client.request<ListEnvelope<AdminAccount>>("GET", "/admin/accounts", { query }),

    /** ADM-7 · GET /admin/listings */
    listListings: (query: AdminListingsQuery = {}) =>
      client.request<ListEnvelope<ListingOwnerView>>("GET", "/admin/listings", { query }),

    /** ADM-8 · GET /admin/reservations */
    listReservations: (query: AdminReservationsQuery = {}) =>
      client.request<ListEnvelope<Reservation>>("GET", "/admin/reservations", { query }),

    /** ADM-9 · GET /admin/metrics */
    getMetrics: (query: AdminMetricsQuery = {}) =>
      unwrap(client.request<Envelope<AdminMetrics>>("GET", "/admin/metrics", { query })),
  };
}

export type AdminEndpoints = ReturnType<typeof adminEndpoints>;

export const adminApi = adminEndpoints(api);
