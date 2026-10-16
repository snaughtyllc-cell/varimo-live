import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exchangeHqSso,
  HQ_SSO_MISSING,
  HQ_SSO_NEXT,
  messageForHqSsoResponse,
  readHqSsoToken,
  resetHqSsoForTests,
  takeHqSsoToken,
} from "../hqSso";

afterEach(() => {
  resetHqSsoForTests();
});

describe("readHqSsoToken", () => {
  it("reads t from the fragment and ignores other fields", () => {
    expect(readHqSsoToken("#t=aaa.bbb.ccc")).toBe("aaa.bbb.ccc");
    expect(readHqSsoToken("#x=1&t=aaa.bbb.ccc")).toBe("aaa.bbb.ccc");
    expect(readHqSsoToken("")).toBeNull();
    expect(readHqSsoToken("#t=")).toBeNull();
  });
});

describe("takeHqSsoToken", () => {
  it("clears the hash and still returns the token after the fragment is gone", () => {
    let hash = "#t=h.p.s";
    const first = takeHqSsoToken(hash, () => {
      hash = "";
    });
    const second = takeHqSsoToken(hash, () => {
      hash = "wiped";
    });
    expect(first).toBe("h.p.s");
    expect(second).toBe("h.p.s");
    expect(hash).toBe("");
  });
});

describe("exchangeHqSso", () => {
  it("posts once and treats 204 as success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const [a, b] = await Promise.all([
      exchangeHqSso("h.p.s", fetchImpl),
      exchangeHqSso("h.p.s", fetchImpl),
    ]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/auth/hq");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ token: "h.p.s" });
    expect(HQ_SSO_NEXT).toBe("/studio");
  });

  it("shows the server message for an unknown email and hides a leaked token", async () => {
    const detail = "This email isn't invited. Ask the operator to add you.";
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail }), { status: 403, headers: { "content-type": "application/json" } }),
    );
    const result = await exchangeHqSso("h.p.s", fetchImpl);
    expect(result).toEqual({ ok: false, message: detail });

    const leaked = "e".repeat(180) + ".p.s";
    expect(messageForHqSsoResponse(401, leaked)).toBe("Sign-in didn't complete. Open Varimo from HQ again.");
    expect(messageForHqSsoResponse(404, detail)).toBe("HQ sign-in is not turned on for Varimo yet.");
    expect(HQ_SSO_MISSING).toMatch(/missing/i);
  });
});
