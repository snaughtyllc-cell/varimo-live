"use client";

import { useEffect, useState } from "react";
import {
  exchangeHqSso,
  HQ_SSO_MISSING,
  HQ_SSO_NEXT,
  takeHqSsoToken,
} from "@/lib/hqSso";

export function HqSsoExchange() {
  const [message, setMessage] = useState("Signing you in…");

  useEffect(() => {
    let live = true;
    const token = takeHqSsoToken(window.location.hash, () => {
      const next = window.location.pathname + window.location.search;
      window.history.replaceState(null, "", next);
    });
    if (!token) {
      // The fragment is not available during server render, so this update has to
      // happen after hydration. A missing link is not a second network round-trip.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only hash
      setMessage(HQ_SSO_MISSING);
      return () => {
        live = false;
      };
    }
    exchangeHqSso(token).then((result) => {
      if (!live) return;
      if (result.ok) {
        window.location.assign(result.next ?? HQ_SSO_NEXT);
        return;
      }
      setMessage(result.message);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <h1>Opening Varimo</h1>
      <p style={{ fontSize: 13, lineHeight: 1.5, margin: "0 0 8px" }}>{message}</p>
    </>
  );
}
