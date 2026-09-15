import type { Metadata } from "next";
import { Sora, Instrument_Serif } from "next/font/google";
import { LandingClient } from "./landing/LandingClient";
import "./landing/landing.css";
const sora = Sora({subsets:["latin"],weight:["400","500","600","700"],variable:"--font-sora"});
const instrument = Instrument_Serif({subsets:["latin"],weight:"400",style:"italic",variable:"--font-instrument"});
export const metadata: Metadata = {
 title: "varimo — The spoofing web app for video variations",
 description: "Spoofing is still highly manual. varimo is the web app that turns one master into a pack of real originals — in a shared workspace with your VAs, or automatically through Google Drive.",
 alternates: {canonical: "https://www.varimo.io/"},
};
export default function LandingPage() { return <div className={`${sora.variable} ${instrument.variable}`}><LandingClient /></div>; }
