import type { PipelineInvoker } from "@fundip/rocketride-client";
import type { ChatPipelineInput, ChatPipelineOutput } from "@fundip/shared-types";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createChatRouter } from "./chat.js";

type ChatMock = ChatPipelineOutput | ((input: ChatPipelineInput) => Promise<ChatPipelineOutput>);

function makeInvoker(result: ChatMock): {
  invoker: PipelineInvoker;
  run: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn(async (input: ChatPipelineInput) => {
    if (typeof result === "function") return result(input);
    return result;
  });
  const invoker: PipelineInvoker = {
    runChatPipeline: run,
    runProfilePipeline: vi.fn(),
    runScrapingPipeline: vi.fn(),
    runSubmissionsPipeline: vi.fn(),
  };
  return { invoker, run };
}

function mountApp(invoker: PipelineInvoker) {
  const app = express();
  app.use(express.json());
  app.use(createChatRouter({ invoker }));
  return app;
}

describe("POST /api/chat", () => {
  it("happy path: forwards a well-formed body to the invoker and returns ChatPipelineOutput", async () => {
    const output: ChatPipelineOutput = {
      status: "ok",
      reply: "Hello back.",
      conversation_id: "c1",
      tool_calls: [],
      surfaced: { pending_submissions: [] },
    };
    const { invoker, run } = makeInvoker(output);
    const body: ChatPipelineInput = {
      user_id: "user-1",
      profile_id: "p1",
      conversation_id: "c1",
      current_page: "dashboard",
      current_selection: null,
      message: "Hello",
    };
    const res = await request(mountApp(invoker))
      .post("/api/chat")
      .send(body)
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(output);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(body);
  });

  it("propagates current_selection and current_page to the invoker", async () => {
    const output: ChatPipelineOutput = {
      status: "ok",
      reply: "Started prefill.",
      conversation_id: "c1",
      tool_calls: [
        {
          tool: "submissions",
          input: { profile_id: "p1", program_id: "prog-1", action: "prefill_only" },
          output: { status: "prefilled", submission_id: "s1", prefilled_fields: {} },
        },
      ],
      surfaced: {},
    };
    const { invoker, run } = makeInvoker(output);
    const body: ChatPipelineInput = {
      user_id: "user-1",
      profile_id: "p1",
      conversation_id: "c1",
      current_page: "programs",
      current_selection: { type: "program", id: "prog-1" },
      message: "apply",
    };
    const res = await request(mountApp(invoker))
      .post("/api/chat")
      .send(body)
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(output);
    expect(run).toHaveBeenCalledWith(body);
    const arg = run.mock.calls[0]![0] as ChatPipelineInput;
    expect(arg.current_page).toBe("programs");
    expect(arg.current_selection).toEqual({ type: "program", id: "prog-1" });
  });

  it("400s on schema-invalid input (missing message)", async () => {
    const { invoker, run } = makeInvoker({
      status: "ok",
      reply: "x",
      conversation_id: "c1",
      tool_calls: [],
      surfaced: {},
    });
    const res = await request(mountApp(invoker))
      .post("/api/chat")
      .send({
        user_id: "user-1",
        profile_id: "p1",
        conversation_id: "c1",
        current_page: "dashboard",
        current_selection: null,
      })
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("400s on bad enum values for current_page", async () => {
    const { invoker, run } = makeInvoker({
      status: "ok",
      reply: "x",
      conversation_id: "c1",
      tool_calls: [],
      surfaced: {},
    });
    const res = await request(mountApp(invoker))
      .post("/api/chat")
      .send({
        user_id: "user-1",
        profile_id: "p1",
        conversation_id: "c1",
        current_page: "not_a_page",
        current_selection: null,
        message: "hi",
      })
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("400s on extra fields (strict schema)", async () => {
    const { invoker, run } = makeInvoker({
      status: "ok",
      reply: "x",
      conversation_id: "c1",
      tool_calls: [],
      surfaced: {},
    });
    const res = await request(mountApp(invoker))
      .post("/api/chat")
      .send({
        user_id: "user-1",
        profile_id: "p1",
        conversation_id: "c1",
        current_page: "dashboard",
        current_selection: null,
        message: "hi",
        extra: "boom",
      })
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("502s with the error body when the invoker throws a RocketRide error", async () => {
    const { invoker } = makeInvoker(async () => {
      const err = Object.assign(new Error("boom"), {
        body: { status: "error", error: "boom", retryable: true },
      });
      throw err;
    });
    const res = await request(mountApp(invoker))
      .post("/api/chat")
      .send({
        user_id: "user-1",
        profile_id: "p1",
        conversation_id: "c1",
        current_page: "dashboard",
        current_selection: null,
        message: "hi",
      })
      .set("Content-Type", "application/json");
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ status: "error", error: "boom" });
  });
});
