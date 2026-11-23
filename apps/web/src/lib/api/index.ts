import { createMockFetch } from "@/mocks/mockFetch";
import { createApiClient } from "./client";
import { endpoints } from "./endpoints";
import { createTokenStore } from "./tokenStore";

/** Mock API is on unless NEXT_PUBLIC_API_MOCK=0 (see apps/web/.env.example). */
export const isMockApi = process.env.NEXT_PUBLIC_API_MOCK !== "0";

export const tokens = createTokenStore();

export const api = createApiClient({
  fetchImpl: isMockApi ? createMockFetch({ latencyMs: 150 }) : (...args) => fetch(...args),
  tokens,
});

export const lastbite = endpoints(api);
