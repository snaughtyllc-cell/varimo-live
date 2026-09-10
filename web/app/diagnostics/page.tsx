"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDiagnostics } from "@/lib/useDiagnostics";
import { DiagnosticsList } from "@/components/diagnostics/DiagnosticsList";
import { useAuthMe } from "@/lib/useAuthMe";
import { showDiagnosticsNav } from "@/lib/navAccess";
import { Activity } from "lucide-react";

export default function DiagnosticsPage() {
  const router = useRouter();
  const { data: me, isLoading: meLoading } = useAuthMe();
  const allowed = showDiagnosticsNav(me);
  const { data, mutate, isLoading } = useDiagnostics();
  const items = data ?? [];

  useEffect(() => {
    if (meLoading) return;
    if (!allowed) router.replace("/studio");
  }, [meLoading, allowed, router]);

  if (meLoading || !allowed) {
    return (
      <main className="diagnostics-page">
        <div style={{ color: "var(--color-muted)", fontSize: 13 }}>
          {meLoading ? "Loading…" : "Admin only"}
        </div>
      </main>
    );
  }

  const totalFailed = items.length;

  return (
    <main className="diagnostics-page">
      <div className="workspace-heading">
        <span className="workspace-heading__icon"><Activity size={19} /></span>
        <div>
          <p className="workspace-heading__eyebrow">Admin exceptions</p>
          <h1>Diagnostics</h1>
          <p className="workspace-heading__copy">
            {isLoading
              ? "Loading…"
              : totalFailed === 0
              ? "All variants delivered — nothing to report."
              : `${totalFailed} variant${totalFailed !== 1 ? "s" : ""} exhausted the 3-reroll cap. Everything else delivered.`}
          </p>
        </div>
      </div>
      <div>
        {isLoading ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "60px 0",
              color: "var(--color-muted)",
              fontSize: 13,
            }}
          >
            Loading diagnostics…
          </div>
        ) : (
          <DiagnosticsList items={items} onRegenerate={() => mutate()} />
        )}
      </div>
    </main>
  );
}
