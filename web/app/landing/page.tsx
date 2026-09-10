import type { Metadata } from "next";
import { Sora, Instrument_Serif } from "next/font/google";
import { LandingClient } from "./LandingClient";
import "./landing.css";
const sora = Sora({subsets:["latin"],weight:["400","500","600","700"],variable:"--font-sora"});
const instrument = Instrument_Serif({subsets:["latin"],weight:"400",style:"italic",variable:"--font-instrument"});
export const metadata: Metadata = {
 title: "varimo for agencies — Many originals from one master",
 description: "Turn one source video into distinct, quality-checked variants for your agency. Explore the workflow, real results, and live Agency pricing.",
 alternates: {canonical: "https://www.varimo.io/landing"},
};
export default function LandingPage() { return <div className={`${sora.variable} ${instrument.variable}`}><LandingClient /></div>; }
