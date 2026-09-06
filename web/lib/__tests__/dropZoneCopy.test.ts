import { describe, it, expect } from "vitest";
import { dropZoneBrowse, dropZoneHint, dropZoneSubcopy, dropZoneTitle } from "@/lib/dropZoneCopy";
import {
  STUDIO_LIVE_RAIL_PX,
  studioProgressIdleClass,
  studioShellClass,
} from "@/lib/studioLayout";

describe("drop zone copy", () => {
  it("tells phone users to tap, not only drop", () => {
    expect(dropZoneTitle()).toBe("Add videos");
    expect(dropZoneSubcopy()).toMatch(/tap/i);
    expect(dropZoneBrowse()).toMatch(/camera roll|files/i);
    expect(dropZoneHint()).toMatch(/camera roll|4k|\.mov/i);
  });
});

describe("studio layout classes", () => {
  it("marks a live run without a second layout class that resizes the studio side", () => {
    expect(studioShellClass(false)).toBe("studio-shell");
    expect(studioShellClass(true)).toBe("studio-shell");
  });

  it("hides the empty progress pane on phones", () => {
    expect(studioProgressIdleClass(false)).toBe("studio-progress studio-progress--idle");
    expect(studioProgressIdleClass(true)).toBe("studio-progress");
  });

  it("keeps the desktop live rail a fixed column", () => {
    expect(STUDIO_LIVE_RAIL_PX).toBe(460);
  });
});
