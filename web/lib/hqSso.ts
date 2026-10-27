/** HQ handoff. The token stays in memory for this page load and is never written to the URL again. */

export const HQ_SSO_NEXT = "/studio";

const MISSING = "This sign-in link is missing. Open Varimo from HQ again.";
const OFF = "HQ sign-in is not turned on for Varimo yet.";
const FAILED = "Sign-in didn't complete. Open Varimo from HQ again.";
const UNREACHABLE = "Varimo didn't respond. Open Varimo from HQ again.";

let held: string | null = null;
let inflight: Promise<HqSsoResult> | null = null;
let inflightToken: string | null = null;

export type HqSsoResult = { ok: true; next?: string } | { ok: false; message: string };

export function resetHqSsoForTests(): void {
  held = null;
  inflight = null;
  inflightToken = null;
}

export function readHqSsoToken(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  const token = new URLSearchParams(raw).get("t");
  if (!token) return null;
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 4096 || /\s/.test(trimmed)) return null;
  return trimmed;
}

/** Read the fragment once, then drop it. A second call (React remount) returns the same token. */
export function takeHqSsoToken(hash: string, clearHash: () => void): string | null {
  if (held) return held;
  const token = readHqSsoToken(hash);
  clearHash();
  if (!token) return null;
  held = token;
  return held;
}

export function messageForHqSsoResponse(status: number, detail: string | null): string | null {
  if (status === 204) return null;
  if (status === 404) return OFF;
  if (detail && detail.length <= 120) return detail;
  return FAILED;
}

export function exchangeHqSso(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HqSsoResult> {
  if (inflight && inflightToken === token) return inflight;
  inflightToken = token;
  inflight = (async () => {
    let res: Response;
    try {
      res = await fetchImpl("/api/auth/hq", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
    } catch {
      return { ok: false, message: UNREACHABLE };
    }
    if (res.status === 200) {
      try {
        const data = await res.json() as { next?: unknown };
        if (typeof data.next === "string" && /^\/studio\?handoff=[a-f0-9]{64}$/.test(data.next)) {
          return { ok: true, next: data.next };
        }
      } catch { /* Invalid target response must not redirect. */ }
      return { ok: false, message: FAILED };
    }
    let detail: string | null = null;
    if (res.status !== 204) {
      try {
        const data = (await res.json()) as { detail?: unknown };
        detail = typeof data.detail === "string" ? data.detail : null;
      } catch {
        detail = null;
      }
    }
    const message = messageForHqSsoResponse(res.status, detail);
    if (message === null) return { ok: true };
    return { ok: false, message };
  })();
  return inflight;
}

export const HQ_SSO_MISSING = MISSING;
