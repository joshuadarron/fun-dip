import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Lightweight "does the pipeline file load and look sane" check. Does NOT
 * run the pipeline (that requires RocketRide credentials, a live MCP
 * server, and a Tinyfish account). Run with:
 * `pnpm --filter @fundip/pipeline-submissions check`.
 *
 * Matches the RocketRide README convention: every project ships a check
 * program that verifies the pipeline config and environment are set up.
 */

interface Component {
  id: string;
  provider: string;
  config?: Record<string, unknown>;
  input?: Array<{ lane: string; from: string }>;
  control?: Array<{ classType: string; from: string }>;
}

interface PipelineConfig {
  components: Component[];
  project_id: string;
  viewport: { x: number; y: number; zoom: number };
  version: number;
}

const here = dirname(fileURLToPath(import.meta.url));
const pipelinePath = resolve(here, "pipeline.pipe");

function loadPipeline(): PipelineConfig {
  const raw = readFileSync(pipelinePath, "utf8");
  const parsed = JSON.parse(raw) as PipelineConfig;
  if (!Array.isArray(parsed.components) || parsed.components.length === 0) {
    throw new Error("pipeline.pipe: components must be a non-empty array");
  }
  if (typeof parsed.project_id !== "string" || parsed.project_id.length < 32) {
    throw new Error("pipeline.pipe: project_id must be a GUID string");
  }
  if (parsed.version !== 1) {
    throw new Error("pipeline.pipe: version must be 1");
  }
  return parsed;
}

function assertComponent(
  components: Component[],
  predicate: (c: Component) => boolean,
  description: string,
): Component {
  const found = components.find(predicate);
  if (!found) throw new Error(`pipeline.pipe: missing ${description}`);
  return found;
}

function main(): void {
  const config = loadPipeline();
  const components = config.components;

  const ids = new Set<string>();
  for (const c of components) {
    if (ids.has(c.id)) throw new Error(`duplicate component id: ${c.id}`);
    ids.add(c.id);
  }

  // Required shape: webhook source, a deep agent, an LLM controlling it,
  // an MCP client wired to Ghost, a Tinyfish tool (application mode),
  // an HTTP tool for HMAC-signed callbacks, and a response_answers sink.
  const webhook = assertComponent(
    components,
    (c) => c.provider === "webhook",
    "webhook source node",
  );
  const agent = assertComponent(
    components,
    (c) => c.provider === "agent_deepagent",
    "agent_deepagent node",
  );
  const llm = assertComponent(
    components,
    (c) => c.provider === "llm_openai" || c.provider === "llm_anthropic",
    "llm node controlled by the agent",
  );
  const mcp = assertComponent(
    components,
    (c) => c.provider === "mcp_client",
    "mcp_client node for Ghost",
  );
  const tinyfish = assertComponent(
    components,
    (c) => c.provider === "tool_tinyfish",
    "tool_tinyfish node in application mode",
  );
  const http = assertComponent(
    components,
    (c) => c.provider === "tool_http_request",
    "tool_http_request node for HMAC-signed callbacks",
  );
  const response = assertComponent(
    components,
    (c) => c.provider === "response_answers",
    "response_answers sink",
  );

  if (!agent.input?.some((i) => i.lane === "questions" && i.from === webhook.id)) {
    throw new Error("agent must accept questions from the webhook source");
  }
  if (!llm.control?.some((c) => c.classType === "llm" && c.from === agent.id)) {
    throw new Error("llm must declare control: [{ classType: 'llm', from: agent.id }]");
  }
  if (!mcp.control?.some((c) => c.classType === "tool" && c.from === agent.id)) {
    throw new Error("mcp_client must declare control: [{ classType: 'tool', from: agent.id }]");
  }
  if (!tinyfish.control?.some((c) => c.classType === "tool" && c.from === agent.id)) {
    throw new Error("tool_tinyfish must declare control: [{ classType: 'tool', from: agent.id }]");
  }
  if (!http.control?.some((c) => c.classType === "tool" && c.from === agent.id)) {
    throw new Error(
      "tool_http_request must declare control: [{ classType: 'tool', from: agent.id }]",
    );
  }
  if (!response.input?.some((i) => i.lane === "answers" && i.from === agent.id)) {
    throw new Error("response_answers must receive answers from the agent");
  }

  // Tinyfish must be configured in 'application' mode per the submissions
  // pipeline contract (pipelines/submissions/AGENTS.md line 87).
  const tinyConfig = (tinyfish.config ?? {}) as { mode?: string };
  if (tinyConfig.mode !== "application") {
    throw new Error("tool_tinyfish must be configured with mode='application'");
  }

  // HMAC callback signing must reference CALLBACK_SHARED_SECRET via env
  // substitution, never hardcoded.
  const httpBody = JSON.stringify(http.config ?? {});
  if (!httpBody.includes("${CALLBACK_SHARED_SECRET}")) {
    throw new Error(
      "tool_http_request must reference ${CALLBACK_SHARED_SECRET} (not hardcoded) for HMAC signing",
    );
  }

  // Env variable references present in the config are surfaced so the user
  // knows what the .env needs.
  const body = JSON.stringify(config);
  const vars = new Set<string>();
  for (const match of body.matchAll(/\$\{([A-Z0-9_]+)\}/g)) {
    vars.add(match[1]!);
  }

  process.stdout.write("submissions pipeline check: OK\n");
  process.stdout.write(`  project_id: ${config.project_id}\n`);
  process.stdout.write(`  components: ${components.length}\n`);
  if (vars.size) {
    process.stdout.write(`  required env vars: ${[...vars].sort().join(", ")}\n`);
  }
}

main();
