import { Cron } from "croner";
import type { PipelineInvoker } from "@fundip/rocketride-client";
import type { Config } from "../config/index.js";
import type { EmailClient } from "../email/client.js";
import type { Repositories } from "../ghost/repos.js";

/**
 * Sunday weekly job. Schedule: `0 12 * * 0` (noon UTC every Sunday).
 *
 * Why noon UTC: gives the full_scrape time to complete before users in
 * the Americas check email Sunday afternoon, and before users in
 * Europe/Asia start the work week. UTC keeps the schedule deterministic
 * across server moves; croner accepts a `timezone` option if a
 * per-user mailing window becomes a requirement later.
 *
 * Sequence:
 *   1. Run scraping pipeline in `full_scrape` mode (writes new programs).
 *   2. List all profiles. Phase 8 keeps the "active" heuristic simple:
 *      every profile gets a match pass.
 *   3. For each profile, run scraping in `match` mode with
 *      `emit_callback: true`. The callback receiver composes the
 *      digest email; this loop only fires the matches.
 */
export const SUNDAY_NOON_UTC = "0 12 * * 0";

export interface CronDeps {
  invoker: PipelineInvoker;
  repos: Repositories;
  email: EmailClient;
  config: Pick<Config, "NODE_ENV">;
}

/**
 * Run one pass of the weekly job. Exported for tests so we can call it
 * directly without engaging the croner scheduler.
 */
export async function runWeeklyJob(deps: Pick<CronDeps, "invoker" | "repos">): Promise<void> {
  const { invoker, repos } = deps;

  // 1. Full scrape pass.
  await invoker.runScrapingPipeline({ mode: "full_scrape" });

  // 2. All profiles, in declaration order.
  const profiles = await repos.profiles.list();

  // 3. Per-profile match pass with callback emission so the digest
  // composer fires.
  for (const profile of profiles) {
    await invoker.runScrapingPipeline({
      mode: "match",
      profile_id: profile.id,
      emit_callback: true,
    });
  }
}

/**
 * Start the weekly cron. Returns a stop handle. NOT called from
 * `createApp`; only `apps/api/src/index.ts` (process entrypoint)
 * starts cron, and only when `NODE_ENV !== "test"`.
 */
export function startCron(deps: CronDeps): { stop: () => void } {
  if (deps.config.NODE_ENV === "test") {
    return { stop: () => undefined };
  }
  const job = new Cron(SUNDAY_NOON_UTC, { timezone: "UTC", protect: true }, () => {
    void runWeeklyJob(deps).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[cron] weekly job failed:", msg);
    });
  });
  return {
    stop: () => job.stop(),
  };
}
