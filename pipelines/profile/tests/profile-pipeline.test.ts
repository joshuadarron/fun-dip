import type {
  Profile,
  ProfileFact,
  ProfileNarrative,
  ProfilePipelineInput,
  ProfilePipelineOutput,
} from "@fundip/shared-types";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * These tests exercise the profile-pipeline LOGIC, not the RocketRide
 * runtime. The deep agent in `pipeline.pipe` implements the same rules
 * the reference implementation below does. Running the pipeline against
 * a live runtime would require RocketRide creds and a real Ghost MCP
 * server, neither of which is appropriate for unit tests.
 *
 * The approach:
 * 1. Run the reference `runProfilePipeline` (this file) against an
 *    in-memory Ghost store.
 * 2. Assert the pipeline contract (I/O shape per PIPELINE_CONTRACTS.md)
 *    plus the four scenarios in pipelines/profile/AGENTS.md.
 *
 * When the real pipeline is wired, the same scenarios can be replayed
 * against a fake RocketRide client that returns canned outputs; the
 * reference below is the living spec of what canned outputs to produce.
 */

const PROFILE_FIELDS: Array<keyof Profile> = [
  "startup_name",
  "stage",
  "location",
  "market",
  "goals",
  "looking_for",
  "narrative",
];

interface Store {
  profiles: Map<string, Profile>;
  narratives: ProfileNarrative[];
  // Audit trail of which fields were set from a stated source versus inferred.
  sourceByField: Map<string, Map<string, ProfileFact["source"]>>;
}

function newStore(seed?: Partial<Profile>): Store {
  const store: Store = {
    profiles: new Map(),
    narratives: [],
    sourceByField: new Map(),
  };
  if (seed?.id) {
    const now = new Date().toISOString();
    const profile: Profile = {
      id: seed.id,
      user_id: seed.user_id ?? randomUUID(),
      startup_name: seed.startup_name ?? "",
      stage: seed.stage ?? null,
      location: seed.location ?? null,
      market: seed.market ?? null,
      goals: seed.goals ?? [],
      looking_for: seed.looking_for ?? [],
      narrative: seed.narrative ?? "",
      updated_at: now,
      created_at: now,
    };
    store.profiles.set(profile.id, profile);
  }
  return store;
}

function initialSources(): Map<string, ProfileFact["source"]> {
  return new Map();
}

function summarize(profile: Profile): string {
  const parts: string[] = [];
  if (profile.startup_name) parts.push(profile.startup_name);
  if (profile.stage) parts.push(`stage ${profile.stage}`);
  if (profile.market) parts.push(`market ${profile.market}`);
  if (profile.location) parts.push(`based in ${profile.location}`);
  if (profile.looking_for.length) parts.push(`looking for ${profile.looking_for.join(", ")}`);
  if (profile.goals.length) parts.push(`goals: ${profile.goals.join(", ")}`);
  if (parts.length === 0) return "Profile has no stated facts yet.";
  return parts.join(". ") + ".";
}

function isProfileField(field: string): field is keyof Profile {
  return (PROFILE_FIELDS as string[]).includes(field);
}

/**
 * Reference profile pipeline. Mirrors the contract in
 * `.claude/docs/PIPELINE_CONTRACTS.md` and the rules in
 * `pipelines/profile/AGENTS.md`.
 */
function runProfilePipeline(store: Store, input: ProfilePipelineInput): ProfilePipelineOutput {
  if (input.mode === "read") {
    const existing = store.profiles.get(input.profile_id);
    return {
      status: "ok",
      profile_id: input.profile_id,
      delta: { fields_updated: [], fields_added: [], narrative_appended: false },
      profile_summary: existing ? summarize(existing) : summarize(emptyProfile(input.profile_id)),
    };
  }

  const now = new Date().toISOString();
  let profile: Profile =
    store.profiles.get(input.profile_id) ?? emptyProfile(input.profile_id, now);

  let sources = store.sourceByField.get(input.profile_id);
  if (!sources) {
    sources = initialSources();
    store.sourceByField.set(input.profile_id, sources);
  }

  const fieldsUpdated: string[] = [];
  const fieldsAdded: string[] = [];

  if (input.mode === "create") {
    store.profiles.set(profile.id, profile);
    // create never fabricates fields. Only context-stated facts would be
    // applied here; reference impl keeps it empty to match "no hallucinated
    // fields" rule.
  }

  if (input.mode === "update" && input.facts) {
    for (const fact of input.facts) {
      if (!isProfileField(fact.field)) continue; // drop unknown fields
      const priorSource = sources.get(fact.field);
      // Rule: never overwrite a stated value (chat/import) with an inferred one.
      if (fact.source === "inferred" && priorSource && priorSource !== "inferred") {
        continue;
      }
      const had = profile[fact.field];
      const hadValue = had != null && had !== "" && !(Array.isArray(had) && had.length === 0);
      (profile as unknown as Record<string, unknown>)[fact.field] = fact.value;
      sources.set(fact.field, fact.source);
      if (hadValue) {
        if (!fieldsUpdated.includes(fact.field)) fieldsUpdated.push(fact.field);
      } else {
        if (!fieldsAdded.includes(fact.field)) fieldsAdded.push(fact.field);
      }
    }
  }

  const narrativeAppended = fieldsAdded.length + fieldsUpdated.length > 0;
  if (narrativeAppended) {
    const summary = summarize(profile);
    profile = { ...profile, narrative: summary, updated_at: now };
    store.profiles.set(profile.id, profile);
    store.narratives.push({
      id: randomUUID(),
      profile_id: profile.id,
      text: `Profile updated. Fields added: ${fieldsAdded.join(", ") || "none"}. Fields updated: ${fieldsUpdated.join(", ") || "none"}.`,
      embedding: [],
      source_message_id: null,
      created_at: now,
    });
  }

  return {
    status: "ok",
    profile_id: profile.id,
    delta: {
      fields_updated: fieldsUpdated,
      fields_added: fieldsAdded,
      narrative_appended: narrativeAppended,
    },
    profile_summary: summarize(profile),
  };
}

function emptyProfile(id: string, now: string = new Date().toISOString()): Profile {
  return {
    id,
    user_id: randomUUID(),
    startup_name: "",
    stage: null,
    location: null,
    market: null,
    goals: [],
    looking_for: [],
    narrative: "",
    updated_at: now,
    created_at: now,
  };
}

describe("profile pipeline logic", () => {
  it("create with empty context returns an empty profile and no hallucinated fields", () => {
    const store = newStore();
    const profileId = randomUUID();
    const out = runProfilePipeline(store, { profile_id: profileId, mode: "create" });
    expect(out.status).toBe("ok");
    expect(out.delta).toEqual({
      fields_updated: [],
      fields_added: [],
      narrative_appended: false,
    });
    const stored = store.profiles.get(profileId);
    expect(stored?.startup_name).toBe("");
    expect(stored?.market).toBeNull();
    expect(stored?.goals).toEqual([]);
    expect(store.narratives).toHaveLength(0);
  });

  it("update with a single stated fact writes the field and appends a narrative", () => {
    const profileId = randomUUID();
    const store = newStore({ id: profileId });
    const out = runProfilePipeline(store, {
      profile_id: profileId,
      mode: "update",
      facts: [{ field: "location", value: "Chicago", source: "chat" }],
    });
    expect(out.delta.fields_added).toEqual(["location"]);
    expect(out.delta.narrative_appended).toBe(true);
    expect(store.profiles.get(profileId)?.location).toBe("Chicago");
    expect(store.narratives).toHaveLength(1);
    expect(store.narratives[0]?.profile_id).toBe(profileId);
  });

  it("preserves a stated field when an inferred fact would overwrite it", () => {
    const profileId = randomUUID();
    const store = newStore({ id: profileId });

    // User stated market=edtech first.
    runProfilePipeline(store, {
      profile_id: profileId,
      mode: "update",
      facts: [{ field: "market", value: "edtech", source: "chat" }],
    });

    // Later inferred suggestion market=fintech (from conversational context).
    const out = runProfilePipeline(store, {
      profile_id: profileId,
      mode: "update",
      facts: [{ field: "market", value: "fintech", source: "inferred" }],
    });

    expect(store.profiles.get(profileId)?.market).toBe("edtech");
    expect(out.delta.fields_updated).toEqual([]);
    expect(out.delta.fields_added).toEqual([]);
  });

  it("read after 5 updates reflects current state in the summary", () => {
    const profileId = randomUUID();
    const store = newStore({ id: profileId });
    const updates: Array<ProfileFact[]> = [
      [{ field: "startup_name", value: "Acme", source: "chat" }],
      [{ field: "stage", value: "seed", source: "chat" }],
      [{ field: "market", value: "fintech", source: "chat" }],
      [{ field: "location", value: "Chicago", source: "chat" }],
      [{ field: "looking_for", value: ["investors", "incubator"], source: "chat" }],
    ];
    for (const facts of updates) {
      runProfilePipeline(store, { profile_id: profileId, mode: "update", facts });
    }
    const out = runProfilePipeline(store, { profile_id: profileId, mode: "read" });
    expect(out.delta.narrative_appended).toBe(false);
    expect(out.profile_summary).toContain("Acme");
    expect(out.profile_summary).toContain("seed");
    expect(out.profile_summary).toContain("fintech");
    expect(out.profile_summary).toContain("Chicago");
    expect(out.profile_summary).toContain("investors");
    // Per project rule, no em-dashes in written content.
    expect(out.profile_summary).not.toContain("—");
  });
});
