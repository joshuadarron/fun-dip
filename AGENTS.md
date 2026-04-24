# AGENTS.md (root)

You are building Fundip, an agent-driven funding program discovery and submission tool. This file is the top-level orientation for any Claude session working in this monorepo. Read it fully before touching code.

## Read order

1. This file.
2. `.claude/docs/ARCHITECTURE.md`: layered view, data flow diagram, weekly cycle, submission cycle.
3. `.claude/docs/GHOST_SCHEMA.md`: collections, fields, ownership, indexes.
4. `.claude/docs/PIPELINE_CONTRACTS.md`: pipeline I/O, callbacks, invocation matrix.
5. The pipeline you are working on: `pipelines/<name>/AGENTS.md`.
6. The existing frontend scaffold (see "Frontend exists already" below).

## What you are building

Four RocketRide pipelines, the app layer around them (API routes, Wondergraph, cron, callback receiver, Resend integration, Google OAuth), and the Ghost MCP client wiring. The UI is **already scaffolded**. Your job is to plug backend into existing components, not to design screens.

## Frontend exists already

Before defining any type, schema, or API contract that crosses the frontend boundary, inspect the existing frontend code:

- Look at the Dashboard, Profile, Programs, and Submissions page components. Read what props they consume and what shapes they expect.
- Look at any existing Wondergraph queries or GraphQL type definitions the frontend uses.
- Look at the chat panel component: how it sends messages, what payload shape it expects back, how it renders tool-call results if at all.
- If the frontend defines shared TypeScript types (likely in a shared package within the monorepo), those types are the contract. Match Ghost fields to them, not the other way around.

If a frontend expectation conflicts with the logical schema in `.claude/docs/GHOST_SCHEMA.md`, flag it in the PR. Do not quietly diverge.

## Non-negotiable technology choices

| Concern | Choice |
|---|---|
| AI runtime | RocketRide, four pipelines |
| Agent node | `deep_agent_langchain` (LangChain deep agents pattern, pre-built node) |
| Web browsing and form submission | Tinyfish node (new to the runtime, two modes: `online_browse`, `application`) |
| Database | Ghost, accessed via its MCP server. MCP client sits on the agent node. No direct DB drivers in pipelines. |
| GraphQL API | Wondergraph, frontend-only consumer |
| Email | Resend, invoked from the app layer only |
| Auth | Google OAuth for users. HMAC-signed callbacks for runtime-to-app. Signed short-lived tokens for email deep links. |
| Scheduler | `croner` in the app layer, in-process, cross-platform (Windows and Linux) |

These are fixed. Do not substitute. Do not bypass. If you think one is wrong, raise it before implementing.

## What is left to you

Inside each pipeline, you choose:

- Which specific RocketRide nodes compose the graph (beyond the required `deep_agent_langchain` and, where applicable, `tinyfish`).
- Which LLM per step. Model selection is yours. Bias toward the cheapest capable model for each step.
- Prompt design, fan-out, chunking, retry strategy.
- Whether a pipeline uses the deep agent for orchestration throughout, or only for the agentic portion with deterministic nodes around it.

You are not constrained to a single pattern across the four pipelines. The chat pipeline is deeply agentic; the scraping `match` path may be nearly deterministic. Pick the right shape per pipeline.

## Architecture rules (do not violate)

1. **Pipelines do not send email.** They emit HMAC-signed HTTP callbacks to the app layer, which composes and sends via Resend.
2. **Pipelines do not schedule themselves.** Cron lives in the app layer (`croner`).
3. **Wondergraph is frontend-only.** Pipelines talk to Ghost through the MCP client, not through Wondergraph.
4. **No circular pipeline invocations.** Chat calls the other three as tools. The other three never call chat, and never call each other.
5. **Chat pipeline is the only pipeline exposed to the user surface.** Everything else is invoked by the app layer (API routes or cron) or by the chat pipeline as a tool.
6. **Chat may only invoke scraping in `mode=match`.** `mode=full_scrape` is cron-only. Enforce in the tool definition the chat pipeline exposes.
7. **Direct profile form edits bypass the profile pipeline.** They write to Ghost via Wondergraph mutations. The profile pipeline is for conversational edits only.
8. **State lives in Ghost.** Pipelines are pure invocations. Do not hold state in pipeline memory across runs.
9. **Chat history is stored in Ghost**, not in Wave memory or anywhere else. Last 20 turns plus a rolling summary. One conversation per user, single-threaded, page context tagged per message.
10. **Fact extraction is explicit.** Chat extracts facts and calls the profile pipeline to commit them. No silent profile mutations.
11. **Two-stage prefill for submissions.** At match time, generate a 3 to 5 sentence positioning summary only (stored on `program_matches`). Generate the full form payload lazily when the user initiates a submission.
12. **Submissions pipeline is idempotent and pure.** `(profile, program, provided_data)` in, one of `prefilled | needs_input | submitted | error` out. Retryable by design.
13. **Email deep links go to authenticated confirmation pages**, never directly execute submissions. Tokens in the URL are short-lived and signed; the verified token plus an authenticated session is required.

## Monorepo structure (expected)

```
fundip/
  apps/
    web/                  # existing frontend (React, Next, or similar)
    api/                  # app-layer API routes, Wondergraph server, cron, callbacks, Resend
  pipelines/
    chat/                 # RocketRide pipeline definition (JSON) + AGENTS.md
    profile/
    scraping/
    submissions/
  packages/
    shared-types/         # TS types shared between frontend and backend
    rocketride-client/    # wrapped SDK client used by the app layer
  .claude/
    docs/                 # PRD / requirements, auto-loaded for Claude sessions
      ARCHITECTURE.md
      GHOST_SCHEMA.md
      PIPELINE_CONTRACTS.md
    settings.json         # shared Claude Code config (team)
  AGENTS.md               # this file
  CLAUDE.md               # Claude Code entry point, imports AGENTS.md
```

If the existing scaffold uses different paths, adapt. The logical boundaries are what matters.

## Secrets and config

Centralized in `apps/api/config` (or the equivalent in the existing scaffold). No scattered `process.env` reads. Expected keys:

- `GHOST_MCP_URL`, `GHOST_MCP_TOKEN`: Ghost MCP connection.
- `ROCKETRIDE_API_URL`, `ROCKETRIDE_API_KEY`: SDK config for invoking pipelines.
- `CALLBACK_SHARED_SECRET`: HMAC secret for runtime-to-app callbacks.
- `DEEP_LINK_SIGNING_KEY`: signing key for email deep-link tokens.
- `RESEND_API_KEY`: Resend.
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`: Google OAuth.
- `APP_BASE_URL`: absolute URL used to construct deep links.

## Code preferences

- TypeScript for the app layer. Python inside pipelines where the runtime expects it. Keep the C++ core out of scope for this project.
- Repository pattern for data access in the app layer. Wondergraph resolvers read through repositories, not raw DB calls.
- Tests mirror source trees. Co-locate integration tests for pipelines under `pipelines/<name>/tests/`.
- No em-dashes in any written content (docs, commit messages, comments, user-facing strings). Use commas, colons, periods, or parentheses.
- Minimal-first scaffolding. Smallest working version, then extend.

## What to do first (recommended order)

1. Read the existing frontend scaffold. Note the component prop shapes and any existing Wondergraph usage.
2. Wire up Ghost MCP access from the app layer (for Wondergraph resolvers) and from a minimal RocketRide test pipeline (to verify MCP client config on the agent node).
3. Implement the profile pipeline. Smallest of the four, validates the deep_agent + MCP + Ghost write path end-to-end.
4. Implement Wondergraph schema and resolvers for profile reads and direct edits. Verifies the frontend plug-in.
5. Implement the scraping pipeline, `mode=match` first (cheaper, no Tinyfish yet). Then `mode=full_scrape` once Tinyfish is available.
6. Implement the submissions pipeline through `prefilled` and `needs_input` states. Add `submit` path last.
7. Implement the chat pipeline, plugging the other three as tools.
8. Implement cron in the app layer. Implement callback receiver and Resend integration. Implement deep-link token verification.
9. End-to-end: Sunday cron fires scrape, matches populate, digest email sends, user clicks through, submits, confirmation records.
