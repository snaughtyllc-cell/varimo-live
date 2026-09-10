"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { isAgencyExperience } from "@/lib/experience";
import { showTeamNav } from "@/lib/navAccess";
import { useAuthMe } from "@/lib/useAuthMe";

/** Drops / Workflows / Team — not on the solo creator chrome. */
export function RequireAgency({
  children,
  ownerOnly = false,
}: {
  children: ReactNode;
  ownerOnly?: boolean;
}) {
  const router = useRouter();
  const { data: me, isLoading } = useAuthMe();
  const allowed = isLoading
    ? false
    : ownerOnly
      ? showTeamNav(me)
      : isAgencyExperience(me);

  useEffect(() => {
    if (!isLoading && !allowed) {
      router.replace("/studio");
    }
  }, [isLoading, allowed, router]);

  if (isLoading || !allowed) {
    return (
      <main>
        <div style={{ color: "var(--color-muted)", fontSize: 13 }}>
          {isLoading ? "Loading…" : "Not available"}
        </div>
      </main>
    );
  }
  return children;
}
