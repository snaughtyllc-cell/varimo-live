import { describe, it, expect, vi, beforeEach } from "vitest";
import * as api from "@/lib/api";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("url builders use relative /api", () => {
  it("variantUrl / sourceUrl / eventsUrl", () => {
    expect(api.variantUrl("s1", "v01.mp4")).toBe("/api/variants/s1/v01.mp4");
    expect(api.sourceUrl("s1")).toBe("/api/sources/s1/source");
    expect(api.eventsUrl("j1")).toBe("/api/jobs/j1/events");
  });

  it("variantUrl encodes spaces and hashtags so thumbs load", () => {
    expect(
      api.variantUrl("s1", "Age is just a number #fyp_v01.mp4"),
    ).toBe("/api/variants/s1/Age%20is%20just%20a%20number%20%23fyp_v01.mp4");
  });
});

describe("getQueue", () => {
  it("GETs /api/queue", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ running: 0, fast: 0, hq: 0, jobs: [] }), { status: 200 }),
    );
    const out = await api.getQueue();
    expect(out.running).toBe(0);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/queue");
  });
});

describe("cancelJob", () => {
  it("POSTs /api/jobs/:id/cancel", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        job_id: "j1", count: 1, created_utc: "", state: "cancelled",
        error: "Cancelled — New run when you want another pack.",
        sources: [],
      }), { status: 200 }),
    );
    const out = await api.cancelJob("j1");
    expect(out.state).toBe("cancelled");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/jobs/j1/cancel");
    expect((init as RequestInit).method).toBe("POST");
  });
});

describe("createJob posts multipart with files + count", () => {
  it("sends FormData to /api/jobs", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ job_id: "j1", sources: [] }), { status: 201 }));
    const f = new File([new Uint8Array([1, 2])], "a.mp4", { type: "video/mp4" });
    const out = await api.createJob([f], 3);
    expect(out.job_id).toBe("j1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/jobs");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    const body = (init as RequestInit).body as FormData;
    expect(body.get("count")).toBe("3");
    expect(body.get("quality_mode")).toBe("fast");
    expect(body.get("generate_captions")).toBe("false");
    expect(body.get("caption_prompt")).toBe("");
    expect(body.get("caption_prompts")).toBe("[]");
    expect(body.getAll("files").length).toBe(1);
  });

  it("sends generate_captions true when requested", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ job_id: "j1", sources: [] }), { status: 201 }));
    const f = new File([new Uint8Array([1, 2])], "a.mp4", { type: "video/mp4" });
    await api.createJob([f], 3, true, "fast", true, "POV boil #reels");
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(body.get("generate_captions")).toBe("true");
    expect(body.get("caption_prompt")).toBe("POV boil #reels");
    expect(body.get("caption_prompts")).toBe(JSON.stringify(["POV boil #reels"]));
  });

  it("sends one caption_prompts entry per source", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ job_id: "j1", sources: [] }), { status: 201 }));
    const a = new File([new Uint8Array([1])], "a.mp4", { type: "video/mp4" });
    const b = new File([new Uint8Array([2])], "b.mp4", { type: "video/mp4" });
    await api.createJob([a, b], 3, true, "fast", true, ["POV boil #reels", "Gym pull #fyp"]);
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(body.get("caption_prompt")).toBe("");
    expect(body.get("caption_prompts")).toBe(JSON.stringify(["POV boil #reels", "Gym pull #fyp"]));
  });

  it("sends quality_mode hq when requested", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ job_id: "j1", sources: [] }), { status: 201 }));
    const f = new File([new Uint8Array([1, 2])], "a.mp4", { type: "video/mp4" });
    await api.createJob([f], 2, true, "hq");
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(body.get("quality_mode")).toBe("hq");
  });

  it("retries a dropped chunked upload then starts the job", async () => {
    const f = new File([new Uint8Array(4_000_000)], "a.mp4", { type: "video/mp4" });
    let offset0 = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u === "/api/uploads") {
        return new Response(JSON.stringify({ upload_id: "up1", chunk_hint: 2_000_000 }), { status: 200 });
      }
      if (u.includes("/api/uploads/up1?offset=0")) {
        offset0 += 1;
        if (offset0 === 1) {
          return new Response("Bad Gateway", { status: 502, statusText: "Bad Gateway" });
        }
        return new Response(JSON.stringify({ received: 2000000 }), { status: 200 });
      }
      if (u.includes("/api/uploads/up1?offset=2000000")) {
        return new Response(JSON.stringify({ received: 4000000 }), { status: 200 });
      }
      if (u === "/api/jobs/from-uploads") {
        return new Response(JSON.stringify({ job_id: "j1", sources: [] }), { status: 201 });
      }
      return new Response("nope", { status: 500, statusText: "Internal Server Error" });
    });
    const out = await api.createJob([f], 20);
    expect(out.job_id).toBe("j1");
    expect(offset0).toBe(2);
    const fromUploads = fetchMock.mock.calls.find((c) => String(c[0]) === "/api/jobs/from-uploads");
    expect(fromUploads).toBeTruthy();
    const fromBody = (fromUploads![1] as RequestInit).body as FormData;
    expect(fromBody.get("generate_captions")).toBe("false");
    expect(fromBody.get("caption_prompt")).toBe("");
    expect(fromBody.get("caption_prompts")).toBe("[]");
  });
});

describe("regenerate posts form n", () => {
  it("sends n to the regenerate route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ source_id: "s1", filename: "a.mp4", requested: 2, delivered: 2, shortfall: 0, variants: [] }), { status: 200 }));
    await api.regenerate("s1", 2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sources/s1/regenerate");
    const body = (init as RequestInit).body as FormData;
    expect(body.get("n")).toBe("2");
  });
});

describe("retryCopy", () => {
  it("POSTs /api/sources/:id/retry-copy", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        source_id: "s1", filename: "a.mp4", requested: 1, delivered: 1, shortfall: 0,
        files_ready: 1, copy_status: "ok", variants: [],
      }), { status: 200 }),
    );
    await api.retryCopy("s1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sources/s1/retry-copy");
    expect((init as RequestInit).method).toBe("POST");
  });
});

describe("setPostUrl", () => {
  it("POSTs the pasted permalink", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        index: 1, filename: "v01.mp4", status: "ok", quality: {},
        file_url: "/api/variants/s1/v01.mp4",
        post_url: "https://www.instagram.com/reel/AbC/",
      }), { status: 200 }),
    );
    const out = await api.setPostUrl("s1", 1, "https://www.instagram.com/reel/AbC/");
    expect(out.post_url).toBe("https://www.instagram.com/reel/AbC/");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/variants/s1/1/post-url");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      url: "https://www.instagram.com/reel/AbC/",
    });
  });
});

describe("setVariantCaption", () => {
  it("POSTs the edited caption", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        index: 1, filename: "v01.mp4", status: "ok", quality: {},
        file_url: "/api/variants/s1/v01.mp4",
        caption: "Wait — the boil hits different\n#reels",
      }), { status: 200 }),
    );
    const out = await api.setVariantCaption("s1", 1, "Wait — the boil hits different\n#reels");
    expect(out.caption).toMatch(/hits different/);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/variants/s1/1/caption");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      caption: "Wait — the boil hits different\n#reels",
    });
  });
});

describe("rewriteSourceCaptions", () => {
  it("POSTs a seed to rewrite every copy", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        source_id: "s1", filename: "a.mp4", requested: 2, delivered: 2, shortfall: 0,
        variants: [], caption_prompt: "Gym pump #fyp",
      }), { status: 200 }),
    );
    const out = await api.rewriteSourceCaptions("s1", "Gym pump #fyp");
    expect(out.caption_prompt).toBe("Gym pump #fyp");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sources/s1/captions");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ prompt: "Gym pump #fyp" });
  });
});

describe("removeSource", () => {
  it("DELETEs /api/sources/:id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    await api.removeSource("s1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sources/s1");
    expect((init as RequestInit).method).toBe("DELETE");
  });
});

it("createDriveExport posts destination, variants, consume_bank, and caption folder", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ export_id: "exp_1", state: "pending", files: [] }), { status: 200 }),
  );
  await api.createDriveExport("dst_1", [{ source_id: "s1", index: 1, caption: "POV #reels" }], true, "bank_gym");
  const [, init] = fetchMock.mock.calls[0];
  expect(JSON.parse((init as RequestInit).body as string)).toEqual({
    destination_id: "dst_1",
    variants: [{ source_id: "s1", index: 1, caption: "POV #reels" }],
    consume_bank: true,
    caption_bank_id: "bank_gym",
  });
});

it("createDriveExportSplit posts job_id, selected, destinations, consume_bank, and caption folder", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true, jobs: [], split: [] }), { status: 201 }),
  );
  await api.createDriveExportSplit({
    job_id: "j1",
    selected: [{ source_id: "s1", index: 1, caption: "POV #reels" }],
    destinations: [
      { destination_id: "dst_main", label: "main" },
      { destination_id: "dst_trial", label: "trial" },
      { destination_id: "dst_growth", label: "growth" },
    ],
    consume_bank: true,
    caption_bank_id: "bank_gym",
  });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/drive/exports/split");
  expect((init as RequestInit).method).toBe("POST");
  expect(JSON.parse((init as RequestInit).body as string)).toEqual({
    job_id: "j1",
    selected: [{ source_id: "s1", index: 1, caption: "POV #reels" }],
    destinations: [
      { destination_id: "dst_main", label: "main" },
      { destination_id: "dst_trial", label: "trial" },
      { destination_id: "dst_growth", label: "growth" },
    ],
    consume_bank: true,
    caption_bank_id: "bank_gym",
  });
});

describe("listDriveExports", () => {
  it("GETs /api/drive/exports", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );
    const out = await api.listDriveExports();
    expect(out).toEqual([]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/drive/exports");
  });
});

describe("captions API", () => {
  it("listCaptions GETs /api/captions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ cursor: 0, items: [] }), { status: 200 }),
    );
    await api.listCaptions();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/captions");
  });

  it("listCaptions and previewCaptions pass bank_id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ cursor: 0, items: [], captions: [] }), { status: 200 })),
    );
    await api.listCaptions("bank_gym");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/captions?bank_id=bank_gym");
    await api.previewCaptions(3, "bank_gym");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/captions/preview?n=3&bank_id=bank_gym");
  });

  it("listCaptionBanks GETs /api/caption-banks", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );
    await api.listCaptionBanks();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/caption-banks");
  });
});

describe("listDestinationVideos", () => {
  it("GETs /api/drive/destinations/:id/videos", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ videos: [{ id: "f1", name: "clip.mp4", mime_type: "video/mp4", md5: null }] }), { status: 200 }),
    );
    const out = await api.listDestinationVideos("dst_1");
    expect(out.videos).toHaveLength(1);
    expect(out.videos[0].name).toBe("clip.mp4");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/drive/destinations/dst_1/videos");
  });
});

describe("createJobFromDrive", () => {
  it("POSTs JSON to /api/jobs/from-drive", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ job_id: "j1", sources: [] }), { status: 201 }),
    );
    await api.createJobFromDrive({
      destinationId: "dst_1",
      fileIds: ["f1", "f2"],
      count: 20,
      qualityMode: "hq",
      allowCreativeEscalate: false,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/jobs/from-drive");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      destination_id: "dst_1",
      file_ids: ["f1", "f2"],
      count: 20,
      quality_mode: "hq",
      allow_creative_escalate: false,
      generate_captions: false,
      caption_prompt: "",
      caption_prompts: [],
    });
  });

  it("sends generate_captions true when requested", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ job_id: "j1", sources: [] }), { status: 201 }),
    );
    await api.createJobFromDrive({
      destinationId: "dst_1",
      fileIds: ["f1"],
      count: 3,
      generateCaptions: true,
      captionPrompt: "POV boil #reels",
    });
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      destination_id: "dst_1",
      file_ids: ["f1"],
      count: 3,
      quality_mode: "fast",
      allow_creative_escalate: true,
      generate_captions: true,
      caption_prompt: "POV boil #reels",
      caption_prompts: ["POV boil #reels"],
    });
  });

  it("sends one caption_prompts entry per Drive source", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ job_id: "j1", sources: [] }), { status: 201 }),
    );
    await api.createJobFromDrive({
      destinationId: "dst_1",
      fileIds: ["f1", "f2"],
      count: 8,
      generateCaptions: true,
      captionPrompt: ["POV boil #reels", "Gym pull #fyp"],
    });
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      destination_id: "dst_1",
      file_ids: ["f1", "f2"],
      count: 8,
      quality_mode: "fast",
      allow_creative_escalate: true,
      generate_captions: true,
      caption_prompt: "",
      caption_prompts: ["POV boil #reels", "Gym pull #fyp"],
    });
  });
});

describe("workflows API", () => {
  const sampleWorkflow = {
    id: "wf_1",
    name: "Inbox → Out",
    inbox_destination_id: "dst_in",
    output_destination_id: "dst_out",
    count: 20,
    quality_mode: "fast" as const,
    allow_creative_escalate: true,
    enabled: true,
    poll_seconds: 120,
    last_sweep_at: null,
    last_summary: null,
    auto_caption: false,
    caption_bank_id: null,
  };

  it("listWorkflows GETs /api/workflows", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([sampleWorkflow]), { status: 200 }),
    );
    const out = await api.listWorkflows();
    expect(out).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workflows");
  });

  it("createWorkflow POSTs JSON", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(sampleWorkflow), { status: 201 }),
    );
    await api.createWorkflow({
      name: "Inbox → Out",
      inbox_destination_id: "dst_in",
      output_destination_id: "dst_out",
      caption_from_filename: true,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workflows");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: "Inbox → Out",
      inbox_destination_id: "dst_in",
      output_destination_id: "dst_out",
      caption_from_filename: true,
    });
  });

  it("updateWorkflow PATCHes /api/workflows/:id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ...sampleWorkflow, enabled: false }), { status: 200 }),
    );
    await api.updateWorkflow("wf_1", { enabled: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workflows/wf_1");
    expect((init as RequestInit).method).toBe("PATCH");
  });

  it("deleteWorkflow DELETEs /api/workflows/:id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await api.deleteWorkflow("wf_1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workflows/wf_1");
    expect((init as RequestInit).method).toBe("DELETE");
  });

  it("runWorkflow POSTs /api/workflows/:id/run", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(sampleWorkflow), { status: 200 }),
    );
    await api.runWorkflow("wf_1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workflows/wf_1/run");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("cancelWorkflow POSTs /api/workflows/:id/cancel", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ...sampleWorkflow, enabled: false }), { status: 200 }),
    );
    const out = await api.cancelWorkflow("wf_1");
    expect(out.enabled).toBe(false);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workflows/wf_1/cancel");
    expect((init as RequestInit).method).toBe("POST");
  });
});

describe("auth API", () => {
  const loggedOut = {
    auth_required: true,
    email: null,
    name: null,
    workspace_id: null,
    workspace_name: null,
    home_workspace_id: null,
    viewing_other: false,
    role: null,
    is_admin: false,
    has_password: false,
    experience: "agency",
  };

  it("getAuthMe GETs /api/auth/me", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ...loggedOut, auth_required: false }), { status: 200 }),
    );
    const out = await api.getAuthMe();
    expect(out.auth_required).toBe(false);
    expect(out.email).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/me");
  });

  it("getAuthMe maps 401 to a logged-out auth_required session", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "login_required" }), { status: 401, statusText: "Unauthorized" }),
    );
    const out = await api.getAuthMe();
    expect(out).toEqual(loggedOut);
  });

  it("passwordLogin POSTs email and password", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ...loggedOut, email: "a@b.com", has_password: true }), { status: 200 }),
    );
    await api.passwordLogin("a@b.com", "secret12");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/password");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      email: "a@b.com",
      password: "secret12",
    });
  });

  it("setStudioPassword POSTs /api/auth/password/set", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await api.setStudioPassword("secret12");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/password/set");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ password: "secret12" });
  });

  it("listInvites GETs /api/auth/invites", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );
    await api.listInvites();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/invites");
  });

  it("createInvite POSTs email and kind", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        id: "inv_1", email: "va@example.com", kind: "join",
        workspace_id: "ws_home", created_utc: "2026-08-20T00:00:00Z",
      }), { status: 201 }),
    );
    await api.createInvite("va@example.com", "join");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/invites");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      email: "va@example.com",
      kind: "join",
    });
  });

  it("deleteInvite DELETEs /api/auth/invites/:id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await api.deleteInvite("inv_1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/invites/inv_1");
    expect((init as RequestInit).method).toBe("DELETE");
  });
});

describe("admin API", () => {
  it("listAdminWorkspaces GETs /api/admin/workspaces", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );
    await api.listAdminWorkspaces();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/workspaces");
  });

  it("removeAdminUser DELETEs the encoded email", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await api.removeAdminUser("va@x.com");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/users/va%40x.com");
    expect((init as RequestInit).method).toBe("DELETE");
  });

  it("setWorkspaceExperience PATCHes /api/admin/workspaces/:id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        id: "ws_va", name: "Maya", owner_email: "maya@example.com",
        member_count: 1, members: [], running: 0, fast: 0, hq: 0,
        last_job_utc: null, last_error: null, experience: "solo",
      }), { status: 200 }),
    );
    const out = await api.setWorkspaceExperience("ws_va", "solo");
    expect(out.experience).toBe("solo");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/workspaces/ws_va");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ experience: "solo" });
  });

  it("setAdminView POSTs workspace_id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await api.setAdminView("ws_va");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/view");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ workspace_id: "ws_va" });
  });

  it("setAdminView POSTs null to exit to home studio", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await api.setAdminView(null);
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      workspace_id: null,
    });
  });
});

describe("drop ledger API", () => {
  const sheet = {
    spreadsheet_id: "sheet_1",
    spreadsheet_url: "https://docs.google.com/spreadsheets/d/sheet_1",
  };

  it("getDropLedgerStatus GETs /api/drop-ledger/status", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        configured: false,
        spreadsheet_id: null,
        spreadsheet_url: null,
        message: "Connect Google first (Settings → Drive), then tap Ensure sheet to create VaryForge Drop Ledger",
      }), { status: 200 }),
    );
    const out = await api.getDropLedgerStatus();
    expect(out.configured).toBe(false);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/drop-ledger/status");
  });

  it("ensureDropLedger POSTs /api/drop-ledger/ensure", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ...sheet, created: true }), { status: 200 }),
    );
    const out = await api.ensureDropLedger();
    expect(out.created).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/drop-ledger/ensure");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("syncDropLedger POSTs job_ids and ensure", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ...sheet, job_ids: ["j1"], rows: 2, inserted: 2, updated: 0, unchanged: 0,
      }), { status: 200 }),
    );
    const out = await api.syncDropLedger({ job_ids: ["j1"], ensure: true });
    expect(out.inserted).toBe(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/drop-ledger/sync");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      job_ids: ["j1"],
      ensure: true,
    });
  });

  it("syncDropLedger defaults to ensure: true", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ...sheet, job_ids: [], rows: 0, inserted: 0, updated: 0, unchanged: 0,
      }), { status: 200 }),
    );
    await api.syncDropLedger();
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      ensure: true,
    });
  });
});

describe("workspace team API", () => {
  it("getWorkspaceTeam GETs /api/workspace/team", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        workspace_id: "ws_ops", workspace_name: "Ops", members: [], invites: [],
      }), { status: 200 }),
    );
    await api.getWorkspaceTeam();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workspace/team");
  });

  it("createWorkspaceInvite POSTs email only (join)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        id: "inv_1", email: "va@x.com", kind: "join",
        workspace_id: "ws_ops", created_utc: "2026-08-20T00:00:00Z",
      }), { status: 201 }),
    );
    await api.createWorkspaceInvite("va@x.com");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workspace/invites");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ email: "va@x.com" });
  });

  it("deleteWorkspaceInvite DELETEs the invite id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await api.deleteWorkspaceInvite("inv_1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workspace/invites/inv_1");
    expect((init as RequestInit).method).toBe("DELETE");
  });

  it("removeWorkspaceMember DELETEs the encoded email", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await api.removeWorkspaceMember("va@x.com");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workspace/members/va%40x.com");
    expect((init as RequestInit).method).toBe("DELETE");
  });
});

describe("Instagram API", () => {
  const status = {
    oauth_available: true,
    connected: true,
    accounts: [{ user_id: "178", username: "lab.ig", name: "Lab", connected_utc: "2026-09-02T00:00:00Z" }],
    message: "1 Instagram account connected — Connect another tester anytime",
  };

  it("getInstagramStatus GETs /api/instagram/status", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(status), { status: 200 }),
    );
    const out = await api.getInstagramStatus();
    expect(out.connected).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/instagram/status");
  });

  it("getInstagramAnalytics GETs /api/instagram/analytics", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        insights_views: null,
        insights_linked: 0,
        ranked: [],
        accounts: status.accounts,
      }), { status: 200 }),
    );
    const out = await api.getInstagramAnalytics();
    expect(out.insights_linked).toBe(0);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/instagram/analytics");
  });

  it("syncInstagram POSTs /api/instagram/sync", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        matched: 1,
        accounts: 1,
        media: 3,
        analytics: { insights_views: 500, insights_linked: 1, ranked: [] },
      }), { status: 200 }),
    );
    const out = await api.syncInstagram();
    expect(out.matched).toBe(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/instagram/sync");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("disconnectInstagram POSTs the encoded account id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ...status, accounts: [] }), { status: 200 }),
    );
    await api.disconnectInstagram("178/alt");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/instagram/accounts/178%2Falt/disconnect");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("pasteInstagramToken POSTs access_token JSON", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(status), { status: 200 }),
    );
    await api.pasteInstagramToken("pasted-long-token");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/instagram/token");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      access_token: "pasted-long-token",
    });
  });

  it("linkInstagramMedia POSTs the unmatched Reel onto a Gallery copy", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        insights_views: 50,
        insights_linked: 1,
        ranked: [],
        suggestions: [],
        accounts: status.accounts,
      }), { status: 200 }),
    );
    const out = await api.linkInstagramMedia({
      source_id: "s1",
      index: 2,
      media_id: "orphan",
      ig_user_id: "178",
      permalink: "https://www.instagram.com/reel/OrphanReel/",
    });
    expect(out.insights_linked).toBe(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/instagram/link");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      source_id: "s1",
      index: 2,
      media_id: "orphan",
      ig_user_id: "178",
      permalink: "https://www.instagram.com/reel/OrphanReel/",
    });
  });

  it("unlinkInstagramMedia POSTs the Gallery copy to drop", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        insights_views: 0,
        insights_linked: 0,
        ranked: [],
        suggestions: [],
        accounts: status.accounts,
      }), { status: 200 }),
    );
    await api.unlinkInstagramMedia({ source_id: "s1", index: 7 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/instagram/unlink");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      source_id: "s1",
      index: 7,
    });
  });
});

describe("error responses surface FastAPI `detail`", () => {
  it("throws the detail string from a JSON error body", async () => {
    const detail = "Cannot write to this folder — share it as Editor with sa@example.iam.gserviceaccount.com";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail }), { status: 400, statusText: "Bad Request" }),
    );
    await expect(api.getDriveStatus()).rejects.toThrow(detail);
  });

  it("joins array-style validation `detail` entries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ detail: [{ msg: "no ok videos in selection" }, { msg: "destination required" }] }),
        { status: 422, statusText: "Unprocessable Entity" },
      ),
    );
    await expect(api.getDriveStatus()).rejects.toThrow("no ok videos in selection; destination required");
  });

  it("maps 502 to a Generate-again upload drop", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>502</html>", { status: 502, statusText: "Bad Gateway" }),
    );
    await expect(api.getDriveStatus()).rejects.toThrow(/Generate again/i);
  });

  it("maps 504 to a Generate-again timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>504</html>", { status: 504, statusText: "Gateway Timeout" }),
    );
    await expect(api.getDriveStatus()).rejects.toThrow(/Generate again/i);
  });

  it("falls back to status text when the body isn't JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>not json</html>", { status: 500, statusText: "Internal Server Error" }),
    );
    await expect(api.getDriveStatus()).rejects.toThrow("500 Internal Server Error");
  });
});
