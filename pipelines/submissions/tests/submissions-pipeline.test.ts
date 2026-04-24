import type {
  Profile,
  Program,
  ProgramMatch,
  Submission,
  SubmissionsPipelineInput,
  UUID,
} from "@fundip/shared-types";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  runSubmissionsPipeline,
  type CallbackEmitter,
  type FormFieldSpec,
  type PersistLayer,
  type PipelineContext,
  type RunDeps,
  type TinyfishRequest,
  type TinyfishResult,
} from "../src/state-machine.js";

/**
 * These tests exercise the submissions-pipeline LOGIC, not the RocketRide
 * runtime. The deep agent in `pipeline.pipe` implements the same rules
 * the reference `runSubmissionsPipeline` does. Running the real pipeline
 * would need RocketRide creds, a Ghost MCP server, and a Tinyfish
 * account. Unit tests stub Tinyfish and use an in-memory store modelled
 * on `createFakeGhostClient` for persistence.
 */

// ---- In-memory Ghost-like store -------------------------------------------

interface Store {
  submissions: Map<UUID, Submission>;
  matches: Map<UUID, ProgramMatch>;
}

function newStore(seed: { matches?: ProgramMatch[] } = {}): Store {
  const matches = new Map<UUID, ProgramMatch>();
  for (const m of seed.matches ?? []) matches.set(m.id, m);
  return { submissions: new Map(), matches };
}

function persistOver(store: Store): PersistLayer {
  return {
    async createSubmission(input) {
      const id = randomUUID();
      const now = new Date().toISOString();
      const row: Submission = {
        id,
        created_at: now,
        updated_at: now,
        ...input,
      };
      store.submissions.set(id, row);
      return { ...row };
    },
    async updateSubmission(id, patch) {
      const existing = store.submissions.get(id);
      if (!existing) throw new Error(`submission ${id} not found`);
      const merged: Submission = {
        ...existing,
        ...patch,
        id,
        updated_at: new Date().toISOString(),
      };
      store.submissions.set(id, merged);
      return { ...merged };
    },
    async markMatchApplied(matchId) {
      const existing = store.matches.get(matchId);
      if (!existing) return;
      store.matches.set(matchId, { ...existing, status: "applied" });
    },
  };
}

interface TrackedCallbacks extends CallbackEmitter {
  needs: ReturnType<typeof vi.fn>;
  submittedMock: ReturnType<typeof vi.fn>;
}

function makeCallbacks(): TrackedCallbacks {
  const needs = vi.fn(async () => undefined);
  const submittedMock = vi.fn(async () => undefined);
  return {
    needs,
    submittedMock,
    needsInput: needs as unknown as CallbackEmitter["needsInput"],
    submitted: submittedMock as unknown as CallbackEmitter["submitted"],
  };
}

// ---- Fixtures -------------------------------------------------------------

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? randomUUID(),
    user_id: overrides.user_id ?? randomUUID(),
    startup_name: overrides.startup_name ?? "Acme Labs",
    stage: overrides.stage ?? "seed",
    location: overrides.location ?? "Chicago",
    market: overrides.market ?? "fintech",
    goals: overrides.goals ?? ["raise"],
    looking_for: overrides.looking_for ?? ["investors"],
    narrative: overrides.narrative ?? "Acme Labs is a seed-stage fintech startup.",
    updated_at: now,
    created_at: now,
  };
}

function makeProgram(overrides: Partial<Program> = {}): Program {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? randomUUID(),
    source_url: overrides.source_url ?? "https://example.org/grant",
    name: overrides.name ?? "Seed Grant",
    provider: overrides.provider ?? "Example Foundation",
    description: overrides.description ?? "A grant for seed-stage fintech startups.",
    requirements: overrides.requirements ?? "US-based, seed stage.",
    apply_method: overrides.apply_method ?? "form",
    apply_url: overrides.apply_url ?? "https://example.org/grant/apply",
    deadline: overrides.deadline ?? null,
    stage_fit: overrides.stage_fit ?? ["seed"],
    market_fit: overrides.market_fit ?? ["fintech"],
    geo_scope: overrides.geo_scope ?? ["US"],
    last_scraped_at: now,
    first_seen_at: now,
  };
}

function makeMatch(profileId: UUID, programId: UUID): ProgramMatch {
  return {
    id: randomUUID(),
    profile_id: profileId,
    program_id: programId,
    score: 80,
    tier: "hot",
    positioning_summary: "Good fit.",
    status: "surfaced",
    rationale: "Stage and market align.",
    matched_at: new Date().toISOString(),
  };
}

const FULL_FORM: FormFieldSpec[] = [
  {
    field_name: "startup_name",
    description: "Legal startup name",
    type: "string",
    profile_key: "startup_name",
    required: true,
  },
  {
    field_name: "stage",
    description: "Funding stage",
    type: "enum",
    enum_values: ["idea", "pre_seed", "seed", "series_a", "series_b_plus"],
    profile_key: "stage",
    required: true,
  },
  {
    field_name: "location",
    description: "Primary operating city",
    type: "string",
    profile_key: "location",
    required: true,
  },
];

const FORM_WITH_GAP: FormFieldSpec[] = [
  ...FULL_FORM,
  {
    field_name: "team_size",
    description: "Current full-time team size",
    type: "number",
    required: true,
  },
  {
    field_name: "pitch_deck_url",
    description: "URL to your pitch deck",
    type: "string",
    required: true,
  },
];

// ---- Deps factory ---------------------------------------------------------

interface SetupOpts {
  profile: Profile;
  program: Program;
  form: FormFieldSpec[];
  match?: ProgramMatch;
  existing?: Submission;
  tinyfishResult?: TinyfishResult;
}

function setup(
  opts: SetupOpts,
  store: Store,
): {
  deps: RunDeps;
  tinyfish: ReturnType<typeof vi.fn>;
  callbacks: ReturnType<typeof makeCallbacks>;
} {
  const tinyfish = vi.fn(
    async (_req: TinyfishRequest): Promise<TinyfishResult> =>
      opts.tinyfishResult ?? { ok: true, confirmation_ref: "CONF-123" },
  );
  const callbacks = makeCallbacks();
  const deps: RunDeps = {
    async load(input): Promise<PipelineContext> {
      // The real pipeline reads by id, possibly refreshing from Ghost.
      // Here we re-read submissions out of the in-memory store to
      // exercise the idempotency path when the same input is replayed.
      const existing = input.submission_id
        ? (store.submissions.get(input.submission_id) ?? opts.existing)
        : opts.existing;
      return {
        profile: opts.profile,
        program: opts.program,
        narratives: [],
        form_schema: opts.form,
        submission: existing ? { ...existing } : undefined,
        match: opts.match,
      };
    },
    persist: persistOver(store),
    callbacks,
    tinyfish,
  };
  return { deps, tinyfish, callbacks };
}

// ---- Tests ---------------------------------------------------------------

describe("submissions pipeline state machine", () => {
  it("first-invocation prefill with full coverage returns prefilled and no callback", async () => {
    const profile = makeProfile();
    const program = makeProgram();
    const store = newStore();
    const { deps, tinyfish, callbacks } = setup({ profile, program, form: FULL_FORM }, store);

    const input: SubmissionsPipelineInput = {
      profile_id: profile.id,
      program_id: program.id,
      action: "prefill_only",
    };
    const out = await runSubmissionsPipeline(input, deps);

    expect(out.status).toBe("prefilled");
    if (out.status !== "prefilled") throw new Error("type narrow");
    expect(out.prefilled_fields).toMatchObject({
      startup_name: "Acme Labs",
      stage: "seed",
      location: "Chicago",
    });
    expect(tinyfish).not.toHaveBeenCalled();
    expect(callbacks.needs).not.toHaveBeenCalled();
    expect(callbacks.submittedMock).not.toHaveBeenCalled();
    const row = store.submissions.get(out.submission_id)!;
    expect(row.status).toBe("prefilled");
    expect(row.missing_fields).toEqual([]);
  });

  it("first-invocation prefill with gaps returns needs_input and fires needs_input callback", async () => {
    const profile = makeProfile();
    const program = makeProgram();
    const store = newStore();
    const { deps, tinyfish, callbacks } = setup({ profile, program, form: FORM_WITH_GAP }, store);

    const out = await runSubmissionsPipeline(
      {
        profile_id: profile.id,
        program_id: program.id,
        action: "prefill_only",
      },
      deps,
    );

    expect(out.status).toBe("needs_input");
    if (out.status !== "needs_input") throw new Error("type narrow");
    const names = out.missing_fields.map((f) => f.field_name).sort();
    expect(names).toEqual(["pitch_deck_url", "team_size"]);
    expect(tinyfish).not.toHaveBeenCalled();
    expect(callbacks.needs).toHaveBeenCalledTimes(1);
    const row = store.submissions.get(out.submission_id)!;
    expect(row.status).toBe("awaiting_user_input");
    expect(row.missing_fields.map((f) => f.field_name).sort()).toEqual([
      "pitch_deck_url",
      "team_size",
    ]);
  });

  it("continuation with partial provided_data shrinks missing_fields", async () => {
    const profile = makeProfile();
    const program = makeProgram();
    const store = newStore();
    const { deps: firstDeps } = setup({ profile, program, form: FORM_WITH_GAP }, store);
    const first = await runSubmissionsPipeline(
      { profile_id: profile.id, program_id: program.id, action: "prefill_only" },
      firstDeps,
    );
    expect(first.status).toBe("needs_input");
    if (first.status !== "needs_input") throw new Error("type narrow");

    // Supply only one of the two gaps.
    const { deps: secondDeps, callbacks: secondCallbacks } = setup(
      { profile, program, form: FORM_WITH_GAP },
      store,
    );
    const second = await runSubmissionsPipeline(
      {
        profile_id: profile.id,
        program_id: program.id,
        submission_id: first.submission_id,
        action: "prefill_only",
        provided_data: { team_size: 5 },
      },
      secondDeps,
    );

    expect(second.status).toBe("needs_input");
    if (second.status !== "needs_input") throw new Error("type narrow");
    expect(second.missing_fields.map((f) => f.field_name)).toEqual(["pitch_deck_url"]);
    expect(secondCallbacks.needs).toHaveBeenCalledTimes(1);

    const row = store.submissions.get(first.submission_id)!;
    expect(row.provided_data).toMatchObject({ team_size: 5 });
    expect(row.prefilled_fields).toMatchObject({ team_size: 5 });
  });

  it("continuation with complete provided_data and action=submit calls Tinyfish and transitions to submitted", async () => {
    const profile = makeProfile();
    const program = makeProgram();
    const match = makeMatch(profile.id, program.id);
    const store = newStore({ matches: [match] });

    const { deps: firstDeps } = setup({ profile, program, form: FORM_WITH_GAP, match }, store);
    const first = await runSubmissionsPipeline(
      { profile_id: profile.id, program_id: program.id, action: "prefill_only" },
      firstDeps,
    );
    expect(first.status).toBe("needs_input");
    if (first.status !== "needs_input") throw new Error("type narrow");

    const {
      deps: submitDeps,
      tinyfish,
      callbacks,
    } = setup(
      {
        profile,
        program,
        form: FORM_WITH_GAP,
        match,
        tinyfishResult: { ok: true, confirmation_ref: "CONF-XYZ" },
      },
      store,
    );
    const submitOut = await runSubmissionsPipeline(
      {
        profile_id: profile.id,
        program_id: program.id,
        submission_id: first.submission_id,
        action: "submit",
        provided_data: {
          team_size: 4,
          pitch_deck_url: "https://example.org/deck.pdf",
        },
      },
      submitDeps,
    );

    expect(submitOut.status).toBe("submitted");
    if (submitOut.status !== "submitted") throw new Error("type narrow");
    expect(submitOut.confirmation_ref).toBe("CONF-XYZ");
    expect(tinyfish).toHaveBeenCalledTimes(1);
    expect(tinyfish).toHaveBeenCalledWith({
      apply_url: program.apply_url,
      fields: expect.objectContaining({
        startup_name: "Acme Labs",
        team_size: 4,
        pitch_deck_url: "https://example.org/deck.pdf",
      }),
    });
    expect(callbacks.submittedMock).toHaveBeenCalledTimes(1);
    expect(callbacks.needs).not.toHaveBeenCalled();

    const row = store.submissions.get(first.submission_id)!;
    expect(row.status).toBe("submitted");
    expect(row.confirmation_ref).toBe("CONF-XYZ");
    // Match row side-effect:
    expect(store.matches.get(match.id)?.status).toBe("applied");
  });

  it("duplicate action=submit on a submitted row is idempotent and does not re-call Tinyfish", async () => {
    const profile = makeProfile();
    const program = makeProgram();
    const store = newStore();
    const { deps: firstDeps } = setup({ profile, program, form: FULL_FORM }, store);
    const first = await runSubmissionsPipeline(
      {
        profile_id: profile.id,
        program_id: program.id,
        action: "submit",
      },
      firstDeps,
    );
    expect(first.status).toBe("submitted");
    if (first.status !== "submitted") throw new Error("type narrow");

    const {
      deps: replayDeps,
      tinyfish,
      callbacks,
    } = setup({ profile, program, form: FULL_FORM }, store);
    const replay = await runSubmissionsPipeline(
      {
        profile_id: profile.id,
        program_id: program.id,
        submission_id: first.submission_id,
        action: "submit",
      },
      replayDeps,
    );

    expect(replay.status).toBe("submitted");
    if (replay.status !== "submitted") throw new Error("type narrow");
    expect(replay.submission_id).toBe(first.submission_id);
    expect(replay.confirmation_ref).toBe(first.confirmation_ref);
    expect(tinyfish).not.toHaveBeenCalled();
    expect(callbacks.submittedMock).not.toHaveBeenCalled();
  });

  it("apply_method=email with action=submit is a documented no-op: submitted with null confirmation_ref", async () => {
    const profile = makeProfile();
    const program = makeProgram({
      apply_method: "email",
      apply_url: null,
    });
    const store = newStore();
    const { deps, tinyfish, callbacks } = setup({ profile, program, form: FULL_FORM }, store);

    const out = await runSubmissionsPipeline(
      {
        profile_id: profile.id,
        program_id: program.id,
        action: "submit",
      },
      deps,
    );

    expect(out.status).toBe("submitted");
    if (out.status !== "submitted") throw new Error("type narrow");
    expect(out.confirmation_ref).toBeNull();
    expect(tinyfish).not.toHaveBeenCalled();
    expect(callbacks.submittedMock).toHaveBeenCalledTimes(1);

    const row = store.submissions.get(out.submission_id)!;
    expect(row.status).toBe("submitted");
    expect(row.confirmation_ref).toBeNull();
    expect(row.response_text).toBeTruthy();
    expect(row.response_text).toMatch(/email/i);
  });

  it("apply_method=website_info_only with action=submit is a documented no-op", async () => {
    const profile = makeProfile();
    const program = makeProgram({
      apply_method: "website_info_only",
      apply_url: null,
    });
    const store = newStore();
    const { deps, tinyfish } = setup({ profile, program, form: FULL_FORM }, store);

    const out = await runSubmissionsPipeline(
      {
        profile_id: profile.id,
        program_id: program.id,
        action: "submit",
      },
      deps,
    );

    expect(out.status).toBe("submitted");
    expect(tinyfish).not.toHaveBeenCalled();
    const row = store.submissions.get(out.status === "submitted" ? out.submission_id : "")!;
    expect(row.response_text).toMatch(/information only|publishes information/i);
  });

  it("on submitted transition, program_matches.status updates to applied when a match row exists", async () => {
    const profile = makeProfile();
    const program = makeProgram();
    const match = makeMatch(profile.id, program.id);
    const store = newStore({ matches: [match] });
    const { deps } = setup({ profile, program, form: FULL_FORM, match }, store);

    const out = await runSubmissionsPipeline(
      {
        profile_id: profile.id,
        program_id: program.id,
        action: "submit",
      },
      deps,
    );

    expect(out.status).toBe("submitted");
    expect(store.matches.get(match.id)?.status).toBe("applied");
  });

  it("on submitted transition with no match row, does not fail", async () => {
    const profile = makeProfile();
    const program = makeProgram();
    const store = newStore();
    const { deps } = setup({ profile, program, form: FULL_FORM }, store);

    const out = await runSubmissionsPipeline(
      {
        profile_id: profile.id,
        program_id: program.id,
        action: "submit",
      },
      deps,
    );

    expect(out.status).toBe("submitted");
  });
});
