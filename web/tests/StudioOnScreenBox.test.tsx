import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import {
  captionsWithNewBox,
  clampTextSize,
  emptyOnScreen,
  frameAspect,
  printPlan,
  clock,
  cuesFromTrack,
  projectFromDraft,
  trackWindow,
  rectFromPoints,
  seatStyle,
  textFitWarning,
  StudioOnScreenBox,
  type OnScreenProject,
} from "@/components/studio/StudioOnScreenBox";
import { soundFileKind, soundSizeNote } from "@/lib/api";

describe("on-screen project", () => {
  it("keeps a drawn box locked by its color", () => {
    const draft = emptyOnScreen();
    draft.captions[0].text = "hello";
    draft.captions[0].box_ids = ["cyan"];
    draft.boxes = [{ id: "cyan", color: "#14b8c4", x: 0.1, y: 0.2, w: 0.5, h: 0.15 }];
    const project = projectFromDraft(draft);
    expect(typeof project).not.toBe("string");
    if (typeof project === "string") return;
    expect(project.captions[0].box_ids).toEqual(["cyan"]);
    expect(project.boxes[0]).toMatchObject({ id: "cyan", x: 0.1, y: 0.2, w: 0.5, h: 0.15 });
  });

  it("refuses a line with no box", () => {
    const draft = emptyOnScreen();
    draft.captions[0].text = "hello";
    expect(projectFromDraft(draft)).toBe("Each line needs a box.");
  });

  it("refuses two lines on the same box", () => {
    const draft = emptyOnScreen();
    draft.boxes = [{ id: "cyan", color: "#14b8c4", x: 0.1, y: 0.2, w: 0.4, h: 0.2 }];
    draft.captions = [
      { id: "1", text: "one", box_ids: ["cyan"] },
      { id: "2", text: "two", box_ids: ["cyan"] },
    ];
    expect(projectFromDraft(draft)).toBe("Each box locks to one line.");
  });

  it("refuses a drawn box that no line owns", () => {
    const draft = emptyOnScreen();
    draft.captions[0].text = "hello";
    draft.captions[0].box_ids = ["cyan"];
    draft.boxes = [
      { id: "cyan", color: "#14b8c4", x: 0.1, y: 0.2, w: 0.4, h: 0.2 },
      { id: "amber", color: "#e39b12", x: 0.1, y: 0.5, w: 0.4, h: 0.2 },
    ];
    expect(projectFromDraft(draft)).toBe("Lock every colored box to a line.");
  });

  it("parks a side seat on the edge instead of the middle of the line", () => {
    expect(seatStyle(0.18, 0.18).transform).toBe("translate(0, 0)");
    expect(seatStyle(0.18, 0.18).left).toBe("4%");
    expect(seatStyle(0.82, 0.82).right).toBe("4%");
    expect(seatStyle(0.82, 0.82).bottom).toBe("4%");
    expect(seatStyle(0.5, 0.5).transform).toBe("translate(-50%, -50%)");
  });

  it("warns when the line is wider than the box", () => {
    expect(textFitWarning(200, 100)).toMatch(/smaller/i);
    expect(textFitWarning(80, 100)).toBe("");
  });

  it("puts the preview sound first", () => {
    const draft = emptyOnScreen();
    draft.captions[0].text = "hi";
    draft.captions[0].box_ids = ["cyan"];
    draft.boxes = [{ id: "cyan", color: "#14b8c4", x: 0.1, y: 0.2, w: 0.4, h: 0.2 }];
    draft.previewAudio = "b";
    draft.audios = [
      { id: "a", name: "A", volume: 0.25, mode: "under", start: 0, bed_id: "1" },
      { id: "b", name: "B", volume: 1, mode: "replace", start: 2, bed_id: "2" },
    ];
    const project = projectFromDraft(draft);
    expect(typeof project).not.toBe("string");
    if (typeof project === "string") return;
    expect(project.audios?.map((audio) => audio.name)).toEqual(["B", "A"]);
    expect(project.audios?.[0].mode).toBe("replace");
  });

  it("treats a video as a sound and keeps audio files on the small cap", () => {
    const video = new File([new Uint8Array(8)], "trend.mp4", { type: "video/mp4" });
    const audio = new File([new Uint8Array(8)], "trend.mp3", { type: "audio/mpeg" });
    expect(soundFileKind(video)).toBe("video");
    expect(soundFileKind(audio)).toBe("audio");
    expect(soundSizeNote(video)).toBeNull();
    const huge = new File([new Uint8Array(8)], "big.mp3", { type: "audio/mpeg" });
    Object.defineProperty(huge, "size", { value: 21 * 1024 * 1024 });
    expect(soundSizeNote(huge)).toMatch(/20 MB/);
  });

  it("lets add sound pick a video", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Sound" }));
    const input = screen.getByLabelText("Add a sound", { selector: "input", hidden: true });
    expect(input.getAttribute("accept")).toContain("video");
  });

  it("caps a printed pack at forty variants", () => {
    expect(printPlan(8, 2)).toEqual({ each: 8, total: 16 });
    expect(printPlan(10, 5)).toEqual({ each: 8, total: 40 });
  });

  it("can send both one line and two lines", () => {
    const draft = emptyOnScreen();
    draft.captions[0].text = "here";
    draft.captions[0].box_ids = ["cyan"];
    draft.captions[0].lines = "both";
    draft.boxes = [{ id: "cyan", color: "#14b8c4", x: 0.1, y: 0.2, w: 0.5, h: 0.3 }];
    const project = projectFromDraft(draft);
    expect(typeof project).not.toBe("string");
    if (typeof project === "string") return;
    expect(project.captions[0].lines).toBe("both");
  });

  it("sends only the seats that are turned on", () => {
    const draft = emptyOnScreen();
    draft.chooseSeats = true;
    draft.captions[0].text = "here";
    draft.captions[0].box_ids = ["cyan"];
    draft.captions[0].place = { cyan: { x: 0.18, y: 0.82 } };
    draft.boxes = [{ id: "cyan", color: "#14b8c4", x: 0.1, y: 0.2, w: 0.5, h: 0.3, seats: ["bl", "br"] }];
    const project = projectFromDraft(draft);
    expect(typeof project).not.toBe("string");
    if (typeof project === "string") return;
    expect(project.boxes[0].seats).toEqual(["bl", "br"]);
  });

  it("sends when a line comes in and when it leaves", () => {
    const draft = emptyOnScreen();
    draft.captions[0].text = "hello";
    draft.captions[0].box_ids = ["cyan"];
    draft.captions[0].show = 1.5;
    draft.captions[0].hide = 4;
    draft.boxes = [{ id: "cyan", color: "#14b8c4", x: 0.1, y: 0.2, w: 0.5, h: 0.2 }];
    const project = projectFromDraft(draft);
    expect(typeof project).not.toBe("string");
    if (typeof project === "string") return;
    expect(project.captions[0].show).toBe(1.5);
    expect(project.captions[0].hide).toBe(4);
    draft.captions[0].hide = 1;
    const dropped = projectFromDraft(draft);
    expect(typeof dropped).not.toBe("string");
    if (typeof dropped === "string") return;
    expect(dropped.captions[0].show).toBe(1.5);
    expect(dropped.captions[0].hide).toBeUndefined();
  });

  it("keeps a chosen text size and a one-line lock", () => {
    expect(clampTextSize(2)).toBe(1.6);
    const draft = emptyOnScreen();
    draft.captions[0].text = "hello";
    draft.captions[0].box_ids = ["cyan"];
    draft.captions[0].size = 0.8;
    draft.captions[0].lines = 1;
    draft.boxes = [{ id: "cyan", color: "#14b8c4", x: 0.1, y: 0.2, w: 0.5, h: 0.2 }];
    const project = projectFromDraft(draft);
    expect(typeof project).not.toBe("string");
    if (typeof project === "string") return;
    expect(project.captions[0].size).toBe(0.8);
    expect(project.captions[0].lines).toBe(1);
  });

  it("locks a new box onto the first open line", () => {
    const lines = captionsWithNewBox(
      [
        { id: "1", text: "one", box_ids: [] },
        { id: "2", text: "two", box_ids: [] },
      ],
      "cyan",
    );
    expect(lines[0].box_ids).toEqual(["cyan"]);
    expect(lines[1].box_ids).toEqual([]);
    const extra = captionsWithNewBox(
      [{ id: "1", text: "one", box_ids: ["cyan"] }],
      "amber",
    );
    expect(extra[0].box_ids).toEqual(["cyan", "amber"]);
  });

  it("uses the clip shape until a format is picked", () => {
    expect(frameAspect(null, 1920, 1080).css).toBe("1920 / 1080");
    expect(frameAspect("4:5", 1920, 1080).css).toBe("4 / 5");
    expect(frameAspect(null).css).toBe("9 / 16");
  });

  it("turns a timeline drag into the caption window", () => {
    expect(trackWindow(undefined, undefined, 8)).toEqual({ start: 0, end: 8 });
    expect(trackWindow(1, 5, 8)).toEqual({ start: 1, end: 5 });
    expect(cuesFromTrack(0, 8, 8)).toEqual({});
    expect(cuesFromTrack(1, 5, 8)).toEqual({ show: 1, hide: 5 });
    expect(clock(65)).toBe("1:05");
  });

  it("turns a drag into a rectangle", () => {
    const rect = rectFromPoints(0.4, 0.5, 0.1, 0.2);
    expect(rect.x).toBeCloseTo(0.1);
    expect(rect.y).toBeCloseTo(0.2);
    expect(rect.w).toBeCloseTo(0.3);
    expect(rect.h).toBeCloseTo(0.3);
  });
});

function MultiHarness() {
  const [projects, setProjects] = useState<Record<string, OnScreenProject>>({});
  return (
    <StudioOnScreenBox
      enabled
      onEnabledChange={() => undefined}
      draft={emptyOnScreen()}
      onChange={() => undefined}
      projects={projects}
      onProjectsChange={setProjects}
      sources={[{ key: "a", name: "one.mp4" }, { key: "b", name: "two.mp4" }]}
    />
  );
}

function Harness() {
  const [draft, setDraft] = useState<OnScreenProject>(emptyOnScreen());
  return (
    <StudioOnScreenBox
      enabled
      onEnabledChange={() => undefined}
      draft={draft}
      onChange={setDraft}
    />
  );
}

function lineDraft(extra?: Partial<OnScreenProject["captions"][number]>): OnScreenProject {
  const draft = emptyOnScreen();
  draft.boxes = [{ id: "cyan", color: "#14b8c4", x: 0.1, y: 0.3, w: 0.7, h: 0.2 }];
  draft.captions = [{ id: "1", text: "hello there", box_ids: ["cyan"], ...extra }];
  return draft;
}

function Live({ start, sources }: { start: OnScreenProject; sources?: { key: string; name: string; src?: string; width?: number; height?: number }[] }) {
  const [draft, setDraft] = useState<OnScreenProject>(start);
  const built = projectFromDraft(draft);
  return (
    <>
      <StudioOnScreenBox enabled onEnabledChange={() => undefined} draft={draft} onChange={setDraft} sources={sources} />
      <output data-testid="built">{JSON.stringify(typeof built === "string" ? built : built)}</output>
    </>
  );
}

function built() {
  return JSON.parse(screen.getByTestId("built").textContent || "null");
}

function words(index = 0) {
  return screen.getByTestId("onscreen-phone").querySelector(`[data-role='text'][data-line='${index}']`) as HTMLElement | null;
}

function tap(node: Element) {
  fireEvent.pointerDown(node, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
  fireEvent.pointerUp(node, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
}

function type(text: string) {
  const box = screen.getByRole("textbox", { name: /On-screen line/ });
  box.textContent = text;
  fireEvent.input(box);
}

function rulerWidth(width: number) {
  const ruler = screen.getByTestId("clip-scrubber");
  ruler.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: width, bottom: 40, width, height: 40, toJSON() { return {}; },
  });
}

describe("one editing screen", () => {
  it("adds a line on the video and types it there, with no second form", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Tap to add text/ }));
    type("sale");
    expect(document.querySelector("textarea")).toBeNull();
    expect(words()?.textContent).toBe("sale");
    expect(screen.getAllByTestId("caption-track")).toHaveLength(1);
  });

  it("keeps a different line on each source", () => {
    render(<MultiHarness />);
    fireEvent.click(screen.getByRole("button", { name: /Tap to add text/ }));
    type("first");
    fireEvent.click(screen.getByRole("button", { name: "two.mp4" }));
    expect(words()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Tap to add text/ }));
    type("second");
    fireEvent.click(screen.getByRole("button", { name: "one.mp4" }));
    expect(words()?.textContent).toBe("first");
  });

  it("taps the words to pick them, and taps again to type", () => {
    render(<Live start={lineDraft()} />);
    expect(screen.queryByRole("button", { name: "Snapchat bar" })).toBeNull();
    tap(words()!);
    expect(words()?.dataset.active).toBe("true");
    expect(screen.getByRole("button", { name: "Snapchat bar" })).toBeTruthy();
    tap(words()!);
    expect(screen.getByRole("textbox", { name: "On-screen line 1" })).toBeTruthy();
  });

  it("drops a line that was left empty", () => {
    render(<Live start={lineDraft()} />);
    tap(words()!);
    tap(words()!);
    type("");
    fireEvent.blur(screen.getByRole("textbox", { name: "On-screen line 1" }));
    expect(words()).toBeNull();
    expect(screen.queryAllByTestId("caption-track")).toHaveLength(0);
  });

  it("shows the seven looks on the video when a line is picked", () => {
    render(<Live start={lineDraft()} />);
    tap(words()!);
    for (const name of ["Instagram sticker", "Strong", "Snapchat bar", "Solid", "See-through", "No shadow", "Shadow"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(words()?.className).toContain("studio-onscreen__type--solid");
    fireEvent.click(screen.getByRole("button", { name: "Snapchat bar" }));
    expect(words()?.className).toContain("studio-onscreen__type--bar");
    fireEvent.click(screen.getByRole("button", { name: "Shadow" }));
    expect(words()?.className).toContain("studio-onscreen__type--none");
    expect(built().look).toEqual({ style: "classic", background: "none", color: "#FFFFFF" });
    fireEvent.click(screen.getByRole("button", { name: "Strong" }));
    expect(words()?.dataset.style).toBe("strong");
  });

  it("trims the line's clip from either end and moves the whole clip", () => {
    render(<Live start={lineDraft()} />);
    rulerWidth(150);
    const cue = screen.getByLabelText(/Line 1 on screen/);
    const start = cue.querySelector("[data-trim='start']")!;
    fireEvent.pointerDown(start, { pointerId: 2, clientX: 0 });
    fireEvent.pointerMove(cue, { pointerId: 2, clientX: 30 });
    fireEvent.pointerUp(cue, { pointerId: 2, clientX: 30 });
    expect(built().captions[0].show).toBe(3);
    expect(built().captions[0].hide).toBeUndefined();
    const end = screen.getByLabelText(/Line 1 on screen/).querySelector("[data-trim='end']")!;
    fireEvent.pointerDown(end, { pointerId: 3, clientX: 150 });
    fireEvent.pointerMove(screen.getByLabelText(/Line 1 on screen/), { pointerId: 3, clientX: 100 });
    fireEvent.pointerUp(screen.getByLabelText(/Line 1 on screen/), { pointerId: 3, clientX: 100 });
    expect(built().captions[0]).toMatchObject({ show: 3, hide: 10 });
    const body = screen.getByLabelText(/Line 1 on screen/);
    fireEvent.pointerDown(body, { pointerId: 4, clientX: 60 });
    fireEvent.pointerMove(body, { pointerId: 4, clientX: 80 });
    fireEvent.pointerUp(body, { pointerId: 4, clientX: 80 });
    expect(built().captions[0]).toMatchObject({ show: 5, hide: 12 });
  });

  it("drags a clip back to full length to keep the line on the whole video", () => {
    render(<Live start={lineDraft({ show: 3 })} />);
    rulerWidth(150);
    const start = screen.getByLabelText(/Line 1 on screen/).querySelector("[data-trim='start']")!;
    fireEvent.pointerDown(start, { pointerId: 5, clientX: 30 });
    fireEvent.pointerMove(screen.getByLabelText(/Line 1 on screen/), { pointerId: 5, clientX: -20 });
    fireEvent.pointerUp(screen.getByLabelText(/Line 1 on screen/), { pointerId: 5, clientX: -20 });
    expect(built().captions[0].show).toBeUndefined();
    expect(built().captions[0].hide).toBeUndefined();
  });

  it("shows a timed line only while the playhead is inside its clip", () => {
    render(<Live start={lineDraft({ show: 4, hide: 8 })} />);
    rulerWidth(150);
    expect(words()).toBeNull();
    const ruler = screen.getByTestId("clip-scrubber");
    fireEvent.pointerDown(ruler, { pointerId: 6, clientX: 60 });
    fireEvent.pointerUp(ruler, { pointerId: 6, clientX: 60 });
    expect(words()?.textContent).toBe("hello there");
    fireEvent.pointerDown(ruler, { pointerId: 7, clientX: 120 });
    fireEvent.pointerUp(ruler, { pointerId: 7, clientX: 120 });
    expect(words()).toBeNull();
  });

  it("keeps size, line count, and seats one step away", () => {
    render(<Live start={lineDraft()} />);
    expect(screen.queryByRole("button", { name: "Choose seats" })).toBeNull();
    tap(words()!);
    fireEvent.change(screen.getByLabelText("Text size"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: /Fit/ }));
    fireEvent.click(screen.getByRole("button", { name: "1 line" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose seats" }));
    fireEvent.click(screen.getByRole("button", { name: "Bottom left" }));
    expect(built().captions[0]).toMatchObject({ size: 0.9, lines: 1 });
    expect(built().boxes[0].seats).toEqual(["bl"]);
    expect(words()?.getAttribute("data-lines")).toBe("1");
  });

  it("opens sound, setups, and frame as tools instead of leaving them under the video", () => {
    render(<Live start={lineDraft()} />);
    expect(screen.queryByRole("button", { name: "Add a sound" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sound" }));
    expect(screen.getByRole("button", { name: "Add a sound" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close tool" }));
    expect(screen.queryByRole("button", { name: "Add a sound" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Setups" }));
    expect(screen.getByLabelText("Setup name")).toBeTruthy();
  });

  it("shows the clip still under the Reel safe edges", () => {
    render(
      <StudioOnScreenBox
        enabled
        onEnabledChange={() => undefined}
        draft={emptyOnScreen()}
        onChange={() => undefined}
        sources={[{ key: "a", name: "gym.mp4", src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" }]}
      />,
    );
    const phone = screen.getByTestId("onscreen-phone");
    expect(phone.querySelector("img")?.getAttribute("src")).toContain("data:image");
    expect(phone.textContent).toContain("Header");
    expect(phone.textContent).toContain("Buttons");
    expect(phone.textContent).toContain("Caption");
  });

  it("shows a wide clip as wide until you pick a tall frame", () => {
    render(
      <StudioOnScreenBox
        enabled
        onEnabledChange={() => undefined}
        draft={emptyOnScreen()}
        onChange={() => undefined}
        sources={[{
          key: "wide",
          name: "wide.mp4",
          src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
          width: 1920,
          height: 1080,
        }]}
      />,
    );
    const phone = screen.getByTestId("onscreen-phone");
    expect(phone.style.aspectRatio).toBe("1920 / 1080");
    expect(phone.textContent).not.toContain("Header");
    fireEvent.click(screen.getByRole("button", { name: "Ratio" }));
    fireEvent.click(screen.getByRole("button", { name: "9:16" }));
    expect(phone.style.aspectRatio).toBe("9 / 16");
    expect(phone.textContent).toContain("Header");
  });

  it("is full screen on a phone and splits into preview, panel, and timeline on desktop", () => {
    const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");
    expect(css).toMatch(/\.studio-onscreen__sheet \{[^}]*height:\s*100dvh/s);
    expect(css).toMatch(/\.studio-onscreen__sheet \{[^}]*width:\s*100%/s);
    expect(css).toMatch(/@media \(min-width: 900px\)[\s\S]*\.studio-onscreen__body \{[^}]*grid-template-areas:\s*"stage side" "timeline side"/);
    expect(css).toMatch(/font-family:\s*"Onscreen Inter"/);
    expect(css).toMatch(/font-family:\s*"Onscreen Noto"/);
  });
});
