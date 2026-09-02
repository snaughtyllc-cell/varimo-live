import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  EXTRA_TABS,
  PRIMARY_TABS,
  STUDIO_DESTINATIONS,
} from "../studioDestinations";

function appPageHrefs(root: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    if (statSync(full).isDirectory()) {
      out.push(...appPageHrefs(full, `${prefix}/${name}`));
      continue;
    }
    if (name === "page.tsx") {
      out.push(prefix || "/");
    }
  }
  return out;
}

describe("studioDestinations", () => {
  it("lists every App Router page so a redesign cannot drop a shipped tab", () => {
    const pages = appPageHrefs(join(__dirname, "../../app")).sort();
    const hrefs = STUDIO_DESTINATIONS.map((d) => d.href).sort();
    expect(hrefs).toEqual(pages);
  });

  it("keeps the phone/desktop primary row at the five operator tabs", () => {
    expect(PRIMARY_TABS.map((d) => d.label)).toEqual([
      "Studio",
      "Gallery",
      "Drops",
      "Workflows",
      "Drive",
    ]);
  });

  it("does not hide Team, Analytics, Admin, or Diagnostics from the catalog", () => {
    expect(EXTRA_TABS.map((d) => d.label)).toEqual([
      "Team",
      "Analytics",
      "Admin",
      "Diagnostics",
    ]);
  });
});
