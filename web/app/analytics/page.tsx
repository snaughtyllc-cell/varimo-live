"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
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
      <main className="analytics-shell">
        <p className="workspace-heading__copy">Owner only</p>
      </main>
    );
  }

  return (
    <main className="analytics-shell">
      <div className="drive-topbar">
        <span className="drive-topbar__section">ANALYTICS</span>
        <span className="drive-topbar__sep">/</span>
        <span className="drive-topbar__crumb">Pack performance</span>
      </div>
      <div className="drive-scroll">
        <div className="analytics-body">
          <div className="drive-head">
            <p className="drive-head__eyebrow">Track</p>
            <h1 className="drive-head__title">Analytics</h1>
            <p className="drive-head__copy">
              Connect tester Instagram accounts, Sync views onto packs, and open
              Unmatched Reels only when you need to attach an older post to a
              Gallery pack. Workspace owners only — VAs do not see this tab.
            </p>
          </div>
          <AnalyticsBoard />
        </div>
      </div>
    </main>
  );
}
