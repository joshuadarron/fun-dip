import type {
  ProfilePipelineInput,
  ProfilePipelineOutput,
  ScrapingMatchOutput,
  SubmissionsPipelineInput,
  SubmissionsPrefilledOutput,
} from "@fundip/shared-types";
import { describe, expect, it, vi } from "vitest";
import {
  RocketRideInvocationError,
  createPipelineInvoker,
  extractOutput,
  type RocketRideClientLike,
} from "./invoker.js";

type SendArgs = [string, string, Record<string, unknown> | undefined, string | undefined];

function makeFakeClient(sendResult: unknown): {
  client: RocketRideClientLike;
  use: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn<(...args: SendArgs) => Promise<unknown>>>;
} {
  const use = vi.fn(async ({ filepath }: { filepath?: string }) => ({
    token: `tok:${filepath}`,
  }));
  const send = vi.fn(async (..._args: SendArgs) => sendResult);
  const client: RocketRideClientLike = {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    use,
    send,
  };
  return { client, use, send };
}

const pipelineFiles = {
  chat: "pipelines/chat/pipeline.pipe",
  profile: "pipelines/profile/pipeline.pipe",
  scraping: "pipelines/scraping/pipeline.pipe",
  submissions: "pipelines/submissions/pipeline.pipe",
};

describe("createPipelineInvoker", () => {
  it("opens the profile pipeline by filepath and sends input as JSON", async () => {
    const output: ProfilePipelineOutput = {
      status: "ok",
      profile_id: "p1",
      delta: { fields_updated: ["stage"], fields_added: [], narrative_appended: true },
      profile_summary: "A seed-stage fintech startup based in Chicago.",
    };
    const { client, use, send } = makeFakeClient({ answers: [JSON.stringify(output)] });

    const invoker = createPipelineInvoker({ client, pipelineFiles });
    const input: ProfilePipelineInput = {
      profile_id: "p1",
      mode: "update",
      facts: [{ field: "stage", value: "seed", source: "chat" }],
    };
    const result = await invoker.runProfilePipeline(input);

    expect(use).toHaveBeenCalledWith({ filepath: "pipelines/profile/pipeline.pipe" });
    expect(send).toHaveBeenCalledTimes(1);
    const [token, payload, objinfo, mime] = send.mock.calls[0] as SendArgs;
    expect(token).toBe("tok:pipelines/profile/pipeline.pipe");
    expect(JSON.parse(payload)).toEqual(input);
    expect(objinfo).toBeUndefined();
    expect(mime).toBe("application/json");
    expect(result).toEqual(output);
  });

  it("accepts an already-parsed object in answers[0]", async () => {
    const output: ScrapingMatchOutput = {
      status: "ok",
      mode: "match",
      profile_id: "p1",
      matches: [],
    };
    const { client } = makeFakeClient({ answers: [output] });
    const invoker = createPipelineInvoker({ client, pipelineFiles });
    const result = await invoker.runScrapingPipeline({ mode: "match", profile_id: "p1" });
    expect(result).toEqual(output);
  });

  it("propagates a pipeline-side error envelope as RocketRideInvocationError", async () => {
    const { client } = makeFakeClient({
      status: "error",
      error: "profile not found",
      retryable: false,
      code: "profile_not_found",
    });
    const invoker = createPipelineInvoker({ client, pipelineFiles });
    await expect(
      invoker.runProfilePipeline({ profile_id: "p1", mode: "read" }),
    ).rejects.toMatchObject({
      name: "RocketRideInvocationError",
      body: { status: "error", error: "profile not found", retryable: false },
    });
  });

  it("maps a send() exception into a retryable pipeline_send_failed error", async () => {
    const use = vi.fn(async () => ({ token: "t" }));
    const send = vi.fn(async () => {
      throw new Error("boom");
    });
    const client: RocketRideClientLike = {
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      use,
      send,
    };
    const invoker = createPipelineInvoker({ client, pipelineFiles });
    const input: SubmissionsPipelineInput = {
      profile_id: "p1",
      program_id: "prog1",
      action: "prefill_only",
    };
    await expect(invoker.runSubmissionsPipeline(input)).rejects.toBeInstanceOf(
      RocketRideInvocationError,
    );
    await expect(invoker.runSubmissionsPipeline(input)).rejects.toMatchObject({
      body: { code: "pipeline_send_failed", retryable: true },
    });
  });

  it("raises when the pipeline returns an empty answers array", async () => {
    const { client } = makeFakeClient({ answers: [] });
    const invoker = createPipelineInvoker({ client, pipelineFiles });
    await expect(
      invoker.runProfilePipeline({ profile_id: "p1", mode: "read" }),
    ).rejects.toMatchObject({ body: { code: "pipeline_output_missing" } });
  });

  it("supports response_text sink when configured", async () => {
    const out: SubmissionsPrefilledOutput = {
      status: "prefilled",
      submission_id: "sub1",
      prefilled_fields: {},
    };
    const use = vi.fn(async () => ({ token: "t" }));
    const send = vi.fn(async () => ({ text: JSON.stringify(out) }));
    const client: RocketRideClientLike = {
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      use,
      send,
    };
    const invoker = createPipelineInvoker({
      client,
      pipelineFiles,
      responseSink: "response_text",
    });
    const result = await invoker.runSubmissionsPipeline({
      profile_id: "p1",
      program_id: "prog1",
      action: "prefill_only",
    });
    expect(result).toEqual(out);
  });

  it("extractOutput falls back to a top-level status payload", () => {
    const out: ProfilePipelineOutput = {
      status: "ok",
      profile_id: "p1",
      delta: { fields_updated: [], fields_added: [], narrative_appended: false },
      profile_summary: "",
    };
    expect(extractOutput<ProfilePipelineOutput>(out, "response_answers")).toEqual(out);
  });
});
