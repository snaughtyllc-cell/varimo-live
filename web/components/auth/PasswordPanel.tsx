"use client";
import { FormEvent, useState } from "react";
import { setStudioPassword } from "@/lib/api";
import { useAuthMe } from "@/lib/useAuthMe";

export function PasswordPanel() {
  const { data: me, mutate } = useAuthMe();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!me?.email) return null;
  const hasPassword = Boolean(me.has_password);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await setStudioPassword(password);
      setPassword("");
      setSaved(true);
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drive-card">
      <div className="drive-card__title">Studio password</div>
      <div className="drive-card__copy">
        {hasPassword
          ? "Replace the password for email sign-in. Google still works."
          : "Add a password so you can sign in with email instead of Google. Drive Connect stays separate."}
      </div>
      <form onSubmit={onSubmit} className="drive-step2-form drive-password-form">
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          aria-label="New studio password"
          autoComplete="new-password"
          className="drive-input drive-input--url"
        />
        <button
          type="submit"
          disabled={busy}
          className="drive-btn drive-btn--dark"
          style={{ cursor: busy ? "wait" : "pointer" }}
        >
          {busy ? "Saving…" : hasPassword ? "Change password" : "Add password"}
        </button>
      </form>
      {error && (
        <div role="alert" className="vf-alert drive-password-alert">
          {error}
        </div>
      )}
      {saved && (
        <div className="vf-alert vf-alert--ok drive-password-alert">
          Password saved.
        </div>
      )}
    </div>
  );
}
