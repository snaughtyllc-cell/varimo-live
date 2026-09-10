"use client";
import { FormEvent, useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { listBillingPlans, startBillingCheckout } from "@/lib/api";
import type { BillingPlan } from "@/lib/types";

const fieldStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "#f3f8f9",
  border: "1px solid #c9dde0",
  borderRadius: 10,
  padding: "11px 12px",
  fontSize: 14,
  color: "var(--color-text)",
  outline: "none",
};

export function PricingCard({ emailPrefill = "" }: { emailPrefill?: string }) {
  const [email, setEmail] = useState(emailPrefill);
  const [plan, setPlan] = useState<BillingPlan | null>(null);
  const [configured, setConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listBillingPlans()
      .then((out) => {
        if (cancelled) return;
        setConfigured(out.configured);
        setPlan(out.plans[0] ?? null);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load pricing.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await startBillingCheckout(email, plan?.id || "agency");
      window.location.assign(out.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
      setBusy(false);
    }
  }

  const hours = plan?.included_fast_hours ?? 90;
  const overage = plan?.overage_usd_per_hour ?? 0.75;
  const price = plan?.price_usd ?? 200;
  const packMinutes = plan?.typical_fast20_minutes ?? 10;
  const packs = plan?.typical_fast20_packs ?? 540;
  const copies = plan?.typical_fast20_copies ?? 10800;
  const copiesLabel = copies.toLocaleString("en-US");

  return (
    <>
      <p style={{ fontSize: 13, color: "var(--color-muted)", lineHeight: 1.5, margin: "0 0 12px" }}>
        ${price}/month Agency. {hours} Fast worker-hours included each period, then{" "}
        ${overage.toFixed(2)}/hr. Not a hard stop — you keep generating, and extra Fast
        time is usage, not a fake unlimited cap.
      </p>
      <p style={{ fontSize: 13, color: "var(--color-text)", lineHeight: 1.5, margin: "0 0 18px" }}>
        A typical talking-head Fast 20-pack uses about {packMinutes} minutes of Fast
        time. {hours} hours is on the order of {packs} packs — about {copiesLabel} copies —
        in a 30-day period. Heavier clips and a cold worker take longer. Typical, not a
        promise. Analytics coming soon.
      </p>
      {!configured && (
        <div
          role="status"
          style={{
            fontSize: 13,
            color: "#8e6119",
            background: "#fff8eb",
            border: "1px solid #efdfbd",
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 16,
            lineHeight: 1.45,
          }}
        >
          Checkout is not connected on this Studio yet. You can still sign in with an invite.
        </div>
      )}
      {error && (
        <div
          role="alert"
          style={{
            fontSize: 13,
            color: "#8e6119",
            background: "#fff8eb",
            border: "1px solid #efdfbd",
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 16,
            lineHeight: 1.45,
          }}
        >
          {error}
        </div>
      )}
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--color-muted)" }}>
          Work email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Work email"
            style={{ ...fieldStyle, marginTop: 6 }}
          />
        </label>
        <button
          type="submit"
          disabled={busy || !configured}
          style={{
            marginTop: 6,
            fontSize: 14,
            fontWeight: 700,
            color: "#fff",
            background: "#172124",
            border: "none",
            padding: "12px 16px",
            borderRadius: 10,
            cursor: busy ? "wait" : !configured ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Redirecting to checkout…" : `Subscribe — $${price}/month`}
        </button>
      </form>
      <p style={{ fontSize: 12.5, color: "var(--color-muted)", lineHeight: 1.5, margin: "16px 0 0" }}>
        After Stripe confirms payment you land on sign-in with this email. First password
        creates your studio — nobody has to paste you in.{" "}
        <Link href="/login" style={{ color: "var(--color-text)", fontWeight: 600 }}>
          Already paid? Sign in
        </Link>
      </p>
    </>
  );
}
