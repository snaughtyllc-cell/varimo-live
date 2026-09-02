export interface QualityHead {
  uniqueness?: number | null;
  sim?: number | null;
  status?: string | null;
  available?: boolean;
  bits?: number | null;
  backend?: string | null;
  n_frames?: number | null;
  metric?: string | null;
}
export interface Quality {
  vmaf: number; histogram_ok: boolean; regen_count: number; passed: boolean;
  spatial_vmaf: number | null; spatial_ok: boolean | null;
  bits?: number | null;
  heads?: Record<string, QualityHead> | null;
}
export type Status = "ok" | "best_effort" | "corrupt" | "uniqueness_fail";
export type PlatformResult = "passed" | "duplicate_reject" | "flagged" | "unknown";
export interface VariantOut {
  index: number; filename: string; status: Status; quality: Quality; file_url: string;
  uniqueness?: number | null; uniqueness_status?: string | null;
  uniqueness_metric?: string | null; uniqueness_target?: number | null;
  preset_used?: string | null; strength_final?: number | null;
  escalated?: boolean; platform_result?: PlatformResult | null;
  post_url?: string | null;
  file_ready?: boolean;
  look_status?: string | null;
  look_mae?: number | null;
  look_src_url?: string | null;
  look_var_url?: string | null;
  caption?: string | null;
  ig_media_id?: string | null;
  ig_user_id?: string | null;
  ig_insights?: {
    views?: number;
    reach?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    saved?: number;
    fetched_at?: string;
  } | null;
}
export interface InFlightOut {
  index: number;
  state: "rendering" | "checking" | "looking" | "rerolling" | "uniqueness" | "escalating";
  attempt: number;
  max_attempts: number;
}
export interface LookPreviewOut {
  index: number;
  look_status?: string | null;
  look_mae?: number | null;
  look_src_url?: string | null;
  look_var_url?: string | null;
}
export interface SourceOut {
  source_id: string; filename: string; requested: number; delivered: number; shortfall: number;
  variants: VariantOut[];
  in_flight?: InFlightOut | null;
  in_flights?: InFlightOut[];
  look_preview?: LookPreviewOut | null;
  job_state?: "running" | "done" | string | null;
  failed?: number;
  created_utc?: string | null;
  files_ready?: number;
  copy_status?: "ok" | "copying" | "missing";
  job_id?: string | null;
  caption_prompt?: string | null;
  insights_views?: number | null;
  insights_linked?: number;
  insights_unknown?: number;
  suggestion_kind?: string | null;
  suggestion_copy?: string | null;
}
export interface JobSummary { job_id: string; count: number; created_utc: string; state: "running" | "done"; source_count: number; }
export interface QueueItem {
  job_id: string;
  quality_mode: "fast" | "hq" | string;
  state: string;
  created_utc: string;
  count: number;
  source_count: number;
  filenames: string[];
  delivered: number;
  requested: number;
  position: number;
}
export interface QueueSnapshot {
  running: number;
  fast: number;
  hq: number;
  jobs: QueueItem[];
}
export interface JobDetail { job_id: string; count: number; created_utc: string; state: string; sources: SourceOut[]; error?: string | null; }
export interface CreateJobResponse { job_id: string; sources: SourceOut[]; }
export interface DiagnosticsItem { source_id: string; index: number; filename: string; status: "best_effort" | "corrupt" | "uniqueness_fail"; quality: Quality; }
export interface VariantEvent {
  source_id: string; index: number;
  state: "rendering" | "checking" | "looking" | "rerolling" | "uniqueness" | "escalating" | "done";
  attempt: number; max_attempts: number;
  status: string | null; quality: Quality | null; filename: string | null;
  uniqueness?: number | null;
  uniqueness_status?: string | null;
  uniqueness_metric?: string | null;
  uniqueness_target?: number | null;
  escalated?: boolean;
  platform_result?: PlatformResult | null;
  look_status?: string | null;
  look_mae?: number | null;
  look_src?: string | null;
  look_var?: string | null;
  look_src_url?: string | null;
  look_var_url?: string | null;
}
export const VMAF_FLOOR = 90;

export type DriveStatusValue = "ready" | "not_configured" | "auth_failed";
export interface DriveStatus {
  status: DriveStatusValue;
  sa_email: string | null;
  message: string;
  auth_mode?: string | null;
  connected_email?: string | null;
  oauth_available?: boolean;
  share_email?: string | null;
}
export interface Destination {
  id: string;
  name: string;
  folder_id: string;
  auth_mode: string;
}
export interface ExportVariantRef {
  source_id: string;
  index: number;
  caption?: string | null;
}
export interface ExportFile {
  source_id: string;
  index: number;
  filename: string;
  status: string;
  error?: string | null;
  drive_file_id?: string | null;
}
export interface ExportJob {
  export_id: string;
  destination_id: string;
  folder_id: string;
  state: string;
  created_utc: string;
  files: ExportFile[];
}
export interface DropFile {
  source_id: string;
  index: number;
  variant_id: string;
  job_id: string | null;
  drive_file_id: string | null;
  platform_result: PlatformResult | null;
  outcome: "pass" | "miss";
}
export interface DropPack {
  export_id: string;
  created_utc: string;
  destination_id: string;
  destination_name: string;
  folder_id: string;
  count: number;
  outcome: "pass" | "miss";
  miss_labels: string[];
  files: DropFile[];
}
export type DropFilter = "all" | "week" | "misses" | "flagged_week";
export interface SplitDestination {
  destination_id: string;
  label?: string | null;
  count?: number | null;
}
export interface SplitExportDest {
  destination_id: string;
  label?: string | null;
  count?: number | null;
}
export interface SplitExportJob {
  id: string;
  dest: string;
  files: string[];
  count: number;
  label?: string | null;
}
export interface SplitExportResult {
  ok: boolean;
  jobs: SplitExportJob[];
  split: number[][];
}

export interface DriveVideo {
  id: string;
  name: string;
  mime_type: string;
  md5: string | null;
}

export interface WorkflowSummary {
  queued: number;
  exported: number;
  skipped: number;
  failed: number;
  running: number;
  job_ids: string[];
  error?: string | null;
}

export interface Caption {
  id: string;
  text: string;
}

export interface CaptionBankFolder {
  id: string;
  name: string;
  is_default: boolean;
  count: number;
  remaining: number;
  cursor: number;
  low: boolean;
}

export interface CaptionBank {
  cursor: number;
  items: Caption[];
  bank_id?: string;
  bank_name?: string;
  count?: number;
  remaining?: number;
  low?: boolean;
  is_default?: boolean;
}

export interface Workflow {
  id: string;
  name: string;
  inbox_destination_id: string;
  output_destination_id: string;
  count: number;
  quality_mode: "fast" | "hq";
  allow_creative_escalate: boolean;
  enabled: boolean;
  poll_seconds: number;
  last_sweep_at: string | null;
  last_summary: WorkflowSummary | null;
  auto_caption: boolean;
  caption_bank_id?: string | null;
  caption_from_filename?: boolean;
}

export type AuthRole = "owner" | "member";
export type InviteKind = "join" | "new_workspace";

export interface AuthMe {
  auth_required: boolean;
  email: string | null;
  name: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
  home_workspace_id: string | null;
  viewing_other: boolean;
  role: AuthRole | null;
  is_admin: boolean;
  has_password: boolean;
  experience?: "solo" | "agency";
}

export interface Invite {
  id: string;
  email: string;
  kind: InviteKind;
  workspace_id: string | null;
  created_utc: string;
}

export interface AdminMember {
  email: string;
  name: string;
  role: AuthRole;
}

export interface Team {
  workspace_id: string;
  workspace_name: string | null;
  members: AdminMember[];
  invites: Invite[];
}

export interface AdminWorkspace {
  id: string;
  name: string;
  owner_email: string | null;
  member_count: number;
  members: AdminMember[];
  running: number;
  fast: number;
  hq: number;
  last_job_utc: string | null;
  last_error: string | null;
  experience?: "solo" | "agency";
}

export interface DropLedgerStatus {
  configured: boolean;
  spreadsheet_id: string | null;
  spreadsheet_url: string | null;
  message: string;
}

export interface DropLedgerEnsure {
  spreadsheet_id: string;
  spreadsheet_url: string;
  created: boolean;
}

export interface DropLedgerSync {
  spreadsheet_id: string;
  spreadsheet_url: string;
  job_ids: string[];
  rows: number;
  inserted: number;
  updated: number;
  unchanged: number;
}

export interface InstagramAccount {
  user_id: string;
  username: string;
  name: string;
  connected_utc?: string | null;
}

export interface InstagramStatus {
  oauth_available: boolean;
  connected: boolean;
  accounts: InstagramAccount[];
  message: string;
}

export interface InstagramPackRow {
  source_id: string;
  filename: string;
  insights_views: number | null;
  insights_linked: number;
  insights_unknown?: number;
}

export interface InstagramSuggestion {
  kind: string;
  source_id: string;
  filename: string;
  copy: string;
}

export interface InstagramUnmatched {
  media_id: string;
  permalink?: string | null;
  caption?: string | null;
  username?: string | null;
  ig_user_id?: string | null;
}

export interface InstagramAnalytics {
  insights_views: number | null;
  insights_linked: number;
  packs?: InstagramPackRow[];
  ranked: InstagramPackRow[];
  suggestions?: InstagramSuggestion[];
  accounts: InstagramAccount[];
}

export interface InstagramSync {
  matched: number;
  accounts: number;
  media: number;
  unmatched?: InstagramUnmatched[];
  errors?: string[];
  analytics: InstagramAnalytics;
}
