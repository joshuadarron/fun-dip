import express, { type Express } from "express";
import type { Config } from "./config/index.js";
import { createCallbackRouter, type CallbackHandlers } from "./callbacks/routes.js";
import { createNoopEmailClient, type EmailClient } from "./email/client.js";

export interface AppDependencies {
  config: Config;
  handlers?: Partial<CallbackHandlers>;
  email?: EmailClient;
}

export function createApp(deps: AppDependencies): Express {
  const { config } = deps;
  const email = deps.email ?? createNoopEmailClient();

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

  return app;
}
