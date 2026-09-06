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
  const isLogin = pathname === "/login";
  const needsLogin = Boolean(data?.auth_required && !data.email);
  const loggedIn = Boolean(data?.email);

  useEffect(() => {
    if (!data) return;
    if (needsLogin && !isLogin) {
      router.replace("/login");
    } else if (loggedIn && isLogin) {
      router.replace("/");
    }
  }, [data, needsLogin, isLogin, loggedIn, router]);

  if (isLoading && !data) {
    return <div className="vf-boot" />;
  }

  if (needsLogin && !isLogin) {
    return <div className="vf-boot" />;
  }

  return (
    <>
      <LabBanner />
      {isLogin ? (
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
