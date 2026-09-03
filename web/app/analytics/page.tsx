"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChartColumn } from "lucide-react";
import { AnalyticsBoard } from "@/components/analytics/AnalyticsBoard";
import { showAnalyticsNav } from "@/lib/navAccess";
import { useAuthMe } from "@/lib/useAuthMe";

export default function AnalyticsPage() {
  const router = useRouter();
  const { data: me, isLoading: meLoading } = useAuthMe();
  const allowed = showAnalyticsNav(me);

  useEffect(() => {
    if (meLoading) return;
    if (!allowed) {
      router.replace("/");
    }
  }, [meLoading, allowed, router]);

  if (meLoading) return null;
  if (!allowed) {
    return (
      <main className="analytics-page">
        <p className="workspace-heading__copy">Owner only</p>
      </main>
    );
  }

  return (
    <main className="analytics-page">
      <div className="workspace-heading">
        <span className="workspace-heading__icon">
          <ChartColumn size={19} />
        </span>
        <div>
          <p className="workspace-heading__eyebrow">Pack performance</p>
          <h1>Analytics</h1>
          <div className="workspace-heading__copy">
            Connect tester Instagram accounts, Sync views onto packs, and open
            Unmatched Reels only when you need to attach an older post to a
            Gallery pack. Workspace owners only — VAs do not see this tab.
          </div>
        </div>
      </div>
      <div>
        <AnalyticsBoard />
      </div>
    </main>
  );
}
