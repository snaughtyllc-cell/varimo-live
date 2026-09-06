"use client";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { CreateJobResponse, SourceOut } from "./types";
import { getJob } from "./api";
import { useJobProgress } from "./useJobProgress";
import { RunProgress } from "./progress";
import { PrepMode, QualityMode } from "./hqWaitCopy";
import { isPreparingJob, PREPARING_JOB_ID } from "./prepareCopy";
import type { JobUploadProgress } from "./jobUpload";

type RunSource = { source_id: string; filename: string; requested: number };

const QUALITY_KEY = "vm.quality";
const PREP_KEY = "vm.prep";

function readStoredQuality(): QualityMode {
  return "fast";
}

function readStoredPrep(): PrepMode {
  return sessionStorage.getItem(PREP_KEY) === "hq" ? "hq" : "none";
}

interface RunCtx {
  jobId: string | null;
  sources: RunSource[];
  progress: RunProgress;
  complete: boolean;
  qualityMode: QualityMode;
  prepMode: PrepMode;
  beginPrepare: (sources: RunSource[]) => void;
  start: (resp: CreateJobResponse, qualityMode?: QualityMode, prepMode?: PrepMode) => void;
  clear: () => void;
  upload: JobUploadProgress | null;
  setUpload: (p: JobUploadProgress | null) => void;
  waitStartedAt: number | null;
}

const Ctx = createContext<RunCtx | null>(null);

export function RunProvider({ children }: { children: React.ReactNode }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [sources, setSources] = useState<RunSource[]>([]);
  const [qualityMode, setQualityMode] = useState<QualityMode>("fast");
  const [prepMode, setPrepMode] = useState<PrepMode>("none");
  const [upload, setUpload] = useState<JobUploadProgress | null>(null);
  const [waitStartedAt, setWaitStartedAt] = useState<number | null>(null);
  const hydratedRef = useRef(false);

  // Hydrate jobId from sessionStorage on mount; if sources are empty, fetch job detail once
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const saved = sessionStorage.getItem("vm.job");
    if (!saved || isPreparingJob(saved)) {
      if (saved) sessionStorage.removeItem("vm.job");
      return;
    }
    setJobId(saved);
    setWaitStartedAt(Date.now());
    setQualityMode(readStoredQuality());
    setPrepMode(readStoredPrep());
    // sources will be empty after a hard reload — fetch once to seed them
    getJob(saved)
      .then((detail) => {
        setSources(
          detail.sources.map((s: SourceOut) => ({
            source_id: s.source_id,
            filename: s.filename,
            requested: s.requested,
          }))
        );
      })
      .catch(() => {
        // 404 or old/cleared job — full reset via clear()
        sessionStorage.removeItem("vm.job");
        sessionStorage.removeItem(QUALITY_KEY);
        sessionStorage.removeItem(PREP_KEY);
        setJobId(null);
        setSources([]);
        setQualityMode("fast");
        setPrepMode("none");
      });
  }, []);

  const progress = useJobProgress(jobId, sources);
  const complete = progress.complete;

  function beginPrepare(srcs: RunSource[]) {
    setSources(srcs);
    setJobId(PREPARING_JOB_ID);
    setUpload(null);
    setWaitStartedAt(Date.now());
  }

  function start(
    resp: CreateJobResponse,
    _qualityMode: QualityMode = "fast",
    nextPrep: PrepMode = "none",
  ) {
    const id = resp.job_id;
    const srcs: RunSource[] = resp.sources.map((s) => ({
      source_id: s.source_id,
      filename: s.filename,
      requested: s.requested,
    }));
    sessionStorage.setItem("vm.job", id);
    sessionStorage.setItem(QUALITY_KEY, "fast");
    sessionStorage.setItem(PREP_KEY, nextPrep);
    setSources(srcs);
    setJobId(id);
    setQualityMode("fast");
    setPrepMode(nextPrep);
    setUpload(null);
  }

  function clear() {
    sessionStorage.removeItem("vm.job");
    sessionStorage.removeItem(QUALITY_KEY);
    sessionStorage.removeItem(PREP_KEY);
    setJobId(null);
    setSources([]);
    setQualityMode("fast");
    setPrepMode("none");
    setUpload(null);
    setWaitStartedAt(null);
  }

  return (
    <Ctx.Provider value={{ jobId, sources, progress, complete, qualityMode, prepMode, beginPrepare, start, clear, upload, setUpload, waitStartedAt }}>
      {children}
    </Ctx.Provider>
  );
}

export function useRun(): RunCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRun() must be used inside <RunProvider>");
  return ctx;
}
