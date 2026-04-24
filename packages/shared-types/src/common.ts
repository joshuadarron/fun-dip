/**
 * UUIDs and timestamps are plain strings at the type level. Branding
 * them caused too much friction with zod/JSON boundaries; validators at
 * the ingress points are where shape is enforced.
 */
export type UUID = string;
export type ISOTimestamp = string;

export interface PipelineError {
  status: "error";
  error: string;
  retryable: boolean;
  code?: string;
}

export type PipelineResult<Ok> = Ok | PipelineError;
