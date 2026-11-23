import type { ApiClient } from "./client";
import type {
  AppConfig,
  BatchCard,
  BatchDetail,
  BatchSearchParams,
  Envelope,
  ListEnvelope,
  MapPin,
} from "@/lib/contract/types";

/** Typed wrappers per contract endpoint ID. Add endpoints here as milestones need them. */
export function endpoints(api: ApiClient) {
  return {
    /** SYS-2 */
    getConfig: () => api.request<Envelope<AppConfig>>("GET", "/config", { auth: false }).then((r) => r.data),

    /** BATCH-1 (view=list) */
    searchBatches: (params: Omit<BatchSearchParams, "view">) =>
      api.request<ListEnvelope<BatchCard>>("GET", "/batches", { query: { ...params, view: "list" } }),

    /** BATCH-1 (view=map) */
    mapPins: (params: Omit<BatchSearchParams, "view" | "cursor" | "limit">) =>
      api
        .request<{ data: MapPin[] }>("GET", "/batches", { query: { ...params, view: "map" } })
        .then((r) => r.data),

    /** BATCH-2 */
    getBatch: (batchId: string) =>
      api.request<Envelope<BatchDetail>>("GET", `/batches/${encodeURIComponent(batchId)}`).then((r) => r.data),
  };
}

export type Endpoints = ReturnType<typeof endpoints>;
