import type { ISOTimestamp, UUID } from "./common.js";

export type ProfileStage = "idea" | "pre_seed" | "seed" | "series_a" | "series_b_plus";

export type ProfileLookingFor = "increase_mrr" | "technology_pea" | "investors" | "incubator";

export type PageContext = "dashboard" | "profile" | "programs" | "submissions";

export type ApplyMethod = "form" | "email" | "website_info_only";

export type MatchStatus = "new" | "surfaced" | "dismissed" | "interested" | "applied";

export type MatchTier = "hot" | "warm" | "cold";

export type SubmissionStatus =
  | "draft"
  | "prefilled"
  | "awaiting_user_input"
  | "ready"
  | "submitting"
  | "submitted"
  | "awaiting_program_response"
  | "accepted"
  | "rejected"
  | "error";

export type MessageRole = "user" | "assistant";

export type SelectionType = "program" | "submission" | "match";

export interface Selection {
  type: SelectionType;
  id: UUID;
}

export interface Profile {
  id: UUID;
  user_id: UUID;
  startup_name: string;
  stage: ProfileStage | null;
  location: string | null;
  market: string | null;
  goals: string[];
  looking_for: ProfileLookingFor[];
  narrative: string;
  updated_at: ISOTimestamp;
  created_at: ISOTimestamp;
}

export interface Program {
  id: UUID;
  source_url: string;
  name: string;
  provider: string;
  description: string;
  requirements: string;
  apply_method: ApplyMethod;
  apply_url: string | null;
  deadline: ISOTimestamp | null;
  stage_fit: ProfileStage[];
  market_fit: string[];
  geo_scope: string[];
  last_scraped_at: ISOTimestamp;
  first_seen_at: ISOTimestamp;
}

export interface ProgramMatch {
  id: UUID;
  profile_id: UUID;
  program_id: UUID;
  score: number;
  tier: MatchTier;
  positioning_summary: string;
  status: MatchStatus;
  rationale: string;
  matched_at: ISOTimestamp;
}

export type MissingFieldType = "string" | "text" | "number" | "boolean" | "enum" | "file";

export interface MissingField {
  field_name: string;
  description: string;
  type: MissingFieldType;
  enum_values?: string[];
}

export interface Submission {
  id: UUID;
  profile_id: UUID;
  program_id: UUID;
  program_match_id: UUID | null;
  status: SubmissionStatus;
  prefilled_fields: Record<string, unknown>;
  missing_fields: MissingField[];
  provided_data: Record<string, unknown>;
  submitted_at: ISOTimestamp | null;
  confirmation_ref: string | null;
  response_text: string | null;
  error: string | null;
  created_at: ISOTimestamp;
  updated_at: ISOTimestamp;
}

export interface Conversation {
  id: UUID;
  user_id: UUID;
  summary: string;
  updated_at: ISOTimestamp;
  created_at: ISOTimestamp;
}

export interface ToolCallRecord {
  tool: "profile" | "scraping" | "submissions";
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface Message {
  id: UUID;
  conversation_id: UUID;
  role: MessageRole;
  content: string;
  page_context: PageContext;
  selection_context: Selection | null;
  tool_calls: ToolCallRecord[] | null;
  created_at: ISOTimestamp;
}

export interface ProgramPage {
  id: UUID;
  program_id: UUID | null;
  source_url: string;
  chunk_index: number;
  text: string;
  embedding: number[];
  scraped_at: ISOTimestamp;
}

export interface ProfileNarrative {
  id: UUID;
  profile_id: UUID;
  text: string;
  embedding: number[];
  source_message_id: UUID | null;
  created_at: ISOTimestamp;
}

export interface ConversationEmbedding {
  id: UUID;
  conversation_id: UUID;
  message_id: UUID;
  text: string;
  embedding: number[];
  created_at: ISOTimestamp;
}
