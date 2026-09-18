"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getDriveStatus, listDestinations } from "@/lib/api";
import type { Destination } from "@/lib/types";
import { studioOutputFolderHint, studioOutputFolderLabel } from "@/lib/studioOutputFolder";

export function StudioOutputFolder({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([getDriveStatus(), listDestinations()])
      .then(([status, dests]) => {
        if (!alive) return;
        setReady(status.status === "ready");
        setDestinations(dests);
        setLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded || !value) return;
    if (!destinations.some((dest) => dest.id === value)) {
      onChange("");
    }
  }, [loaded, destinations, value, onChange]);

  const hasFolders = destinations.length > 0;

  return (
    <div className="studio-option-row studio-option-row--static studio-output-folder">
      <span>
        <span className="studio-option-row__label">{studioOutputFolderLabel()}</span>
        <span className="studio-option-row__hint">{studioOutputFolderHint(hasFolders, ready)}</span>
      </span>
      {!loaded ? (
        <span className="studio-option-row__value">…</span>
      ) : !hasFolders ? (
        <Link href="/settings/drive" className="studio-output-folder__link">
          Add a Drive folder
        </Link>
      ) : (
        <select
          aria-label="Output folder"
          value={value}
          disabled={!ready}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Don&apos;t send</option>
          {destinations.map((dest) => (
            <option key={dest.id} value={dest.id}>
              {dest.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
