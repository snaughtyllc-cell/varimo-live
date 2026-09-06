import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANALYTICS_SHEET_PX,
  ANALYTICS_SHEET_WIDE_MIN_PX,
  STUDIO_SIDENAV_PX,
} from "@/lib/studioLayout";

const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");

function mediaAll(query: string): string {
  const needle = `@media ${query}`;
  let out = "";
  let from = 0;
  while (from < css.length) {
    const start = css.indexOf(needle, from);
    if (start < 0) break;
    const brace = css.indexOf("{", start);
    let depth = 0;
    for (let i = brace; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") {
        depth--;
        if (depth === 0) {
          out += css.slice(brace + 1, i);
          from = i + 1;
          break;
        }
      }
    }
  }
  return out;
}

function rule(block: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`));
  return match?.[0] ?? "";
}

const phone = mediaAll("(max-width: 639px)");
const tablet = mediaAll("(min-width: 640px)");
const wide = mediaAll(`(min-width: ${ANALYTICS_SHEET_WIDE_MIN_PX}px)`);

describe("Analytics layout across phone, iPad, and desktop", () => {
  it("keeps the generate-more callout on its own full-width row in the Insights hero", () => {
    expect(rule(css, ".analytics-pack-hero__suggestion")).toMatch(/grid-column:\s*1\s*\/\s*-1/);
  });

  it("makes Insights a full-screen sheet on the phone, below the notch", () => {
    const sheet = rule(phone, ".analytics-sheet");
    expect(sheet).toMatch(/left:\s*0/);
    expect(sheet).toMatch(/width:\s*100%/);
    expect(sheet).toMatch(/env\(safe-area-inset-top/);
    expect(sheet).toMatch(/env\(safe-area-inset-bottom/);
  });

  it("fills the column next to SideNav on iPad instead of a 480px sliver over the board", () => {
    expect(rule(tablet, ".analytics-sheet-overlay")).toMatch(
      new RegExp(`left:\\s*${STUDIO_SIDENAV_PX}px`),
    );
    const sheet = rule(tablet, ".analytics-sheet");
    expect(sheet).toMatch(new RegExp(`left:\\s*${STUDIO_SIDENAV_PX}px`));
    expect(sheet).toMatch(/width:\s*auto/);
    expect(sheet).not.toMatch(new RegExp(`width:\\s*${ANALYTICS_SHEET_PX}px`));
  });

  it("uses a 480px Insights drawer only when the desktop board still has room", () => {
    const sheet = rule(wide, ".analytics-sheet");
    expect(sheet).toMatch(/left:\s*auto/);
    expect(sheet).toMatch(new RegExp(`width:\\s*${ANALYTICS_SHEET_PX}px`));
  });
});
