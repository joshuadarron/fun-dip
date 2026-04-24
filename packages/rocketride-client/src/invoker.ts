import type {
  ChatPipelineInput,
  ChatPipelineOutput,
  PipelineError,
  ProfilePipelineInput,
  ProfilePipelineOutput,
  ScrapingPipelineInput,
  ScrapingPipelineOutput,
  SubmissionsPipelineInput,
  SubmissionsPipelineOutput,
} from "@fundip/shared-types";

/**
 * Minimal surface of the real `rocketride` SDK client used by the app layer.
 * Declared here so this package does not need a hard dependency on the SDK:
 * the SDK is loaded lazily (see `createRocketRideClient`) and tests inject
 * fakes that conform to this interface.
 */
export interface RocketRideClientLike {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  use(options: {
    filepath?: string;
    pipeline?: unknown;
    token?: string;
  }): Promise<{ token: string }>;
  send(
    token: string,
    data: string,
    objinfo?: Record<string, unknown>,
    mimetype?: string,
  ): Promise<unknown>;
}

export type PipelineName = "chat" | "profile" | "scraping" | "submissions";

export type PipelineFilePaths = Record<PipelineName, string>;

export interface PipelineInvoker {
  runChatPipeline(input: ChatPipelineInput): Promise<ChatPipelineOutput>;
  runProfilePipeline(input: ProfilePipelineInput): Promise<ProfilePipelineOutput>;
  runScrapingPipeline(input: ScrapingPipelineInput): Promise<ScrapingPipelineOutput>;
  runSubmissionsPipeline(input: SubmissionsPipelineInput): Promise<SubmissionsPipelineOutput>;
}

export interface PipelineInvokerConfig {
  client: RocketRideClientLike;
  pipelineFiles: PipelineFilePaths;
  /**
   * Response sink convention used by every pipeline in this project.
   *
   * Non-chat pipelines (profile, scraping, submissions) all emit their JSON
   * output on the `response_answers` sink. The runtime returns a
   * `PIPELINE_RESULT` shaped like `{ answers: [<json-or-string>], ... }`. We
   * pick the first `answers` entry and, when it is a string, JSON-parse it.
   *
   * Overridable for future pipelines that prefer `response_text`. See
   * `.claude/docs/PIPELINE_CONTRACTS.md` (global conventions section).
   */
  responseSink?: "response_answers" | "response_text";
}

/**
 * Error thrown by the invoker when the underlying RocketRide SDK fails or
 * the pipeline returns a payload that cannot be interpreted as the
 * expected output shape. Wraps a `PipelineError` body that the app layer
 * can surface through routes without leaking SDK internals.
 */
export class RocketRideInvocationError extends Error {
  readonly body: PipelineError;
  constructor(body: PipelineError) {
    super(body.error);
    this.name = "RocketRideInvocationError";
    this.body = body;
  }
}

/**
 * Create a PipelineInvoker that, per call, opens the relevant pipeline
 * via `client.use({ filepath })`, sends the JSON input via `client.send`,
 * parses the response_answers sink, and validates the pipeline output
 * shape.
 *
 * Design notes:
 * - Each invocation opens a fresh pipeline instance. Pipelines in this
 *   project are short-lived webhook-source pipelines, not long-running
 *   chat pipelines, so we do not cache tokens. If a pipeline becomes
 *   hot-path enough to warrant reuse, extend this invoker with a
 *   per-name token cache.
 * - Connection lifetime is the caller's responsibility. The app layer
 *   connects the SDK client once at boot.
 * - MIME type of the send() call is `application/json` so the webhook
 *   source treats the payload as structured data, not a file upload.
 */
export function createPipelineInvoker(config: PipelineInvokerConfig): PipelineInvoker {
  const { client, pipelineFiles } = config;
  const sink = config.responseSink ?? "response_answers";

  async function invoke<Out>(name: PipelineName, input: unknown): Promise<Out> {
    const filepath = pipelineFiles[name];
    if (!filepath) {
      throw new RocketRideInvocationError({
        status: "error",
        error: `No pipeline file registered for "${name}"`,
        retryable: false,
        code: "pipeline_not_registered",
      });
    }
    let token: string;
    try {
      const opened = await client.use({ filepath });
      token = opened.token;
    } catch (err) {
      throw toInvocationError(err, "pipeline_open_failed");
    }
    let raw: unknown;
    try {
      raw = await client.send(token, JSON.stringify(input), undefined, "application/json");
    } catch (err) {
      throw toInvocationError(err, "pipeline_send_failed");
    }
    return extractOutput<Out>(raw, sink);
  }

  return {
    runChatPipeline: (input) => invoke<ChatPipelineOutput>("chat", input),
    runProfilePipeline: (input) => invoke<ProfilePipelineOutput>("profile", input),
    runScrapingPipeline: (input) => invoke<ScrapingPipelineOutput>("scraping", input),
    runSubmissionsPipeline: (input) => invoke<SubmissionsPipelineOutput>("submissions", input),
  };
}

/**
 * Attempt to pull the structured output from a RocketRide pipeline result.
 * The runtime returns `PIPELINE_RESULT`, a flexible object whose keys come
 * from the response sink's `laneName`. For `response_answers` the key is
 * `answers` (array); for `response_text` the key is `text` (string). We
 * also tolerate the output being returned directly at the top level.
 */
export function extractOutput<Out>(raw: unknown, sink: "response_answers" | "response_text"): Out {
  if (raw == null || typeof raw !== "object") {
    throw new RocketRideInvocationError({
      status: "error",
      error: "Pipeline returned no result object",
      retryable: true,
      code: "pipeline_empty_result",
    });
  }
  const result = raw as Record<string, unknown>;

  // If the pipeline itself emitted an error envelope, propagate it.
  const maybeStatus = result.status;
  if (maybeStatus === "error") {
    const errMsg = result.error;
    const retryable = result.retryable;
    const code = result.code;
    throw new RocketRideInvocationError({
      status: "error",
      error: typeof errMsg === "string" ? errMsg : "Pipeline returned error",
      retryable: Boolean(retryable),
      code: typeof code === "string" ? code : undefined,
    });
  }

  if (sink === "response_answers") {
    const answers = result.answers;
    if (Array.isArray(answers) && answers.length > 0) {
      return coerce<Out>(answers[0]);
    }
  } else {
    const text = result.text;
    if (typeof text === "string") {
      return coerce<Out>(text);
    }
  }

  // Fallback: if the runtime returned the output directly (some sinks do),
  // accept it as-is provided it looks like our contract shape.
  if ("status" in result) {
    return result as Out;
  }

  throw new RocketRideInvocationError({
    status: "error",
    error: `Pipeline result missing expected "${sink}" payload`,
    retryable: true,
    code: "pipeline_output_missing",
  });
}

function coerce<Out>(value: unknown): Out {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Out;
    } catch {
      // A plain text string cannot be our contract shape; surface as error.
      throw new RocketRideInvocationError({
        status: "error",
        error: "Pipeline returned non-JSON string where JSON was expected",
        retryable: false,
        code: "pipeline_output_invalid_json",
      });
    }
  }
  return value as Out;
}

function toInvocationError(err: unknown, code: string): RocketRideInvocationError {
  if (err instanceof RocketRideInvocationError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new RocketRideInvocationError({
    status: "error",
    error: message,
    retryable: true,
    code,
  });
}
