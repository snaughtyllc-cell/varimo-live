import { NextRequest } from "next/server";

const UPSTREAM = process.env.API_PROXY_TARGET || "http://127.0.0.1:8000";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Proxy OAuth start/callback without following 302s or dropping ?code=&state=. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ step: string }> },
) {
  const { step } = await params;
  if (step !== "start" && step !== "callback") {
    return new Response("not found", { status: 404 });
  }
  const incoming = new URL(req.url);
  const upstream = `${UPSTREAM}/api/instagram/oauth/${step}${incoming.search}`;
  const proto = incoming.protocol.replace(":", "");
  let res: Response;
  try {
    res = await fetch(upstream, {
      redirect: "manual",
      headers: {
        cookie: req.headers.get("cookie") ?? "",
        host: incoming.host,
        "x-forwarded-proto": proto,
        "x-forwarded-host": incoming.host,
      },
    });
  } catch {
    return new Response("upstream unavailable", { status: 502 });
  }

  const headers = new Headers();
  const location = res.headers.get("location");
  if (location) headers.set("Location", location);
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) headers.set("Set-Cookie", setCookie);
  return new Response(null, { status: res.status, headers });
}
