import type { UUID } from "./common.js";
import type { MatchTier, MissingField } from "./ghost.js";

export const CALLBACK_SIGNATURE_HEADER = "X-Fundip-Signature";

export interface MatchesReadyPayload {
  profile_id: UUID;
  match_count: number;
  max_tier: MatchTier;
}

export interface SubmissionNeedsInputPayload {
  submission_id: UUID;
  profile_id: UUID;
  program_id: UUID;
  missing_fields: MissingField[];
}

export interface SubmissionSubmittedPayload {
  submission_id: UUID;
  profile_id: UUID;
  program_id: UUID;
  confirmation_ref: string | null;
}

export type CallbackPayload =
  | { type: "matches_ready"; body: MatchesReadyPayload }
  | { type: "submission_needs_input"; body: SubmissionNeedsInputPayload }
  | { type: "submission_submitted"; body: SubmissionSubmittedPayload };

export const CALLBACK_PATHS = {
  matches_ready: "/internal/callbacks/matches-ready",
  submission_needs_input: "/internal/callbacks/submission-needs-input",
  submission_submitted: "/internal/callbacks/submission-submitted",
} as const;

export type CallbackPath = (typeof CALLBACK_PATHS)[keyof typeof CALLBACK_PATHS];
