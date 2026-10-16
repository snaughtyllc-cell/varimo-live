import type { Metadata } from "next";
import { HqSsoExchange } from "@/components/auth/HqSsoExchange";
import { VarimoWordmark } from "@/components/brand/VarimoWordmark";

export const metadata: Metadata = {
  title: "Opening Varimo",
  robots: { index: false, follow: false },
};

export default function HqSsoPage() {
  return (
    <main className="login-page">
      <div className="login-card">
        <div className="login-brand"><VarimoWordmark /></div>
        <HqSsoExchange />
      </div>
    </main>
  );
}
