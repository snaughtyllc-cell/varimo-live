import type { Metadata } from "next";
import { Sora, Instrument_Serif } from "next/font/google";
import { LandingClient } from "./landing/LandingClient";
import "./landing/landing.css";
const sora = Sora({subsets:["latin"],weight:["400","500","600","700"],variable:"--font-sora"});
const instrument = Instrument_Serif({subsets:["latin"],weight:"400",style:"italic",variable:"--font-instrument"});
export const metadata: Metadata = {
 title: "varimo — Many originals from one master",
 description: "Turn one source video into distinct, quality-checked variants for your team. Explore the workflow, real results, and live pricing.",
 alternates: {canonical: "https://www.varimo.io/"},
};
export default function LandingPage() { return <div className={`${sora.variable} ${instrument.variable}`}><LandingClient /></div>; }
