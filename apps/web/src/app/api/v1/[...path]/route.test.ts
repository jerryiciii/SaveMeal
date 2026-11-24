import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "./route";

describe("/api/v1/[...path] proxy route", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_MOCK = "0";
    process.env.API_ORIGIN = "https://api.savemeal.thezah.space/";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it("returns 404 JSON error envelope when mock mode is enabled", async () => {
    process.env.NEXT_PUBLIC_API_MOCK = "1";
    const req = new NextRequest("https://savemeal.thezah.space/api/v1/auth/refresh", {
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ path: ["auth", "refresh"] }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("strips Domain attributes from multiple Set-Cookie headers and forwards cookies & headers", async () => {
    const upstreamHeaders = new Headers({
      "content-type": "application/json",
      "x-request-id": "req-123",
      "cache-control": "no-store",
    });
    upstreamHeaders.append(
      "set-cookie",
      "lb_rt=tok_123; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Lax; Domain=api.savemeal.thezah.space",
    );
    upstreamHeaders.append(
      "set-cookie",
      "lb_csrf=abc; Domain=.thezah.space; Path=/; SameSite=Lax",
    );

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accessToken: "at_1" }), {
        status: 200,
        headers: upstreamHeaders,
      }),
    );

    const req = new NextRequest("https://savemeal.thezah.space/api/v1/auth/refresh?foo=bar", {
      method: "POST",
      headers: {
        cookie: "lb_rt=old_tok",
        authorization: "Bearer old_at",
        "content-type": "application/json",
        "idempotency-key": "idem-1",
      },
      body: JSON.stringify({ device: "ios" }),
    });

    const res = await POST(req, { params: Promise.resolve({ path: ["auth", "refresh"] }) });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe("https://api.savemeal.thezah.space/api/v1/auth/refresh?foo=bar");
    expect(calledInit?.method).toBe("POST");
    const sentHeaders = calledInit?.headers as Headers;
    expect(sentHeaders.get("cookie")).toBe("lb_rt=old_tok");
    expect(sentHeaders.get("authorization")).toBe("Bearer old_at");
    expect(sentHeaders.get("idempotency-key")).toBe("idem-1");
    expect(calledInit?.body).toBeInstanceOf(ArrayBuffer);

    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("req-123");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const cookies = res.headers.getSetCookie();
    expect(cookies).toEqual([
      "lb_rt=tok_123; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Lax",
      "lb_csrf=abc; Path=/; SameSite=Lax",
    ]);
    expect(await res.json()).toEqual({ accessToken: "at_1" });
  });

  it("preserves multipart/form-data boundary and omits empty body on DELETE", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "img_1" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const boundary = "----SaveMealBoundary7MA4YWxkTrZu0gW";
    const multipartReq = new NextRequest("https://savemeal.thezah.space/api/v1/images", {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      body: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\n\r\nIMG\r\n--${boundary}--`,
    });

    const uploadRes = await POST(multipartReq, { params: Promise.resolve({ path: ["images"] }) });
    expect(uploadRes.status).toBe(201);
    const uploadHeaders = fetchMock.mock.calls[0]![1]?.headers as Headers;
    expect(uploadHeaders.get("content-type")).toBe(`multipart/form-data; boundary=${boundary}`);

    const deleteReq = new NextRequest("https://savemeal.thezah.space/api/v1/listings/1", {
      method: "DELETE",
    });
    const deleteRes = await DELETE(deleteReq, {
      params: Promise.resolve({ path: ["listings", "1"] }),
    });
    expect(deleteRes.status).toBe(204);
    expect(fetchMock.mock.calls[1]![1]?.body).toBeUndefined();
  });

  it("returns 502 JSON error envelope when upstream fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const req = new NextRequest("https://savemeal.thezah.space/api/v1/me", { method: "GET" });

    const res = await GET(req, { params: Promise.resolve({ path: ["me"] }) });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("UPSTREAM_UNAVAILABLE");
  });
});
