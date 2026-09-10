import Link from "next/link";
import { PricingCard } from "@/components/auth/PricingCard";
import { VarimoWordmark } from "@/components/brand/VarimoWordmark";

function first(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>;
}) {
  const email = first((await searchParams).email);

  return (
    <main className="login-page">
      <div className="login-card pricing-card">
        <Link href="/landing" className="login-brand" aria-label="varimo — for agencies"><VarimoWordmark /></Link>
        <h1>Agency</h1>
        <PricingCard emailPrefill={email} />
        <Link href="/landing" style={{display:"inline-block",marginTop:24,fontSize:13}}>← Explore varimo for agencies</Link>
      </div>
    </main>
  );
}
