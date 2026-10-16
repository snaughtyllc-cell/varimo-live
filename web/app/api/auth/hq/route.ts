import { NextRequest } from "next/server";
import { appendSetCookies } from "@/lib/proxySetCookie";

const UPSTREAM = process.env.API_PROXY_TARGET || "http://127.0.0.1:8000";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Proxy HQ SSO without dropping the session cookie or the admin-view clear. */
export async function POST(req: NextRequest) {
  const incoming = new URL(req.url);
  const body = await req.text();
  let res: Response;
  try {
    res = await fetch(`${UPSTREAM}/api/auth/hq`, {
      method: "POST",
      redirect: "manual",
      cache: "no-store",
      headers: {
        cookie: req.headers.get("cookie") ?? "",
        host: incoming.host,
        "content-type": req.headers.get("content-type") ?? "application/json",
        "x-forwarded-proto": incoming.protocol.replace(":", ""),
        "x-forwarded-host": incoming.host,
      },
      body,
    });
  } catch {
    return new Response("upstream unavailable", { status: 502 });
  }

  const headers = new Headers();
  const contentType = res.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  appendSetCookies(res.headers, headers);
  // 204/205/304 must not carry a body: Response() throws on one, which dropped the session cookie.
  const bodyless = res.status === 204 || res.status === 205 || res.status === 304;
  return new Response(bodyless ? null : await res.text(), { status: res.status, headers });
}
