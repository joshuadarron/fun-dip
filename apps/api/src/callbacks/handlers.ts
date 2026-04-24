import type { ProgramMatch, UUID } from "@fundip/shared-types";
import type { Repositories } from "../ghost/repos.js";
import type { EmailClient } from "../email/client.js";
import { renderDigestEmail, type DigestMatchView } from "../email/templates/digest.js";
import { renderMissingInfoEmail } from "../email/templates/missingInfo.js";
import { renderSubmissionConfirmedEmail } from "../email/templates/submissionConfirmed.js";
import { signDeepLinkToken } from "../deep-links/tokens.js";
import type { CallbackHandlers } from "./routes.js";

/**
 * Number of top matches surfaced in the weekly digest. Architecture
 * spec calls for "10 to 30 matches per week"; we pick 20 as a sensible
 * default. Adjust later if engagement data tells us otherwise.
 */
const DIGEST_MATCH_LIMIT = 20;

/**
 * Deep-link token TTL for digest confirm buttons. 7 days is long enough
 * for a user to come back to the email later in the week, short enough
 * that a stolen link cannot resurrect once the next digest replaces it.
 */
const DIGEST_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Resolves a user_id to the email address Fundip should send to. In
 * production this will read the OAuth-backed user store; for now,
 * tests inject a stub. Kept in the app layer because `Profile` does
 * not carry an email and `@fundip/shared-types` is frozen.
 */
export interface UserEmailResolver {
  resolveUserEmail(userId: UUID): Promise<string | null>;
}

export interface CreateCallbackHandlersOptions {
  repos: Repositories;
  email: EmailClient;
  /**
   * Signer for digest deep-link tokens. The signer closes over
   * `DEEP_LINK_SIGNING_KEY`; the handler only chooses purpose + ttl.
   */
  signer: (
    payload: { purpose: "submission_confirm"; profile_id: UUID; submission_id?: UUID },
    ttlSeconds: number,
  ) => string;
  /** Absolute base URL, e.g. `https://app.fundip.app`. No trailing slash. */
  appBaseUrl: string;
  userEmail: UserEmailResolver;
}

function tierForScore(score: number): "hot" | "warm" | "cold" {
  if (score >= 75) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

function topMatches(matches: ProgramMatch[], limit: number): ProgramMatch[] {
  // Repos already orderBy score desc, but sort defensively.
  return [...matches].sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Compose the three callback handlers. Each one reads minimum required
 * state from Ghost, renders the matching template, and sends via the
 * injected email client. Handlers swallow no errors: a failed email
 * surfaces as a 5xx on the callback receiver, and the runtime retries.
 */
export function createCallbackHandlers(opts: CreateCallbackHandlersOptions): CallbackHandlers {
  const { repos, email, signer, appBaseUrl, userEmail } = opts;
  const baseUrl = appBaseUrl.replace(/\/+$/, "");

  return {
    async onMatchesReady(payload) {
      if (payload.match_count <= 0) return;
      const matchesAll = await repos.matches.listForProfile(payload.profile_id);
      if (matchesAll.length === 0) return;
      const matches = topMatches(matchesAll, DIGEST_MATCH_LIMIT);

      const profile = await repos.profiles.getById(payload.profile_id);
      if (!profile) return;
      const to = await userEmail.resolveUserEmail(profile.user_id);
      if (!to) return;

      const matchViews: DigestMatchView[] = [];
      for (const m of matches) {
        const program = await repos.programs
          .list()
          .then((rows) => rows.find((p) => p.id === m.program_id));
        if (!program) continue;
        const token = signer(
          {
            purpose: "submission_confirm",
            profile_id: payload.profile_id,
            submission_id: m.id,
          },
          DIGEST_TOKEN_TTL_SECONDS,
        );
        const confirmUrl = `${baseUrl}/confirm?token=${encodeURIComponent(token)}&submission=${encodeURIComponent(m.id)}`;
        matchViews.push({
          program_name: program.name,
          program_provider: program.provider,
          requirements_summary: program.requirements,
          positioning_summary: m.positioning_summary,
          score: m.score,
          tier: m.tier ?? tierForScore(m.score),
          confirm_url: confirmUrl,
        });
      }

      if (matchViews.length === 0) return;

      const rendered = renderDigestEmail({
        startup_name: profile.startup_name,
        matches: matchViews,
      });
      await email.send({ to, subject: rendered.subject, html: rendered.html, text: rendered.text });
    },

    async onSubmissionNeedsInput(payload) {
      const submission = await repos.submissions.getById(payload.submission_id);
      if (!submission) return;
      const profile = await repos.profiles.getById(payload.profile_id);
      if (!profile) return;
      const programs = await repos.programs.list();
      const program = programs.find((p) => p.id === payload.program_id);
      if (!program) return;
      const to = await userEmail.resolveUserEmail(profile.user_id);
      if (!to) return;

      const rendered = renderMissingInfoEmail({
        startup_name: profile.startup_name,
        program_name: program.name,
        program_provider: program.provider,
        missing_fields: payload.missing_fields.map((f) => ({
          field_name: f.field_name,
          description: f.description,
          type: f.type,
        })),
        profile_url: `${baseUrl}/profile`,
      });
      await email.send({ to, subject: rendered.subject, html: rendered.html, text: rendered.text });
    },

    async onSubmissionSubmitted(payload) {
      const submission = await repos.submissions.getById(payload.submission_id);
      if (!submission) return;
      const profile = await repos.profiles.getById(payload.profile_id);
      if (!profile) return;
      const programs = await repos.programs.list();
      const program = programs.find((p) => p.id === payload.program_id);
      if (!program) return;
      const to = await userEmail.resolveUserEmail(profile.user_id);
      if (!to) return;

      const rendered = renderSubmissionConfirmedEmail({
        startup_name: profile.startup_name,
        program_name: program.name,
        program_provider: program.provider,
        confirmation_ref: payload.confirmation_ref,
        submissions_url: `${baseUrl}/submissions`,
      });
      await email.send({ to, subject: rendered.subject, html: rendered.html, text: rendered.text });
    },
  };
}

/**
 * Convenience wrapper that builds the standard signer over the deep-link
 * tokens module. Kept here so callsites (`createApp`, the cron job) do
 * not have to know token internals.
 */
export function buildDeepLinkSigner(deepLinkSigningKey: string) {
  return (
    payload: { purpose: "submission_confirm"; profile_id: UUID; submission_id?: UUID },
    ttlSeconds: number,
  ): string => {
    return signDeepLinkToken(payload, ttlSeconds, deepLinkSigningKey);
  };
}
