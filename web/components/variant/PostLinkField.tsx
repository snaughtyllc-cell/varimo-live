"use client";
import { useEffect, useState } from "react";
import { VariantOut } from "@/lib/types";
import { setPostUrl } from "@/lib/api";
import {
  hostFromPostUrl,
  postLinkClearLabel,
  postLinkHint,
  postLinkLabel,
  postLinkOpenLabel,
  postLinkSaveLabel,
} from "@/lib/postUrl";

interface PostLinkFieldProps {
  sourceId: string;
  variant: VariantOut;
  onSaved: () => void;
}

export function PostLinkField({ sourceId, variant, onSaved }: PostLinkFieldProps) {
  const saved = variant.post_url?.trim() || "";
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  async function save(url: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setPostUrl(sourceId, variant.index, url);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 9,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-space-grotesk), monospace",
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--color-violet)",
          }}
        >
          {postLinkLabel()}
        </div>
        <div
          style={{
            fontFamily: "var(--font-space-grotesk), monospace",
            fontSize: 10,
            color: "var(--color-muted2)",
          }}
        >
          Optional
        </div>
      </div>

      {saved && (
        <a
          href={saved}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            marginBottom: 8,
            fontSize: 12.5,
            fontWeight: 700,
            color: "var(--color-violet)",
            wordBreak: "break-all",
          }}
        >
          {postLinkOpenLabel()} · {hostFromPostUrl(saved)}
        </a>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="instagram.com/reel/…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
          aria-label={postLinkLabel()}
          style={{
            flex: "1 1 160px",
            minWidth: 0,
            height: 44,
            background: "#fff",
            color: "var(--color-text)",
            border: "1px solid var(--color-line)",
            borderRadius: 11,
            padding: "0 13px",
            fontSize: 13.5,
          }}
        />
        <button
          type="button"
          onClick={() => save(draft)}
          disabled={busy}
          style={{
            fontSize: 13,
            fontWeight: 600,
            height: 44,
            padding: "0 16px",
            borderRadius: 11,
            background: "var(--ink)",
            border: "none",
            color: busy ? "var(--color-muted2)" : "#f6fbfb",
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Saving…" : postLinkSaveLabel()}
        </button>
        {saved && (
          <button
            type="button"
            onClick={() => {
              setDraft("");
              void save("");
            }}
            disabled={busy}
            style={{
              fontSize: 13,
              fontWeight: 600,
              height: 44,
              padding: "0 14px",
              borderRadius: 11,
              background: "transparent",
              border: "1px solid var(--color-line)",
              color: "var(--color-muted)",
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {postLinkClearLabel()}
          </button>
        )}
      </div>

      <div
        style={{
          marginTop: 9,
          fontFamily: "var(--font-space-grotesk), monospace",
          fontSize: 10,
          lineHeight: 1.5,
          letterSpacing: "0.02em",
          color: "var(--color-muted2)",
        }}
      >
        {postLinkHint()}
      </div>

      {error && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-red)" }}>{error}</div>
      )}
    </div>
  );
}
