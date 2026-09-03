/** Instagram Insights copy + view formatting. Unknown (unlinked) is not zero. */

export const AMPLIFY_MORE_N = 20;

export const INSTAGRAM_OAUTH_START = "/api/instagram/oauth/start";

export const INSTAGRAM_TESTER_HINT =
  "Testers only — Jeff adds your @handle on the Meta app. Accept the invite in " +
  "Instagram → Settings → Apps and websites → Tester invites, then tap Connect. " +
  "Each Connect adds another account (main / trial / growth). Studio stores the token; " +
  "you do not paste the long Meta generate-token string.";

export function formatViews(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    const text = k >= 10 ? k.toFixed(0) : k.toFixed(1);
    return `${text.replace(/\.0$/, "")}k`;
  }
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function packViewsCopy(
  views: number | null | undefined,
  linked: number,
  copies: number,
): string | null {
  if (linked <= 0) return null;
  const label = views == null ? "views unknown" : `${formatViews(views)} views`;
  return `${label} · ${linked} of ${copies} linked`;
}

export function galleryViewsCopy(
  views: number | null | undefined,
  linked: number,
  accounts: number,
): string {
  if (accounts <= 0) {
    return "Connect Instagram testers on Analytics to pull Insights onto these packs.";
  }
  if (linked <= 0) {
    return `${accounts} account${accounts === 1 ? "" : "s"} connected. Sync to match Reels to copies.`;
  }
  const total = views == null ? "—" : formatViews(views);
  return `${total} views across ${linked} linked post${linked === 1 ? "" : "s"}`;
}

export function variantViewsCopy(views: number | null | undefined, linked: boolean): string | null {
  if (!linked) return null;
  if (views == null) return "linked";
  return formatViews(views);
}

export function insightSnapshotCopy(snapshot: {
  views?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saved?: number;
  fetched_at?: string;
} | null | undefined): string | null {
  if (!snapshot) return null;
  const parts: string[] = [];
  if (typeof snapshot.views === "number") parts.push(`${formatViews(snapshot.views)} views`);
  if (typeof snapshot.reach === "number") parts.push(`${formatViews(snapshot.reach)} reach`);
  if (typeof snapshot.likes === "number") parts.push(`${formatViews(snapshot.likes)} likes`);
  if (typeof snapshot.comments === "number") parts.push(`${formatViews(snapshot.comments)} comments`);
  if (typeof snapshot.shares === "number") parts.push(`${formatViews(snapshot.shares)} shares`);
  if (typeof snapshot.saved === "number") parts.push(`${formatViews(snapshot.saved)} saved`);
  if (parts.length === 0) return snapshot.fetched_at ? "Linked — Insights not in yet" : null;
  return parts.join(" · ");
}

export function igOauthErrorMessage(reason: string | null): string {
  switch (reason) {
    case "missing_code":
      return "Instagram came back without an auth code. Check the callback URL, then Connect again.";
    case "bad_state":
      return "Sign-in expired or was interrupted. Connect Instagram again.";
    case "exchange_failed":
      return "Instagram signed you in, but Studio could not store the token. Try Connect again.";
    case "access_denied":
      return "Instagram access was denied. Accept the tester invite, then Connect again.";
    default:
      return reason
        ? `Instagram sign-in failed (${reason}). Accept the tester invite, then Connect again.`
        : "Instagram sign-in failed. Accept the tester invite, then Connect again.";
  }
}

export function instagramTesterHint(): string {
  return INSTAGRAM_TESTER_HINT;
}

export function syncInsightsCopy(out: {
  matched: number;
  accounts: number;
  media?: number;
  unmatched?: unknown[];
  errors?: string[];
}): string {
  const accounts = out.accounts;
  const accountBit = `${accounts} account${accounts === 1 ? "" : "s"}`;
  if (out.errors && out.errors.length > 0) {
    return `Instagram sync hit an API error on ${accountBit}: ${out.errors[0]}`;
  }
  const media = out.media ?? 0;
  const leftover = Array.isArray(out.unmatched) ? out.unmatched.length : 0;
  if (media <= 0) {
    return (
      `Instagram returned 0 Reels across ${accountBit}. ` +
      "The @handle is connected, but Graph sent no posts. " +
      "Confirm the tester invite is accepted, the account is Professional, and it has Reels."
    );
  }
  let note = `Saw ${media} Reel${media === 1 ? "" : "s"}, matched ${out.matched} across ${accountBit}.`;
  if (leftover > 0) {
    note += ` ${leftover} unmatched Reel${leftover === 1 ? "" : "s"} live on the Unmatched tab (older posts stay there).`;
  }
  return note;
}

export function handleLabel(username: string): string {
  const t = username.trim().replace(/^@+/, "");
  return t ? `@${t}` : "";
}

export function unmatchedCaptionPreview(caption: string, max = 80): string {
  const t = caption.replace(/\s+/g, " ").trim();
  if (!t) return "No caption";
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function unmatchedTabCopy(count: number): string {
  if (count <= 0) {
    return "No leftover Reels. Sync insights after you post a Gallery pack.";
  }
  return (
    `${count} unmatched Reel${count === 1 ? "" : "s"}. ` +
    "Most of these are Instagram posts from before Varimo — they will not match a Gallery copy. " +
    "Pick the pack you posted, then link the Reel that belongs to it."
  );
}

export function suggestionButtonLabel(kind: string): string | null {
  return kind === "winner" ? `Generate ${AMPLIFY_MORE_N} more of this original` : null;
}

export function packSuggestionHint(kind: string | null | undefined): string | null {
  if (kind === "winner") return "Winner";
  if (kind === "quiet") return "Quiet — try a new original";
  return null;
}

export function copyPickerLabel(filename: string, index: number, linked = false): string {
  const n = String(index).padStart(2, "0");
  const base = `${filename} · copy ${n}`;
  return linked ? `${base} (linked)` : base;
}

export function copyOnlyLabel(index: number, linked = false): string {
  const n = String(index).padStart(2, "0");
  return linked ? `copy ${n} (linked)` : `copy ${n}`;
}

export function formatCopyPick(sourceId: string, index: number): string {
  return `${sourceId}:${index}`;
}

export function parseCopyPick(value: string): { source_id: string; index: number } | null {
  const i = value.lastIndexOf(":");
  if (i <= 0) return null;
  const source_id = value.slice(0, i);
  const index = Number(value.slice(i + 1));
  if (!source_id || !Number.isInteger(index)) return null;
  return { source_id, index };
}

export function packPickerOptions(
  sources: { source_id: string; filename: string }[],
): { value: string; label: string }[] {
  return sources.map((source) => ({ value: source.source_id, label: source.filename }));
}

export function copiesForPack(
  sources: {
    source_id: string;
    filename: string;
    variants: { index: number; ig_media_id?: string | null }[];
  }[],
  sourceId: string,
): { source_id: string; index: number; value: string; label: string }[] {
  const source = sources.find((row) => row.source_id === sourceId);
  if (!source) return [];
  return source.variants.map((variant) => ({
    source_id: source.source_id,
    index: variant.index,
    value: formatCopyPick(source.source_id, variant.index),
    label: copyOnlyLabel(variant.index, Boolean(variant.ig_media_id)),
  }));
}

export function copyPickerOptions(
  sources: {
    source_id: string;
    filename: string;
    variants: { index: number; ig_media_id?: string | null }[];
  }[],
): { source_id: string; index: number; value: string; label: string }[] {
  return sources.flatMap((source) =>
    source.variants.map((variant) => ({
      source_id: source.source_id,
      index: variant.index,
      value: formatCopyPick(source.source_id, variant.index),
      label: copyPickerLabel(source.filename, variant.index, Boolean(variant.ig_media_id)),
    })),
  );
}
