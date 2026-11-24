import type { ApiClient } from "./client";
import { listingQueryKey, TtlCache } from "./ttlCache";
import type {
  AppConfig,
  BuyerCancelReason,
  DeclarationKey,
  Envelope,
  Image,
  ImagePurpose,
  ListEnvelope,
  ListingCard,
  ListingDetail,
  ListingOwnerView,
  ListingSearchParams,
  MapPin,
  Me,
  Payment,
  PickupLocation,
  PickupToken,
  Reservation,
  SellerType,
} from "@/lib/contract/types";

export type ListingInput = Partial<{
  title: string;
  description: string | null;
  category: ListingDetail["category"];
  imageIds: string[];
  origin: string;
  preparedAt: string;
  storage: ListingDetail["storage"];
  storageNote: string | null;
  ingredients: string | null;
  allergens: ListingDetail["allergens"];
  originalPrice: number | null;
  price: number;
  quantityTotal: number;
  pickupStart: string;
  pickupEnd: string;
  pickup: PickupLocation;
  bankQrImageId: string | null;
}>;

export type PickupLookup = {
  reservation: Reservation;
  amountToCollect: number;
  canConfirm: boolean;
  blockingReason: "TOO_EARLY" | "WINDOW_CLOSED" | "NOT_ACTIVE" | "TOKEN_EXPIRED" | "TOKEN_USED" | "LISTING_BLOCKED" | null;
};

export type PickupProof = { qrPayload: string } | { code: string };

const data = <T>(p: Promise<Envelope<T>>) => p.then((r) => r.data);

const CONFIG_TTL_MS = 10 * 60_000;
const LISTINGS_TTL_MS = 60_000;

/** Typed wrappers per contract v1.1 endpoint ID (MVP demo slice, DOMAIN §10). */
export function endpoints(api: ApiClient) {
  const configCache = new TtlCache<AppConfig>(CONFIG_TTL_MS, 1);
  const searchCache = new TtlCache<ListEnvelope<ListingCard>>(LISTINGS_TTL_MS, 40);
  const pinsCache = new TtlCache<MapPin[]>(LISTINGS_TTL_MS, 40);

  const invalidateListingCache = () => {
    searchCache.clear();
    pinsCache.clear();
  };

  return {
    /** Clear cached discovery/search results (called automatically after mutations). */
    invalidateListingCache,

    /** SYS-2 */
    peekConfig: () => configCache.get("config"),
    getConfig: (opts?: { cache?: boolean; force?: boolean }) => {
      const fetcher = () => data(api.request<Envelope<AppConfig>>("GET", "/config", { auth: false }));
      return opts?.cache ? configCache.getOrFetch("config", fetcher, opts.force) : fetcher();
    },

    /** AUTH-1 */
    requestOtp: (channel: "SMS" | "EMAIL", identifier: string) =>
      data(
        api.request<Envelope<{ requestId: string; expiresAt: string; resendAfterSec: number; codeLength: number }>>(
          "POST",
          "/auth/otp/request",
          { body: { channel, identifier }, auth: false },
        ),
      ),
    /** AUTH-2 */
    verifyOtp: (requestId: string, code: string) =>
      data(
        api.request<Envelope<{ accessToken: string; accessTokenExpiresAt: string; isNewUser: boolean; user: Me }>>(
          "POST",
          "/auth/otp/verify",
          { body: { requestId, code }, auth: false },
        ),
      ),
    /** AUTH-3 */
    refresh: () =>
      data(api.request<Envelope<{ accessToken: string; accessTokenExpiresAt: string }>>("POST", "/auth/refresh", { auth: false })),
    /** AUTH-4 */
    logout: () => api.request<void>("POST", "/auth/logout", { body: {} }),

    /** ME-1 */
    getMe: () => data(api.request<Envelope<Me>>("GET", "/me")),
    /** ME-2 */
    updateMe: (patch: {
      displayName?: string;
      avatarImageId?: string | null;
      seller?: {
        name?: string | null;
        type?: SellerType | null;
        defaultPickup?: PickupLocation | null;
        bankQrImageId?: string | null;
      };
    }) => data(api.request<Envelope<Me>>("PATCH", "/me", { body: patch })),

    /** IMG-1 */
    uploadImage: (file: Blob, purpose: ImagePurpose) => {
      const form = new FormData();
      form.set("file", file);
      form.set("purpose", purpose);
      return data(api.request<Envelope<Image>>("POST", "/images", { body: form }));
    },

    /** LIST-1 (view=list) */
    peekSearchListings: (params: Omit<ListingSearchParams, "view">) => searchCache.get(listingQueryKey(params)),
    searchListings: (params: Omit<ListingSearchParams, "view">, opts?: { cache?: boolean; force?: boolean }) => {
      const fetcher = () => api.request<ListEnvelope<ListingCard>>("GET", "/listings", { query: { ...params, view: "list" } });
      return opts?.cache ? searchCache.getOrFetch(listingQueryKey(params), fetcher, opts.force) : fetcher();
    },
    /** LIST-1 (view=map) */
    peekMapPins: (params: Omit<ListingSearchParams, "view" | "cursor" | "limit">) => pinsCache.get(listingQueryKey(params)),
    mapPins: (params: Omit<ListingSearchParams, "view" | "cursor" | "limit">, opts?: { cache?: boolean; force?: boolean }) => {
      const fetcher = () =>
        api.request<{ data: MapPin[] }>("GET", "/listings", { query: { ...params, view: "map" } }).then((r) => r.data);
      return opts?.cache ? pinsCache.getOrFetch(listingQueryKey(params), fetcher, opts.force) : fetcher();
    },
    /** LIST-2 (public detail, or owner view for the seller) */
    getListing: (listingId: string) =>
      data(api.request<Envelope<ListingDetail | ListingOwnerView>>("GET", `/listings/${encodeURIComponent(listingId)}`)),
    /** LIST-3 */
    createListing: (input: ListingInput & { title: string; category: ListingDetail["category"] }) =>
      data(api.request<Envelope<ListingOwnerView>>("POST", "/listings", { body: input })).then((res) => {
        invalidateListingCache();
        return res;
      }),
    /** LIST-4 */
    updateListing: (listingId: string, input: ListingInput) =>
      data(api.request<Envelope<ListingOwnerView>>("PATCH", `/listings/${encodeURIComponent(listingId)}`, { body: input })).then(
        (res) => {
          invalidateListingCache();
          return res;
        },
      ),
    /** LIST-6 */
    publishListing: (listingId: string, declaration: Record<DeclarationKey, boolean>) =>
      data(
        api.request<Envelope<ListingOwnerView>>("POST", `/listings/${encodeURIComponent(listingId)}/publish`, {
          body: { declaration },
        }),
      ).then((res) => {
        invalidateListingCache();
        return res;
      }),
    /** LIST-8 */
    myListings: (tab: "active" | "done") =>
      api.request<ListEnvelope<ListingOwnerView>>("GET", "/me/listings", { query: { tab } }),

    /** RES-1 */
    reserve: (listingId: string, quantity: number, idempotencyKey: string, holdMinutes?: number) =>
      data(
        api.request<Envelope<Reservation>>("POST", "/reservations", {
          body: holdMinutes !== undefined ? { listingId, quantity, holdMinutes } : { listingId, quantity },
          idempotencyKey,
        }),
      ).then((res) => {
        invalidateListingCache();
        return res;
      }),
    /** RES-2 */
    myReservations: (tab: "upcoming" | "history") =>
      api.request<ListEnvelope<Reservation>>("GET", "/me/reservations", { query: { tab } }),
    /** RES-3 */
    getReservation: (id: string) => data(api.request<Envelope<Reservation>>("GET", `/reservations/${encodeURIComponent(id)}`)),
    /** RES-4 */
    cancelReservation: (id: string, reason: BuyerCancelReason, note?: string) =>
      data(
        api.request<Envelope<Reservation>>("POST", `/reservations/${encodeURIComponent(id)}/cancel`, {
          body: { reason, note: note ?? null },
        }),
      ).then((res) => {
        invalidateListingCache();
        return res;
      }),
    /** RES-5 */
    mySales: (status: string = "RESERVED") => api.request<ListEnvelope<Reservation>>("GET", "/me/sales", { query: { status } }),
    /** RES-6 */
    newPickupToken: (id: string) =>
      data(api.request<Envelope<PickupToken>>("POST", `/reservations/${encodeURIComponent(id)}/pickup-token`, { body: {} })),
    /** RES-7 */
    lookupPickup: (proof: PickupProof) => data(api.request<Envelope<PickupLookup>>("POST", "/pickups/lookup", { body: proof })),
    /** RES-8 */
    confirmPickup: (reservationId: string, proof: PickupProof) =>
      data(
        api.request<Envelope<{ reservation: Reservation; listingRemaining: number }>>("POST", "/pickups/confirm", {
          body: { reservationId, ...proof },
        }),
      ).then((res) => {
        invalidateListingCache();
        return res;
      }),

    /** PAY-1 (v1.3 P2P) */
    getPayment: (reservationId: string) =>
      data(api.request<Envelope<Payment>>("GET", `/reservations/${encodeURIComponent(reservationId)}/payment`)),
    /** PAY-2 (v1.3 P2P) */
    submitPaymentProof: (reservationId: string, proofImageId: string) =>
      data(
        api.request<Envelope<Reservation>>("POST", `/reservations/${encodeURIComponent(reservationId)}/payment-proof`, {
          body: { proofImageId },
        }),
      ),
    /** PAY-3 (v1.3 P2P) */
    confirmPayment: (reservationId: string) =>
      data(
        api.request<Envelope<Reservation>>("POST", `/reservations/${encodeURIComponent(reservationId)}/payment/confirm`, {
          body: {},
        }),
      ),
    /** PAY-4 (v1.3 P2P) */
    rejectPayment: (reservationId: string, reason: string) =>
      data(
        api.request<Envelope<Reservation>>("POST", `/reservations/${encodeURIComponent(reservationId)}/payment/reject`, {
          body: { reason },
        }),
      ).then((res) => {
        invalidateListingCache();
        return res;
      }),
  };
}

export type Endpoints = ReturnType<typeof endpoints>;
