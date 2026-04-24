import type {
  ChatPipelineInput,
  ChatPipelineOutput,
  ProfilePipelineInput,
  ProfilePipelineOutput,
  ScrapingPipelineInput,
  ScrapingPipelineOutput,
  SubmissionsPipelineInput,
  SubmissionsPipelineOutput,
} from "@fundip/shared-types";

/**
 * Minimal surface of the real `rocketride` SDK client used by the app layer.
 * Declared here so this package does not need a hard dependency on the SDK
 * until pipeline files exist (Phase 3+).
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
}

/**
 * Factory stub. Real implementation lands in Phase 3 once the first
 * `.pipe` file exists and we can verify the send/response shape. Until
 * then, calling any method throws so callers cannot silently no-op.
 */
export function createPipelineInvoker(_config: PipelineInvokerConfig): PipelineInvoker {
  const notImplemented = (name: PipelineName): never => {
    throw new Error(
      `RocketRide pipeline "${name}" invoker not implemented yet (Phase 3). ` +
        `See .claude/docs/PIPELINE_CONTRACTS.md and pipelines/${name}/AGENTS.md.`,
    );
  };
  return {
    async runChatPipeline() {
      return notImplemented("chat");
    },
    async runProfilePipeline() {
      return notImplemented("profile");
    },
    async runScrapingPipeline() {
      return notImplemented("scraping");
    },
    async runSubmissionsPipeline() {
      return notImplemented("submissions");
    },
  };
}
