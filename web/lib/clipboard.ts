function execCopy(value: string): boolean {
  let el: HTMLTextAreaElement | null = null;
  try {
    el = document.createElement("textarea");
    el.value = value;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.focus();
    el.select();
    el.setSelectionRange(0, value.length);
    if (typeof document.execCommand !== "function") return false;
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    if (el?.parentNode) el.parentNode.removeChild(el);
  }
}

/** Copy text for a tap/click. Returns false when the browser blocks the clipboard. */
export async function writeClipboardText(text: string): Promise<boolean> {
  const value = text ?? "";
  if (!value) return false;
  // execCommand must run before any await so the user-gesture is still valid
  // inside a dialog (clipboard.writeText can hang there with no error).
  if (execCopy(value)) return true;
  try {
    if (navigator.clipboard?.writeText) {
      await Promise.race([
        navigator.clipboard.writeText(value),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error("clipboard timeout")), 400);
        }),
      ]);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
