import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Program } from "@fundip/shared-types";
import { signDeepLinkToken } from "../deep-links/tokens.js";
import { runWeeklyJob } from "../cron/index.js";
import { createRepositories } from "../ghost/repos.js";
import {
  bootHarness,
  createStubInvoker,
  makeProfile,
  makeProgram,
  type Harness,
} from "./harness.js";

const PROGRAMS: Array<Omit<Program, "id">> = [
  makeProgram({
    source_url: "https://example.com/hot-fit",
    name: "Fintech Boost",
    stage_fit: ["seed"],
    geo_scope: ["Chicago"],
  }),
  makeProgram({
    source_url: "https://example.com/warm-fit",
    name: "Midwest Seed",
    stage_fit: ["seed", "series_a"],
    geo_scope: ["Detroit"],
  }),
];

describe("e2e full cycle", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await bootHarness({
      buildInvoker: ({ baseUrl, ghost }) =>
        createStubInvoker({
          ghost,
          appBaseUrl: baseUrl,
          callbackSecret: "c".repeat(40),
          programsSeed: PROGRAMS,
        }),
    });
    await h.ghost.insert("profiles", makeProfile({ user_id: "user-1" }));
  });

  afterEach(async () => {
    await h.stop();
  });

  it("Sunday cron writes programs, matches, and fires a digest email", async () => {
    const repos = createRepositories(h.ghost);
    await runWeeklyJob({ invoker: h.invoker!, repos });

    const programs = await h.ghost.list("programs");
    expect(programs).toHaveLength(2);

    const matches = await h.ghost.list("program_matches");
    expect(matches).toHaveLength(2);
    const byProgramName = new Map(
      await Promise.all(
        matches.map(async (m) => {
          const program = await h.ghost.get("programs", m.program_id);
          return [program?.name ?? "?", m] as const;
        }),
      ),
    );
    expect(byProgramName.get("Fintech Boost")?.tier).toBe("hot");
    expect(byProgramName.get("Midwest Seed")?.tier).toBe("warm");

    expect(h.email.sent.length).toBeGreaterThanOrEqual(1);
    const digest = h.email.sent.find((m) => /match/i.test(m.subject));
    expect(digest).toBeDefined();
    expect(digest?.html).toContain("Fintech Boost");
  });

  it("authenticated confirm of a signed deep link drives the submission to submitted", async () => {
    const profile = (await h.ghost.list("profiles"))[0]!;
    const program = await h.ghost.insert("programs", PROGRAMS[0]!);

    // Log in via the stubbed Google callback to get a session cookie.
    const agent = request.agent(h.app);
    const login = await agent.get("/auth/google/callback").query({ code: "stub" });
    expect([200, 302]).toContain(login.status);

    // Sign a deep-link token scoped to this profile.
    const token = signDeepLinkToken(
      { purpose: "submission_confirm", profile_id: profile.id },
      600,
      h.config.DEEP_LINK_SIGNING_KEY,
    );

    // Confirm + submit. The submission does not exist yet; the stub
    // invoker inserts one on the submit path.
    const res = await agent.post("/confirm/submit").type("form").send({
      token,
      submission: "pending",
      profile_id: profile.id,
      program_id: program.id,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("submitted");

    const submissions = await h.ghost.list("submissions");
    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.status).toBe("submitted");
    expect(submissions[0]?.confirmation_ref).toBe("CONF-123");

    // Pre-seed a match row so the applied side-effect has something to
    // flip, then re-run the submit path and verify. In this first pass
    // there is no match row; just assert the primary submission state.
    const confirmEmail = h.email.sent.find((m) => /submit/i.test(m.subject));
    expect(confirmEmail).toBeDefined();
  });

  it("submit after match flips program_matches.status to applied", async () => {
    const repos = createRepositories(h.ghost);

    // Run the weekly job so matches exist.
    await runWeeklyJob({ invoker: h.invoker!, repos });
    const profile = (await h.ghost.list("profiles"))[0]!;
    const hotProgram = (await h.ghost.list("programs")).find((p) => p.name === "Fintech Boost")!;

    // Auth + confirm.
    const agent = request.agent(h.app);
    await agent.get("/auth/google/callback").query({ code: "stub" });
    const token = signDeepLinkToken(
      { purpose: "submission_confirm", profile_id: profile.id },
      600,
      h.config.DEEP_LINK_SIGNING_KEY,
    );
    const res = await agent.post("/confirm/submit").type("form").send({
      token,
      submission: "pending",
      profile_id: profile.id,
      program_id: hotProgram.id,
    });
    expect(res.status).toBe(200);

    const match = (await h.ghost.list("program_matches")).find(
      (m) => m.program_id === hotProgram.id,
    );
    expect(match?.status).toBe("applied");
  });
});
