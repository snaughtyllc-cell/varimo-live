/** Copy every upstream Set-Cookie. `Headers.get` collapses them and drops the admin-view clear. */

export function setCookieLines(headers: Headers): string[] {
  const getter = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getter === "function") {
    const lines = getter.call(headers);
    if (lines.length > 0) return lines;
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

export function appendSetCookies(from: Headers, onto: Headers): void {
  for (const line of setCookieLines(from)) {
    onto.append("set-cookie", line);
  }
}
