import { describe, expect, it } from "vitest";
import { studioOutputFolderHint, studioOutputFolderLabel } from "../studioOutputFolder";

describe("studio output folder copy", () => {
  it("replaces Output size with a Drive folder pick", () => {
    expect(studioOutputFolderLabel()).toBe("Output folder");
    expect(studioOutputFolderHint(true)).toMatch(/when Generate finishes/i);
    expect(studioOutputFolderHint(false)).toMatch(/Drive first/i);
    expect(studioOutputFolderHint(true, false)).toMatch(/Drive isn't ready/i);
    expect(studioOutputFolderHint(true)).not.toMatch(/output size|matches source/i);
  });
});
