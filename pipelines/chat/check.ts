import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Lightweight "does the pipeline file load and look sane" check. Does NOT
 * run the pipeline (that requires RocketRide credentials, a live MCP
 * server, and child pipelines wired up). Run with:
 * `pnpm --filter @fundip/pipeline-chat check`.
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

function findComponent(
  components: Component[],
  predicate: (c: Component) => boolean,
): Component | undefined {
  return components.find(predicate);
}

function main(): void {
  const config = loadPipeline();
  const components = config.components;

  const ids = new Set<string>();
  for (const c of components) {
    if (ids.has(c.id)) throw new Error(`duplicate component id: ${c.id}`);
    ids.add(c.id);
  }

  // Required shape: webhook (or chat) source, a deep agent, an LLM
  // controlling it, an MCP client wired to Ghost, three pipeline_as_tool
  // wrappers (profile, scraping match-only, submissions prefill-only),
  // optionally a fourth wrapper for explicit submit, and a response sink.
  const source = assertComponent(
    components,
    (c) => c.provider === "webhook" || c.provider === "chat",
    "webhook or chat source node",
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
  const profileTool = assertComponent(
    components,
    (c) =>
      c.provider === "pipeline_as_tool" &&
      (c.config as { tool_name?: string } | undefined)?.tool_name === "profile_pipeline",
    "pipeline_as_tool wrapper for profile_pipeline",
  );
  const scrapingMatchTool = assertComponent(
    components,
    (c) =>
      c.provider === "pipeline_as_tool" &&
      (c.config as { tool_name?: string } | undefined)?.tool_name === "scraping_pipeline_match",
    "pipeline_as_tool wrapper for scraping_pipeline_match (match-only)",
  );
  const submissionsPrefillTool = assertComponent(
    components,
    (c) =>
      c.provider === "pipeline_as_tool" &&
      (c.config as { tool_name?: string } | undefined)?.tool_name ===
        "submissions_pipeline_prefill",
    "pipeline_as_tool wrapper for submissions_pipeline_prefill (prefill_only)",
  );
  // Optional: explicit submit wrapper. Allowed but not required at config
  // load time. The chat-side preflight is what enforces in-turn confirmation.
  const submissionsSubmitTool = findComponent(
    components,
    (c) =>
      c.provider === "pipeline_as_tool" &&
      (c.config as { tool_name?: string } | undefined)?.tool_name === "submissions_pipeline_submit",
  );
  const response = assertComponent(
    components,
    (c) => c.provider === "response_answers" || c.provider === "response_text",
    "response_answers or response_text sink",
  );

  if (!agent.input?.some((i) => i.lane === "questions" && i.from === source.id)) {
    throw new Error("agent must accept questions from the source node");
  }
  if (!llm.control?.some((c) => c.classType === "llm" && c.from === agent.id)) {
    throw new Error("llm must declare control: [{ classType: 'llm', from: agent.id }]");
  }
  if (!mcp.control?.some((c) => c.classType === "tool" && c.from === agent.id)) {
    throw new Error("mcp_client must declare control: [{ classType: 'tool', from: agent.id }]");
  }
  for (const tool of [profileTool, scrapingMatchTool, submissionsPrefillTool]) {
    if (!tool.control?.some((c) => c.classType === "tool" && c.from === agent.id)) {
      throw new Error(
        `${(tool.config as { tool_name?: string }).tool_name} pipeline_as_tool must declare control: [{ classType: 'tool', from: agent.id }]`,
      );
    }
  }
  if (
    submissionsSubmitTool &&
    !submissionsSubmitTool.control?.some((c) => c.classType === "tool" && c.from === agent.id)
  ) {
    throw new Error(
      "submissions_pipeline_submit pipeline_as_tool must declare control: [{ classType: 'tool', from: agent.id }]",
    );
  }
  const responseSinkLane = response.provider === "response_answers" ? "answers" : "text";
  if (!response.input?.some((i) => i.lane === responseSinkLane && i.from === agent.id)) {
    throw new Error(`${response.provider} must receive ${responseSinkLane} from the agent`);
  }

  // Match wrapper schema must lock mode='match'.
  const scrapingSchema = (scrapingMatchTool.config as { input_schema?: Record<string, unknown> })
    .input_schema as
    | { properties?: { mode?: { const?: string } }; additionalProperties?: boolean }
    | undefined;
  if (scrapingSchema?.properties?.mode?.const !== "match") {
    throw new Error(
      "scraping_pipeline_match input_schema.properties.mode.const must be 'match' (lock the mode at the schema level)",
    );
  }
  if (scrapingSchema.additionalProperties !== false) {
    throw new Error(
      "scraping_pipeline_match input_schema.additionalProperties must be false (prevent mode override via extra fields)",
    );
  }

  // Prefill wrapper schema must lock action='prefill_only'.
  const prefillSchema = (
    submissionsPrefillTool.config as { input_schema?: Record<string, unknown> }
  ).input_schema as
    | { properties?: { action?: { const?: string } }; additionalProperties?: boolean }
    | undefined;
  if (prefillSchema?.properties?.action?.const !== "prefill_only") {
    throw new Error(
      "submissions_pipeline_prefill input_schema.properties.action.const must be 'prefill_only'",
    );
  }
  if (prefillSchema.additionalProperties !== false) {
    throw new Error("submissions_pipeline_prefill input_schema.additionalProperties must be false");
  }

  // Submit wrapper, if present, must declare a preflight rule that requires
  // the user_confirmation_phrase to match the current-turn user message.
  if (submissionsSubmitTool) {
    const submitConfig = submissionsSubmitTool.config as {
      input_schema?: { required?: string[]; properties?: { action?: { const?: string } } };
      preflight?: { rule?: string; field?: string };
    };
    if (submitConfig.input_schema?.properties?.action?.const !== "submit") {
      throw new Error(
        "submissions_pipeline_submit input_schema.properties.action.const must be 'submit'",
      );
    }
    if (!submitConfig.input_schema.required?.includes("user_confirmation_phrase")) {
      throw new Error(
        "submissions_pipeline_submit input_schema must require 'user_confirmation_phrase' to enforce in-turn confirmation",
      );
    }
    if (submitConfig.preflight?.rule !== "require_in_turn_phrase") {
      throw new Error(
        "submissions_pipeline_submit must declare preflight.rule='require_in_turn_phrase'",
      );
    }
  }

  // Env variable references present in the config are surfaced so the user
  // knows what the .env needs.
  const body = JSON.stringify(config);
  const vars = new Set<string>();
  for (const match of body.matchAll(/\$\{([A-Z0-9_]+)\}/g)) {
    vars.add(match[1]!);
  }

  process.stdout.write("chat pipeline check: OK\n");
  process.stdout.write(`  project_id: ${config.project_id}\n`);
  process.stdout.write(`  components: ${components.length}\n`);
  process.stdout.write(`  source: ${source.provider}\n`);
  process.stdout.write(`  response sink: ${response.provider}\n`);
  if (vars.size) {
    process.stdout.write(`  required env vars: ${[...vars].sort().join(", ")}\n`);
  }
}

main();
