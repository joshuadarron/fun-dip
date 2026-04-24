import express, { type Express } from "express";
import type { PipelineInvoker } from "@fundip/rocketride-client";
import type { Config } from "./config/index.js";
import { createCallbackRouter, type CallbackHandlers } from "./callbacks/routes.js";
import { createNoopEmailClient, type EmailClient } from "./email/client.js";
import type { GhostClient } from "./ghost/client.js";
import { createFakeGhostClient } from "./ghost/fake.js";
import { createRepositories } from "./ghost/repos.js";
import { createGraphQLRouter } from "./graphql/server.js";
import { createProfileRouter } from "./routes/profile.js";
import { createScrapingRouter } from "./routes/scraping.js";
import { createSubmissionsRouter } from "./routes/submissions.js";

export interface AppDependencies {
  config: Config;
  handlers?: Partial<CallbackHandlers>;
  email?: EmailClient;
  /**
   * Injected Ghost client. If omitted, an in-memory fake is used; this
   * keeps `createApp()` useful in tests without booting an MCP server.
   * Production wiring uses `createGhostMcpClient` from `./ghost/mcp.ts`.
   */
  ghost?: GhostClient;
  /**
   * Injected pipeline invoker. Optional: routes that need it are only
   * mounted when provided, so tests that do not exercise pipeline
   * invocation do not have to stub one out.
   */
  invoker?: PipelineInvoker;
}

export function createApp(deps: AppDependencies): Express {
  const { config } = deps;
  const email = deps.email ?? createNoopEmailClient();
  const ghost = deps.ghost ?? createFakeGhostClient();
  const repos = createRepositories(ghost);

  const handlers: CallbackHandlers = {
    async onMatchesReady(payload) {
      console.log("matches_ready", payload);
      // Phase 8: compose digest email per profile, send via email client.
      void email;
    },
    async onSubmissionNeedsInput(payload) {
      console.log("submission_needs_input", payload);
      // Phase 8: compose missing-info email with signed deep link.
    },
    async onSubmissionSubmitted(payload) {
      console.log("submission_submitted", payload);
      // Phase 8: send confirmation email.
    },
    ...deps.handlers,
  };

  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", env: config.NODE_ENV });
  });

  app.use(
    createCallbackRouter({
      secret: config.CALLBACK_SHARED_SECRET,
      handlers,
    }),
  );

  // JSON body parser for any non-callback routes. Must come AFTER the
  // callback router so the raw-body parser there is not superseded.
  app.use(express.json({ limit: "1mb" }));

  app.use(createGraphQLRouter({ repos }));

  if (deps.invoker) {
    app.use(createProfileRouter({ invoker: deps.invoker }));

    // --- scraping ---
    // Phase 5. Scraping pipeline is invoked by: Phase 8 cron (full_scrape
    // Sundays + per-profile match pass) and, in Phase 7, by the chat
    // pipeline's tool wrapper (mode=match only, emit_callback=false). The
    // route honors whatever the caller sends; chat-side enforcement is the
    // chat pipeline's responsibility.
    app.use(createScrapingRouter({ invoker: deps.invoker }));
    // --- /scraping ---

    // --- submissions ---
    app.use(createSubmissionsRouter({ invoker: deps.invoker }));
    // --- /submissions ---
  }

  return app;
}
