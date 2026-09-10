"use client";
import { useRef, useState, type FormEvent } from "react";
import { CREATOR_BUDGETS, CREATOR_VOLUMES, joinCreatorWaitlist, type CreatorSignup } from "@/lib/creatorWaitlist";

export function CreatorWaitlistForm() {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const values = new FormData(event.currentTarget);
    lock.current = true; setBusy(true); setError(null);
    try {
      await joinCreatorWaitlist({
        email:String(values.get("email") || ""), instagram:String(values.get("instagram") || ""),
        monthly_budget:values.get("monthly_budget") as CreatorSignup["monthly_budget"],
        monthly_variants:values.get("monthly_variants") as CreatorSignup["monthly_variants"],
        use_case:String(values.get("use_case") || ""), website:String(values.get("website") || ""), consent:true,
      });
      setSent(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Please try again."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="creator-notice" id="waitlist" aria-labelledby="creator-heading">
    <div className="creator-intro">
      <span className="creator-eyebrow">For independent creators</span>
      <h2 id="creator-heading">Working solo?</h2>
      <p>We’re exploring a lighter plan for creators who don’t need a whole team’s output. Tell us what you’d make and what would fit your budget.</p>
      <p>Join the waitlist to help shape it. We’ll email you about creator-plan updates.</p>
      <small>Pricing, launch timing, and access haven’t been announced.</small>
    </div>
    {sent ? <div className="creator-success" role="status"><span aria-hidden="true">✓</span><h3>You’re on the waitlist.</h3><p>Thanks for helping shape a creator plan. Your preferences are saved, and we’ll email you when there’s an update.</p></div>
      : <form className="creator-form" onSubmit={submit}>
        <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" /></label>
        <label>Instagram <span>(optional)</span><input name="instagram" autoCapitalize="none" autoCorrect="off" maxLength={31} pattern="@?[A-Za-z0-9_.]{1,30}" placeholder="@yourhandle" /></label>
        <label>How many variants would you make each month?<select name="monthly_variants" required defaultValue=""><option value="" disabled>Choose an estimate</option>{Object.entries(CREATOR_VOLUMES).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>What monthly budget would feel comfortable? <span>(USD)</span><select name="monthly_budget" required defaultValue=""><option value="" disabled>Choose a range</option>{Object.entries(CREATOR_BUDGETS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>What would you use varimo for? <span>(optional)</span><textarea name="use_case" maxLength={1000} rows={3} placeholder="Testing reels, client work, growing my own account…" /></label>
        <div className="creator-honeypot" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
        <label className="creator-consent"><input type="checkbox" name="consent" required />Email me about the creator plan and availability.</label>
        {error && <p role="alert" className="creator-form-error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? "Joining…" : "Join the waitlist"}</button>
      </form>}
  </section>;
}
