import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Lightweight "does the pipeline file load and look sane" check for the
 * scraping pipeline. Does NOT run the pipeline (that requires RocketRide
 * credentials, a live Ghost MCP server, and a configured Tinyfish
 * account). Run with: `pnpm --filter @fundip/pipeline-scraping check`.
 *
 * The scraping pipeline has two mode subgraphs (full_scrape and match).
 * This check asserts both are present and wired to the webhook source,
 * the shared LLM and MCP client, their mode-specific tools (Tinyfish for
 * full_scrape only, HTTP request for match), and a single shared
 * response_answers sink per the RocketRide multi-agent fan-out pattern.
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

function controlsAgent(node: Component, agentId: string, classType: string): boolean {
  return Boolean(node.control?.some((c) => c.classType === classType && c.from === agentId));
}

function main(): void {
  const config = loadPipeline();
  const components = config.components;

  const ids = new Set<string>();
  for (const c of components) {
    if (ids.has(c.id)) throw new Error(`duplicate component id: ${c.id}`);
    ids.add(c.id);
  }

  const webhook = assertComponent(
    components,
    (c) => c.provider === "webhook",
    "webhook source node",
  );

  // Two mode subgraphs: full_scrape and match. Each has its own
  // agent_deepagent node that reads from the webhook's questions lane.
  const agents = components.filter((c) => c.provider === "agent_deepagent");
  if (agents.length !== 2) {
    throw new Error(
      `pipeline.pipe: expected 2 agent_deepagent nodes (full_scrape + match), found ${agents.length}`,
    );
  }
  const fullScrapeAgent = assertComponent(
    components,
    (c) => c.provider === "agent_deepagent" && c.id.includes("full_scrape"),
    "full_scrape agent_deepagent node (id must contain 'full_scrape')",
  );
  const matchAgent = assertComponent(
    components,
    (c) => c.provider === "agent_deepagent" && c.id.includes("match"),
    "match agent_deepagent node (id must contain 'match')",
  );

  for (const agent of [fullScrapeAgent, matchAgent]) {
    if (!agent.input?.some((i) => i.lane === "questions" && i.from === webhook.id)) {
      throw new Error(`${agent.id} must accept questions from the webhook source`);
    }
  }

  const llm = assertComponent(
    components,
    (c) => c.provider === "llm_openai" || c.provider === "llm_anthropic",
    "llm node shared by both agents",
  );
  if (!controlsAgent(llm, fullScrapeAgent.id, "llm")) {
    throw new Error("llm must declare control for the full_scrape agent");
  }
  if (!controlsAgent(llm, matchAgent.id, "llm")) {
    throw new Error("llm must declare control for the match agent");
  }

  const mcp = assertComponent(
    components,
    (c) => c.provider === "mcp_client",
    "mcp_client node for Ghost",
  );
  if (!controlsAgent(mcp, fullScrapeAgent.id, "tool")) {
    throw new Error("mcp_client must be a tool of the full_scrape agent");
  }
  if (!controlsAgent(mcp, matchAgent.id, "tool")) {
    throw new Error("mcp_client must be a tool of the match agent");
  }

  // Tinyfish is loaded only in the full_scrape subgraph.
  const tinyfish = assertComponent(
    components,
    (c) => c.provider === "tool_tinyfish",
    "tool_tinyfish node (full_scrape subgraph only)",
  );
  if (!controlsAgent(tinyfish, fullScrapeAgent.id, "tool")) {
    throw new Error("tool_tinyfish must be controlled by the full_scrape agent");
  }
  if (controlsAgent(tinyfish, matchAgent.id, "tool")) {
    throw new Error(
      "tool_tinyfish must NOT be wired to the match agent (match path has no web browsing)",
    );
  }

  // HTTP request tool used by the match agent to fire the matches_ready callback.
  const http = assertComponent(
    components,
    (c) => c.provider === "tool_http_request",
    "tool_http_request node for the matches_ready callback",
  );
  if (!controlsAgent(http, matchAgent.id, "tool")) {
    throw new Error("tool_http_request must be controlled by the match agent");
  }

  // Single response_answers sink with two inputs, matching the
  // multi-agent fan-out pattern from ROCKETRIDE_PIPELINE_RULES.md.
  const response = assertComponent(
    components,
    (c) => c.provider === "response_answers",
    "response_answers sink",
  );
  const fromFullScrape = response.input?.some(
    (i) => i.lane === "answers" && i.from === fullScrapeAgent.id,
  );
  const fromMatch = response.input?.some((i) => i.lane === "answers" && i.from === matchAgent.id);
  if (!fromFullScrape || !fromMatch) {
    throw new Error(
      "response_answers must receive answers from BOTH the full_scrape and match agents",
    );
  }

  const body = JSON.stringify(config);
  const vars = new Set<string>();
  for (const match of body.matchAll(/\$\{(ROCKETRIDE_[A-Z0-9_]+)\}/g)) {
    vars.add(match[1]!);
  }

  process.stdout.write("scraping pipeline check: OK\n");
  process.stdout.write(`  project_id: ${config.project_id}\n`);
  process.stdout.write(`  components: ${components.length}\n`);
  process.stdout.write(
    `  subgraphs: full_scrape (${fullScrapeAgent.id}), match (${matchAgent.id})\n`,
  );
  if (vars.size) {
    process.stdout.write(`  required env vars: ${[...vars].sort().join(", ")}\n`);
  }
}

main();
