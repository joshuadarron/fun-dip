import express, { type Express } from "express";
import type { PipelineInvoker } from "@fundip/rocketride-client";
import type { Config } from "./config/index.js";
import {
  buildDeepLinkSigner,
  createCallbackHandlers,
  type UserEmailResolver,
} from "./callbacks/handlers.js";
import { createCallbackRouter, type CallbackHandlers } from "./callbacks/routes.js";
import { createNoopEmailClient, type EmailClient } from "./email/client.js";
import { createResendEmailClient } from "./email/resend.js";
import type { GhostClient } from "./ghost/client.js";
import { createFakeGhostClient } from "./ghost/fake.js";
import { createRepositories } from "./ghost/repos.js";
import { createGraphQLRouter } from "./graphql/server.js";
import { requireAuth } from "./routes/auth.js";
import { createChatRouter } from "./routes/chat.js";
import { createConfirmRouter } from "./routes/confirm.js";
import { createDevSeedRouter } from "./routes/dev-seed.js";
import { createOAuthRouter, type GoogleTokenVerifier } from "./routes/oauth.js";
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
  /**
   * Resolver for `user_id -> email`. The shared types do not put email
   * on the Profile, and Phase 8 does not yet ship a real user store;
   * the OAuth flow will be the source of truth in production. Tests
   * inject a stub.
   */
  userEmail?: UserEmailResolver;
  /**
   * Stub Google ID-token verifier for tests. Production wiring builds
   * the real one in `index.ts` from `google-auth-library`.
   */
  googleVerifier?: GoogleTokenVerifier;
}

/**
 * Default user-email resolver: returns `null`, which causes the
 * callback handlers to skip sending. Production wiring overrides this
 * with a resolver backed by the OAuth-issued user store.
 */
const noopUserEmail: UserEmailResolver = {
  async resolveUserEmail() {
    return null;
  },
};

export function createApp(deps: AppDependencies): Express {
  const { config } = deps;
  const isTest = config.NODE_ENV === "test";

  // Pick email client: real Resend in non-test environments, no-op in
  // tests (or when explicitly injected by tests). Tests can also pass
  // a stub `EmailClient` directly via `deps.email`.
  const email =
    deps.email ??
    (isTest
      ? createNoopEmailClient()
      : createResendEmailClient({
          apiKey: config.RESEND_API_KEY,
          from: "Fundip <noreply@fundip.app>",
        }));

  const ghost = deps.ghost ?? createFakeGhostClient();
  const repos = createRepositories(ghost);
  const userEmail = deps.userEmail ?? noopUserEmail;

  const baseHandlers = createCallbackHandlers({
    repos,
    email,
    signer: buildDeepLinkSigner(config.DEEP_LINK_SIGNING_KEY),
    appBaseUrl: config.APP_BASE_URL,
    userEmail,
  });

  const handlers: CallbackHandlers = {
    ...baseHandlers,
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

  // JSON + url-encoded body parsers for non-callback routes. Must come
  // AFTER the callback router so its raw-body parser is not superseded.
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use(createGraphQLRouter({ repos }));

  // --- dev seed ---
  // Only available in development. Writes sample programs + a profile
  // + matches directly to Ghost so the UI has data without needing a
  // live RocketRide + Tinyfish stack. Idempotent. GET /dev/seed.
  if (config.NODE_ENV === "development") {
    app.use(createDevSeedRouter({ ghost }));
  }
  // --- /dev seed ---

  // --- oauth ---
  // OAuth routes are mounted whenever a verifier is available: tests
  // inject a stub, production wires the real google-auth-library
  // verifier in `index.ts`. When no verifier is provided (e.g. the
  // bare `createApp({ config })` call used by some unit tests),
  // OAuth routes are simply absent.
  if (deps.googleVerifier) {
    app.use(
      createOAuthRouter({
        clientId: config.GOOGLE_OAUTH_CLIENT_ID,
        redirectUri: `${config.APP_BASE_URL.replace(/\/+$/, "")}/auth/google/callback`,
        appBaseUrl: config.APP_BASE_URL,
        sessionSigningKey: config.DEEP_LINK_SIGNING_KEY,
        verifier: deps.googleVerifier,
        secureCookies: !isTest,
      }),
    );
  }
  // --- /oauth ---

  // --- confirm ---
  // Email deep-link confirmation page. Both the GET (token-only) and
  // POST (token + session) paths are mounted here. The POST handler
  // uses `requireAuth` internally; see `confirm.ts`.
  app.use(
    createConfirmRouter({
      signingKey: config.DEEP_LINK_SIGNING_KEY,
      sessionSigningKey: config.DEEP_LINK_SIGNING_KEY,
      ...(deps.invoker ? { invoker: deps.invoker } : {}),
    }),
  );
  // --- /confirm ---

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
    // `POST /api/submissions/:id/submit` requires both a signed deep
    // link AND an authenticated session per ARCHITECTURE rule 13. The
    // deep-link check happens at `/confirm` (the email button); the
    // session check is enforced here as a route-scoped middleware so
    // the route shape stays unchanged. Other submissions routes
    // (prefill, resume) are open in Phase 8 because they are called
    // from already-authenticated UI surfaces.
    app.use(
      "/api/submissions/:id/submit",
      requireAuth({ signingKey: config.DEEP_LINK_SIGNING_KEY }),
    );
    app.use(createSubmissionsRouter({ invoker: deps.invoker }));
    // --- /submissions ---

    // --- chat ---
    // Phase 7. Single user-facing chat endpoint (POST /api/chat). The
    // chat pipeline owns the chat-side safety rails (match-only scraping,
    // no silent submit) inside its `pipeline.pipe`, so this route stays a
    // thin invoker wrapper, identical in shape to the others.
    app.use(createChatRouter({ invoker: deps.invoker }));
    // --- /chat ---
  }

  // --- cron wiring ---
  // Cron does NOT start in createApp. The process entrypoint
  // (`src/index.ts`) imports `startCron` from `./cron/index.ts` and
  // calls it only when `NODE_ENV !== "test"`. createApp stays pure
  // and synchronous so tests can boot it freely.
  // --- /cron wiring ---

  return app;
}
