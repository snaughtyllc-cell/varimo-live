/**
 * @vitest-environment node
 */
import { Headers } from "undici";
import { describe, expect, it } from "vitest";
import { appendSetCookies, setCookieLines } from "../proxySetCookie";

describe("setCookieLines", () => {
  it("keeps the session cookie and the admin-view clear as separate lines", () => {
    const headers = new Headers();
    headers.append("set-cookie", "vf_session=abc; Path=/; HttpOnly; SameSite=Lax");
    headers.append("set-cookie", "vf_admin_view=; Path=/; Max-Age=0");
    const lines = setCookieLines(headers);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("vf_session=");
    expect(lines[1]).toContain("vf_admin_view=");

    const onto = new Headers();
    appendSetCookies(headers, onto);
    expect(onto.getSetCookie()).toHaveLength(2);
  });
});
