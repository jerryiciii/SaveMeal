import type { ApiClient } from "./client";
import { api } from "./index";
import type { Envelope, ListingOwnerView, SellerProfile } from "@/lib/contract/types";

export const WITHDRAW_REASONS = ["STORAGE_NOT_OK", "SOLD_ELSEWHERE", "OTHER"] as const;
export type WithdrawReason = (typeof WITHDRAW_REASONS)[number];

const data = <T>(p: Promise<Envelope<T>>) => p.then((r) => r.data);

/**
 * Typed API wrappers for Seller Profile & Listing Management (docs/API_CONTRACT.md v1.1):
 * - SELLER-1: GET /sellers/{accountId}
 * - LIST-5:   DELETE /listings/{listingId}
 * - LIST-7:   POST /listings/{listingId}/withdraw
 * - IMG-2:    DELETE /images/{imageId}
 */
export function sellerEndpoints(client: ApiClient) {
  return {
    /** SELLER-1 · GET /sellers/{accountId} (PUBLIC) */
    getSellerProfile: (accountId: string) =>
      data(client.request<Envelope<SellerProfile>>("GET", `/sellers/${encodeURIComponent(accountId)}`, { auth: false })),

    /** LIST-5 · DELETE /listings/{listingId} (OWNER, DRAFT only) */
    deleteDraftListing: (listingId: string) =>
      client.request<void>("DELETE", `/listings/${encodeURIComponent(listingId)}`),

    /** LIST-7 · POST /listings/{listingId}/withdraw (OWNER, DRAFT | PUBLISHED) */
    withdrawListing: (listingId: string, reason: WithdrawReason, note?: string | null) =>
      data(
        client.request<Envelope<ListingOwnerView>>("POST", `/listings/${encodeURIComponent(listingId)}/withdraw`, {
          body: { reason, note: note?.trim() ? note.trim() : null },
        }),
      ),

    /** IMG-2 · DELETE /images/{imageId} (uploader) */
    deleteImage: (imageId: string) =>
      client.request<void>("DELETE", `/images/${encodeURIComponent(imageId)}`),
  };
}

export type SellerEndpoints = ReturnType<typeof sellerEndpoints>;

export const sellerApi = sellerEndpoints(api);

export const { getSellerProfile, deleteDraftListing, withdrawListing, deleteImage } = sellerApi;
