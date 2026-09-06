import { describe, expect, it } from "vitest";
import { uploadBusyTitle, uploadProgressCopy, uploadTileLabel } from "@/lib/jobUpload";
import type { JobUploadProgress } from "@/lib/jobUpload";

const uploading: JobUploadProgress = {
  phase: "direct",
  fileIndex: 0,
  fileCount: 2,
  filename: "C2033.mp4",
  loaded: 40,
  total: 100,
};

describe("job upload copy", () => {
  it("shows which clip is uploading instead of a frozen starting label", () => {
    expect(uploadProgressCopy(uploading)).toBe("Uploading 1 of 2 · 40%");
    expect(uploadTileLabel(uploading)).toBe("uploading");
    expect(uploadBusyTitle(uploading)).toBe("Uploading…");
  });

  it("names the engine handoff after bytes are on the server", () => {
    const create: JobUploadProgress = { ...uploading, phase: "create" };
    expect(uploadProgressCopy(create)).toMatch(/engine/i);
    expect(uploadTileLabel(create)).toBe("starting");
    expect(uploadBusyTitle(create)).toBe("Starting…");
    expect(uploadTileLabel(null)).toBe("starting");
  });
});
