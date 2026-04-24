import type { PipelineInvoker } from "@fundip/rocketride-client";
import type { ProfilePipelineInput, ProfilePipelineOutput } from "@fundip/shared-types";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createProfileRouter } from "./profile.js";

function makeInvoker(result: ProfilePipelineOutput | (() => Promise<never>)): {
  invoker: PipelineInvoker;
  run: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn(async (input: ProfilePipelineInput) => {
    void input;
    if (typeof result === "function") return result();
    return result;
  });
  const invoker: PipelineInvoker = {
    runChatPipeline: vi.fn(),
    runProfilePipeline: run,
    runScrapingPipeline: vi.fn(),
    runSubmissionsPipeline: vi.fn(),
  };
  return { invoker, run };
}

function mountApp(invoker: PipelineInvoker) {
  const app = express();
  app.use(express.json());
  app.use(createProfileRouter({ invoker }));
  return app;
}

describe("POST /api/profile/invoke", () => {
  it("validates input and forwards to the invoker", async () => {
    const output: ProfilePipelineOutput = {
      status: "ok",
      profile_id: "p1",
      delta: { fields_updated: ["market"], fields_added: [], narrative_appended: true },
      profile_summary: "A fintech startup.",
    };
    const { invoker, run } = makeInvoker(output);
    const app = mountApp(invoker);

    const res = await request(app)
      .post("/api/profile/invoke")
      .send({
        profile_id: "p1",
        mode: "update",
        facts: [{ field: "market", value: "fintech", source: "chat" }],
      })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(output);
    expect(run).toHaveBeenCalledWith({
      profile_id: "p1",
      mode: "update",
      facts: [{ field: "market", value: "fintech", source: "chat" }],
    });
  });

  it("rejects an invalid mode with 400", async () => {
    const { invoker, run } = makeInvoker({
      status: "ok",
      profile_id: "p1",
      delta: { fields_updated: [], fields_added: [], narrative_appended: false },
      profile_summary: "",
    });
    const res = await request(mountApp(invoker))
      .post("/api/profile/invoke")
      .send({ profile_id: "p1", mode: "nope" })
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
});
