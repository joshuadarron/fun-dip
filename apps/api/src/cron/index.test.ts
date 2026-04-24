import type { PipelineInvoker } from "@fundip/rocketride-client";
import type { ScrapingPipelineInput, ScrapingPipelineOutput } from "@fundip/shared-types";
import { describe, expect, it, vi } from "vitest";
import { createFakeGhostClient } from "../ghost/fake.js";
import { createRepositories } from "../ghost/repos.js";
import { runWeeklyJob, SUNDAY_NOON_UTC } from "./index.js";

function makeInvoker(): {
  invoker: PipelineInvoker;
  scrape: ReturnType<typeof vi.fn>;
} {
  const scrape = vi.fn(async (input: ScrapingPipelineInput): Promise<ScrapingPipelineOutput> => {
    if (input.mode === "full_scrape") {
      return {
        status: "ok",
        mode: "full_scrape",
        programs_added: 1,
        programs_updated: 0,
        pages_scraped: 1,
      };
    }
    return { status: "ok", mode: "match", profile_id: input.profile_id, matches: [] };
  });
  const invoker: PipelineInvoker = {
    runChatPipeline: vi.fn(),
    runProfilePipeline: vi.fn(),
    runScrapingPipeline: scrape,
    runSubmissionsPipeline: vi.fn(),
  };
  return { invoker, scrape };
}

describe("runWeeklyJob", () => {
  it("runs full_scrape first, then a match pass per profile with emit_callback=true", async () => {
    const ghost = createFakeGhostClient({
      profiles: [
        {
          id: "p1",
          user_id: "u1",
          startup_name: "Acme",
          stage: "seed",
          location: "Austin",
          market: "B2B",
          goals: [],
          looking_for: [],
          narrative: "",
          updated_at: "2025-01-01T00:00:00.000Z",
          created_at: "2025-01-01T00:00:00.000Z",
        },
        {
          id: "p2",
          user_id: "u2",
          startup_name: "Beta",
          stage: "pre_seed",
          location: "Berlin",
          market: "Fintech",
          goals: [],
          looking_for: [],
          narrative: "",
          updated_at: "2025-01-01T00:00:00.000Z",
          created_at: "2025-01-01T00:00:00.000Z",
        },
      ],
    });
    const repos = createRepositories(ghost);
    const { invoker, scrape } = makeInvoker();

    await runWeeklyJob({ invoker, repos });

    expect(scrape).toHaveBeenCalledTimes(3);
    expect(scrape.mock.calls[0]![0]).toEqual({ mode: "full_scrape" });
    expect(scrape.mock.calls[1]![0]).toEqual({
      mode: "match",
      profile_id: "p1",
      emit_callback: true,
    });
    expect(scrape.mock.calls[2]![0]).toEqual({
      mode: "match",
      profile_id: "p2",
      emit_callback: true,
    });
  });

  it("when there are no profiles, runs only the full_scrape pass", async () => {
    const ghost = createFakeGhostClient({});
    const repos = createRepositories(ghost);
    const { invoker, scrape } = makeInvoker();
    await runWeeklyJob({ invoker, repos });
    expect(scrape).toHaveBeenCalledTimes(1);
    expect(scrape.mock.calls[0]![0]).toEqual({ mode: "full_scrape" });
  });

  it("documents the schedule cadence as Sunday noon UTC", () => {
    expect(SUNDAY_NOON_UTC).toBe("0 12 * * 0");
  });
});
