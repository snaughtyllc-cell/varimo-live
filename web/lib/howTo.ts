/**
 * Operator How-to copy: three categories (Generating, Automation, Posting).
 * Never fingerprint internals (SHA / AAC / SEI / encode tags). Tests scan this module.
 */

export type HowToJump = { href: string; label: string };

export type HowToTopic = {
  id: string;
  title: string;
  paragraphs: string[];
};

export type HowToCategory = {
  id: "generating" | "automation" | "posting";
  label: string;
  blurb: string;
  topics: HowToTopic[];
  jumps: readonly HowToJump[];
};

export const HOW_TO_TITLE = "How to";
export const HOW_TO_EYEBROW = "Best practices";
export const HOW_TO_LEAD =
  "Three jobs: generating packs, automating the handoff, and posting. Open a tab.";

export const HOW_TO_CATEGORIES: HowToCategory[] = [
  {
    id: "generating",
    label: "Generating",
    blurb: "How to use Studio. Original in, Fast pack, check the look in Gallery.",
    jumps: [
      { href: "/studio", label: "Studio" },
      { href: "/gallery", label: "Gallery" },
    ],
    topics: [
      {
        id: "original",
        title: "Start from the original",
        paragraphs: [
          "Use the master clip. Drop it on Studio or pick it from Drive.",
          "Do not run a finished copy through Studio as a new source. That stacks encodes and the look gets worse.",
        ],
      },
      {
        id: "studio-gallery",
        title: "Studio → Gallery",
        paragraphs: [
          "Set how many copies and generate a Fast pack. Fast is the daily path.",
          "When the pack is done, it lands in Gallery — that is where you review and send. Pick an output folder in Studio if you want finished copies uploaded there automatically. Leave it on Don't send to keep sending from Gallery.",
        ],
      },
      {
        id: "look",
        title: "Check the look",
        paragraphs: [
          "Open Gallery and compare stills to the source. If a copy looks washed, muddy, or unlike the clip, do not send it.",
          "Play the file when you are unsure. Stills are not the whole video.",
        ],
      },
    ],
  },
  {
    id: "automation",
    label: "Automation",
    blurb: "Drive in, Drive out — then plugins you already use to caption and schedule.",
    jumps: [
      { href: "/workflows", label: "Workflows" },
      { href: "/settings/drive", label: "Drive" },
    ],
    topics: [
      {
        id: "workflows",
        title: "Workflows",
        paragraphs: [
          "Drive in, Drive out. Save two folders: an inbox for raw clips and a different output folder for finished packs. Share the studio Drive email as Editor so the machine can actually open them.",
          "A workflow watches the inbox, makes the pack, and drops copies into output — one subfolder per source, not one giant pile.",
        ],
      },
      {
        id: "filenames",
        title: "Drive filenames",
        paragraphs: [
          "Plugins like Repurpose.io and Buffer use the Drive filename as the post caption. Name the file before you hand the folder off.",
        ],
      },
      {
        id: "plugins",
        title: "Plugins",
        paragraphs: [
          "Point the export Drive folder at Repurpose.io or Buffer and let that tool schedule. Those are plugins on the folder, not extra Studio tabs.",
        ],
      },
    ],
  },
  {
    id: "posting",
    label: "Posting",
    blurb: "How to put copies on accounts without stacking flags.",
    jumps: [],
    topics: [
      {
        id: "accounts",
        title: "Multiple accounts",
        paragraphs: [
          "If you post the same pack across multiple accounts, do not drop every copy on every account at the same time. Stagger. Flags, integrity issues, and bans stack when a whole set lands at once.",
        ],
      },
      {
        id: "trial",
        title: "Trial Reels and content type",
        paragraphs: [
          "Skip sexual clips on Trial Reels. If one of those gets flagged, a lot of them get flagged — then you have a pile of sexual flags on the account.",
          "The usual miss with copies is not the file itself getting the account banned. It is using the wrong kind of content, then posting that same content over and over so flags pile up.",
        ],
      },
    ],
  },
];

/** Patterns that must never appear in How-to (clone bait / internals). */
export const HOW_TO_FORBIDDEN: readonly RegExp[] = [
  /\bSHA-?256\b/i,
  /\bSHA\b/,
  /\bAAC\b/,
  /\bSEI\b/,
  /\bSSIM\b/i,
  /\bVMAF\b/i,
  /\bMAE\b/,
  /fingerprint/i,
  /\bx264\b/i,
  /\blibx264\b/i,
  /\bgate\s*24\b/i,
  /\b24\s*bits\b/i,
  /38%/,
  /\bdetector\b/i,
  /nal_hrd/i,
  /info=0/i,
];

export function howToPlainText(): string {
  const parts = [HOW_TO_TITLE, HOW_TO_EYEBROW, HOW_TO_LEAD];
  for (const category of HOW_TO_CATEGORIES) {
    parts.push(category.label, category.blurb);
    for (const topic of category.topics) {
      parts.push(topic.title, ...topic.paragraphs);
    }
    parts.push(...category.jumps.map((link) => link.label));
  }
  return parts.join("\n");
}
