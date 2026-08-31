import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { dropZoneBrowse, dropZoneHint, dropZoneSubcopy, dropZoneTitle } from "@/lib/dropZoneCopy";
import { studioProgressIdleClass, studioShellClass } from "@/lib/studioLayout";

describe("drop zone copy", () => {
  it("tells phone users to tap, not only drop", () => {
    expect(dropZoneTitle()).toBe("Add videos");
    expect(dropZoneSubcopy()).toMatch(/tap/i);
    expect(dropZoneBrowse()).toMatch(/camera roll|files/i);
    expect(dropZoneHint()).toMatch(/camera roll|4k|\.mov/i);
  });
});

describe("studio layout classes", () => {
  it("tags a live run without changing document order", () => {
    expect(studioShellClass(false)).toBe("studio-shell");
    expect(studioShellClass(true)).toBe("studio-shell studio-shell--live");
  });

  it("hides the empty progress pane on phones", () => {
    expect(studioProgressIdleClass(false)).toBe("studio-progress studio-progress--idle");
    expect(studioProgressIdleClass(true)).toBe("studio-progress");
  });

  it("keeps the progress pane at the bottom of the phone stack while a job runs", () => {
    const css = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8");
    expect(css).not.toMatch(/\.studio-shell--live\s+\.studio-progress\s*\{[^}]*order:\s*-1/s);
    expect(css).not.toMatch(/\.studio-progress[^{]*\{[^}]*order:\s*-1/s);
  });
});
