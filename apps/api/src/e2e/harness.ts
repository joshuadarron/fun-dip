import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { signBody } from "@fundip/rocketride-client";
import {
  CALLBACK_PATHS,
  CALLBACK_SIGNATURE_HEADER,
  type Profile,
  type Program,
  type ScrapingPipelineInput,
  type ScrapingPipelineOutput,
  type SubmissionsPipelineInput,
  type SubmissionsPipelineOutput,
} from "@fundip/shared-types";
import type { PipelineInvoker } from "@fundip/rocketride-client";
import type { Express } from "express";
import { createApp } from "../app.js";
import type { Config } from "../config/index.js";
import { createFakeGhostClient } from "../ghost/fake.js";
import type { GhostClient } from "../ghost/client.js";
import type { EmailClient, EmailMessage } from "../email/client.js";
import type { GoogleTokenVerifier } from "../routes/oauth.js";
import type { UserEmailResolver } from "../callbacks/handlers.js";
import {
  computePrefill,
  type FormFieldSpec,
} from "../../../../pipelines/submissions/src/state-machine.js";

// ---------------------------------------------------------------------------
// Config stub. Avoids dragging in real env vars for the in-process e2e.
// ---------------------------------------------------------------------------

export function makeTestConfig(overrides: Partial<Config> = {}): Config {
  return {
    NODE_ENV: "test",
    PORT: 0,
    APP_BASE_URL: "http://localhost",
    GHOST_MCP_URL: "http://ghost.test",
    GHOST_MCP_TOKEN: "tkn",
    ROCKETRIDE_API_URL: "http://rr.test",
    ROCKETRIDE_API_KEY: "k",
    CALLBACK_SHARED_SECRET: "c".repeat(40),
    DEEP_LINK_SIGNING_KEY: "d".repeat(40),
    RESEND_API_KEY: "resend",
    GOOGLE_OAUTH_CLIENT_ID: "gid",
    GOOGLE_OAUTH_CLIENT_SECRET: "gsecret",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Recording email client. Keeps sent messages in memory for assertions.
// ---------------------------------------------------------------------------

export interface RecordingEmailClient extends EmailClient {
  readonly sent: EmailMessage[];
  clear(): void;
}

export function createRecordingEmailClient(): RecordingEmailClient {
  const sent: EmailMessage[] = [];
  return {
    sent,
    clear() {
      sent.length = 0;
    },
    async send(message) {
      sent.push(message);
      return { id: `rec-${sent.length}` };
    },
  };
}

// ---------------------------------------------------------------------------
// Stub Google verifier. Always returns the caller-supplied identity.
// ---------------------------------------------------------------------------

export function makeStubGoogleVerifier(identity: {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
}): GoogleTokenVerifier {
  return {
    async verifyCode() {
      return {
        sub: identity.sub,
        email: identity.email,
        email_verified: identity.email_verified ?? true,
        name: identity.name ?? "Test User",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Stub pipeline invoker. Emulates scraping + submissions pipelines against
// a shared GhostClient and posts HMAC-signed callbacks back to the app so
// the real callback receiver + email composer execute. Chat/profile are
// out of scope for the weekly flow; they throw if exercised.
// ---------------------------------------------------------------------------

export interface StubInvokerOptions {
  ghost: GhostClient;
  /** Full URL of the live app, including protocol + port. */
  appBaseUrl: string;
  callbackSecret: string;
  /** List of programs to write into Ghost on full_scrape. */
  programsSeed: ReadonlyArray<Omit<Program, "id">>;
  /** Form schemas keyed by program_id (populated at match time). */
  formSchemas?: Map<string, FormFieldSpec[]>;
  /** Canned Tinyfish submit result. Default: ok, confirmation_ref set. */
  tinyfishResult?: { ok: boolean; confirmation_ref: string | null };
}

async function postCallback(
  appBaseUrl: string,
  path: string,
  body: unknown,
  secret: string,
): Promise<void> {
  const raw = JSON.stringify(body);
  const res = await fetch(`${appBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [CALLBACK_SIGNATURE_HEADER]: signBody(raw, secret),
    },
    body: raw,
  });
  if (!res.ok) {
    throw new Error(`callback ${path} failed: ${String(res.status)} ${await res.text()}`);
  }
}

export function createStubInvoker(opts: StubInvokerOptions): PipelineInvoker {
  const { ghost, appBaseUrl, callbackSecret, programsSeed } = opts;
  const tinyfishResult = opts.tinyfishResult ?? { ok: true, confirmation_ref: "CONF-123" };

  async function runScraping(input: ScrapingPipelineInput): Promise<ScrapingPipelineOutput> {
    if (input.mode === "full_scrape") {
      let added = 0;
      let updated = 0;
      for (const row of programsSeed) {
        const existing = await ghost.list("programs", {
          filter: { source_url: row.source_url },
          limit: 1,
        });
        if (existing[0]) {
          await ghost.update("programs", existing[0].id, row);
          updated += 1;
        } else {
          await ghost.insert("programs", row);
          added += 1;
        }
      }
      return {
        status: "ok",
        mode: "full_scrape",
        programs_added: added,
        programs_updated: updated,
        pages_scraped: programsSeed.length,
      };
    }

    // match mode
    const profile = await ghost.get("profiles", input.profile_id);
    if (!profile) throw new Error(`profile ${input.profile_id} not found`);
    const programs = await ghost.list("programs");

    const matches: ScrapingPipelineOutput = {
      status: "ok",
      mode: "match",
      profile_id: input.profile_id,
      matches: [],
    };

    let maxTier: "hot" | "warm" | "cold" = "cold";
    for (const program of programs) {
      // Deterministic score for e2e: stage match + geo match.
      const stageHit =
        program.stage_fit.length === 0 || program.stage_fit.includes(profile.stage ?? "idea");
      const geoHit =
        program.geo_scope.length === 0 ||
        (profile.location != null && program.geo_scope.includes(profile.location));
      const score = (stageHit ? 50 : 0) + (geoHit ? 40 : 0);
      const tier: "hot" | "warm" | "cold" = score >= 75 ? "hot" : score >= 40 ? "warm" : "cold";
      if (tier === "hot") maxTier = "hot";
      else if (tier === "warm" && maxTier === "cold") maxTier = "warm";

      const existing = await ghost.list("program_matches", {
        filter: { profile_id: input.profile_id, program_id: program.id },
        limit: 1,
      });
      const row = {
        profile_id: input.profile_id,
        program_id: program.id,
        score,
        tier,
        positioning_summary:
          `Stage alignment ${stageHit ? "yes" : "no"}, geo alignment ${geoHit ? "yes" : "no"}. ` +
          `Program ${program.name} fits ${profile.startup_name}.`,
        status: "new" as const,
        rationale: `score=${String(score)}; stage=${String(stageHit)}; geo=${String(geoHit)}`,
        matched_at: new Date().toISOString(),
      };
      const saved = existing[0]
        ? await ghost.update("program_matches", existing[0].id, row)
        : await ghost.insert("program_matches", row);
      matches.matches.push({
        program_match_id: saved.id,
        program_id: program.id,
        score,
        tier,
        positioning_summary: row.positioning_summary,
      });
    }

    if (input.emit_callback !== false) {
      await postCallback(
        appBaseUrl,
        CALLBACK_PATHS.matches_ready,
        { profile_id: input.profile_id, match_count: matches.matches.length, max_tier: maxTier },
        callbackSecret,
      );
    }

    return matches;
  }

  async function runSubmissions(
    input: SubmissionsPipelineInput,
  ): Promise<SubmissionsPipelineOutput> {
    // Minimal state machine mirroring pipelines/submissions/src/state-machine.ts
    // but co-located so the e2e test does not depend on that package's
    // internal load/persist plumbing.
    const profile = await ghost.get("profiles", input.profile_id);
    const program = await ghost.get("programs", input.program_id);
    if (!profile || !program) throw new Error("profile/program not seeded");

    const form =
      opts.formSchemas?.get(input.program_id) ??
      ([
        {
          field_name: "startup_name",
          description: "Your startup",
          type: "string",
          required: true,
          profile_key: "startup_name",
        },
        {
          field_name: "location",
          description: "Where you are",
          type: "string",
          required: true,
          profile_key: "location",
        },
      ] as FormFieldSpec[]);

    const submission = input.submission_id
      ? await ghost.get("submissions", input.submission_id)
      : null;

    if (submission && submission.status === "submitted") {
      return {
        status: "submitted",
        submission_id: submission.id,
        confirmation_ref: submission.confirmation_ref,
      };
    }

    const provided: Record<string, unknown> = {
      ...((submission?.provided_data as Record<string, unknown> | undefined) ?? {}),
      ...(input.provided_data ?? {}),
    };
    const { prefilled, missing } = computePrefill(form, profile, provided);
    const now = new Date().toISOString();

    const basePatch = {
      profile_id: input.profile_id,
      program_id: input.program_id,
      program_match_id: null,
      prefilled_fields: prefilled,
      missing_fields: missing,
      provided_data: provided,
      submitted_at: null,
      confirmation_ref: null,
      response_text: null,
      error: null,
    };

    if (input.action === "submit" && missing.length === 0) {
      const row = submission
        ? await ghost.update("submissions", submission.id, {
            ...basePatch,
            status: "submitted",
            submitted_at: now,
            confirmation_ref: tinyfishResult.confirmation_ref,
          })
        : await ghost.insert("submissions", {
            ...basePatch,
            status: "submitted",
            submitted_at: now,
            confirmation_ref: tinyfishResult.confirmation_ref,
          });
      // Side-effect: mark the matching (profile, program) as applied.
      const matches = await ghost.list("program_matches", {
        filter: { profile_id: input.profile_id, program_id: input.program_id },
        limit: 1,
      });
      if (matches[0]) {
        await ghost.update("program_matches", matches[0].id, { status: "applied" });
      }
      await postCallback(
        appBaseUrl,
        CALLBACK_PATHS.submission_submitted,
        {
          submission_id: row.id,
          profile_id: input.profile_id,
          program_id: input.program_id,
          confirmation_ref: row.confirmation_ref,
        },
        callbackSecret,
      );
      return {
        status: "submitted",
        submission_id: row.id,
        confirmation_ref: row.confirmation_ref,
      };
    }

    const status = missing.length === 0 ? "prefilled" : "awaiting_user_input";
    const row = submission
      ? await ghost.update("submissions", submission.id, { ...basePatch, status })
      : await ghost.insert("submissions", { ...basePatch, status });

    if (status === "awaiting_user_input") {
      await postCallback(
        appBaseUrl,
        CALLBACK_PATHS.submission_needs_input,
        {
          submission_id: row.id,
          profile_id: input.profile_id,
          program_id: input.program_id,
          missing_fields: missing,
        },
        callbackSecret,
      );
      return { status: "needs_input", submission_id: row.id, missing_fields: missing };
    }

    return { status: "prefilled", submission_id: row.id, prefilled_fields: prefilled };
  }

  return {
    async runChatPipeline() {
      throw new Error("chat pipeline not exercised in e2e harness");
    },
    async runProfilePipeline() {
      throw new Error("profile pipeline not exercised in e2e harness");
    },
    runScrapingPipeline: runScraping,
    runSubmissionsPipeline: runSubmissions,
  };
}

// ---------------------------------------------------------------------------
// Harness boot: starts a listening HTTP server and returns its URL so the
// stub invoker can fire real callbacks. Caller owns shutdown.
// ---------------------------------------------------------------------------

export interface Harness {
  app: Express;
  server: Server;
  baseUrl: string;
  ghost: GhostClient;
  email: RecordingEmailClient;
  config: Config;
  userEmail: UserEmailResolver;
  invoker?: PipelineInvoker;
  stop(): Promise<void>;
}

export async function bootHarness(options?: {
  userEmail?: string;
  googleIdentity?: { sub: string; email: string; name?: string };
  /**
   * Optional factory called once we know the base URL. Lets tests
   * build a stub invoker that posts callbacks back to this server.
   */
  buildInvoker?: (ctx: { baseUrl: string; ghost: GhostClient }) => PipelineInvoker;
}): Promise<Harness> {
  const ghost = createFakeGhostClient();
  const email = createRecordingEmailClient();
  const identity = options?.googleIdentity ?? {
    sub: "google-123",
    email: options?.userEmail ?? "founder@acme.test",
    name: "Founder",
  };

  // Placeholder base URL until we know the port. Config is mutated in place
  // after the server binds.
  const config = makeTestConfig();

  const userEmail: UserEmailResolver = {
    async resolveUserEmail() {
      return identity.email;
    },
  };

  // Bind + listen first so we know the port, then build the real app with
  // a base-url-aware invoker.
  const earlyServer = createServer();
  await new Promise<void>((resolve) => earlyServer.listen(0, "127.0.0.1", resolve));
  const earlyAddr = earlyServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${String(earlyAddr.port)}`;
  await new Promise<void>((resolve) => earlyServer.close(() => resolve()));
  config.APP_BASE_URL = baseUrl;

  const invoker = options?.buildInvoker?.({ baseUrl, ghost });

  const app = createApp({
    config,
    ghost,
    email,
    userEmail,
    googleVerifier: makeStubGoogleVerifier(identity),
    ...(invoker ? { invoker } : {}),
  });

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(earlyAddr.port, "127.0.0.1", resolve));

  return {
    app,
    server,
    baseUrl,
    ghost,
    email,
    config,
    userEmail,
    ...(invoker ? { invoker } : {}),
    async stop() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

// Re-export useful seed factories for tests.
export function makeProfile(overrides: Partial<Omit<Profile, "id">> = {}): Omit<Profile, "id"> {
  const now = new Date().toISOString();
  return {
    user_id: "user-1",
    startup_name: "Acme",
    stage: "seed",
    location: "Chicago",
    market: "fintech",
    goals: ["raise_seed"],
    looking_for: ["investors"],
    narrative: "Acme builds developer tooling for banks.",
    updated_at: now,
    created_at: now,
    ...overrides,
  };
}

export function makeProgram(overrides: Partial<Omit<Program, "id">> = {}): Omit<Program, "id"> {
  const now = new Date().toISOString();
  return {
    source_url: "https://example.com/program",
    name: "Example Program",
    provider: "Example Foundation",
    description: "Funding for fintech startups.",
    requirements: "Seed stage, US-based.",
    apply_method: "form",
    apply_url: "https://example.com/apply",
    deadline: null,
    stage_fit: ["seed"],
    market_fit: ["fintech"],
    geo_scope: ["Chicago"],
    last_scraped_at: now,
    first_seen_at: now,
    ...overrides,
  };
}
