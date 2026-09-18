export const STUDIO_OUTPUT_NONE = "";

export function studioOutputFolderHint(hasFolders: boolean, ready = true): string {
  if (hasFolders && !ready) {
    return "Drive isn't ready — Generate still works. Send later from Gallery.";
  }
  return hasFolders
    ? "Sends the pack there when Generate finishes."
    : "Paste a Drive folder on Drive first.";
}

export function studioOutputFolderLabel(): string {
  return "Output folder";
}
