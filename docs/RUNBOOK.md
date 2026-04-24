# Fundip runbook

End-to-end notes for bringing the system up and verifying it works. Start here after `pnpm install` on a fresh clone.

## Prerequisites

- Node 20+, pnpm 10+.
- For the real stack (not tests): a running RocketRide cluster, a Ghost MCP server, a Tinyfish node, Resend, and Google OAuth credentials.

## Environment

Copy `.env.example` to `.env` in the repo root and fill every key:

- `GHOST_MCP_URL`, `GHOST_MCP_TOKEN` — Ghost MCP connection.
- `ROCKETRIDE_API_URL`, `ROCKETRIDE_API_KEY` — RocketRide SDK connection.
- `CALLBACK_SHARED_SECRET` — HMAC secret shared with pipelines for runtime-to-app callbacks (at least 32 chars).
- `DEEP_LINK_SIGNING_KEY` — HMAC key for signed deep-link tokens and session cookies (at least 32 chars).
- `RESEND_API_KEY` — transactional email.
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` — OAuth creds.
- `APP_BASE_URL` — absolute URL used to build deep links and OAuth redirects.

Pipelines also need their own env vars when actually executed in the RocketRide runtime. Each `.pipe` file documents them; typical keys include `ROCKETRIDE_OPENAI_KEY`, `ROCKETRIDE_TINYFISH_KEY`, and duplicates of the Ghost MCP + callback keys so RocketRide can substitute them at invocation time.

## Local gates

```
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm format:check
pnpm --filter @fundip/api build
pnpm --filter @fundip/web build
```

These run end-to-end on the in-process harness with stubs for RocketRide, Ghost, Tinyfish, and Google. No external services required.

## E2E harness (`apps/api/src/e2e/`)

`fullCycle.test.ts` exercises the full Sunday-to-submission flow in a single process:

1. Boot the real Express app with the real callback router, deep-link routes, OAuth routes, confirm routes, and GraphQL resolvers. Inject a fake Ghost client, a recording email client, a stub Google verifier, and a stub pipeline invoker that writes to the same Ghost and fires real HMAC-signed callbacks to its own running server.
2. Seed a profile. Call `runWeeklyJob` directly.
3. The stub scraping invoker writes programs, computes deterministic matches (stage + geo alignment), and POSTs `matches_ready` to `/internal/callbacks/matches-ready`.
4. The callback handler composes a digest email via the real digest template and delivers through the recording email client. Asserted.
5. A supertest agent logs in via `/auth/google/callback` (stub verifier) to get a session cookie.
6. The test signs a deep-link token directly (short-circuiting the email click) and POSTs to `/confirm/submit`.
7. `requireAuth` validates the session, the confirm handler re-verifies the token, and the stub submissions invoker transitions the row to `submitted`, fires `submission_submitted`, and flips the matching `program_matches.status` to `applied`. Asserted.

The three e2e assertions land what Phase 9 is meant to prove without needing live services. Swapping the stubs for real ones (see below) makes this a live smoke test.

## Going live

To exercise the full real stack:

1. Replace `createFakeGhostClient()` in `apps/api/src/index.ts` with `createGhostMcpClient({ url: config.GHOST_MCP_URL, token: config.GHOST_MCP_TOKEN })`. The tool names on that client default to `list_records`, `get_record`, `insert_record`, `update_record`, `upsert_record`, `delete_record` and live in `GHOST_MCP_TOOLS` (`apps/api/src/ghost/mcp.ts`). Align those to the real Ghost MCP server's tool names.
2. Build a real `PipelineInvoker` from `createPipelineInvoker` in `@fundip/rocketride-client`, passing in the `RocketRideClient` from the `rocketride` npm package and the `.pipe` file paths. Replace the throw-stub invoker currently in `apps/api/src/index.ts`.
3. Populate pipeline env vars so `.pipe` files can substitute them. Each pipeline file lists the variables it reads.
4. Verify the RocketRide node providers used in the `.pipe` files match the real catalog. Current assumption: `agent_deepagent`, `llm_openai`, `mcp_client`, `tool_tinyfish`, `tool_http_request`, `response_answers`. If `AGENTS.md` really wants `deep_agent_langchain`, swap the node provider id.
5. Implement a real `UserEmailResolver` that looks up the user created by the OAuth callback. The current default returns `null`, which causes callback handlers to skip sending.
6. On Windows, be aware of char encoding when running Python RocketRide pipelines.

## Smoke test script

Once the real stack is up, fire the weekly job manually from a Node REPL in `apps/api`:

```
import { loadConfig } from "./dist/config/index.js";
import { createRepositories } from "./dist/ghost/repos.js";
import { createGhostMcpClient } from "./dist/ghost/mcp.js";
import { runWeeklyJob } from "./dist/cron/index.js";
// ... build the real invoker per "Going live" step 2
await runWeeklyJob({ invoker, repos });
```

Then click the deep link in the digest email, complete Google login, confirm, and verify `submissions.status = submitted` + `program_matches.status = applied` in Ghost. That is the full Sunday-to-submission loop.
