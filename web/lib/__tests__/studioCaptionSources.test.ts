import { describe, expect, it } from "vitest";
import type { DrivePick } from "@/components/studio/DrivePickerModal";
import { studioCaptionSources } from "@/lib/studioCaptionSources";

describe("studioCaptionSources", () => {
  it("maps Drive picks without a thumbnail URL so next build can typecheck", () => {
    const picks: DrivePick[] = [{ destinationId: "d1", id: "file1", name: "gym.mp4" }];
    expect(studioCaptionSources([], picks)).toEqual([
      { key: "drive-file1", name: "gym.mp4" },
    ]);
  });

  it("keeps local file objects for uploaded clips", () => {
    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
    const out = studioCaptionSources([file], []);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("clip.mp4");
    expect(out[0].file).toBe(file);
  });
});
