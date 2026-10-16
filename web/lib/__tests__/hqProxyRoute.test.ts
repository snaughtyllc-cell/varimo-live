/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../../app/api/auth/hq/route";

describe("POST /api/auth/hq proxy", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("passes a 204 success through with the session cookie and no body (was a crash)", async () => {
    const upstream = new Headers();
    upstream.append("set-cookie", "vf_session=abc; Path=/; HttpOnly; SameSite=Lax");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204, headers: upstream })));
    const res = await POST(new NextRequest("https://www.varimo.io/api/auth/hq", { method: "POST", body: '{"token":"x"}', headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toContain("vf_session=abc");
  });
  it("keeps error bodies", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"detail":"Sign-in link is not valid."}', { status: 401, headers: { "content-type": "application/json" } })));
    const res = await POST(new NextRequest("https://www.varimo.io/api/auth/hq", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("not valid");
  });
});
