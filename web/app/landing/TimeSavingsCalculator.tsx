"use client";
import { useState } from "react";
import type { BillingPlan } from "@/lib/types";

const defaults = { minutes: "2.5", variants: "200", rate: "25", review: "10" };
const fields = [
  { key: "minutes", label: "Manual minutes per additional output", min: 0.1, max: 240, step: 0.1 },
  { key: "variants", label: "Variants needed per month", min: 1, max: 100000, step: 1 },
  { key: "rate", label: "Value of your time per hour (USD)", min: 1, max: 1000, step: 1 },
  { key: "review", label: "Varimo setup + review minutes per 20-pack", min: 0, max: 480, step: 1 },
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
  const assisted = Math.ceil(Number(inputs.variants) / 20) * Number(inputs.review) / 60;
  const difference = manual - assisted;
  const timeValue = difference * Number(inputs.rate);
  const scale = Math.max(manual, assisted, 1);
  const price = plan && Number.isFinite(plan.price_usd) && plan.price_usd > 0 ? plan.price_usd : null;
  return <section className="time-calculator" id="time-savings" aria-labelledby="time-heading">
    <div className="time-intro"><span className="creator-eyebrow">Make room for the next idea</span>
      <h2 id="time-heading">Make the creative once. Build a pack from every version.</h2>
      <p>Use Edits or CapCut for different hooks, on-screen text, and creative treatments. Bring each finished version into Varimo to generate additional files while keeping its intended look.</p>
    </div>
    <div className="time-multiplier"><span>5 finished creative edits</span><span aria-hidden="true">×</span><span>20 outputs per edit</span><span aria-hidden="true">=</span><strong>100 files</strong><p>Five creative treatments, each with its own pack. Choose 10 outputs per edit for 50 files. Review the results before posting.</p></div>
    <div className="time-layout">
      <div className="time-inputs"><h3>Put your workflow into the numbers.</h3><p id="time-assumptions">Start with an example of 2.5 minutes per additional output using your existing editing workflow. These are assumptions, not measured benchmarks. Include checking and exporting; adjust Varimo setup and review time too.</p>
        {fields.map(field => <label key={field.key}>{field.label}<input type="number" inputMode={field.key === "minutes" ? "decimal" : "numeric"} min={field.min} max={field.max} step={field.step} value={inputs[field.key]} aria-describedby="time-assumptions" onChange={event => setInputs(previous => ({...previous, [field.key]: event.target.value}))} /></label>)}
        <button type="button" className="time-reset" onClick={() => setInputs(defaults)}>Reset example</button>
      </div>
      <div className="time-results" aria-live="polite" aria-atomic="true">
        {!valid ? <p>Enter positive values and a whole number of monthly variants to see your estimate. Setup and review time can be zero.</p> : <>
          <span className="creator-eyebrow">Your monthly estimate · {number(Number(inputs.variants))} variants</span>
          <div className="time-comparison"><div><span>Manual preparation</span><strong>{number(manual)} hours</strong></div><div className="time-track"><span style={{width: `${manual / scale * 100}%`}} /></div></div>
          <div className="time-comparison time-assisted"><div><span>Varimo setup + review</span><strong>{number(assisted)} hours</strong></div><div className="time-track"><span style={{width: `${assisted / scale * 100}%`}} /></div></div>
          <p className="time-total"><strong>{number(Math.abs(difference))} hours</strong><span>{difference > 0 ? "of hands-on time freed up per month" : difference < 0 ? "more hands-on time with these inputs" : "difference with these inputs"}</span></p>
          {difference > 0 ? <p className="time-value">That time is worth approximately <strong>{money(timeValue)}/month</strong> at your selected hourly rate.</p> : <p className="time-value">These inputs don’t show a time saving. Try your actual workflow to see whether packs make sense for you.</p>}
          {price !== null ? <p className="time-breakeven">At {money(Number(inputs.rate))}/hour, <strong>{number(price / Number(inputs.rate))} hours saved</strong> equals the {money(price)} monthly base subscription.</p> : <p className="time-breakeven">Live plan pricing is unavailable. You can still compare hands-on time.</p>}
          <a className="time-plan-link" href="#pricing">See what’s included <span aria-hidden="true">↓</span></a>
        </>}
      </div>
    </div>
    <p className="time-method">How it works: manual minutes × variants, compared with setup and review minutes × 20-packs (partial packs round up). Background rendering takes additional elapsed time. Creating the original clip and creative treatments, plus posting, are excluded from both sides. This compares file-production time, not equivalent creative ideas or guaranteed reach. Time value is an estimate, not guaranteed cash savings; the subscription comparison excludes usage charges and taxes.</p>
  </section>;
}
