import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GalleryFolderBar } from "@/components/gallery/GalleryFolderBar";
import { PackFolderMenu } from "@/components/gallery/PackFolderMenu";
import { GALLERY_FOLDER_UNFILED } from "@/lib/galleryFolders";

const folders = [
  { id: "gf_1", name: "Client A", pack_count: 2 },
  { id: "gf_2", name: "Trial Reels", pack_count: 1 },
];

describe("GalleryFolderBar", () => {
  it("lists All, Unfiled, named folders, and New folder", () => {
    render(
      <GalleryFolderBar
        folders={folders}
        unassignedCount={3}
        totalCount={6}
        selectedId=""
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /^all packs/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^unfiled packs/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /client a folder/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new folder/i })).toBeInTheDocument();
  });

  it("creates a folder from the top rail", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <GalleryFolderBar
        folders={[]}
        unassignedCount={0}
        totalCount={4}
        selectedId=""
        onSelect={vi.fn()}
        onCreate={onCreate}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /new folder/i }));
    fireEvent.change(screen.getByLabelText(/new folder/i), { target: { value: "Client A" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("Client A"));
  });

  it("selects Unfiled leftovers", () => {
    const onSelect = vi.fn();
    render(
      <GalleryFolderBar
        folders={folders}
        unassignedCount={3}
        totalCount={6}
        selectedId=""
        onSelect={onSelect}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^unfiled packs/i }));
    expect(onSelect).toHaveBeenCalledWith(GALLERY_FOLDER_UNFILED);
  });

  it("renames a folder from the actions menu", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(
      <GalleryFolderBar
        folders={folders}
        unassignedCount={3}
        totalCount={6}
        selectedId=""
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onRename={onRename}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /folder actions for client a/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /rename/i }));
    fireEvent.change(screen.getByLabelText(/rename/i), { target: { value: "Client B" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(onRename).toHaveBeenCalledWith("gf_1", "Client B"));
  });

  it("deletes a folder from the actions menu", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <GalleryFolderBar
        folders={folders}
        unassignedCount={3}
        totalCount={6}
        selectedId=""
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /folder actions for client a/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete folder/i }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("gf_1"));
  });
});

describe("PackFolderMenu", () => {
  it("moves a pack into a folder", () => {
    const onAssign = vi.fn();
    render(
      <PackFolderMenu folders={folders} currentId={null} onAssign={onAssign} />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: /move to folder/i }), {
      target: { value: "gf_1" },
    });
    expect(onAssign).toHaveBeenCalledWith("gf_1");
  });
});
