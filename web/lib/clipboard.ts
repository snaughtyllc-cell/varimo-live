/** Copy text for a tap/click. Returns false when the browser blocks the clipboard. */
export async function writeClipboardText(text: string): Promise<boolean> {
  const value = text ?? "";
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
