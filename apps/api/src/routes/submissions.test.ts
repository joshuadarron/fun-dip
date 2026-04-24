import type { PipelineInvoker } from "@fundip/rocketride-client";
import type { SubmissionsPipelineInput, SubmissionsPipelineOutput } from "@fundip/shared-types";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createSubmissionsRouter } from "./submissions.js";

type SubmissionsMock =
  | SubmissionsPipelineOutput
  | ((input: SubmissionsPipelineInput) => Promise<SubmissionsPipelineOutput>);

function makeInvoker(result: SubmissionsMock): {
  invoker: PipelineInvoker;
  run: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn(async (input: SubmissionsPipelineInput) => {
    if (typeof result === "function") return result(input);
    return result;
  });
  const invoker: PipelineInvoker = {
    runChatPipeline: vi.fn(),
    runProfilePipeline: vi.fn(),
    runScrapingPipeline: vi.fn(),
    runSubmissionsPipeline: run,
  };
  return { invoker, run };
}

function mountApp(invoker: PipelineInvoker) {
  const app = express();
  app.use(express.json());
  app.use(createSubmissionsRouter({ invoker }));
  return app;
}

describe("POST /api/submissions/prefill", () => {
  it("forwards a well-formed body to the invoker with action=prefill_only", async () => {
    const output: SubmissionsPipelineOutput = {
      status: "prefilled",
      submission_id: "s1",
      prefilled_fields: { startup_name: "Acme" },
    };
    const { invoker, run } = makeInvoker(output);
    const res = await request(mountApp(invoker))
      .post("/api/submissions/prefill")
      .send({ profile_id: "p1", program_id: "prog1" })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(output);
    expect(run).toHaveBeenCalledWith({
      profile_id: "p1",
      program_id: "prog1",
      action: "prefill_only",
    });
  });

  it("400s on missing profile_id", async () => {
    const { invoker, run } = makeInvoker({
      status: "prefilled",
      submission_id: "x",
      prefilled_fields: {},
    });
    const res = await request(mountApp(invoker))
      .post("/api/submissions/prefill")
      .send({ program_id: "prog1" })
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("400s on unknown extra fields (strict schema)", async () => {
    const { invoker, run } = makeInvoker({
      status: "prefilled",
      submission_id: "x",
      prefilled_fields: {},
    });
    const res = await request(mountApp(invoker))
      .post("/api/submissions/prefill")
      .send({ profile_id: "p1", program_id: "prog1", action: "submit" })
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("POST /api/submissions/:id/resume", () => {
  it("merges the :id into the invoker input and keeps action=prefill_only", async () => {
    const output: SubmissionsPipelineOutput = {
      status: "needs_input",
      submission_id: "s1",
      missing_fields: [{ field_name: "pitch_deck_url", description: "URL", type: "string" }],
    };
    const { invoker, run } = makeInvoker(output);
    const res = await request(mountApp(invoker))
      .post("/api/submissions/s1/resume")
      .send({
        profile_id: "p1",
        program_id: "prog1",
        provided_data: { team_size: 5 },
      })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(output);
    expect(run).toHaveBeenCalledWith({
      profile_id: "p1",
      program_id: "prog1",
      submission_id: "s1",
      action: "prefill_only",
      provided_data: { team_size: 5 },
    });
  });

  it("400s on missing profile_id", async () => {
    const { invoker, run } = makeInvoker({
      status: "prefilled",
      submission_id: "x",
      prefilled_fields: {},
    });
    const res = await request(mountApp(invoker))
      .post("/api/submissions/s1/resume")
      .send({ program_id: "prog1" })
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("POST /api/submissions/:id/submit", () => {
  it("invokes with action=submit and returns the typed output", async () => {
    const output: SubmissionsPipelineOutput = {
      status: "submitted",
      submission_id: "s1",
      confirmation_ref: "CONF-1",
    };
    const { invoker, run } = makeInvoker(output);
    const res = await request(mountApp(invoker))
      .post("/api/submissions/s1/submit")
      .send({ profile_id: "p1", program_id: "prog1" })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(output);
    expect(run).toHaveBeenCalledWith({
      profile_id: "p1",
      program_id: "prog1",
      submission_id: "s1",
      action: "submit",
    });
  });

  it("is idempotent: a second submit call forwards through the invoker but the caller is expected to pass the same submission_id", async () => {
    // The pipeline itself enforces idempotency; this route just forwards.
    // We verify the route DOES forward every call, so the pipeline sees
    // the duplicate. Mock the invoker to short-circuit the second call
    // the way the real pipeline would.
    const first: SubmissionsPipelineOutput = {
      status: "submitted",
      submission_id: "s1",
      confirmation_ref: "CONF-1",
    };
    const { invoker, run } = makeInvoker(async () => first);

    const app = mountApp(invoker);
    const r1 = await request(app)
      .post("/api/submissions/s1/submit")
      .send({ profile_id: "p1", program_id: "prog1" })
      .set("Content-Type", "application/json");
    const r2 = await request(app)
      .post("/api/submissions/s1/submit")
      .send({ profile_id: "p1", program_id: "prog1" })
      .set("Content-Type", "application/json");

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body).toEqual(first);
    expect(r2.body).toEqual(first);
    // Route forwards both calls; pipeline layer is responsible for
    // returning the cached submitted result on the second call. The
    // mock above does exactly that. Call count on the route's invoker
    // therefore reflects exactly two invocations.
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("400s on missing program_id", async () => {
    const { invoker, run } = makeInvoker({
      status: "submitted",
      submission_id: "s1",
      confirmation_ref: null,
    });
    const res = await request(mountApp(invoker))
      .post("/api/submissions/s1/submit")
      .send({ profile_id: "p1" })
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("502s with error body when the invoker throws a RocketRide error", async () => {
    const { invoker } = makeInvoker(async () => {
      // Emulate RocketRideInvocationError.body shape without pulling the
      // class in (the route only inspects `.body`).
      const err = Object.assign(new Error("boom"), {
        body: { status: "error", error: "boom", retryable: true },
      });
      throw err;
    });
    const res = await request(mountApp(invoker))
      .post("/api/submissions/s1/submit")
      .send({ profile_id: "p1", program_id: "prog1" })
      .set("Content-Type", "application/json");
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ status: "error", error: "boom" });
  });
});
