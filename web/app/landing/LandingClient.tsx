"use client";
/* eslint-disable @next/next/no-img-element -- Preserve original analytics screenshots without recompression. */
/* Adapted from the supplied Agency v2 desktop and mobile handoff. */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TimeSavingsCalculator } from "./TimeSavingsCalculator";
import { CreatorWaitlistForm } from "./CreatorWaitlistForm";
import { listBillingPlans, startBillingCheckout } from "@/lib/api";
import type { BillingPlan } from "@/lib/types";

export function LandingClient() {
 const checkoutLock = useRef(false);
 const [checkoutBusy, setCheckoutBusy] = useState(false);
 const [checkoutReady, setCheckoutReady] = useState(false);
 const [checkoutError, setCheckoutError] = useState<string | null>(null);
 const workflowRef = useRef<HTMLVideoElement>(null);
 const galleryRef = useRef<HTMLVideoElement>(null);
 const [playing, setPlaying] = useState(false);
 const [pricingError, setPricingError] = useState(false);
 const [plan, setPlan] = useState<BillingPlan | null>(null);
 useEffect(() => {
  let active = true;
  listBillingPlans().then(out => { if (active) { const agency = out.plans.find(p => p.id === "agency"); setPlan(agency ?? null); setCheckoutReady(out.configured && !!agency); setPricingError(!agency || !out.configured); } }).catch(() => { if (active) setPricingError(true); });
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const videos = [workflowRef.current, galleryRef.current];
  if (workflowRef.current) workflowRef.current.playbackRate = 5;
  const pause = () => { videos.forEach(v => v?.pause()); setPlaying(false); };
  if (!motion.matches) Promise.all(videos.map(v => v?.play())).then(() => { if (active) setPlaying(true); }).catch(pause);
  const change = () => { if (motion.matches) pause(); };
  motion.addEventListener("change", change);
  return () => { active = false; videos.forEach(v => v?.pause()); motion.removeEventListener("change", change); };
 }, []);
 async function buySubscription() {
  if (checkoutLock.current || !checkoutReady || !plan) return;
  checkoutLock.current = true;
  setCheckoutBusy(true);
  setCheckoutError(null);
  try {
   const checkout = await startBillingCheckout(undefined, plan.id);
   window.location.assign(checkout.url);
  } catch {
   setCheckoutError("Stripe checkout couldn’t open. Please try again.");
   checkoutLock.current = false;
   setCheckoutBusy(false);
  }
 }
 async function toggleVideo() {
  const videos = [workflowRef.current, galleryRef.current];
  if (playing) { videos.forEach(v => v?.pause()); setPlaying(false); }
  else { try { await Promise.all(videos.map(v => v?.play())); setPlaying(true); } catch { videos.forEach(v => v?.pause()); setPlaying(false); } }
 }
 function copy(text: string) {
  if (!plan && text.startsWith("Start generating")) return "View pricing";
  return text.replace(/\$200|\b90\b|0\.75|540|10,800/g, token => {
   if (!plan) return "—";
   return ({ "$200": `$${plan.price_usd}`, "90": String(plan.included_fast_hours), "0.75": plan.overage_usd_per_hour.toFixed(2), "540": String(plan.typical_fast20_packs ?? "—"), "10,800": plan.typical_fast20_copies?.toLocaleString("en-US") ?? "—" })[token] ?? token;
  });
 }
 return <div className="varimo-landing">{checkoutError && <div className="checkout-error" role="alert"><span>{checkoutError}</span><button type="button" onClick={() => setCheckoutError(null)} aria-label="Dismiss checkout error">×</button></div>}{pricingError && <p className="pricing-unavailable" role="status">Checkout is temporarily unavailable. Please try again shortly.</p>}<a className="landing-skip" href="#h-hero">Skip to content</a><header className="l0">
<nav className="l1" aria-label="Primary">
<div className="l2" aria-label="varimo" role="img">
<span >{"varimo"}</span>
<span className="l3" aria-hidden="true">{"o"}</span>
<span className="l4" aria-hidden="true">{"o"}</span>
</div>
<div className="l5">
<a className="l6" href="#demo">{"The app"}</a>
<a className="l8" href="#receipts">{"Receipts"}</a>
<a className="l10" href="#faq">{"FAQ"}</a>
<a className="l12" href="#pricing">{"Pricing"}</a>
</div>
<div className="l14"></div><a className="landing-signin" href="/login">Sign in</a>
<a className="l15" href="#pricing">Start generating</a>
</nav>
</header><main >
<section className="l18" aria-labelledby="h-hero">
<span className="l19" data-anim="">{"Built for teams"}</span>
<h1 className="l20" id="h-hero" data-anim="">{"Many originals"}<br />{"from one master"}</h1>
<p className="l21" data-anim="">{"One source video in. A pack of real, original files out \u2014 ready for every account your team already posts from."}</p>
<div className="l22" data-anim="">
<a className="l23" href="#pricing">Start generating</a>
<a className="l25" href="#receipts">{"See the receipts"}</a>
</div>
<div className="l27">
<div className="l28">
<span className="l29">{"One master \u00b7 ~20 originals"}</span>
<div className="l30">
<div className="l31"></div>
<div className="l32"></div>
<div className="l33">
<div className="l34"></div>
<div className="l35"></div>
<div className="l36"></div>
<div className="l37"></div>
<div className="l38"></div>
<div className="l39"></div>
<div className="l40"></div>
<div className="l41"></div>
<div className="l42"></div>
<div className="l43"></div>
<div className="l44"></div>
<div className="l45"></div>
<div className="l46"></div>
<div className="l47"></div>
<div className="l48"></div>
<div className="l49"></div>
<div className="l50"></div>
<div className="l51"></div>
<div className="l52"></div>
<div className="l53"></div>
</div>
</div>
<p className="l54">{"The default Fast pack is about 20 copies per clip \u2014 genuinely distinct files rendered off one master."}</p>
</div>
<div className="l55">
<span className="l56">{"Every file quality-gated"}</span>
<div className="l57">
<div className="l58"><span className="l59"></span><span className="l60">{"Colour stays true"}</span></div>
<div className="l61"><span className="l62"></span><span className="l63">{"Audio stays in sync"}</span></div>
<div className="l64"><span className="l65"></span><span className="l66">{"Output matches source"}</span></div>
</div>
<p className="l67">{"Not washed re-encodes. Not sticker-and-overlay remixes."}</p>
</div>
</div>
</section>
<section className="l68" aria-labelledby="h-vs">
<div className="l69">
<div className="l70">
<span className="l71">{"One file per idea"}</span>
<h3 className="l72" id="h-vs">{"What it looks like today"}</h3>
<div className="l73">
<div className="l74"><span className="l75"></span><span className="l76">{"One upload is one shot. The same file on every account kills reach."}</span></div>
<div className="l77"><span className="l78"></span><span className="l79">{"VAs hand-remix a winner instead of shipping the next ten."}</span></div>
<div className="l80"><span className="l81"></span><span className="l82">{"More output means more filming, or more people."}</span></div>
</div>
</div>
<div className="l83">
<span className="l84">{"With varimo"}</span>
<h3 className="l85">{"What it looks like after"}</h3>
<div className="l86">
<div className="l87"><span className="l88"></span><span className="l89">{"A pack of distinct files off one master, ready for the whole roster."}</span></div>
<div className="l90"><span className="l91"></span><span className="l92">{"The hand-remixing hour disappears. VAs run packs, not edits."}</span></div>
<div className="l93"><span className="l94"></span><span className="l95">{"A proven winner stays in rotation instead of retiring after one post."}</span></div>
</div>
</div>
</div>
</section>
<section className="l96" id="demo" aria-labelledby="h-demo">
<span className="l97">{"The app"}</span>
<h2 className="l98" id="h-demo">{"Drop a clip."}<br /><span className="l99">{"Watch the pack land."}</span></h2>
<p className="l100">{"Drop a clip, pick a pack size, hit Generate \u2014 and twenty delivered originals land in the gallery. Real capture, sped up."}</p>
<div className="l101">
<div className="l102">
<span className="l103">{"01"}</span>
<span className="l104">{"Drop"}</span>
<span className="l105">{"Upload a clip, or pull straight from a Drive folder your team already fills."}</span>
</div>
<div className="l106">
<span className="l107">{"02"}</span>
<span className="l108">{"Generate"}</span>
<span className="l109">{"Pick a pack size. varimo renders the variants and gates the ones that don\u2019t hold up."}</span>
</div>
<div className="l110">
<span className="l111">{"03"}</span>
<span className="l112">{"Send"}</span>
<span className="l113">{"Save to phone, or push back into the Drive folders your VAs post from."}</span>
</div>
</div>
<div className="l114">
<video className="l115" ref={workflowRef} src="/landing/varimo-workflow.mp4" poster="/landing/varimo-workflow-poster.jpg" muted={true} loop={true} playsInline={true} aria-label="Varimo building a 20-variant pack and delivering it to the gallery" preload="none"></video>
<div className="l116" aria-hidden="true"><span className="l117">{"Agency workspace"}</span></div>
<button className="l118" type="button" onClick={toggleVideo} aria-label={playing ? "Pause product videos" : "Play product videos"}>{playing ? "Pause" : "Play"}</button>
<div className="l120">
<span className="l121"></span>
<span className="l122">{"Real capture \u00b7 sped up"}</span>
</div>
</div>
<div className="l123">
<div className="l124">
<span className="l125">{"Then the gallery"}</span>
<h3 className="l126">{"Twenty delivered originals, scored and ready to send"}</h3>
<p className="l127">{"Every copy carries its own originality score. Keep them, send them to Drive, or save straight to the phone your VAs post from."}</p>
</div>
<div className="l128">
<video className="l129" ref={galleryRef} src="/landing/varimo-gallery-cropped.mp4" poster="/landing/varimo-gallery-cropped-poster.jpg" muted={true} loop={true} playsInline={true} aria-label="The finished pack sitting in the varimo gallery" preload="none"></video>
</div>
</div>
<div className="l130">
<span className="l131">{"Instagram Reels"}</span>
<span className="l132">{"TikTok"}</span>
<span className="l133">{"YouTube Shorts"}</span>
<span className="l134">{"Wherever your team already posts"}</span>
</div>
</section>
<section className="l135" id="receipts" aria-labelledby="h-receipts">
<div className="l136">
<div className="l137">
<div className="l138">
<span className="l139">{"Receipts"}</span>
<h2 className="l140" id="h-receipts">{"One master."}<br />{"Nine posts."}<br /><span className="l141">{"1.53M views."}</span></h2>
<p className="l142">{"Same clip, same caption, nine placements inside thirty days. The best post did 415,036. The weakest did 62,871. Both came off the same master file."}</p>
<div className="l143">
<div className="l144">{"415,036"}</div>
<div className="l145">{"279,615"}</div>
<div className="l146">{"177,325"}</div>
<div className="l147">{"154,326"}</div>
<div className="l148">{"151,931"}</div>
<div className="l149">{"118,473"}</div>
<div className="l150">{"102,634"}</div>
<div className="l151">{"66,051"}</div>
<div className="l152">{"62,871"}</div>
</div>
<div className="l153">
<span className="l154">{"Views in screenshot"}</span>
<span className="l155">{"1,528,262 "}<span className="l156">{"\u00b7 9 of 24 variants tested"}</span></span>
</div>
<p className="l157">{"One account, last 30 days. Past results from real posts \u2014 not a projection of yours."}</p>
</div>
<div className="l158">
<img className="l159" src="/landing/receipts-escalator.png" alt="Instagram insights: nine posts from one master, 415,036 down to 62,871 views" loading="lazy" decoding="async"/>
</div>
</div>
</div>
</section>
<section className="l160">
<a className="l161" href="#pricing">Start generating</a>
<span className="l163">One master. More originals. Ready for your team.</span>
</section>
<section className="l164" aria-labelledby="h-spread">
<span className="l165">{"The spread"}</span>
<h2 className="l166" id="h-spread">{"You can't call the winner."}</h2>
<p className="l167">{"Same idea, same day, same account \u2014 and the gap between the best and worst placement runs from 21\u00d7 to over a thousand. One upload is a bet. Twenty is a test."}</p>
<div className="l168">
<div className="l169">
<div className="l170"><img className="l171" src="/landing/spread-coffee-1086x.jpg" alt="Trial reels grid: views from 186 up to 202K on the same clip" loading="lazy" decoding="async"/></div>
<div className="l172">
<div className="l173">
<span className="l174">{"186"}</span>
<span className="l175"></span>
<span className="l176">{"202K"}</span>
</div>
<span className="l177">{"1,086\u00d7 spread"}</span>
<div className="l178">
<span className="l179">{"Views in screenshot"}</span>
<span className="l180">{"~495K "}<span className="l181">{"\u00b7 9 of 15 variants tested"}</span></span>
</div>
</div>
</div>
<div className="l182">
<div className="l183"><img className="l184" src="/landing/spread-gym-21x.jpg" alt="Trial reels grid: views from 2,545 up to 53.8K on the same clip" loading="lazy" decoding="async"/></div>
<div className="l185">
<div className="l186">
<span className="l187">{"2,545"}</span>
<span className="l188"></span>
<span className="l189">{"53.8K"}</span>
</div>
<span className="l190">{"21\u00d7 spread"}</span>
<div className="l191">
<span className="l192">{"Views in screenshot"}</span>
<span className="l193">{"~185K "}<span className="l194">{"\u00b7 9 of 20 variants tested"}</span></span>
</div>
</div>
</div>
<div className="l195">
<div className="l196"><img className="l197" src="/landing/spread-artist-151x-redacted.jpg" alt="Reels grid: views from 2,296 up to 347K on the same clip" loading="lazy" decoding="async"/></div>
<div className="l198">
<div className="l199">
<span className="l200">{"2,296"}</span>
<span className="l201"></span>
<span className="l202">{"347K"}</span>
</div>
<span className="l203">{"151\u00d7 spread"}</span>
<div className="l204">
<span className="l205">{"Views in screenshot"}</span>
<span className="l206">{"~498K "}<span className="l207">{"\u00b7 11 of 30 variants tested"}</span></span>
</div>
</div>
</div>
</div>
</section>
<section className="l208" id="faq" aria-labelledby="h-faq">
<span className="l209">{"Questions"}</span>
<h2 className="l210" id="h-faq">{"Before you start"}</h2>
<div className="l211">
<details className="l212">
<summary className="l213">
<span >{"What files can I put in?"}</span>
<span className="l214" aria-hidden="true">{"+"}</span>
</summary>
<p className="l215">{"Standard short-form video files \u2014 the clips your team already shoots and posts. Output matches the source: same resolution, same aspect, colour pipeline held, audio in sync."}</p>
</details>
<details className="l216">
<summary className="l217">
<span >{"How long does a pack take?"}</span>
<span className="l218" aria-hidden="true">{"+"}</span>
</summary>
<p className="l219">{"A typical talking-head 20-pack takes about ten minutes of Fast time. Heavier clips take longer \u2014 the meter runs on render time, so the number on your bill is the work that actually happened."}</p>
</details>
<details className="l220">
<summary className="l221">
<span >{copy("What happens when I use up my 90 hours?")}</span>
<span className="l222" aria-hidden="true">{"+"}</span>
</summary>
<p className="l223">{copy("Nothing stops. Extra Fast time bills at $0.75/hour for the rest of the month. Keep generating beyond your included hours—no hard stop.")}</p>
</details>
<details className="l224">
<summary className="l225">
<span >{"Can my VAs use it without touching billing?"}</span>
<span className="l226" aria-hidden="true">{"+"}</span>
</summary>
<p className="l227">{"Yes. Workspaces are invite-only and scoped \u2014 VAs can run packs and pull from Drive without seeing billing or your accounts."}</p>
</details>
<details className="l228">
<summary className="l229">
<span >{"Does this get me past a platform's duplicate check?"}</span>
<span className="l230" aria-hidden="true">{"+"}</span>
</summary>
<p className="l231">{"We do not claim that. Originality is measured as pixel difference from the source; the live platform is still the oracle. What varimo gives you is more distinct shots at the same idea."}</p>
</details>
<details className="l232">
<summary className="l233">
<span >{"Is it a scheduler?"}</span>
<span className="l234" aria-hidden="true">{"+"}</span>
</summary>
<p className="l235">{"No. No posting, no account management, no farming \u2014 varimo only does the part your VAs do by hand today. Files come back to you, into Drive or onto your phone, and you post them the way you already do."}</p>
</details>
<details className="l236">
<summary className="l237">
<span >{"Do you promise views?"}</span>
<span className="l238" aria-hidden="true">{"+"}</span>
</summary>
<p className="l239">{"No. No guaranteed reach, no guaranteed followers. What you get is more shots at the same idea \u2014 the platform still decides which one travels."}</p>
</details>
<details className="l240">
<summary className="l241">
<span >{"Will it degrade the clip?"}</span>
<span className="l242" aria-hidden="true">{"+"}</span>
</summary>
<p className="l243">{"No. The colour pipeline holds, audio stays in sync, output matches source \u2014 and files that don\u2019t clear the quality gate don\u2019t ship."}</p>
</details>
<details className="l244">
<summary className="l245">
<span >{"How do the captions work?"}</span>
<span className="l246" aria-hidden="true">{"+"}</span>
</summary>
<p className="l247">{"Turn Auto Captions on when you add a source and give it a base caption or prompt \u2014 varimo writes a unique variation for every copy in the pack, so no two uploads read the same. Importing from Drive, you can tick "}<strong className="l248">{"Use file name as caption"}</strong>{" and each asset takes its Drive file name as the base, then gets its own variations off that."}</p>
</details>
</div>
</section>
<TimeSavingsCalculator plan={plan} />
<section className="l249" id="pricing" aria-labelledby="h-pricing">
<span className="l250">{"Pricing"}</span>
<h2 className="l251" id="h-pricing">{"One plan."}<br /><span className="l252">{"Built for the roster."}</span></h2>
<p className="l253">{"For agencies and established content teams already producing variants of work that performs. You buy render time, not seats."}</p>
<div className="l254">
<div className="l255">
<div className="l256">
<span className="l257">{"Monthly plan"}</span>
</div>
<div className="l258">
<span className="l259">{copy("$200")}</span>
<span className="l260">{"/ month"}</span>
</div>
<span className="l261">{"Billed monthly. USD."}</span>
<p className="l262">{copy("90 Fast hours included each month. Then $0.75/hr. Keep generating beyond your included hours—no hard stop.")}</p>
<div className="l263">
<span className="l264">{copy("A 20-pack takes ~10 min of Fast time. 90 hours \u2248 ")}<strong className="l265">{copy("540 packs (~10,800 copies)")}</strong>{" a month."}</span>
<span className="l266">{"Typical, not a guarantee. Heavier clips take longer."}</span>
</div>
<button className="l267" type="button" onClick={buySubscription} disabled={checkoutBusy || !checkoutReady} aria-busy={checkoutBusy}>{checkoutBusy ? "Opening Stripe…" : <>{copy("Start generating \u2014 $200/month")}</>}</button>
</div>
<div className="l269">
<span className="l270">{"What's included"}</span>
<div className="l271">
<div className="l272"><span className="l273"></span><span className="l274">{copy("90 Fast hours, then $0.75/hr")}</span></div>
<div className="l275"><span className="l276"></span><span className="l277">{"Auto-import from Google Drive \u2192 generate \u2192 auto-export back to Drive, organised"}</span></div>
<div className="l278"><span className="l279"></span><span className="l280">{"Team / VAs run packs (not billing)"}</span></div>
<div className="l281"><span className="l282"></span><span className="l283">{"Auto captions \u2014 a unique caption per copy"}</span></div>
<div className="l284"><span className="l285"></span><span className="l286">{"Quality gate stays on (colour + audio sync)"}</span></div>
<div className="l287"><span className="l288"></span><span className="l289">{"Analytics \u2014 coming soon"}</span></div>
</div>
</div>
</div>
</section>
<CreatorWaitlistForm />
<section className="l290" id="access" aria-labelledby="h-close">
<div className="l291">
<h2 className="l292" id="h-close">{"Many originals"}<br /><span className="l293">{"from one master."}</span></h2>
<p className="l294">{"One source video in. A pack of real, original files out \u2014 ready for every account your team already posts from."}</p>
<button className="l295" type="button" onClick={buySubscription} disabled={checkoutBusy || !checkoutReady} aria-busy={checkoutBusy}>{checkoutBusy ? "Opening Stripe…" : <>{copy("Start generating \u2014 $200/month")}</>}</button>
<span className="l297">{"varimo.io"}</span>
</div>
</section>
</main><footer className="l298">{"varimo \u00b7 "}<Link href="#pricing">{"Pricing"}</Link>{" \u00b7 "}<a href="/login">{"Sign in"}</a></footer></div>;
}
