import type { Profile, Program, ProgramMatch, Submission } from "@fundip/shared-types";
import { describe, expect, it, vi } from "vitest";
import { createFakeGhostClient } from "../ghost/fake.js";
import { createRepositories } from "../ghost/repos.js";
import type { EmailClient, EmailMessage } from "../email/client.js";
import { createCallbackHandlers, type UserEmailResolver } from "./handlers.js";

const profile: Profile = {
  id: "prof-1",
  user_id: "user-1",
  startup_name: "Acme",
  stage: "seed",
  location: "Austin",
  market: "B2B SaaS",
  goals: [],
  looking_for: [],
  narrative: "",
  updated_at: "2025-01-01T00:00:00.000Z",
  created_at: "2025-01-01T00:00:00.000Z",
};

const program: Program = {
  id: "prog-1",
  source_url: "https://yc.example.com",
  name: "Y Combinator",
  provider: "Y Combinator",
  description: "Top accelerator",
  requirements: "Pre-seed, technical founder",
  apply_method: "form",
  apply_url: "https://yc.example.com/apply",
  deadline: null,
  stage_fit: ["seed"],
  market_fit: [],
  geo_scope: [],
  last_scraped_at: "2025-01-01T00:00:00.000Z",
  first_seen_at: "2025-01-01T00:00:00.000Z",
};

const match: ProgramMatch = {
  id: "match-1",
  profile_id: "prof-1",
  program_id: "prog-1",
  score: 88,
  tier: "hot",
  positioning_summary: "Acme fits because of strong technical founders.",
  status: "new",
  rationale: "",
  matched_at: "2025-01-01T00:00:00.000Z",
};

const submission: Submission = {
  id: "sub-1",
  profile_id: "prof-1",
  program_id: "prog-1",
  program_match_id: "match-1",
  status: "awaiting_user_input",
  prefilled_fields: {},
  missing_fields: [{ field_name: "team_size", description: "How many?", type: "number" }],
  provided_data: {},
  submitted_at: null,
  confirmation_ref: null,
  response_text: null,
  error: null,
  created_at: "2025-01-01T00:00:00.000Z",
  updated_at: "2025-01-01T00:00:00.000Z",
};

function makeHarness(opts: { resolverEmail?: string | null } = {}) {
  const ghost = createFakeGhostClient({
    profiles: [profile],
    programs: [program],
    program_matches: [match],
    submissions: [submission],
  });
  const repos = createRepositories(ghost);
  const send = vi.fn<(message: EmailMessage) => Promise<{ id: string }>>(async () => ({
    id: "msg-1",
  }));
  const email: EmailClient = { send };
  const userEmail: UserEmailResolver = {
    resolveUserEmail: vi.fn(async () =>
      opts.resolverEmail === undefined ? "founder@acme.test" : opts.resolverEmail,
    ),
  };
  const signer = vi.fn((_payload: unknown, _ttl: number) => "signed.token");
  const handlers = createCallbackHandlers({
    repos,
    email,
    signer,
    appBaseUrl: "https://app.fundip.test",
    userEmail,
  });
  return { handlers, send, userEmail, signer };
}

describe("createCallbackHandlers", () => {
  it("onMatchesReady sends a digest with one section per match and a signed deep-link URL", async () => {
    const { handlers, send, signer } = makeHarness();
    await handlers.onMatchesReady({ profile_id: "prof-1", match_count: 1, max_tier: "hot" });
    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0]![0];
    expect(sent.to).toBe("founder@acme.test");
    expect(sent.subject).toContain("Acme");
    expect(sent.html).toContain("Y Combinator");
    expect(sent.html).toContain("88/100");
    expect(sent.html).toContain(
      "https://app.fundip.test/confirm?token=signed.token&amp;submission=match-1",
    );
    expect(signer).toHaveBeenCalledWith(
      { purpose: "submission_confirm", profile_id: "prof-1", submission_id: "match-1" },
      expect.any(Number),
    );
  });

  it("onMatchesReady skips when match_count is 0", async () => {
    const { handlers, send } = makeHarness();
    await handlers.onMatchesReady({ profile_id: "prof-1", match_count: 0, max_tier: "cold" });
    expect(send).not.toHaveBeenCalled();
  });

  it("onMatchesReady skips when no email is resolvable", async () => {
    const { handlers, send } = makeHarness({ resolverEmail: null });
    await handlers.onMatchesReady({ profile_id: "prof-1", match_count: 1, max_tier: "hot" });
    expect(send).not.toHaveBeenCalled();
  });

  it("onSubmissionNeedsInput sends the missing-info email with gap list", async () => {
    const { handlers, send } = makeHarness();
    await handlers.onSubmissionNeedsInput({
      submission_id: "sub-1",
      profile_id: "prof-1",
      program_id: "prog-1",
      missing_fields: [
        { field_name: "team_size", description: "How many full-time?", type: "number" },
      ],
    });
    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0]![0];
    expect(sent.to).toBe("founder@acme.test");
    expect(sent.subject).toContain("Y Combinator");
    expect(sent.html).toContain("team_size");
    expect(sent.html).toContain("https://app.fundip.test/profile");
  });

  it("onSubmissionSubmitted sends the confirmation email with the ref", async () => {
    const { handlers, send } = makeHarness();
    await handlers.onSubmissionSubmitted({
      submission_id: "sub-1",
      profile_id: "prof-1",
      program_id: "prog-1",
      confirmation_ref: "REF-42",
    });
    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0]![0];
    expect(sent.to).toBe("founder@acme.test");
    expect(sent.subject).toBe("Application submitted: Y Combinator");
    expect(sent.html).toContain("REF-42");
    expect(sent.html).toContain("https://app.fundip.test/submissions");
  });
});
