import type { ApiClient } from "./client";
import type { AppConfig, Envelope, ListEnvelope, ListingCard, ListingDetail, ListingSearchParams, MapPin } from "@/lib/contract/types";

/** Typed wrappers per contract v1.1 endpoint ID. Add endpoints here as milestones need them. */
export function endpoints(api: ApiClient) {
  return {
    /** SYS-2 */
    getConfig: () => api.request<Envelope<AppConfig>>("GET", "/config", { auth: false }).then((r) => r.data),

    /** LIST-1 (view=list) */
    searchListings: (params: Omit<ListingSearchParams, "view">) =>
      api.request<ListEnvelope<ListingCard>>("GET", "/listings", { query: { ...params, view: "list" } }),

    /** LIST-1 (view=map) */
    mapPins: (params: Omit<ListingSearchParams, "view" | "cursor" | "limit">) =>
      api.request<{ data: MapPin[] }>("GET", "/listings", { query: { ...params, view: "map" } }).then((r) => r.data),

    /** LIST-2 */
    getListing: (listingId: string) =>
      api.request<Envelope<ListingDetail>>("GET", `/listings/${encodeURIComponent(listingId)}`).then((r) => r.data),
  };
}

export type Endpoints = ReturnType<typeof endpoints>;
