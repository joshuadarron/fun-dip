import type {
  ApplyMethod,
  MissingField,
  Profile,
  ProfileNarrative,
  Program,
  ProgramMatch,
  Submission,
  SubmissionsPipelineInput,
  SubmissionsPipelineOutput,
  SubmissionStatus,
  UUID,
} from "@fundip/shared-types";

/**
 * Reference implementation of the submissions pipeline state machine.
 *
 * This file mirrors the contract the deep agent in `pipeline.pipe`
 * implements. The RocketRide runtime owns the real execution; this
 * function exists to:
 *
 * 1. Document the exact state transitions in executable form (the tests
 *    in `tests/submissions-pipeline.test.ts` drive this directly).
 * 2. Serve as a local harness for unit testing the idempotency, email
 *    no-op, and match.status=applied side-effects without requiring a
 *    live RocketRide server.
 *
 * Contract: see .claude/docs/PIPELINE_CONTRACTS.md and
 * pipelines/submissions/AGENTS.md. Input/output types come from
 * @fundip/shared-types; do not widen them here.
 */

/** Minimal form field spec extracted from program_pages. */
export interface FormFieldSpec {
  field_name: string;
  description: string;
  type: MissingField["type"];
  enum_values?: string[];
  /**
   * Profile key used to populate this field when no explicit answer is
   * supplied. When absent, the field is a true gap that must come from
   * provided_data or the missing-info flow.
   */
  profile_key?: keyof Profile;
  required: boolean;
}

/**
 * Snapshot of what we need to call the state machine. In the real
 * pipeline these come from Ghost MCP reads; tests construct them
 * directly.
 */
export interface PipelineContext {
  profile: Profile;
  program: Program;
  narratives: ProfileNarrative[];
  /**
   * Form schema for this program. In production this is derived from
   * program_pages (scraped HTML). Tests supply it directly.
   */
  form_schema: FormFieldSpec[];
  /** Existing submission row when submission_id is present. */
  submission?: Submission;
  /** Matching (profile, program) row, if any. Used for status=applied side-effect. */
  match?: ProgramMatch;
}

export interface TinyfishRequest {
  apply_url: string;
  fields: Record<string, unknown>;
}

export interface TinyfishResult {
  ok: boolean;
  confirmation_ref: string | null;
  error?: string;
  retryable?: boolean;
}

export interface CallbackEmitter {
  needsInput(body: {
    submission_id: UUID;
    profile_id: UUID;
    program_id: UUID;
    missing_fields: MissingField[];
  }): Promise<void>;
  submitted(body: {
    submission_id: UUID;
    profile_id: UUID;
    program_id: UUID;
    confirmation_ref: string | null;
  }): Promise<void>;
}

export interface PersistLayer {
  createSubmission(
    input: Omit<Submission, "id" | "created_at" | "updated_at">,
  ): Promise<Submission>;
  updateSubmission(id: UUID, patch: Partial<Submission>): Promise<Submission>;
  markMatchApplied(matchId: UUID): Promise<void>;
}

export interface RunDeps {
  load(input: SubmissionsPipelineInput): Promise<PipelineContext>;
  persist: PersistLayer;
  callbacks: CallbackEmitter;
  tinyfish(request: TinyfishRequest): Promise<TinyfishResult>;
}

/**
 * Compute prefilled_fields and missing_fields from form schema + profile +
 * provided_data. Pure function, no I/O.
 */
export function computePrefill(
  form: FormFieldSpec[],
  profile: Profile,
  provided: Record<string, unknown>,
): { prefilled: Record<string, unknown>; missing: MissingField[] } {
  const prefilled: Record<string, unknown> = {};
  const missing: MissingField[] = [];

  for (const field of form) {
    // provided_data wins: user answers are authoritative.
    if (Object.prototype.hasOwnProperty.call(provided, field.field_name)) {
      const value = provided[field.field_name];
      if (isPresent(value)) {
        prefilled[field.field_name] = value;
        continue;
      }
    }

    if (field.profile_key) {
      const value = profile[field.profile_key];
      if (isPresent(value)) {
        prefilled[field.field_name] = value;
        continue;
      }
    }

    if (field.required) {
      const entry: MissingField = {
        field_name: field.field_name,
        description: field.description,
        type: field.type,
      };
      if (field.enum_values) entry.enum_values = field.enum_values;
      missing.push(entry);
    }
  }

  return { prefilled, missing };
}

function isPresent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function isManualApplyMethod(method: ApplyMethod): boolean {
  return method === "email" || method === "website_info_only";
}

/**
 * Entry point. Executes the state machine and returns the typed output.
 *
 * Throws only if the `load` step fails (unrecoverable); all other error
 * paths surface as `{ status: 'error', retryable }` per the pipeline
 * contract.
 */
export async function runSubmissionsPipeline(
  input: SubmissionsPipelineInput,
  deps: RunDeps,
): Promise<SubmissionsPipelineOutput> {
  const ctx = await deps.load(input);
  const existing = ctx.submission ?? null;

  // Idempotency rule: once submitted, stay submitted. Do not re-call
  // Tinyfish. Do not walk status backward under prefill_only either.
  if (existing && existing.status === "submitted") {
    return {
      status: "submitted",
      submission_id: existing.id,
      confirmation_ref: existing.confirmation_ref,
    };
  }

  // Merge any newly supplied provided_data onto what exists.
  const provided: Record<string, unknown> = {
    ...(existing?.provided_data ?? {}),
    ...(input.provided_data ?? {}),
  };

  const { prefilled, missing } = computePrefill(ctx.form_schema, ctx.profile, provided);

  // Determine the new status before persistence.
  const wantsSubmit = input.action === "submit";
  const canSubmit = missing.length === 0;
  const manualApply = isManualApplyMethod(ctx.program.apply_method);

  // Decide: stay in input-needed state, or proceed to submit.
  if (wantsSubmit && canSubmit) {
    // Submit path. Persist row in 'ready' first so audit trail is clear,
    // then either Tinyfish or email/manual no-op.
    const saved = await upsertSubmission(
      existing,
      {
        profile_id: input.profile_id,
        program_id: input.program_id,
        status: "ready",
        prefilled_fields: prefilled,
        missing_fields: [],
        provided_data: provided,
        match_id: ctx.match?.id ?? null,
      },
      deps.persist,
    );

    if (manualApply) {
      // Documented no-op for email/website_info_only programs: record a
      // manual-apply instruction and transition to 'submitted' with a
      // null confirmation_ref. No Tinyfish call.
      const note = buildManualApplyNote(ctx.program);
      const submitted = await deps.persist.updateSubmission(saved.id, {
        status: "submitted",
        submitted_at: new Date().toISOString(),
        confirmation_ref: null,
        response_text: note,
        error: null,
      });
      await applyMatchSideEffect(ctx.match, deps.persist);
      await deps.callbacks.submitted({
        submission_id: submitted.id,
        profile_id: submitted.profile_id,
        program_id: submitted.program_id,
        confirmation_ref: null,
      });
      return {
        status: "submitted",
        submission_id: submitted.id,
        confirmation_ref: null,
      };
    }

    // Form + apply_url path. Call Tinyfish in application mode.
    if (ctx.program.apply_method !== "form" || !ctx.program.apply_url) {
      // Defensive: apply_method=form but no apply_url. Surface as a
      // terminal error, do not pretend to submit.
      const errored = await deps.persist.updateSubmission(saved.id, {
        status: "error",
        error: "Program is missing apply_url despite apply_method=form",
      });
      return {
        status: "error",
        submission_id: errored.id,
        error: "Program is missing apply_url despite apply_method=form",
        retryable: false,
      };
    }

    let result: TinyfishResult;
    try {
      result = await deps.tinyfish({
        apply_url: ctx.program.apply_url,
        fields: prefilled,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errored = await deps.persist.updateSubmission(saved.id, {
        status: "error",
        error: message,
      });
      return {
        status: "error",
        submission_id: errored.id,
        error: message,
        retryable: true,
      };
    }

    if (!result.ok) {
      const errored = await deps.persist.updateSubmission(saved.id, {
        status: "error",
        error: result.error ?? "Tinyfish application submission failed",
      });
      return {
        status: "error",
        submission_id: errored.id,
        error: result.error ?? "Tinyfish application submission failed",
        retryable: result.retryable ?? false,
      };
    }

    const submitted = await deps.persist.updateSubmission(saved.id, {
      status: "submitted",
      submitted_at: new Date().toISOString(),
      confirmation_ref: result.confirmation_ref,
      error: null,
    });
    await applyMatchSideEffect(ctx.match, deps.persist);
    await deps.callbacks.submitted({
      submission_id: submitted.id,
      profile_id: submitted.profile_id,
      program_id: submitted.program_id,
      confirmation_ref: result.confirmation_ref,
    });
    return {
      status: "submitted",
      submission_id: submitted.id,
      confirmation_ref: result.confirmation_ref,
    };
  }

  // Non-submit paths: prefill_only, or submit-with-missing. Both write
  // state and return either 'prefilled' or 'needs_input'.
  const nextStatus: SubmissionStatus = canSubmit ? "prefilled" : "awaiting_user_input";

  const saved = await upsertSubmission(
    existing,
    {
      profile_id: input.profile_id,
      program_id: input.program_id,
      status: nextStatus,
      prefilled_fields: prefilled,
      missing_fields: missing,
      provided_data: provided,
      match_id: ctx.match?.id ?? null,
    },
    deps.persist,
  );

  if (!canSubmit) {
    await deps.callbacks.needsInput({
      submission_id: saved.id,
      profile_id: saved.profile_id,
      program_id: saved.program_id,
      missing_fields: missing,
    });
    return {
      status: "needs_input",
      submission_id: saved.id,
      missing_fields: missing,
    };
  }

  return {
    status: "prefilled",
    submission_id: saved.id,
    prefilled_fields: prefilled,
  };
}

interface UpsertInput {
  profile_id: UUID;
  program_id: UUID;
  status: SubmissionStatus;
  prefilled_fields: Record<string, unknown>;
  missing_fields: MissingField[];
  provided_data: Record<string, unknown>;
  match_id: UUID | null;
}

async function upsertSubmission(
  existing: Submission | null,
  input: UpsertInput,
  persist: PersistLayer,
): Promise<Submission> {
  if (!existing) {
    return persist.createSubmission({
      profile_id: input.profile_id,
      program_id: input.program_id,
      program_match_id: input.match_id,
      status: input.status,
      prefilled_fields: input.prefilled_fields,
      missing_fields: input.missing_fields,
      provided_data: input.provided_data,
      submitted_at: null,
      confirmation_ref: null,
      response_text: null,
      error: null,
    });
  }
  return persist.updateSubmission(existing.id, {
    status: input.status,
    prefilled_fields: input.prefilled_fields,
    missing_fields: input.missing_fields,
    provided_data: input.provided_data,
  });
}

async function applyMatchSideEffect(
  match: ProgramMatch | undefined,
  persist: PersistLayer,
): Promise<void> {
  if (!match) return;
  await persist.markMatchApplied(match.id);
}

function buildManualApplyNote(program: Program): string {
  if (program.apply_method === "email") {
    return (
      `This program accepts applications by email only. The Fundip agent has staged the ` +
      `prefilled application but cannot email it directly (that path lands in a later phase). ` +
      `Contact the provider (${program.provider}) using the instructions on ${program.source_url}.`
    );
  }
  return (
    `This program publishes information only and does not accept an online application. ` +
    `Review ${program.source_url} for next steps. The Fundip agent has staged the prefilled ` +
    `response locally for reference.`
  );
}
