import type { UUID } from "./common.js";
import type { MatchTier, MissingField, PageContext, Selection, ToolCallRecord } from "./ghost.js";

// --- Chat pipeline -----------------------------------------------------------

export interface ChatPipelineInput {
  user_id: UUID;
  profile_id: UUID;
  conversation_id: UUID;
  current_page: PageContext;
  current_selection: Selection | null;
  message: string;
}

export interface ChatSurfaced {
  pending_submissions?: UUID[];
  new_matches?: UUID[];
}

export interface ChatPipelineOutput {
  status: "ok";
  reply: string;
  conversation_id: UUID;
  tool_calls: ToolCallRecord[];
  surfaced: ChatSurfaced;
}

// --- Profile pipeline --------------------------------------------------------

export type ProfileFactSource = "chat" | "import" | "inferred";

export interface ProfileFact {
  field: string;
  value: unknown;
  source: ProfileFactSource;
}

export type ProfilePipelineMode = "create" | "update" | "read";

export interface ProfilePipelineInput {
  profile_id: UUID;
  mode: ProfilePipelineMode;
  facts?: ProfileFact[];
  context?: string;
}

export interface ProfilePipelineDelta {
  fields_updated: string[];
  fields_added: string[];
  narrative_appended: boolean;
}

export interface ProfilePipelineOutput {
  status: "ok";
  profile_id: UUID;
  delta: ProfilePipelineDelta;
  profile_summary: string;
}

// --- Scraping pipeline -------------------------------------------------------

export type ScrapingPipelineMode = "full_scrape" | "match";

export interface ScrapingFullScrapeInput {
  mode: "full_scrape";
  source_urls?: string[];
}

export interface ScrapingMatchInput {
  mode: "match";
  profile_id: UUID;
  /**
   * Whether the pipeline should emit the `matches_ready` callback after
   * writing. Cron sets `true` (or omits — default true). Chat's tool wrapper
   * must set `false`.
   */
  emit_callback?: boolean;
}

export type ScrapingPipelineInput = ScrapingFullScrapeInput | ScrapingMatchInput;

export interface ScrapingFullScrapeOutput {
  status: "ok";
  mode: "full_scrape";
  programs_added: number;
  programs_updated: number;
  pages_scraped: number;
}

export interface ScrapingMatchRow {
  program_match_id: UUID;
  program_id: UUID;
  score: number;
  tier: MatchTier;
  positioning_summary: string;
}

export interface ScrapingMatchOutput {
  status: "ok";
  mode: "match";
  profile_id: UUID;
  matches: ScrapingMatchRow[];
}

export type ScrapingPipelineOutput = ScrapingFullScrapeOutput | ScrapingMatchOutput;

// --- Submissions pipeline ----------------------------------------------------

export type SubmissionsPipelineAction = "prefill_only" | "submit";

export interface SubmissionsPipelineInput {
  profile_id: UUID;
  program_id: UUID;
  submission_id?: UUID;
  action: SubmissionsPipelineAction;
  provided_data?: Record<string, unknown>;
}

export interface SubmissionsPrefilledOutput {
  status: "prefilled";
  submission_id: UUID;
  prefilled_fields: Record<string, unknown>;
}

export interface SubmissionsNeedsInputOutput {
  status: "needs_input";
  submission_id: UUID;
  missing_fields: MissingField[];
}

export interface SubmissionsSubmittedOutput {
  status: "submitted";
  submission_id: UUID;
  confirmation_ref: string | null;
}

export interface SubmissionsErrorOutput {
  status: "error";
  submission_id: UUID;
  error: string;
  retryable: boolean;
}

export type SubmissionsPipelineOutput =
  | SubmissionsPrefilledOutput
  | SubmissionsNeedsInputOutput
  | SubmissionsSubmittedOutput
  | SubmissionsErrorOutput;
