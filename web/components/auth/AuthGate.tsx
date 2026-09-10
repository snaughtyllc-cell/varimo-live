"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LabBanner } from "@/components/nav/LabBanner";
import { SideNav } from "@/components/nav/SideNav";
import { TopNav } from "@/components/nav/TopNav";
import { useAuthMe } from "@/lib/useAuthMe";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data, isLoading } = useAuthMe();
  const isPublic = pathname === "/" || pathname === "/login" || pathname === "/pricing" || pathname === "/landing";
  const needsLogin = Boolean(data?.auth_required && !data.email);
  const loggedIn = Boolean(data?.email);

  useEffect(() => {
    if (!data) return;
    if (needsLogin && !isPublic) {
      router.replace("/login");
    } else if (loggedIn && pathname === "/login") {
      router.replace("/studio");
    }
  }, [data, needsLogin, isPublic, loggedIn, pathname, router]);

  if (isLoading && !data && !isPublic) {
    return <div className="vf-boot" />;
  }

  if (needsLogin && !isPublic) {
    return <div className="vf-boot" />;
  }

  return (
    <>
      <LabBanner />
      {isPublic ? (
        children
      ) : (
        <div className="vf-shell">
          <SideNav />
          <div className="vf-shell-main">
            <TopNav />
            <div className="app-main">{children}</div>
          </div>
        </div>
      )}
    </>
  );
}
