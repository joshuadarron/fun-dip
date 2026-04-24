import { Router } from "express";
import type { Program } from "@fundip/shared-types";
import type { GhostClient } from "../ghost/client.js";

type ProgramSeed = Omit<Program, "id" | "last_scraped_at" | "first_seen_at">;

// Fixed ids so the frontend dev user (see apps/web/src/config/dev.ts)
// resolves against these rows.
const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";
const DEV_PROFILE_ID = "00000000-0000-0000-0000-000000000002";
const DEV_CONVERSATION_ID = "00000000-0000-0000-0000-000000000003";

const SAMPLE_PROGRAMS: ProgramSeed[] = [
  {
    source_url: "https://example.com/seed-boost",
    name: "Seed Boost Grant",
    provider: "Midwest Foundation",
    description: "Non-dilutive funding for pre-seed fintech.",
    requirements: "Incorporated in US. Under 10 FTE.",
    apply_method: "form" as const,
    apply_url: "https://example.com/seed-boost/apply",
    deadline: null,
    stage_fit: ["pre_seed", "seed"],
    market_fit: ["fintech"],
    geo_scope: ["Chicago", "Detroit", "Cleveland"],
  },
  {
    source_url: "https://example.com/fintech-accelerator",
    name: "Fintech Accelerator",
    provider: "Coastal Partners",
    description: "13-week program with mentorship and a $150k check.",
    requirements: "Seed stage, B2B product, fintech vertical.",
    apply_method: "form" as const,
    apply_url: "https://example.com/fintech/apply",
    deadline: null,
    stage_fit: ["seed"],
    market_fit: ["fintech", "b2b_saas"],
    geo_scope: ["Chicago", "San Francisco", "New York"],
  },
  {
    source_url: "https://example.com/climate-lab",
    name: "Climate Venture Lab",
    provider: "GreenTech Collective",
    description: "Research-backed grants for climate-aligned hardware startups.",
    requirements: "Hardware or deep tech, climate thesis.",
    apply_method: "form" as const,
    apply_url: "https://example.com/climate/apply",
    deadline: null,
    stage_fit: ["idea", "pre_seed"],
    market_fit: ["climate", "hardware"],
    geo_scope: ["Global"],
  },
  {
    source_url: "https://example.com/women-in-fintech",
    name: "Women in Fintech Fund",
    provider: "Equitable Capital",
    description: "$50k to $250k checks for fintech founders from underrepresented groups.",
    requirements: "At least one female or non-binary co-founder.",
    apply_method: "email" as const,
    apply_url: null,
    deadline: null,
    stage_fit: ["pre_seed", "seed"],
    market_fit: ["fintech"],
    geo_scope: ["Chicago", "New York"],
  },
  {
    source_url: "https://example.com/ai-prototype-grant",
    name: "AI Prototype Grant",
    provider: "Forward Labs",
    description: "Technology PEA grants for AI-native prototypes.",
    requirements: "Working demo, technical team of at least 2.",
    apply_method: "form" as const,
    apply_url: "https://example.com/ai-grant/apply",
    deadline: null,
    stage_fit: ["idea", "pre_seed", "seed"],
    market_fit: ["ai", "dev_tools"],
    geo_scope: ["Chicago"],
  },
];

function tierFor(score: number): "hot" | "warm" | "cold" {
  if (score >= 75) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

export interface DevSeedRouterOptions {
  ghost: GhostClient;
}

export function createDevSeedRouter({ ghost }: DevSeedRouterOptions): Router {
  const router = Router();

  router.get("/dev/seed", async (_req, res) => {
    const now = new Date().toISOString();

    // Profile. Idempotent: skip if it already exists.
    const existingProfile = await ghost.get("profiles", DEV_PROFILE_ID);
    if (!existingProfile) {
      await ghost.insert("profiles", {
        id: DEV_PROFILE_ID,
        user_id: DEV_USER_ID,
        startup_name: "Acme Fintech",
        stage: "seed",
        location: "Chicago",
        market: "fintech",
        goals: ["raise_seed", "enterprise_pilots"],
        looking_for: ["investors", "incubator"],
        narrative:
          "Acme Fintech ships developer tooling for mid-market banks. Three pilot customers, closing a seed round.",
      });
    }

    // Conversation so the chat panel has a row to read.
    const existingConvo = await ghost.get("conversations", DEV_CONVERSATION_ID);
    if (!existingConvo) {
      await ghost.insert("conversations", {
        id: DEV_CONVERSATION_ID,
        user_id: DEV_USER_ID,
        summary: "",
      });
    }

    // Programs. Upsert by source_url.
    const programs = [];
    for (const row of SAMPLE_PROGRAMS) {
      const existing = await ghost.list("programs", {
        filter: { source_url: row.source_url },
        limit: 1,
      });
      const saved = existing[0]
        ? await ghost.update("programs", existing[0].id, {
            ...row,
            last_scraped_at: now,
          })
        : await ghost.insert("programs", {
            ...row,
            stage_fit: [...row.stage_fit],
            last_scraped_at: now,
            first_seen_at: now,
          });
      programs.push(saved);
    }

    // Matches. Score = stage-fit (50) + geo-fit (40) + fintech bonus (10).
    const profile = await ghost.get("profiles", DEV_PROFILE_ID);
    if (!profile) throw new Error("profile seed failed");

    const matchRows = [];
    for (const program of programs) {
      const stageHit =
        program.stage_fit.length === 0 || program.stage_fit.includes(profile.stage ?? "idea");
      const geoHit =
        program.geo_scope.length === 0 ||
        program.geo_scope.includes("Global") ||
        (profile.location != null && program.geo_scope.includes(profile.location));
      const fintechHit = program.market_fit.includes("fintech");
      const score = (stageHit ? 50 : 0) + (geoHit ? 40 : 0) + (fintechHit ? 10 : 0);
      const tier = tierFor(score);

      const existing = await ghost.list("program_matches", {
        filter: { profile_id: profile.id, program_id: program.id },
        limit: 1,
      });
      const saved = existing[0]
        ? await ghost.update("program_matches", existing[0].id, {
            score,
            tier,
          })
        : await ghost.insert("program_matches", {
            profile_id: profile.id,
            program_id: program.id,
            score,
            tier,
            positioning_summary:
              `${program.name} fits ${profile.startup_name}. Stage alignment: ${stageHit ? "yes" : "no"}. ` +
              `Geo: ${geoHit ? "yes" : "no"}. ${fintechHit ? "Fintech focus matches." : ""}`,
            status: "new",
            rationale: `stage=${String(stageHit)} geo=${String(geoHit)} fintech=${String(fintechHit)} score=${String(score)}`,
            matched_at: now,
          });
      matchRows.push(saved);
    }

    res.json({
      status: "seeded",
      profile_id: DEV_PROFILE_ID,
      programs: programs.length,
      matches: matchRows.length,
      tiers: {
        hot: matchRows.filter((m) => m.tier === "hot").length,
        warm: matchRows.filter((m) => m.tier === "warm").length,
        cold: matchRows.filter((m) => m.tier === "cold").length,
      },
    });
  });

  return router;
}
