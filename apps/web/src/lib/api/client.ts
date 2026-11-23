import { ApiError, isErrorBody } from "@/lib/contract/errors";
import type { TokenStore } from "./tokenStore";

export type QueryValue = string | number | boolean | undefined | null | readonly (string | number)[];

export type RequestOptions = {
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Required by RES-1; optional elsewhere (contract §0). */
  idempotencyKey?: string;
  /** Set false for PUBLIC calls that must not trigger a token refresh. */
  auth?: boolean;
  signal?: AbortSignal;
};

export type ApiClient = {
  request<T>(method: string, path: string, options?: RequestOptions): Promise<T>;
};

export type ApiClientConfig = {
  baseUrl?: string;
  fetchImpl: typeof fetch;
  tokens: TokenStore;
};

export function buildQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(","));
    } else {
      params.set(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toApiError(res: Response, body: unknown): ApiError {
  if (isErrorBody(body)) {
    const { code, message, details, requestId } = body.error;
    return new ApiError(res.status, code, message, details, requestId ?? res.headers.get("X-Request-Id") ?? undefined);
  }
  return new ApiError(res.status, "INTERNAL", "Đã có lỗi xảy ra. Vui lòng thử lại.");
}

/**
 * Thin fetch wrapper for `/api/v1`:
 * - parses the contract error envelope into ApiError
 * - on 401 TOKEN_EXPIRED calls AUTH-3 once (shared across concurrent calls) and retries once
 */
export function createApiClient({ baseUrl = "/api/v1", fetchImpl, tokens }: ApiClientConfig): ApiClient {
  let refreshing: Promise<boolean> | null = null;

  async function refresh(): Promise<boolean> {
    refreshing ??= (async () => {
      try {
        const res = await fetchImpl(`${baseUrl}/auth/refresh`, { method: "POST", credentials: "include" });
        if (!res.ok) {
          tokens.set(null);
          return false;
        }
        const body = (await parseBody(res)) as { data?: { accessToken?: string } } | undefined;
        const token = body?.data?.accessToken ?? null;
        tokens.set(token);
        return token !== null;
      } catch {
        return false;
      } finally {
        queueMicrotask(() => {
          refreshing = null;
        });
      }
    })();
    return refreshing;
  }

  async function send(method: string, path: string, options: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = tokens.get();
    if (token && options.auth !== false) headers.Authorization = `Bearer ${token}`;
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
    let body: BodyInit | undefined;
    if (options.body instanceof FormData) {
      body = options.body;
    } else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json; charset=utf-8";
      body = JSON.stringify(options.body);
    }
    try {
      return await fetchImpl(`${baseUrl}${path}${buildQuery(options.query)}`, {
        method,
        headers,
        body,
        credentials: "include",
        signal: options.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new ApiError(0, "NETWORK_ERROR", "Không có kết nối mạng. Vui lòng thử lại.");
    }
  }

  return {
    async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
      let res = await send(method, path, options);
      let body = await parseBody(res);
      if (res.status === 401 && isErrorBody(body) && body.error.code === "TOKEN_EXPIRED" && options.auth !== false) {
        if (await refresh()) {
          res = await send(method, path, options);
          body = await parseBody(res);
        }
      }
      if (!res.ok) throw toApiError(res, body);
      return body as T;
    },
  };
}
