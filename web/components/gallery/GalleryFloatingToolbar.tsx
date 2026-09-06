"use client";

interface GalleryFloatingToolbarProps {
  count: number;
  onSend: () => void;
  sendDisabled: boolean;
  sendTitle?: string | null;
  onSave: () => void;
  saveLabel: string;
  saveDisabled: boolean;
  saveTitle?: string | null;
  onClose: () => void;
}

/** Bottom-center dark pill — appears only while variants are selected (mock: "Screen 2 — Gallery"). */
export function GalleryFloatingToolbar({
  count,
  onSend,
  sendDisabled,
  sendTitle,
  onSave,
  saveLabel,
  saveDisabled,
  saveTitle,
  onClose,
}: GalleryFloatingToolbarProps) {
  return (
    <div className="gallery-floating-toolbar" role="toolbar" aria-label="Selected variants">
      <div className="gallery-floating-toolbar__count">
        {count} variant{count === 1 ? "" : "s"} selected
      </div>
      <div className="gallery-floating-toolbar__actions">
        <button
          type="button"
          className="gallery-floating-toolbar__secondary"
          onClick={onSave}
          disabled={saveDisabled}
          title={saveTitle ?? undefined}
        >
          {saveLabel}
        </button>
        <button
          type="button"
          className="gallery-floating-toolbar__primary"
          onClick={onSend}
          disabled={sendDisabled}
          title={sendTitle ?? undefined}
        >
          <span className="material-symbols-rounded" aria-hidden="true">cloud_upload</span>
          Send to Drive
        </button>
      </div>
      <button
        type="button"
        className="gallery-floating-toolbar__close"
        onClick={onClose}
        aria-label="Clear selection"
      >
        <span className="material-symbols-rounded" aria-hidden="true">close</span>
      </button>
    </div>
  );
}
