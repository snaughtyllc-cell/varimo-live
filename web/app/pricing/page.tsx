import { redirect } from "next/navigation";

// Keep existing pricing links useful without inserting a second purchase step.
export default function PricingPage() {
  redirect("/landing#pricing");
}
