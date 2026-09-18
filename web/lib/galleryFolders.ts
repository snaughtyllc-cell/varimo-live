import type { SourceOut } from "./types";

export const GALLERY_FOLDER_ALL = "";
export const GALLERY_FOLDER_UNFILED = "unfiled";

export function galleryFolderBarLabel(): string {
  return "Folders";
}

export function galleryFolderAllLabel(): string {
  return "All";
}

export function galleryFolderUnfiledLabel(): string {
  return "Unfiled";
}

export function galleryFolderNewLabel(): string {
  return "New folder";
}

export function galleryFolderMoveLabel(): string {
  return "Move to folder";
}

export function galleryFolderHint(): string {
  return "Label packs like Drive folders. They stay in this studio.";
}

export function galleryFolderEmptyCopy(): string {
  return "No packs in this folder yet. Open a pack and use Move to folder.";
}

export function galleryFolderUnfiledEmptyCopy(): string {
  return "Every pack is already in a folder.";
}

export function galleryFolderRenameLabel(): string {
  return "Rename";
}

export function galleryFolderDeleteLabel(): string {
  return "Delete folder";
}

export function galleryFolderAllChipLabel(count: number): string {
  return `${galleryFolderAllLabel()} packs (${count})`;
}

export function galleryFolderUnfiledChipLabel(count: number): string {
  return `${galleryFolderUnfiledLabel()} packs (${count})`;
}

export function galleryFolderNamedChipLabel(name: string, count: number): string {
  return `${name} folder (${count})`;
}

export function galleryFolderActionsLabel(name: string): string {
  return `Folder actions for ${name}`;
}

export function filterSourcesByFolder(
  sources: SourceOut[],
  folderId: string,
): SourceOut[] {
  if (!folderId) return sources;
  if (folderId === GALLERY_FOLDER_UNFILED) {
    return sources.filter((source) => !source.gallery_folder_id);
  }
  return sources.filter((source) => source.gallery_folder_id === folderId);
}

export function folderNameForId(
  folders: { id: string; name: string }[],
  folderId: string | null | undefined,
): string | null {
  if (!folderId) return null;
  return folders.find((folder) => folder.id === folderId)?.name ?? null;
}
