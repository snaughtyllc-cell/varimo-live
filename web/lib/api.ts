import {
  AdminWorkspace,
  AuthMe,
  Caption,
  CaptionBank,
  CaptionBankFolder,
  CreateJobResponse,
  Destination,
  DiagnosticsItem,
  DriveStatus,
  DropLedgerEnsure,
  DropLedgerStatus,
  DropLedgerSync,
  DriveVideo,
  DropPack,
  ExportJob,
  ExportVariantRef,
  Invite,
  InviteKind,
  SplitExportDest,
  SplitExportResult,
  JobDetail,
  JobSummary,
  PlatformResult,
  QueueSnapshot,
  SourceOut,
  Team,
  VariantOut,
  Workflow,
} from "./types";

/**
 * FastAPI error bodies are `{"detail": string | Array<{msg: string, ...}>}`.
 * Prefer that over the generic status text so actionable messages (e.g. Drive
 * permission/quota errors) reach the UI instead of "400 Bad Request".
 */
async function errorMessage(res: Response): Promise<string> {
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return "Upload dropped before Generate started — hit Generate again.";
  }
  const fallback = `${res.status} ${res.statusText}`;
  try {
    const body = await res.clone().json();
    const detail = body?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail) && detail.length) {
      return detail
        .map((d) => (typeof d === "string" ? d : d?.msg ?? JSON.stringify(d)))
        .join("; ");
    }
  } catch {
    // Body wasn't JSON (or was empty) — fall back to status text below.
  }
  return fallback;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json() as Promise<T>;
}

export const variantUrl = (sourceId: string, filename: string) =>
  `/api/variants/${encodeURIComponent(sourceId)}/${encodeURIComponent(filename)}`;
export const sourceUrl = (sourceId: string) => `/api/sources/${sourceId}/source`;
export const eventsUrl = (jobId: string) => `/api/jobs/${jobId}/events`;
export const sourceZipUrl = (sourceId: string) => `/api/sources/${sourceId}/zip`;

export const getHealth = () => fetch("/api/health").then(json<{ status: string; lab?: boolean }>);
export const getJobs = () => fetch("/api/jobs").then(json<JobSummary[]>);
export const getQueue = () => fetch("/api/queue").then(json<QueueSnapshot>);
export const getJob = (id: string) =>
  fetch(`/api/jobs/${id}`, { cache: "no-store" }).then(json<JobDetail>);
export const cancelJob = (id: string) =>
  fetch(`/api/jobs/${id}/cancel`, { method: "POST" }).then(json<JobDetail>);
export const getGallery = () => fetch("/api/gallery").then(json<SourceOut[]>);
export const getDiagnostics = () => fetch("/api/diagnostics").then(json<DiagnosticsItem[]>);

/** RunPod's HTTP proxy often drops multipart bodies above a few MB — chunk instead. */
const CHUNK_THRESHOLD = 3_500_000;
const CHUNK_SIZE = 2_000_000;
const CHUNK_RETRIES = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function putChunk(url: string, body: ArrayBuffer): Promise<void> {
  let last = "Upload dropped — hit Generate again.";
  for (let attempt = 0; attempt < CHUNK_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body,
      });
      if (res.ok) return;
      last = await errorMessage(res);
      if (res.status !== 400 && res.status !== 408 && res.status < 500) {
        throw new Error(last);
      }
    } catch (err) {
      last = err instanceof Error ? err.message : last;
    }
    await sleep(400 * 2 ** attempt);
  }
  throw new Error(last);
}

async function uploadFileChunked(file: File): Promise<string> {
  const initFd = new FormData();
  initFd.append("filename", file.name);
  initFd.append("size", String(file.size));
  const init = await fetch("/api/uploads", { method: "POST", body: initFd }).then(
    json<{ upload_id: string; chunk_hint?: number }>,
  );
  const chunkSize = init.chunk_hint || CHUNK_SIZE;
  let offset = 0;
  while (offset < file.size) {
    const blob = file.slice(offset, offset + chunkSize);
    const buf = await blob.arrayBuffer();
    await putChunk(`/api/uploads/${init.upload_id}?offset=${offset}`, buf);
    offset += blob.size;
  }
  return init.upload_id;
}

function captionFields(generate: boolean, captionPrompt: string | string[]): {
  caption_prompt: string;
  caption_prompts: string;
} {
  if (!generate) return { caption_prompt: "", caption_prompts: "[]" };
  const list = Array.isArray(captionPrompt) ? captionPrompt : [captionPrompt];
  return {
    caption_prompt: list.length === 1 ? (list[0] ?? "") : "",
    caption_prompts: JSON.stringify(list),
  };
}

export async function createJob(
  files: File[],
  count: number,
  allowCreativeEscalate: boolean = true,
  qualityMode: "fast" | "hq" = "fast",
  generateCaptions: boolean = false,
  captionPrompt: string | string[] = "",
): Promise<CreateJobResponse> {
  const captions = generateCaptions ? "true" : "false";
  const prompts = captionFields(generateCaptions, captionPrompt);
  const needsChunk = files.some((f) => f.size > CHUNK_THRESHOLD);
  if (!needsChunk) {
    const fd = new FormData();
    fd.append("count", String(count));
    fd.append("allow_creative_escalate", String(allowCreativeEscalate));
    fd.append("quality_mode", qualityMode);
    fd.append("generate_captions", captions);
    fd.append("caption_prompt", prompts.caption_prompt);
    fd.append("caption_prompts", prompts.caption_prompts);
    for (const f of files) fd.append("files", f, f.name);
    return fetch("/api/jobs", { method: "POST", body: fd }).then(json<CreateJobResponse>);
  }

  const uploadIds: string[] = [];
  for (const f of files) {
    uploadIds.push(await uploadFileChunked(f));
  }
  const fd = new FormData();
  fd.append("upload_ids", uploadIds.join(","));
  fd.append("count", String(count));
  fd.append("allow_creative_escalate", String(allowCreativeEscalate));
  fd.append("quality_mode", qualityMode);
  fd.append("generate_captions", captions);
  fd.append("caption_prompt", prompts.caption_prompt);
  fd.append("caption_prompts", prompts.caption_prompts);
  return fetch("/api/jobs/from-uploads", { method: "POST", body: fd }).then(json<CreateJobResponse>);
}

export function regenerate(sourceId: string, n: number): Promise<SourceOut> {
  const fd = new FormData();
  fd.append("n", String(n));
  return fetch(`/api/sources/${sourceId}/regenerate`, { method: "POST", body: fd }).then(json<SourceOut>);
}

export async function removeSource(sourceId: string): Promise<void> {
  const res = await fetch(`/api/sources/${sourceId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export function retryCopy(sourceId: string): Promise<SourceOut> {
  return fetch(`/api/sources/${sourceId}/retry-copy`, { method: "POST" }).then(json<SourceOut>);
}

export function setPlatformResult(sourceId: string, index: number, result: PlatformResult): Promise<VariantOut> {
  return fetch(`/api/variants/${sourceId}/${index}/platform-result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ result }),
  }).then(json<VariantOut>);
}

export function setPostUrl(sourceId: string, index: number, url: string): Promise<VariantOut> {
  return fetch(`/api/variants/${sourceId}/${index}/post-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  }).then(json<VariantOut>);
}

export function setVariantCaption(sourceId: string, index: number, caption: string): Promise<VariantOut> {
  return fetch(`/api/variants/${sourceId}/${index}/caption`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caption }),
  }).then(json<VariantOut>);
}

export function rewriteSourceCaptions(sourceId: string, prompt: string): Promise<SourceOut> {
  return fetch(`/api/sources/${sourceId}/captions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  }).then(json<SourceOut>);
}

export const getDriveStatus = () => fetch("/api/drive/status").then(json<DriveStatus>);

export async function disconnectDriveOAuth(): Promise<void> {
  const res = await fetch("/api/drive/oauth/disconnect", { method: "POST" });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export const listDestinations = () => fetch("/api/drive/destinations").then(json<Destination[]>);

export function createDestination(name: string, folderUrl: string): Promise<Destination> {
  return fetch("/api/drive/destinations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, folder_url: folderUrl }),
  }).then(json<Destination>);
}

export function updateDestination(
  id: string,
  patch: { name?: string; folder_url?: string },
): Promise<Destination> {
  return fetch(`/api/drive/destinations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then(json<Destination>);
}

export async function deleteDestination(id: string): Promise<void> {
  const res = await fetch(`/api/drive/destinations/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export const testDestination = (id: string) =>
  fetch(`/api/drive/destinations/${id}/test`, { method: "POST" }).then(json<{ ok: boolean }>);

export function createDriveExport(
  destinationId: string,
  variants: ExportVariantRef[],
  consumeBank = false,
  captionBankId?: string,
): Promise<ExportJob> {
  return fetch("/api/drive/exports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      destination_id: destinationId,
      variants,
      consume_bank: consumeBank,
      ...(captionBankId ? { caption_bank_id: captionBankId } : {}),
    }),
  }).then(json<ExportJob>);
}

export function createDriveExportSplit(body: {
  job_id?: string;
  selected: ExportVariantRef[];
  destinations: SplitExportDest[];
  consume_bank?: boolean;
  caption_bank_id?: string;
}): Promise<SplitExportResult> {
  return fetch("/api/drive/exports/split", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(body.job_id ? { job_id: body.job_id } : {}),
      selected: body.selected,
      destinations: body.destinations,
      consume_bank: body.consume_bank ?? false,
      ...(body.caption_bank_id ? { caption_bank_id: body.caption_bank_id } : {}),
    }),
  }).then(json<SplitExportResult>);
}

export function splitResultToJobs(result: SplitExportResult): ExportJob[] {
  return result.jobs.map((j) => ({
    export_id: j.id,
    destination_id: j.dest,
    folder_id: "",
    state: "pending",
    created_utc: "",
    files: j.files.map((filename, index) => ({
      source_id: "",
      index: index + 1,
      filename,
      status: "pending",
    })),
  }));
}

export async function createSplitDriveExport(
  destinationIds: string[],
  variants: ExportVariantRef[],
  consumeBank = false,
  captionBankId?: string,
  jobId?: string,
): Promise<ExportJob[]> {
  const labels = ["main", "trial", "growth"] as const;
  const result = await createDriveExportSplit({
    job_id: jobId,
    selected: variants,
    destinations: destinationIds.map((destination_id, i) => ({
      destination_id,
      label: labels[i],
    })),
    consume_bank: consumeBank,
    caption_bank_id: captionBankId,
  });
  return splitResultToJobs(result);
}

export const getDriveExport = (exportId: string) =>
  fetch(`/api/drive/exports/${exportId}`, { cache: "no-store" }).then(json<ExportJob>);

export const listDriveExports = () =>
  fetch("/api/drive/exports", { cache: "no-store" }).then(json<DropPack[]>);

export const retryDriveExport = (exportId: string) =>
  fetch(`/api/drive/exports/${exportId}/retry`, { method: "POST" }).then(json<ExportJob>);

export const listDestinationVideos = (destinationId: string) =>
  fetch(`/api/drive/destinations/${destinationId}/videos`).then(json<{ videos: DriveVideo[] }>);

export function createJobFromDrive(opts: {
  destinationId: string;
  fileIds: string[];
  count: number;
  qualityMode?: "fast" | "hq";
  allowCreativeEscalate?: boolean;
  generateCaptions?: boolean;
  captionPrompt?: string | string[];
}): Promise<CreateJobResponse> {
  const packed = captionFields(opts.generateCaptions ?? false, opts.captionPrompt ?? "");
  return fetch("/api/jobs/from-drive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      destination_id: opts.destinationId,
      file_ids: opts.fileIds,
      count: opts.count,
      quality_mode: opts.qualityMode ?? "fast",
      allow_creative_escalate: opts.allowCreativeEscalate ?? true,
      generate_captions: opts.generateCaptions ?? false,
      caption_prompt: packed.caption_prompt,
      caption_prompts: JSON.parse(packed.caption_prompts) as string[],
    }),
  }).then(json<CreateJobResponse>);
}

export const listWorkflows = () => fetch("/api/workflows").then(json<Workflow[]>);

export function createWorkflow(body: {
  name: string;
  inbox_destination_id: string;
  output_destination_id: string;
  count?: number;
  quality_mode?: "fast" | "hq";
  allow_creative_escalate?: boolean;
  enabled?: boolean;
  poll_seconds?: number;
  auto_caption?: boolean;
  caption_bank_id?: string | null;
  caption_from_filename?: boolean;
}): Promise<Workflow> {
  return fetch("/api/workflows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(json<Workflow>);
}

export function updateWorkflow(
  id: string,
  patch: Partial<{
    name: string;
    inbox_destination_id: string;
    output_destination_id: string;
    count: number;
    quality_mode: "fast" | "hq";
    allow_creative_escalate: boolean;
    enabled: boolean;
    poll_seconds: number;
    auto_caption: boolean;
    caption_bank_id: string | null;
    caption_from_filename: boolean;
  }>,
): Promise<Workflow> {
  return fetch(`/api/workflows/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then(json<Workflow>);
}

export async function deleteWorkflow(id: string): Promise<void> {
  const res = await fetch(`/api/workflows/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export const runWorkflow = (id: string) =>
  fetch(`/api/workflows/${id}/run`, { method: "POST" }).then(json<Workflow>);

export const cancelWorkflow = (id: string) =>
  fetch(`/api/workflows/${id}/cancel`, { method: "POST" }).then(json<Workflow>);

function bankQuery(bankId?: string | null): string {
  return bankId ? `bank_id=${encodeURIComponent(bankId)}` : "";
}

export const listCaptionBanks = () =>
  fetch("/api/caption-banks").then(json<CaptionBankFolder[]>);

export function createCaptionBank(name: string): Promise<CaptionBankFolder> {
  return fetch("/api/caption-banks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }).then(json<CaptionBankFolder>);
}

export async function deleteCaptionBank(id: string): Promise<void> {
  const res = await fetch(`/api/caption-banks/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export const listCaptions = (bankId?: string) => {
  const q = bankQuery(bankId);
  return fetch(q ? `/api/captions?${q}` : "/api/captions").then(json<CaptionBank>);
};

export const previewCaptions = (n: number, bankId?: string) => {
  const parts = [`n=${encodeURIComponent(String(n))}`];
  const b = bankQuery(bankId);
  if (b) parts.push(b);
  return fetch(`/api/captions/preview?${parts.join("&")}`).then(
    json<{ captions: string[] }>,
  );
};

export function createCaption(text: string, bankId?: string): Promise<Caption> {
  return fetch("/api/captions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, bank_id: bankId || undefined }),
  }).then(json<Caption>);
}

export function bulkCaptions(raw: string, bankId?: string): Promise<CaptionBank> {
  return fetch("/api/captions/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw, bank_id: bankId || undefined }),
  }).then(json<CaptionBank>);
}

export function updateCaption(id: string, text: string): Promise<Caption> {
  return fetch(`/api/captions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }).then(json<Caption>);
}

export async function deleteCaption(id: string): Promise<void> {
  const res = await fetch(`/api/captions/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessage(res));
}

/** 401 from a public /api/auth/me means login is on and the cookie is missing. */
export const LOGGED_OUT_ME: AuthMe = {
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

export async function getAuthMe(): Promise<AuthMe> {
  const res = await fetch("/api/auth/me");
  if (res.status === 401) return { ...LOGGED_OUT_ME };
  return json<AuthMe>(res);
}

export async function logout(): Promise<void> {
  const res = await fetch("/api/auth/logout", { method: "POST" });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export function passwordLogin(email: string, password: string): Promise<AuthMe> {
  return fetch("/api/auth/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then(json<AuthMe>);
}

export async function setStudioPassword(password: string): Promise<void> {
  const res = await fetch("/api/auth/password/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export const listInvites = () => fetch("/api/auth/invites").then(json<Invite[]>);

export function createInvite(email: string, kind: InviteKind): Promise<Invite> {
  return fetch("/api/auth/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, kind }),
  }).then(json<Invite>);
}

export async function deleteInvite(id: string): Promise<void> {
  const res = await fetch(`/api/auth/invites/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export const listAdminWorkspaces = () =>
  fetch("/api/admin/workspaces").then(json<AdminWorkspace[]>);

export function setWorkspaceExperience(
  id: string,
  experience: "solo" | "agency",
): Promise<AdminWorkspace> {
  return fetch(`/api/admin/workspaces/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ experience }),
  }).then(json<AdminWorkspace>);
}

export async function removeAdminUser(email: string): Promise<void> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(email)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export async function setAdminView(workspaceId: string | null): Promise<void> {
  const res = await fetch("/api/admin/view", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_id: workspaceId }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export const getWorkspaceTeam = () => fetch("/api/workspace/team").then(json<Team>);

export function createWorkspaceInvite(email: string): Promise<Invite> {
  return fetch("/api/workspace/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  }).then(json<Invite>);
}

export async function deleteWorkspaceInvite(id: string): Promise<void> {
  const res = await fetch(`/api/workspace/invites/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export async function removeWorkspaceMember(email: string): Promise<void> {
  const res = await fetch(`/api/workspace/members/${encodeURIComponent(email)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export const getDropLedgerStatus = () =>
  fetch("/api/drop-ledger/status").then(json<DropLedgerStatus>);

export function ensureDropLedger(): Promise<DropLedgerEnsure> {
  return fetch("/api/drop-ledger/ensure", { method: "POST" }).then(json<DropLedgerEnsure>);
}

export function syncDropLedger(body?: {
  job_ids?: string[];
  ensure?: boolean;
}): Promise<DropLedgerSync> {
  return fetch("/api/drop-ledger/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? { ensure: true }),
  }).then(json<DropLedgerSync>);
}
