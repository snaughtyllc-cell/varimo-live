import { describe, it, expect } from "vitest";
import {
  workflowFoldersClash,
  workflowFoldersMustDiffer,
  workflowNeedTwoFolders,
  workflowOutputHint,
  workflowAutoCaptionHint,
  workflowPageBlurb,
  workflowCanCancel,
  workflowFilenameCaptionCardLabel,
  workflowFilenameCaptionHint,
  workflowFilenameCaptionLabel,
} from "@/lib/workflowCopy";

describe("workflow folder layout copy", () => {
  it("says inbox and output must differ, with one subfolder per source", () => {
    expect(workflowPageBlurb()).toMatch(/different Drive folders/i);
    expect(workflowPageBlurb()).toMatch(/subfolder/i);
    expect(workflowPageBlurb()).toMatch(/10 folders/i);
    expect(workflowFoldersMustDiffer()).toMatch(/different/i);
    expect(workflowNeedTwoFolders()).toMatch(/two Drive folders/i);
    expect(workflowOutputHint()).toMatch(/one subfolder per source/i);
    expect(workflowAutoCaptionHint()).toMatch(/off by default|caption folder/i);
    expect(workflowAutoCaptionHint()).toMatch(/remaining|folder/i);
    expect(workflowFilenameCaptionLabel()).toMatch(/filename/i);
    expect(workflowFilenameCaptionCardLabel()).toMatch(/^filenames as captions$/i);
    expect(workflowFilenameCaptionHint()).toMatch(/drive name|filename/i);
    expect(workflowFilenameCaptionHint()).toMatch(/unique/i);
  });

  it("treats the same destination or the same Drive folder as a clash", () => {
    expect(
      workflowFoldersClash(
        { id: "a", folder_id: "IN" },
        { id: "b", folder_id: "OUT" },
      ),
    ).toBe(false);
    expect(
      workflowFoldersClash(
        { id: "a", folder_id: "SAME" },
        { id: "a", folder_id: "SAME" },
      ),
    ).toBe(true);
    expect(
      workflowFoldersClash(
        { id: "a", folder_id: "FOLDER" },
        { id: "b", folder_id: "FOLDER" },
      ),
    ).toBe(true);
  });
});

describe("workflowCanCancel", () => {
  it("is true only while a sweep still has a live pack", () => {
    expect(workflowCanCancel(null)).toBe(false);
    expect(workflowCanCancel({
      queued: 1, exported: 0, skipped: 0, failed: 0, running: 1, job_ids: ["j1"],
    })).toBe(true);
    expect(workflowCanCancel({
      queued: 0, exported: 8, skipped: 0, failed: 0, running: 0, job_ids: ["j1"],
    })).toBe(false);
  });
});
