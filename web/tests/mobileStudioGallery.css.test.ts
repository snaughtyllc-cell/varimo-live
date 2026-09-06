import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STUDIO_GENERATE_DOCK_H_PX, STUDIO_LIVE_RAIL_PX } from "@/lib/studioLayout";

const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");
const mobile = css.split("@media (max-width: 639px)")[1] ?? "";
const desktop =
  css.split("@media (min-width: 900px)").find((part, i) => i > 0 && part.includes(".studio-live")) ?? "";

function rule(block: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`));
  return match?.[0] ?? "";
}

describe("mobile Studio + Gallery CSS contract", () => {
  it("pins Generate above the tab bar and leaves room for Just Finished above it", () => {
    expect(css).toMatch(/\.studio-generate-bar \{[^}]*position:\s*static/s);
    expect(css).not.toMatch(/\.studio-generate-bar \{[^}]*background:\s*var\(--color-panel\)/s);
    expect(css).toMatch(/\.studio-generate-bar--dock \{[^}]*background:\s*transparent/s);
    const dock = rule(mobile, ".studio-generate-bar.studio-generate-bar--dock");
    expect(dock).toMatch(/position:\s*fixed/);
    expect(dock).toMatch(/bottom:\s*var\(--tab-h\)/);
    expect(dock).toMatch(/left:\s*16px/);
    expect(dock).toMatch(/right:\s*16px/);
    expect(dock).not.toMatch(/position:\s*static/);
    expect(dock).toMatch(/background:\s*transparent/);
    expect(dock).not.toMatch(/background:\s*var\(--color-panel\)/);
    expect(dock).not.toMatch(/border-top:/);
    expect(rule(mobile, ".studio-generate-bar")).toMatch(/background:\s*transparent/);
    expect(rule(mobile, ".studio-generate-bar--dock .studio-generate-bar__inner")).toMatch(
      /background:\s*transparent/,
    );
    expect(mobile).toMatch(new RegExp(`--generate-dock-h:\\s*${STUDIO_GENERATE_DOCK_H_PX}px`));
    expect(rule(mobile, ".studio-live")).toMatch(/padding-bottom:\s*calc\(\s*var\(--generate-dock-h\)/);
    expect(css).toMatch(/\.studio-generate-cancel\s*\{/s);
    expect(css).toMatch(/\.studio-live-row__cancel\s*\{[^}]*opacity:\s*1/s);
    expect(css).not.toMatch(/\.studio-live-row__cancel\s*\{[^}]*opacity:\s*0/s);
  });

  it("lets the Gallery body scroll past PACKS so tiles are reachable", () => {
    expect(css).toMatch(/\.gallery-page\s*\{[^}]*overflow:\s*hidden/s);
    expect(mobile).toMatch(/\.gallery-body\s*\{[^}]*overflow-y:\s*auto/s);
    expect(mobile).toMatch(/\.gallery-grid-pane\s*\{[^}]*overflow:\s*visible/s);
    expect(mobile).toMatch(/\.gallery-packs\s*\{[^}]*flex-shrink:\s*0/s);
    expect(mobile).toMatch(/\.gallery-toolbar \.gallery-send-wrap\s*\{[^}]*display:\s*none/s);
    expect(mobile).toMatch(/\.gallery-packs__search\s*\{[^}]*display:\s*none/s);
    expect(mobile).toMatch(/\.gallery-grid\s*\{[^}]*minmax\(\s*80px/s);
    expect(mobile).toMatch(/\.gallery-tile\s*\{[^}]*max-width:\s*none/s);
  });

  it("keeps a single green status chip on the phone top bar", () => {
    expect(mobile).toMatch(/\.vf-topbar-left \.status-gpu\s*\{[^}]*display:\s*none/s);
    expect(mobile).toMatch(/\.vf-topbar-left \.status-ready-text\s*\{[^}]*display:\s*none/s);
    expect(mobile).toMatch(/\.vf-topbar-left \.status-engine\s*\{[^}]*width:\s*34px/s);
  });

  it("stacks the selection sheet: count on top, Save and Send below", () => {
    expect(mobile).toMatch(/\.gallery-floating-toolbar\s*\{[^}]*position:\s*fixed/s);
    expect(mobile).toMatch(
      /\.gallery-floating-toolbar\s*\{[^}]*grid-template-areas:\s*"count close"\s*"actions actions"/s,
    );
  });

  it("lays caption prompt cards out as a horizontal snap row on phone", () => {
    expect(mobile).toMatch(/\.studio-caption-sources\s*\{[^}]*scroll-snap-type:\s*x mandatory/s);
    expect(mobile).toMatch(/\.studio-caption-source\s*\{[^}]*flex:\s*0 0 100%/s);
    expect(mobile).toMatch(/\.studio-caption-source\s*\{[^}]*flex-direction:\s*column/s);
    expect(css).toMatch(/\.studio-source-thumb img,\s*\.studio-source-thumb video\s*\{[^}]*object-fit:\s*cover/s);
    expect(mobile).toMatch(/\.studio-clip-card__thumb\s*\{[^}]*width:\s*84px/s);
  });

  it("lets Studio scroll as one page with Live Queue in the flow", () => {
    const phoneLive = rule(mobile, ".studio-live");
    expect(phoneLive).toMatch(/height:\s*auto/);
    expect(phoneLive).toMatch(/max-height:\s*none/);
    expect(phoneLive).toMatch(/overflow:\s*visible/);
    expect(rule(mobile, ".studio-cockpit__scroll")).toMatch(/overflow:\s*visible/);
    expect(rule(mobile, ".studio-cockpit__scroll")).not.toMatch(/overflow-y:\s*auto/);

    const deskLive = rule(desktop, ".studio-live");
    expect(deskLive).toMatch(new RegExp(`flex:\\s*0 0 ${STUDIO_LIVE_RAIL_PX}px`));
    expect(deskLive).toMatch(new RegExp(`width:\\s*${STUDIO_LIVE_RAIL_PX}px`));
    expect(deskLive).not.toMatch(/flex:\s*1 1 auto/);
  });

  it("shows pack Insights under the phone pack tiles", () => {
    expect(css).toMatch(/\.gallery-main\s*\{[^}]*flex-direction:\s*column/s);
    expect(css).toMatch(/\.gallery-pack-live\s*\{[^}]*display:\s*flex/s);
    expect(mobile).toMatch(/\.gallery-pack-live\s*\{[^}]*display:\s*flex/s);
    expect(mobile).toMatch(/\.gallery-pack-live\s*\{[^}]*flex-shrink:\s*0/s);
  });

  it("gives the phone variant review a full overlay between the top bar and tabs", () => {
    expect(mobile).toMatch(/\.gallery-page:has\(\.gallery-body--review\) \.gallery-toolbar\s*\{[^}]*display:\s*none/s);
    expect(mobile).toMatch(/\.gallery-review\s*\{[^}]*position:\s*fixed/s);
    expect(mobile).toMatch(/\.gallery-review\s*\{[^}]*top:\s*var\(--nav-h\)/s);
    expect(mobile).toMatch(/\.gallery-review\s*\{[^}]*bottom:\s*var\(--tab-h\)/s);
    expect(mobile).toMatch(/\.gallery-review \.variant-sheet__player\s*\{[^}]*height:\s*min\(\s*52dvh/s);
    expect(mobile).toMatch(/\.gallery-review \.variant-sheet__player\s*\{[^}]*container-type:\s*normal/s);
    expect(mobile).toMatch(/\.gallery-review \.compare-slider--stage\s*\{[^}]*height:\s*100%/s);
    expect(mobile).not.toMatch(/\.gallery-review \.compare-slider--stage\s*\{[^}]*100cqh/s);
  });

  it("keeps the full varimo wordmark in the phone top bar", () => {
    expect(mobile).toMatch(/\.vf-brand-wordmark\s*\{[^}]*display:\s*inline-block/s);
    expect(mobile).toMatch(/\.vf-brand-mark\s*\{[^}]*display:\s*none/s);
    expect(mobile).toMatch(/\.vf-more-trigger\s*\{[^}]*font-size:\s*0/s);
  });
});
