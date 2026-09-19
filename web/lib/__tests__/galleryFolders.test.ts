import { describe, expect, it } from "vitest";
import type { SourceOut } from "@/lib/types";
import {
  GALLERY_FOLDER_UNFILED,
  filterSourcesByFolder,
  folderNameForId,
  galleryFolderActionsLabel,
  galleryFolderAllChipLabel,
  galleryFolderEmptyCopy,
  galleryFolderHint,
  galleryFolderMoveLabel,
  galleryFolderNamedChipLabel,
  galleryFolderNewLabel,
  galleryFolderUnfiledChipLabel,
} from "@/lib/galleryFolders";

function pack(id: string, folder?: string): SourceOut {
  return {
    source_id: id,
    filename: `${id}.mp4`,
    requested: 1,
    delivered: 1,
    shortfall: 0,
    variants: [],
    gallery_folder_id: folder ?? null,
  };
}

describe("gallery folder helpers", () => {
  it("keeps the flat gallery when All is selected", () => {
    const packs = [pack("a", "gf_1"), pack("b")];
    expect(filterSourcesByFolder(packs, "").map((p) => p.source_id)).toEqual(["a", "b"]);
  });

  it("filters a named folder and Unfiled leftovers", () => {
    const packs = [pack("a", "gf_1"), pack("b"), pack("c", "gf_2")];
    expect(filterSourcesByFolder(packs, "gf_1").map((p) => p.source_id)).toEqual(["a"]);
    expect(filterSourcesByFolder(packs, GALLERY_FOLDER_UNFILED).map((p) => p.source_id)).toEqual(["b"]);
  });

  it("names a folder for a pack badge", () => {
    expect(folderNameForId([{ id: "gf_1", name: "Client A" }], "gf_1")).toBe("Client A");
    expect(folderNameForId([{ id: "gf_1", name: "Client A" }], null)).toBeNull();
  });

  it("uses Drive-like labels", () => {
    expect(galleryFolderNewLabel()).toMatch(/new folder/i);
    expect(galleryFolderMoveLabel()).toMatch(/move to folder/i);
    expect(galleryFolderHint()).toMatch(/drive/i);
    expect(galleryFolderEmptyCopy()).toMatch(/move to folder/i);
    expect(galleryFolderAllChipLabel(6)).toBe("All packs (6)");
    expect(galleryFolderUnfiledChipLabel(3)).toBe("Unfiled packs (3)");
    expect(galleryFolderNamedChipLabel("Client A", 2)).toBe("Client A folder (2)");
    expect(galleryFolderActionsLabel("Client A")).toBe("Folder actions for Client A");
  });
});
