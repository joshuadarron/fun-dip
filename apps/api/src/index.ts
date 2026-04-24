import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { loadConfig } from "./config/index.js";

// Load .env from the repo root before anything else reads process.env.
// Monorepo layout: apps/api/{src,dist}/index.{ts,js} -> ../../../.env
const here = fileURLToPath(import.meta.url);
loadDotenv({ path: resolve(here, "../../../../.env") });
import { startCron } from "./cron/index.js";
import { createResendEmailClient } from "./email/resend.js";
import { createFakeGhostClient } from "./ghost/fake.js";
import { createRepositories } from "./ghost/repos.js";
import { createRealGoogleVerifier } from "./routes/oauth-google.js";

const config = loadConfig();

// Production wires real services. createApp re-creates the email
// client and repos itself when needed; we build them here too so the
// cron loop can share the same instances.
const email = createResendEmailClient({
  apiKey: config.RESEND_API_KEY,
  from: "Fundip <noreply@fundip.app>",
});
const ghost = createFakeGhostClient(); // TODO(phase9): swap for real MCP client.
const repos = createRepositories(ghost);

const app = createApp({
  config,
  email,
  ghost,
  googleVerifier: createRealGoogleVerifier({
    clientId: config.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: `${config.APP_BASE_URL.replace(/\/+$/, "")}/auth/google/callback`,
  }),
});

// Cron only starts outside tests. The Sunday weekly job is documented
// in `./cron/index.ts`.
const cron =
  config.NODE_ENV === "test"
    ? { stop: () => undefined }
    : startCron({
        // PipelineInvoker plumbing arrives once Phase 9 wires the SDK
        // boot here; Phase 8 leaves the invoker out of cron until then.
        invoker: {
          async runChatPipeline() {
            throw new Error("invoker not wired in Phase 8 entrypoint");
          },
          async runProfilePipeline() {
            throw new Error("invoker not wired in Phase 8 entrypoint");
          },
          async runScrapingPipeline() {
            throw new Error("invoker not wired in Phase 8 entrypoint");
          },
          async runSubmissionsPipeline() {
            throw new Error("invoker not wired in Phase 8 entrypoint");
          },
        },
        repos,
        email,
        config,
      });

const server = app.listen(config.PORT, () => {
  console.log(`fundip api listening on :${String(config.PORT)}`);
});

function shutdown() {
  cron.stop();
  server.close();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
