import type { PipelineInvoker } from "@fundip/rocketride-client";
import type {
  ScrapingFullScrapeOutput,
  ScrapingMatchOutput,
  ScrapingPipelineInput,
  ScrapingPipelineOutput,
} from "@fundip/shared-types";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createScrapingRouter } from "./scraping.js";

function makeInvoker(result: ScrapingPipelineOutput | (() => Promise<never>)): {
  invoker: PipelineInvoker;
  run: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn(async (input: ScrapingPipelineInput) => {
    void input;
    if (typeof result === "function") return result();
    return result;
  });
  const invoker: PipelineInvoker = {
    runChatPipeline: vi.fn(),
    runProfilePipeline: vi.fn(),
    runScrapingPipeline: run,
    runSubmissionsPipeline: vi.fn(),
  };
  return { invoker, run };
}

function mountApp(invoker: PipelineInvoker) {
  const app = express();
  app.use(express.json());
  app.use(createScrapingRouter({ invoker }));
  return app;
}

describe("POST /api/scraping/invoke", () => {
  it("forwards a full_scrape invocation and returns the pipeline output", async () => {
    const output: ScrapingFullScrapeOutput = {
      status: "ok",
      mode: "full_scrape",
      programs_added: 3,
      programs_updated: 1,
      pages_scraped: 12,
    };
    const { invoker, run } = makeInvoker(output);
    const res = await request(mountApp(invoker))
      .post("/api/scraping/invoke")
      .send({
        mode: "full_scrape",
        source_urls: ["https://example.com/grants", "https://example.com/accelerators"],
      })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(output);
    expect(run).toHaveBeenCalledWith({
      mode: "full_scrape",
      source_urls: ["https://example.com/grants", "https://example.com/accelerators"],
    });
  });

  it("forwards a match invocation with emit_callback=true", async () => {
    const output: ScrapingMatchOutput = {
      status: "ok",
      mode: "match",
      profile_id: "p1",
      matches: [
        {
          program_match_id: "m1",
          program_id: "pg1",
          score: 82,
          tier: "hot",
          positioning_summary: "Great fit.",
        },
      ],
    };
    const { invoker, run } = makeInvoker(output);
    const res = await request(mountApp(invoker))
      .post("/api/scraping/invoke")
      .send({ mode: "match", profile_id: "p1", emit_callback: true })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(output);
    expect(run).toHaveBeenCalledWith({
      mode: "match",
      profile_id: "p1",
      emit_callback: true,
    });
  });

  it("reflects emit_callback=false through to the invoker (chat path)", async () => {
    const { invoker, run } = makeInvoker({
      status: "ok",
      mode: "match",
      profile_id: "p1",
      matches: [],
    });
    const res = await request(mountApp(invoker))
      .post("/api/scraping/invoke")
      .send({ mode: "match", profile_id: "p1", emit_callback: false })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith({
      mode: "match",
      profile_id: "p1",
      emit_callback: false,
    });
  });

  it("rejects an invalid mode with 400", async () => {
    const { invoker, run } = makeInvoker({
      status: "ok",
      mode: "match",
      profile_id: "p1",
      matches: [],
    });
    const res = await request(mountApp(invoker))
      .post("/api/scraping/invoke")
      .send({ mode: "nope" })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a match request missing profile_id with 400", async () => {
    const { invoker, run } = makeInvoker({
      status: "ok",
      mode: "match",
      profile_id: "p1",
      matches: [],
    });
    const res = await request(mountApp(invoker))
      .post("/api/scraping/invoke")
      .send({ mode: "match" })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a full_scrape with non-url entries in source_urls", async () => {
    const { invoker, run } = makeInvoker({
      status: "ok",
      mode: "full_scrape",
      programs_added: 0,
      programs_updated: 0,
      pages_scraped: 0,
    });
    const res = await request(mountApp(invoker))
      .post("/api/scraping/invoke")
      .send({ mode: "full_scrape", source_urls: ["not a url"] })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("returns 502 with an error body when the pipeline throws", async () => {
    const { invoker } = makeInvoker(async () => {
      throw new Error("pipeline blew up");
    });
    const res = await request(mountApp(invoker))
      .post("/api/scraping/invoke")
      .send({ mode: "match", profile_id: "p1" })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      status: "error",
      error: "pipeline blew up",
      retryable: true,
    });
  });
});
