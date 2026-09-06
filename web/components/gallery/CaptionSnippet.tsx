import { captionSnippet } from "@/lib/prepareCopy";

export function CaptionSnippet({ caption }: { caption?: string | null }) {
  const text = captionSnippet(caption);
  if (!text) return null;

  return <p className="gallery-tile__caption">{text}</p>;
}
