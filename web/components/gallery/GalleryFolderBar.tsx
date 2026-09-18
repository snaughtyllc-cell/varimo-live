"use client";

import { useEffect, useState } from "react";
import type { GalleryFolder } from "@/lib/types";
import {
  GALLERY_FOLDER_ALL,
  GALLERY_FOLDER_UNFILED,
  galleryFolderActionsLabel,
  galleryFolderAllChipLabel,
  galleryFolderAllLabel,
  galleryFolderBarLabel,
  galleryFolderDeleteLabel,
  galleryFolderHint,
  galleryFolderNamedChipLabel,
  galleryFolderNewLabel,
  galleryFolderRenameLabel,
  galleryFolderUnfiledChipLabel,
  galleryFolderUnfiledLabel,
} from "@/lib/galleryFolders";

interface GalleryFolderBarProps {
  folders: GalleryFolder[];
  unassignedCount: number;
  totalCount: number;
  selectedId: string;
  onSelect: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function GalleryFolderBar({
  folders,
  unassignedCount,
  totalCount,
  selectedId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: GalleryFolderBarProps) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!menuId) return;
    function onDoc(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".gallery-folder-chip-wrap")) {
        setMenuId(null);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuId]);

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(draft.trim());
      setDraft("");
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create folder");
    } finally {
      setBusy(false);
    }
  }

  async function submitRename(e: React.FormEvent) {
    e.preventDefault();
    if (!renameId || busy || !renameDraft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onRename(renameId, renameDraft.trim());
      setRenameId(null);
      setMenuId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename folder");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gallery-folders" role="region" aria-label={galleryFolderBarLabel()}>
      <div className="gallery-folders__head">
        <span className="gallery-folders__label">{galleryFolderBarLabel()}</span>
        <p className="gallery-folders__hint">{galleryFolderHint()}</p>
      </div>
      <div className="gallery-folders__rail">
        <button
          type="button"
          className="gallery-folder-chip"
          data-active={selectedId === GALLERY_FOLDER_ALL}
          aria-label={galleryFolderAllChipLabel(totalCount)}
          onClick={() => onSelect(GALLERY_FOLDER_ALL)}
        >
          <span className="material-symbols-rounded" aria-hidden="true">folder</span>
          {galleryFolderAllLabel()}
          <span className="gallery-folder-chip__count" aria-hidden="true">{totalCount}</span>
        </button>
        {folders.length > 0 && (
          <button
            type="button"
            className="gallery-folder-chip"
            data-active={selectedId === GALLERY_FOLDER_UNFILED}
            aria-label={galleryFolderUnfiledChipLabel(unassignedCount)}
            onClick={() => onSelect(GALLERY_FOLDER_UNFILED)}
          >
            <span className="material-symbols-rounded" aria-hidden="true">folder_off</span>
            {galleryFolderUnfiledLabel()}
            <span className="gallery-folder-chip__count" aria-hidden="true">{unassignedCount}</span>
          </button>
        )}
        {folders.map((folder) => (
          <div key={folder.id} className="gallery-folder-chip-wrap">
            {renameId === folder.id ? (
              <form className="gallery-folder-create" onSubmit={submitRename}>
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  aria-label={galleryFolderRenameLabel()}
                  disabled={busy}
                />
                <button type="submit" disabled={busy || !renameDraft.trim()}>Save</button>
                <button type="button" onClick={() => setRenameId(null)}>Cancel</button>
              </form>
            ) : (
              <button
                type="button"
                className="gallery-folder-chip"
                data-active={selectedId === folder.id}
                aria-label={galleryFolderNamedChipLabel(folder.name, folder.pack_count)}
                onClick={() => onSelect(folder.id)}
              >
                <span className="material-symbols-rounded" aria-hidden="true">folder</span>
                {folder.name}
                <span className="gallery-folder-chip__count" aria-hidden="true">{folder.pack_count}</span>
              </button>
            )}
            {renameId !== folder.id && (
            <button
              type="button"
              className="gallery-folder-chip__more"
              aria-label={galleryFolderActionsLabel(folder.name)}
              aria-expanded={menuId === folder.id}
              onClick={() => setMenuId((id) => (id === folder.id ? null : folder.id))}
            >
              <span className="material-symbols-rounded" aria-hidden="true">more_horiz</span>
            </button>
            )}
            {menuId === folder.id && (
              <div className="gallery-folder-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setRenameId(folder.id);
                    setRenameDraft(folder.name);
                    setMenuId(null);
                  }}
                >
                  {galleryFolderRenameLabel()}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await onDelete(folder.id);
                      setMenuId(null);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Could not delete folder");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {galleryFolderDeleteLabel()}
                </button>
              </div>
            )}
          </div>
        ))}
        {creating ? (
          <form className="gallery-folder-create" onSubmit={submitNew}>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Client or account"
              aria-label={galleryFolderNewLabel()}
              disabled={busy}
            />
            <button type="submit" disabled={busy || !draft.trim()}>Add</button>
            <button type="button" onClick={() => { setCreating(false); setDraft(""); }}>
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="gallery-folder-chip gallery-folder-chip--new"
            aria-label={galleryFolderNewLabel()}
            onClick={() => setCreating(true)}
          >
            <span className="material-symbols-rounded" aria-hidden="true">create_new_folder</span>
            {galleryFolderNewLabel()}
          </button>
        )}
      </div>
      {error && (
        <div className="gallery-folders__error" role="alert">{error}</div>
      )}
    </div>
  );
}
