import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

const FORWARD_REQUEST_HEADERS = [
  "cookie",
  "authorization",
  "content-type",
  "accept",
  "idempotency-key",
  "user-agent",
  "x-forwarded-for",
  "x-real-ip",
] as const;

const FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "x-request-id",
  "cache-control",
  "retry-after",
] as const;

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function stripCookieDomain(setCookie: string): string {
  return setCookie.replace(/;\s*domain=[^;]*/gi, "");
}

function getAllSetCookies(headers: Headers): string[] {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

async function proxyRequest(req: NextRequest, context: RouteContext): Promise<Response> {
  if (process.env.NEXT_PUBLIC_API_MOCK !== "0") {
    return Response.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "API proxy is disabled when NEXT_PUBLIC_API_MOCK is not 0.",
        },
      },
      { status: 404 },
    );
  }

  const { path } = await context.params;
  const apiOrigin = (process.env.API_ORIGIN ?? "http://localhost:4000").replace(/\/+$/, "");
  const targetUrl = `${apiOrigin}/api/v1/${path.join("/")}${req.nextUrl.search}`;

  const forwardHeaders = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) {
      forwardHeaders.set(name, value);
    }
  }

  let body: ArrayBuffer | undefined;
  if (METHODS_WITH_BODY.has(req.method.toUpperCase())) {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > 0) {
      body = buf;
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body,
      redirect: "manual",
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          message: "Không thể kết nối tới máy chủ SaveMeal.",
        },
      },
      { status: 502 },
    );
  }

  const resHeaders = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) {
      resHeaders.set(name, value);
    }
  }

  for (const cookie of getAllSetCookies(upstream.headers)) {
    resHeaders.append("set-cookie", stripCookieDomain(cookie));
  }

  const isEmptyStatus = upstream.status === 204 || upstream.status === 304;
  return new Response(isEmptyStatus ? null : upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
}

export async function GET(req: NextRequest, context: RouteContext) {
  return proxyRequest(req, context);
}

export async function POST(req: NextRequest, context: RouteContext) {
  return proxyRequest(req, context);
}

export async function PUT(req: NextRequest, context: RouteContext) {
  return proxyRequest(req, context);
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  return proxyRequest(req, context);
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  return proxyRequest(req, context);
}

export async function OPTIONS(req: NextRequest, context: RouteContext) {
  return proxyRequest(req, context);
}
