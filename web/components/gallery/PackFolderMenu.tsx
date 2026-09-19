"use client";

import type { GalleryFolder } from "@/lib/types";
import {
  galleryFolderMoveLabel,
  galleryFolderUnfiledLabel,
} from "@/lib/galleryFolders";

interface PackFolderMenuProps {
  folders: GalleryFolder[];
  currentId?: string | null;
  onAssign: (folderId: string | null) => void;
  disabled?: boolean;
}

export function PackFolderMenu({
  folders,
  currentId,
  onAssign,
  disabled,
}: PackFolderMenuProps) {
  return (
    <label className="gallery-pack-folder">
      <span className="material-symbols-rounded" aria-hidden="true">drive_file_move</span>
      <select
        aria-label={galleryFolderMoveLabel()}
        value={currentId || ""}
        disabled={disabled || folders.length === 0}
        onChange={(e) => onAssign(e.target.value || null)}
      >
        <option value="">{galleryFolderUnfiledLabel()}</option>
        {folders.map((folder) => (
          <option key={folder.id} value={folder.id}>{folder.name}</option>
        ))}
      </select>
    </label>
  );
}
