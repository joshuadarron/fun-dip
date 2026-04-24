import { randomUUID } from "node:crypto";
import type {
  MatchStatus,
  Profile,
  Program,
  ProgramMatch,
  ProgramPage,
  ScrapingMatchInput,
  ScrapingMatchOutput,
  ScrapingFullScrapeInput,
  ScrapingFullScrapeOutput,
} from "@fundip/shared-types";
import { describe, expect, it, vi } from "vitest";

/**
 * These tests exercise the scraping-pipeline LOGIC, not the RocketRide
 * runtime. The deep agents in `pipeline.pipe` implement the same rules
 * the reference implementation below does. Running the pipeline against
 * a live runtime would require RocketRide credentials, Tinyfish access,
 * and a real Ghost MCP server, none of which is appropriate for unit
 * tests.
 *
 * Approach (mirrors pipelines/profile/tests):
 * 1. Use an in-memory fake Ghost store (a light shape that mirrors the
 *    scraping-relevant repo methods).
 * 2. Stub Tinyfish and the LLM as plain functions. The stubs return
 *    deterministic content so the reference pipeline can be exercised
 *    without network calls.
 * 3. Run the reference `runScrapingPipeline` and assert both the
 *    returned contract and the persisted Ghost state.
 *
 * When the real pipeline ships, the same scenarios can be replayed
 * against a fake RocketRide client that returns canned outputs.
 */

// --- in-memory data store shape -------------------------------------------

interface Store {
  profiles: Map<string, Profile>;
  programs: Map<string, Program>; // keyed by source_url
  matches: Map<string, ProgramMatch>; // keyed by `${profileId}:${programId}`
  pages: ProgramPage[];
}

function newStore(): Store {
  return {
    profiles: new Map(),
    programs: new Map(),
    matches: new Map(),
    pages: [],
  };
}

function seedProfile(store: Store, profile: Profile): void {
  store.profiles.set(profile.id, profile);
}

function seedProgram(store: Store, program: Program): void {
  store.programs.set(program.source_url, program);
}

function matchKey(profileId: string, programId: string): string {
  return `${profileId}:${programId}`;
}

// --- tier derivation (matches GHOST_SCHEMA.md and AGENTS.md) --------------

function tierFromScore(score: number): ProgramMatch["tier"] {
  if (score >= 75) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

// --- full_scrape reference -------------------------------------------------

interface TinyfishPage {
  url: string;
  program: {
    name: string;
    provider: string;
    description: string;
    requirements: string;
    apply_method: Program["apply_method"];
    apply_url: string | null;
    deadline: string | null;
    stage_fit: Program["stage_fit"];
    market_fit: string[];
    geo_scope: string[];
  };
  chunks: string[];
}

type TinyfishStub = (url: string) => Promise<TinyfishPage | null>;

async function runFullScrape(
  store: Store,
  input: ScrapingFullScrapeInput,
  tinyfish: TinyfishStub,
): Promise<ScrapingFullScrapeOutput> {
  const urls = input.source_urls ?? [];
  let added = 0;
  let updated = 0;
  let pagesScraped = 0;

  for (const url of urls) {
    const page = await tinyfish(url);
    if (!page) continue;
    const now = new Date().toISOString();
    const existing = store.programs.get(url);
    if (existing) {
      const next: Program = {
        ...existing,
        ...page.program,
        source_url: url,
        last_scraped_at: now,
      };
      store.programs.set(url, next);
      updated += 1;
    } else {
      const row: Program = {
        id: randomUUID(),
        source_url: url,
        ...page.program,
        last_scraped_at: now,
        first_seen_at: now,
      };
      store.programs.set(url, row);
      added += 1;
    }
    // Replace chunks for this url: delete existing + insert new.
    store.pages = store.pages.filter((p) => p.source_url !== url);
    for (let i = 0; i < page.chunks.length; i++) {
      store.pages.push({
        id: randomUUID(),
        program_id: store.programs.get(url)?.id ?? null,
        source_url: url,
        chunk_index: i,
        text: page.chunks[i]!,
        embedding: [],
        scraped_at: now,
      });
      pagesScraped += 1;
    }
  }

  return {
    status: "ok",
    mode: "full_scrape",
    programs_added: added,
    programs_updated: updated,
    pages_scraped: pagesScraped,
  };
}

// --- match reference -------------------------------------------------------

interface LlmStub {
  scoreSoftSignals(profile: Profile, program: Program): number; // 0 to 55 (market + goals portion)
  writePositioningSummary(profile: Profile, program: Program): string;
  writeRationale(profile: Profile, program: Program, score: number): string;
}

/**
 * Pre-filter candidates on stage_fit and geo_scope. Geo passes if the
 * program has an empty geo_scope (global) or contains the profile's
 * location (case-insensitive partial match).
 */
function preFilter(profile: Profile, programs: Program[]): Program[] {
  return programs.filter((program) => {
    const stageOk = profile.stage ? program.stage_fit.includes(profile.stage) : false;
    const geoOk =
      program.geo_scope.length === 0 ||
      (profile.location
        ? program.geo_scope.some((g) => g.toLowerCase().includes(profile.location!.toLowerCase()))
        : false);
    return stageOk && geoOk;
  });
}

function deterministicHardScore(profile: Profile, program: Program): number {
  let score = 0;
  if (profile.stage && program.stage_fit.includes(profile.stage)) score += 20;
  if (program.geo_scope.length === 0) score += 10;
  else if (
    profile.location &&
    program.geo_scope.some((g) => g.toLowerCase().includes(profile.location!.toLowerCase()))
  ) {
    score += 15;
  }
  return score;
}

function deadlineAdjustment(program: Program): number {
  if (!program.deadline) return 0;
  const delta = new Date(program.deadline).getTime() - Date.now();
  if (delta < 0) return -100; // effectively excludes
  const days = delta / (1000 * 60 * 60 * 24);
  if (days <= 30) return 10;
  return 0;
}

function profileIsSparse(profile: Profile): boolean {
  const hasStage = profile.stage != null;
  const hasMarket = profile.market != null && profile.market.length > 0;
  const hasLookingFor = profile.looking_for.length > 0;
  const signals = [hasStage, hasMarket, hasLookingFor].filter(Boolean).length;
  return signals <= 1;
}

async function runMatch(
  store: Store,
  input: ScrapingMatchInput,
  llm: LlmStub,
  httpPost: (body: unknown) => Promise<void>,
): Promise<ScrapingMatchOutput> {
  const profile = store.profiles.get(input.profile_id);
  if (!profile) {
    return { status: "ok", mode: "match", profile_id: input.profile_id, matches: [] };
  }

  const candidates = preFilter(profile, Array.from(store.programs.values()));
  const sparse = profileIsSparse(profile);

  const rows: ScrapingMatchOutput["matches"] = [];

  for (const program of candidates) {
    const deadlineAdj = deadlineAdjustment(program);
    if (deadlineAdj <= -100) continue; // exclude expired

    let score = deterministicHardScore(profile, program) + deadlineAdj;
    score += llm.scoreSoftSignals(profile, program);
    score = Math.max(0, Math.min(100, Math.round(score)));
    if (sparse) score = Math.min(score, 40);

    const tier = tierFromScore(score);
    const positioning = llm.writePositioningSummary(profile, program);
    const rationale = llm.writeRationale(profile, program, score);
    const now = new Date().toISOString();

    const key = matchKey(profile.id, program.id);
    const prior = store.matches.get(key);
    let nextStatus: MatchStatus;
    if (prior) {
      const preserve =
        prior.status === "dismissed" || prior.status === "interested" || prior.status === "applied";
      nextStatus = preserve ? prior.status : "new";
    } else {
      nextStatus = "new";
    }

    const next: ProgramMatch = {
      id: prior?.id ?? randomUUID(),
      profile_id: profile.id,
      program_id: program.id,
      score,
      tier,
      positioning_summary: positioning,
      status: nextStatus,
      rationale,
      matched_at: now,
    };
    store.matches.set(key, next);
    rows.push({
      program_match_id: next.id,
      program_id: next.program_id,
      score: next.score,
      tier: next.tier,
      positioning_summary: next.positioning_summary,
    });
  }

  const shouldEmit = input.emit_callback ?? true;
  if (shouldEmit) {
    const maxTier =
      rows.length === 0
        ? "cold"
        : rows.some((r) => r.tier === "hot")
          ? "hot"
          : rows.some((r) => r.tier === "warm")
            ? "warm"
            : "cold";
    await httpPost({
      profile_id: profile.id,
      match_count: rows.length,
      max_tier: maxTier,
    });
  }

  return { status: "ok", mode: "match", profile_id: profile.id, matches: rows };
}

// --- test fixtures ---------------------------------------------------------

function makeProgram(partial: Partial<Program>): Program {
  const now = new Date().toISOString();
  return {
    id: partial.id ?? randomUUID(),
    source_url: partial.source_url ?? `https://example.com/${randomUUID()}`,
    name: partial.name ?? "Program",
    provider: partial.provider ?? "Provider",
    description: partial.description ?? "",
    requirements: partial.requirements ?? "",
    apply_method: partial.apply_method ?? "website_info_only",
    apply_url: partial.apply_url ?? null,
    deadline: partial.deadline ?? null,
    stage_fit: partial.stage_fit ?? ["seed"],
    market_fit: partial.market_fit ?? [],
    geo_scope: partial.geo_scope ?? [],
    last_scraped_at: partial.last_scraped_at ?? now,
    first_seen_at: partial.first_seen_at ?? now,
  };
}

function makeProfile(partial: Partial<Profile>): Profile {
  const now = new Date().toISOString();
  return {
    id: partial.id ?? randomUUID(),
    user_id: partial.user_id ?? randomUUID(),
    startup_name: partial.startup_name ?? "",
    stage: partial.stage ?? null,
    location: partial.location ?? null,
    market: partial.market ?? null,
    goals: partial.goals ?? [],
    looking_for: partial.looking_for ?? [],
    narrative: partial.narrative ?? "",
    updated_at: partial.updated_at ?? now,
    created_at: partial.created_at ?? now,
  };
}

// Deterministic LLM stub: strong soft-signal scoring when profile has
// market + looking_for overlap with program description, zero otherwise.
// Goals use any-word overlap (stopwords filtered) to mimic a realistic
// LLM that reads past exact phrasing.
const GOAL_STOPWORDS = new Set(["increase", "reduce", "more", "new", "the", "a", "to", "and"]);
const richLlm: LlmStub = {
  scoreSoftSignals(profile, program) {
    let n = 0;
    if (profile.market && program.market_fit.includes(profile.market)) n += 25;
    const desc = (program.description + " " + program.requirements).toLowerCase();
    for (const want of profile.looking_for) {
      if (desc.includes(want.replace(/_/g, " "))) n += 10;
    }
    for (const g of profile.goals) {
      const tokens = g
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => !GOAL_STOPWORDS.has(t) && t.length > 2);
      if (tokens.some((t) => desc.includes(t))) n += 5;
    }
    return Math.min(55, n);
  },
  writePositioningSummary(profile, program) {
    return `${profile.startup_name || "The startup"} aligns with ${program.name}. Stage and market fit check out. The team can use this program to advance its goals.`;
  },
  writeRationale(_profile, _program, score) {
    return `Composite score ${score}.`;
  },
};

// --- tinyfish stubs -------------------------------------------------------

function tinyfishFor(pages: Record<string, TinyfishPage>): TinyfishStub {
  return async (url) => pages[url] ?? null;
}

// ==========================================================================
// Tests
// ==========================================================================

describe("scraping pipeline: full_scrape", () => {
  it("scrapes two source URLs, upserts programs, embeds pages", async () => {
    const store = newStore();
    const urls = ["https://example.com/grants", "https://example.com/accelerators"];
    const pages: Record<string, TinyfishPage> = {
      [urls[0]!]: {
        url: urls[0]!,
        program: {
          name: "Acme Grants",
          provider: "Acme Gov",
          description: "Grant for seed-stage fintech startups in Chicago.",
          requirements: "Incorporated entity. Minimum one year of operation.",
          apply_method: "form",
          apply_url: "https://example.com/grants/apply",
          deadline: null,
          stage_fit: ["seed", "series_a"],
          market_fit: ["fintech"],
          geo_scope: ["Chicago", "Illinois"],
        },
        chunks: ["Chunk A1 about grant requirements.", "Chunk A2 describing the application form."],
      },
      [urls[1]!]: {
        url: urls[1]!,
        program: {
          name: "Wayfinder Accelerator",
          provider: "Wayfinder",
          description: "Global accelerator for pre-seed and seed startups.",
          requirements: "Founding team of at least two.",
          apply_method: "form",
          apply_url: "https://example.com/accelerators/apply",
          deadline: null,
          stage_fit: ["pre_seed", "seed"],
          market_fit: [],
          geo_scope: [],
        },
        chunks: [
          "Wayfinder provides capital and mentorship.",
          "Applications open quarterly.",
          "Portfolio companies receive follow-on interest.",
        ],
      },
    };
    const result = await runFullScrape(
      store,
      { mode: "full_scrape", source_urls: urls },
      tinyfishFor(pages),
    );
    expect(result).toEqual({
      status: "ok",
      mode: "full_scrape",
      programs_added: 2,
      programs_updated: 0,
      pages_scraped: 5,
    });
    expect(store.programs.size).toBe(2);
    expect(store.pages).toHaveLength(5);
    for (const url of urls) {
      const hit = store.pages.filter((p) => p.source_url === url);
      expect(hit.length).toBeGreaterThan(0);
      expect(hit.every((p) => p.scraped_at)).toBe(true);
    }
  });

  it("re-running full_scrape updates, does not duplicate", async () => {
    const store = newStore();
    const url = "https://example.com/grants";
    const firstPage: TinyfishPage = {
      url,
      program: {
        name: "Acme Grants",
        provider: "Acme Gov",
        description: "v1 description.",
        requirements: "v1 requirements.",
        apply_method: "form",
        apply_url: "https://example.com/grants/apply",
        deadline: null,
        stage_fit: ["seed"],
        market_fit: [],
        geo_scope: [],
      },
      chunks: ["old chunk 1", "old chunk 2"],
    };
    await runFullScrape(
      store,
      { mode: "full_scrape", source_urls: [url] },
      tinyfishFor({ [url]: firstPage }),
    );
    expect(store.programs.size).toBe(1);
    expect(store.pages).toHaveLength(2);

    const firstId = store.programs.get(url)!.id;
    const firstFirstSeen = store.programs.get(url)!.first_seen_at;

    const secondPage: TinyfishPage = {
      ...firstPage,
      program: { ...firstPage.program, description: "v2 description." },
      chunks: ["new chunk A", "new chunk B", "new chunk C"],
    };
    const result = await runFullScrape(
      store,
      { mode: "full_scrape", source_urls: [url] },
      tinyfishFor({ [url]: secondPage }),
    );

    expect(result.programs_added).toBe(0);
    expect(result.programs_updated).toBe(1);
    expect(result.pages_scraped).toBe(3);

    // Single row, same id, same first_seen_at, updated description.
    expect(store.programs.size).toBe(1);
    const updated = store.programs.get(url)!;
    expect(updated.id).toBe(firstId);
    expect(updated.first_seen_at).toBe(firstFirstSeen);
    expect(updated.description).toBe("v2 description.");

    // Chunks replaced (not accumulated).
    expect(store.pages).toHaveLength(3);
    const texts = store.pages.map((p) => p.text).sort();
    expect(texts).toEqual(["new chunk A", "new chunk B", "new chunk C"]);
  });
});

describe("scraping pipeline: match", () => {
  it("sparse profile does not fabricate high scores", async () => {
    const store = newStore();
    const profile = makeProfile({
      id: "p-sparse",
      startup_name: "Thin",
      stage: "seed",
      // no market, no goals, no looking_for
    });
    seedProfile(store, profile);
    seedProgram(
      store,
      makeProgram({
        name: "Wide Program",
        stage_fit: ["seed"],
        geo_scope: [], // global
        market_fit: ["fintech", "healthtech"],
        description: "Supports growth startups seeking investors and incubator access.",
      }),
    );
    const httpPost = vi.fn<(body: unknown) => Promise<void>>(async () => {});
    const out = await runMatch(
      store,
      { mode: "match", profile_id: profile.id, emit_callback: false },
      richLlm,
      httpPost,
    );
    expect(out.status).toBe("ok");
    expect(out.matches).toHaveLength(1);
    // Sparse cap is 40; all scores must be <=40.
    for (const m of out.matches) {
      expect(m.score).toBeLessThanOrEqual(40);
      expect(["warm", "cold"]).toContain(m.tier);
    }
    expect(httpPost).not.toHaveBeenCalled();
  });

  it("rich profile produces a reasonable tier distribution", async () => {
    const store = newStore();
    const profile = makeProfile({
      id: "p-rich",
      startup_name: "Brightline",
      stage: "seed",
      location: "Chicago",
      market: "fintech",
      looking_for: ["investors", "incubator"],
      goals: ["increase MRR", "hire senior engineer"],
    });
    seedProfile(store, profile);
    seedProgram(
      store,
      makeProgram({
        name: "Perfect Fit",
        stage_fit: ["seed"],
        geo_scope: ["Chicago"],
        market_fit: ["fintech"],
        description: "Investors program for fintech seed founders focused on MRR growth.",
      }),
    );
    seedProgram(
      store,
      makeProgram({
        name: "Partial Fit",
        stage_fit: ["seed", "series_a"],
        geo_scope: ["Chicago", "Illinois"],
        market_fit: ["healthtech"],
        description: "General-purpose accelerator.",
      }),
    );
    seedProgram(
      store,
      makeProgram({
        name: "Wrong Stage",
        stage_fit: ["series_b_plus"],
        geo_scope: [],
      }),
    );
    seedProgram(
      store,
      makeProgram({
        name: "Wrong Geo",
        stage_fit: ["seed"],
        geo_scope: ["Remote EU only"],
      }),
    );
    const httpPost = vi.fn<(body: unknown) => Promise<void>>(async () => {});
    const out = await runMatch(
      store,
      { mode: "match", profile_id: profile.id, emit_callback: true },
      richLlm,
      httpPost,
    );
    // Only the two geo+stage passing candidates remain post-prefilter.
    expect(out.matches).toHaveLength(2);
    const perfect = out.matches.find((m) => {
      const pg = Array.from(store.programs.values()).find((p) => p.id === m.program_id);
      return pg?.name === "Perfect Fit";
    });
    const partial = out.matches.find((m) => {
      const pg = Array.from(store.programs.values()).find((p) => p.id === m.program_id);
      return pg?.name === "Partial Fit";
    });
    expect(perfect).toBeDefined();
    expect(partial).toBeDefined();
    expect(perfect!.score).toBeGreaterThan(partial!.score);
    expect(perfect!.tier).toBe("hot");
    expect(httpPost).toHaveBeenCalledTimes(1);
    const [payload] = httpPost.mock.calls[0]!;
    expect(payload).toMatchObject({
      profile_id: profile.id,
      match_count: 2,
      max_tier: "hot",
    });
  });

  it("re-run preserves status=dismissed while updating score", async () => {
    const store = newStore();
    const profile = makeProfile({
      id: "p-rerun",
      stage: "seed",
      location: "Chicago",
      market: "fintech",
      looking_for: ["investors"],
    });
    seedProfile(store, profile);
    const program = makeProgram({
      name: "Repeat Program",
      stage_fit: ["seed"],
      geo_scope: ["Chicago"],
      market_fit: ["fintech"],
      description: "Investors program for fintech.",
    });
    seedProgram(store, program);
    const httpPost = vi.fn<(body: unknown) => Promise<void>>(async () => {});
    await runMatch(
      store,
      { mode: "match", profile_id: profile.id, emit_callback: false },
      richLlm,
      httpPost,
    );
    const key = matchKey(profile.id, program.id);
    const before = store.matches.get(key)!;
    expect(before.status).toBe("new");

    // User dismissed it.
    store.matches.set(key, { ...before, status: "dismissed" });

    // Re-run.
    const out = await runMatch(
      store,
      { mode: "match", profile_id: profile.id, emit_callback: false },
      richLlm,
      httpPost,
    );
    const after = store.matches.get(key)!;
    expect(after.status).toBe("dismissed");
    // Score still recomputed (same inputs, same score).
    expect(after.score).toBe(before.score);
    // Row count unchanged (upsert, not duplicate).
    expect(store.matches.size).toBe(1);
    // Returned shape reflects the fresh computation.
    expect(out.matches[0]?.program_match_id).toBe(before.id);
  });

  it("emit_callback=false suppresses the HTTP callback", async () => {
    const store = newStore();
    const profile = makeProfile({
      id: "p-chat",
      stage: "seed",
      location: "Chicago",
      market: "fintech",
      looking_for: ["investors"],
    });
    seedProfile(store, profile);
    seedProgram(
      store,
      makeProgram({
        stage_fit: ["seed"],
        geo_scope: ["Chicago"],
        market_fit: ["fintech"],
      }),
    );
    const httpPost = vi.fn<(body: unknown) => Promise<void>>(async () => {});
    await runMatch(
      store,
      { mode: "match", profile_id: profile.id, emit_callback: false },
      richLlm,
      httpPost,
    );
    expect(httpPost).not.toHaveBeenCalled();
  });

  it("emit_callback default (omitted) fires the callback (cron path)", async () => {
    const store = newStore();
    const profile = makeProfile({ id: "p-cron", stage: "seed" });
    seedProfile(store, profile);
    seedProgram(store, makeProgram({ stage_fit: ["seed"], geo_scope: [] }));
    const httpPost = vi.fn<(body: unknown) => Promise<void>>(async () => {});
    await runMatch(store, { mode: "match", profile_id: profile.id }, richLlm, httpPost);
    expect(httpPost).toHaveBeenCalledTimes(1);
  });
});
