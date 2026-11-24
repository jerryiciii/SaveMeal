import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/contract/errors";
import { buildQuery, createApiClient } from "./client";
import { createTokenStore } from "./tokenStore";

function res(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("buildQuery", () => {
  it("drops empty values and joins arrays as csv", () => {
    expect(buildQuery({ a: 1, b: undefined, c: "", d: ["BAKERY", "DRINK"], e: [], f: false })).toBe(
      "?a=1&d=BAKERY%2CDRINK&f=false",
    );
    expect(buildQuery(undefined)).toBe("");
  });
});

describe("createApiClient", () => {
  it("sends bearer token, JSON body and Idempotency-Key", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(res(201, { data: { id: "r1" } }));
    const api = createApiClient({ fetchImpl, tokens: createTokenStore("tok") });
    const out = await api.request<{ data: { id: string } }>("POST", "/reservations", {
      body: { listingId: "l1", quantity: 1 },
      idempotencyKey: "key-1",
    });
    expect(out.data.id).toBe("r1");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("/api/v1/reservations");
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["Idempotency-Key"]).toBe("key-1");
    expect(init!.body).toBe(JSON.stringify({ listingId: "l1", quantity: 1 }));
  });

  it("maps the contract error envelope to ApiError", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        res(409, { error: { code: "BATCH_SOLD_OUT", message: "Món này vừa hết suất.", details: { quantityAvailable: 0 }, requestId: "req_1" } }),
      );
    const api = createApiClient({ fetchImpl, tokens: createTokenStore() });
    const err = await api.request("POST", "/reservations").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "BATCH_SOLD_OUT", requestId: "req_1", details: { quantityAvailable: 0 } });
  });

  it("refreshes once on TOKEN_EXPIRED and retries with the new token", async () => {
    const tokens = createTokenStore("old");
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith("/auth/refresh")) return res(200, { data: { accessToken: "new", accessTokenExpiresAt: "x" } });
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === "Bearer new" ? res(200, { data: { ok: true } }) : res(401, { error: { code: "TOKEN_EXPIRED", message: "x" } });
    });
    const api = createApiClient({ fetchImpl, tokens });
    const [a, b] = await Promise.all([api.request("GET", "/me"), api.request("GET", "/me")]);
    expect(a).toEqual({ data: { ok: true } });
    expect(b).toEqual({ data: { ok: true } });
    expect(tokens.get()).toBe("new");
    const refreshCalls = fetchImpl.mock.calls.filter(([u]) => String(u).endsWith("/auth/refresh"));
    expect(refreshCalls).toHaveLength(1);
  });

  it("clears the token and throws when refresh fails", async () => {
    const tokens = createTokenStore("old");
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith("/auth/refresh")
        ? res(401, { error: { code: "REFRESH_INVALID", message: "x" } })
        : res(401, { error: { code: "TOKEN_EXPIRED", message: "Phiên đã hết hạn." } }),
    );
    const api = createApiClient({ fetchImpl, tokens });
    await expect(api.request("GET", "/me")).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
    expect(tokens.get()).toBeNull();
  });

  it("turns network failures into NETWORK_ERROR", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    const api = createApiClient({ fetchImpl, tokens: createTokenStore() });
    await expect(api.request("GET", "/config", { auth: false })).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });
  });
});
