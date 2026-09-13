"use client";
import { FormEvent, useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { getBillingCheckoutSession, passwordLogin } from "@/lib/api";

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

export function LoginForm({
  oauthError,
  paid = false,
  emailPrefill = "",
  sessionId = "",
}: {
  oauthError?: string | null;
  paid?: boolean;
  emailPrefill?: string;
  sessionId?: string;
}) {
  const [email, setEmail] = useState(emailPrefill);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const afterPay = paid || Boolean(sessionId);

  useEffect(() => {
    if (!sessionId || emailPrefill) return;
    let cancelled = false;
    getBillingCheckoutSession(sessionId)
      .then((session) => {
        if (cancelled || !session.email) return;
        setEmail(session.email);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId, emailPrefill]);

  const oauthMessage =
    oauthError === "not_invited"
      ? afterPay
        ? "Payment is still landing. Wait a few seconds and sign in with the email you paid with."
        : "This email isn't on the platform yet. Subscribe on the pricing page, or ask the operator to add you."
      : oauthError === "oauth"
        ? "Google sign-in didn't complete. Try again."
        : null;
  const message = error || oauthMessage;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await passwordLogin(email, password, sessionId || undefined);
      window.location.assign("/studio");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
  }

  return (
    <>
      <p style={{ fontSize: 13, color: "var(--color-muted)", lineHeight: 1.5, margin: "0 0 22px" }}>
        {afterPay
          ? "Payment received. Use the email from Stripe checkout and choose a password. That signs you into Agency Studio."
          : "Use the email from checkout or an invite. First password sign-in sets that password."}{" "}
        {!afterPay && (
          <Link href="/pricing" style={{ color: "var(--color-text)", fontWeight: 600 }}>
            View pricing
          </Link>
        )}
      </p>
      {message && (
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
          {message}
        </div>
      )}
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--color-muted)" }}>
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email"
            style={{ ...fieldStyle, marginTop: 6 }}
          />
        </label>
        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--color-muted)" }}>
          {afterPay ? "Create a password" : "Password"}
          <input
            type="password"
            autoComplete={afterPay ? "new-password" : "current-password"}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-label={afterPay ? "Create a password" : "Password"}
            style={{ ...fieldStyle, marginTop: 6 }}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          style={{
            marginTop: 6,
            fontSize: 14,
            fontWeight: 700,
            color: "#fff",
            background: "#172124",
            border: "none",
            padding: "12px 16px",
            borderRadius: 10,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? (afterPay ? "Opening Studio…" : "Signing in…") : afterPay ? "Set password and enter" : "Sign in"}
        </button>
      </form>
      {!afterPay && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              margin: "18px 0",
              color: "#87989d",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            <span style={{ flex: 1, height: 1, background: "#d4e3e6" }} />
            or
            <span style={{ flex: 1, height: 1, background: "#d4e3e6" }} />
          </div>
          <Link
            href="/api/auth/google/start"
            style={{
              display: "block",
              textAlign: "center",
              textDecoration: "none",
              fontSize: 14,
              fontWeight: 700,
              color: "var(--color-text)",
              background: "#f3f8f9",
              border: "1px solid #c9dde0",
              padding: "12px 16px",
              borderRadius: 10,
            }}
          >
            Continue with Google
          </Link>
        </>
      )}
    </>
  );
}
