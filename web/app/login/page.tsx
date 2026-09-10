import { LoginForm } from "@/components/auth/LoginForm";
import { VarimoWordmark } from "@/components/brand/VarimoWordmark";

function first(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; paid?: string | string[]; email?: string | string[] }>;
}) {
  const params = await searchParams;
  const error = first(params.error) || null;
  const paid = first(params.paid) === "1" || first(params.paid) === "true";
  const email = first(params.email);

  return (
    <main className="login-page">
      <div className="login-card">
        <div className="login-brand"><VarimoWordmark /></div>
        <h1>{paid ? "You're in" : "Sign in"}</h1>
        <LoginForm oauthError={error} paid={paid} emailPrefill={email} />
      </div>
    </main>
  );
}
