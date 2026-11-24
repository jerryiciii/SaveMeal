import { api } from "./index";
import type { ApiClient } from "./client";
import type { Envelope, Image, Me, PickupLocation, ReportType, SellerType } from "@/lib/contract/types";

export const REPORT_TYPES = ["WRONG_INFO", "UNSAFE_FOOD", "NOT_RECEIVED", "SELLER_ABSENT", "OTHER"] as const;

export type ReportStatus = "OPEN" | "IN_REVIEW" | "RESOLVED" | "DISMISSED";
export type ReportAction = "NONE" | "WARNING" | "LISTING_BLOCKED" | "ACCOUNT_SUSPENDED";

/** Mirror of docs/API_CONTRACT.md §1 `Report` (v1.1). */
export type Report = {
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

/** Request body for REP-1 (`POST /reports`). */
export type CreateReportInput = {
  type: ReportType;
  listingId?: string | null;
  reservationId?: string | null;
  accountId?: string | null;
  description: string;
  imageIds?: string[];
};

/** Request body for ME-2 (`PATCH /me`) including `avatarImageId`. */
export type UpdateProfilePatch = {
  displayName?: string;
  avatarImageId?: string | null;
  seller?: {
    name?: string | null;
    type?: SellerType | null;
    defaultPickup?: PickupLocation | null;
  };
};

export const DELETE_ACCOUNT_CONFIRM = "XOA TAI KHOAN" as const;

const data = <T>(p: Promise<Envelope<T>>) => p.then((r) => r.data);

/** Factory for trust & settings endpoints (contract v1.1: REP-1, ME-2, ME-3, AUTH-4). */
export function trustEndpoints(client: ApiClient) {
  return {
    /** REP-1 · POST /reports */
    createReport: (input: CreateReportInput) =>
      data(
        client.request<Envelope<Report>>("POST", "/reports", {
          body: {
            type: input.type,
            listingId: input.listingId ?? null,
            reservationId: input.reservationId ?? null,
            accountId: input.accountId ?? null,
            description: input.description,
            imageIds: input.imageIds ?? [],
          },
        }),
      ),

    /** ME-2 · PATCH /me (supports displayName, avatarImageId, and optional seller setup) */
    updateProfile: (patch: UpdateProfilePatch) =>
      data(client.request<Envelope<Me>>("PATCH", "/me", { body: patch })),

    /** ME-3 · DELETE /me */
    deleteMe: (confirm: string = DELETE_ACCOUNT_CONFIRM) =>
      client.request<void>("DELETE", "/me", { body: { confirm } }),

    /** AUTH-4 · POST /auth/logout with optional allDevices flag */
    logoutAll: (allDevices = true) =>
      client.request<void>("POST", "/auth/logout", { body: { allDevices } }),
  };
}

const defaultTrust = trustEndpoints(api);

export const createReport = defaultTrust.createReport;
export const updateProfile = defaultTrust.updateProfile;
export const deleteMe = defaultTrust.deleteMe;
export const logoutAll = defaultTrust.logoutAll;
