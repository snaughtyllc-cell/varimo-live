"use client";
import { useState } from "react";
import type { BillingPlan } from "@/lib/types";

const defaults = { minutes: "4", variants: "200", generation: "10" };
const fields = [
  { key: "minutes", label: "Manual minutes per additional output", min: 0.1, max: 240, step: 0.1 },
  { key: "variants", label: "Variants needed per month", min: 1, max: 100000, step: 1 },
  { key: "generation", label: "Generation minutes per 20-pack", min: 0.1, max: 1440, step: 0.1 },
] as const;
const number = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 1 });
const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function TimeSavingsCalculator({ plan }: { plan: BillingPlan | null }) {
  const [inputs, setInputs] = useState(defaults);
  const valid = fields.every(field => {
    const value = Number(inputs[field.key]);
    return inputs[field.key].trim() !== "" && Number.isFinite(value) && value >= field.min && value <= field.max && (field.key !== "variants" || Number.isInteger(value));
  });
  const manual = Number(inputs.minutes) * Number(inputs.variants) / 60;
  const assisted = Math.ceil(Number(inputs.variants) / 20) * Number(inputs.generation) / 60;
  const scale = Math.max(manual, assisted, 1);
  const price = plan && Number.isFinite(plan.price_usd) && plan.price_usd > 0 ? plan.price_usd : null;
  return <section className="time-calculator" id="time-savings" aria-labelledby="time-heading">
    <div className="time-intro"><span className="creator-eyebrow">Make room for the next idea</span>
      <h2 id="time-heading">Make the creative once. Build a pack from every version.</h2>
      <p>Use Edits or CapCut for different hooks, on-screen text, and creative treatments. Bring each finished version into Varimo to generate additional files while keeping its intended look.</p>
    </div>
    <div className="time-multiplier"><span>5 finished creative edits</span><span aria-hidden="true">×</span><span>20 outputs per edit</span><span aria-hidden="true">=</span><strong>100 files</strong><p>Five creative treatments, each with its own pack. Choose 10 outputs per edit for 50 files. Review the results before posting.</p></div>
    <div className="time-layout">
      <div className="time-inputs"><h3>Put your workflow into the numbers.</h3><p id="time-assumptions">Try four minutes of manual editing per additional output. For Varimo, enter the elapsed time from hitting Generate to a completed 20-pack. Both defaults are editable examples, not measured averages.</p>
        {fields.map(field => <label key={field.key}>{field.label}<input type="number" inputMode={field.key !== "variants" ? "decimal" : "numeric"} min={field.min} max={field.max} step={field.step} value={inputs[field.key]} aria-describedby="time-assumptions" onChange={event => setInputs(previous => ({...previous, [field.key]: event.target.value}))} /></label>)}
        <button type="button" className="time-reset" onClick={() => setInputs(defaults)}>Reset example</button>
      </div>
      <div className="time-results" aria-live="polite" aria-atomic="true">
        {!valid ? <p>Enter positive values and a whole number of monthly variants to see your estimate. </p> : <>
          <span className="creator-eyebrow">Your monthly estimate · {number(Number(inputs.variants))} variants</span>
          <div className="time-comparison"><div><span>Manual editing · hands-on</span><strong>{number(manual)} hours</strong></div><div className="time-track"><span style={{width: `${manual / scale * 100}%`}} /></div></div>
          <div className="time-comparison time-assisted"><div><span>Varimo generation · background</span><strong>{number(assisted)} hours</strong></div><div className="time-track"><span style={{width: `${assisted / scale * 100}%`}} /></div></div>
          <p className="time-total"><strong>{number(manual)} hours</strong><span>of manual variation-making for this monthly output</span></p>
          <p className="time-value">Varimo generates in the background. The generation estimate totals packs run one after another; it is not paid human work.</p>
          <table className="time-costs"><caption>What that manual editing could cost</caption><thead><tr><th scope="col">Example labor rate</th><th scope="col">Monthly manual cost</th></tr></thead><tbody>{[10,15,25].map(rate => <tr key={rate}><th scope="row">{money(rate)}/hour</th><td>{money(manual * rate)}</td></tr>)}</tbody></table>
          {price !== null ? <p className="time-breakeven">Varimo’s base subscription is <strong>{money(price)}/month</strong>. Manual labor estimates above are for comparison, not guaranteed net savings.</p> : <p className="time-breakeven">Live plan pricing is unavailable. You can still compare editing and generation time.</p>}
          <a className="time-plan-link" href="#pricing">See what’s included <span aria-hidden="true">↓</span></a>
        </>}
      </div>
    </div>
    <p className="time-automation"><strong>Even fewer manual steps with workflows.</strong> Connect your Drive folders to automate importing, generation, and delivery. Add your source clip to the connected folder and let the workflow run.</p>
    <p className="time-method">How it works: manual editing minutes × outputs, versus generation minutes × 20-packs (partial packs round up). Hands-on editing and background generation are different kinds of time, so we don’t subtract one from the other as labor saved. Uploading, settings, review, source creation, and posting are excluded from this comparison. Actual generation time depends on the clip, processing settings, and queue. Labor costs use the full unrounded manual hours; subscription pricing excludes usage charges and taxes.</p>
  </section>;
}
