import type { Profile } from "@fundip/shared-types";
import { describe, expect, it } from "vitest";
import { createFakeGhostClient } from "../ghost/fake.js";
import { createRepositories } from "../ghost/repos.js";
import { profileResolvers, type GraphQLContext } from "./resolvers.js";

function makeProfile(over: Partial<Profile> = {}): Profile {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: over.id ?? "p1",
    user_id: over.user_id ?? "u1",
    startup_name: over.startup_name ?? "Acme",
    stage: over.stage ?? "seed",
    location: over.location ?? "Chicago",
    market: over.market ?? "fintech",
    goals: over.goals ?? [],
    looking_for: over.looking_for ?? [],
    narrative: over.narrative ?? "",
    updated_at: over.updated_at ?? now,
    created_at: over.created_at ?? now,
  };
}

function makeCtx(initial: Profile[]): GraphQLContext {
  const client = createFakeGhostClient({ profiles: initial });
  return { repos: createRepositories(client) };
}

describe("profile resolvers", () => {
  it("Query.profile returns the row by id via the repo layer", async () => {
    const profile = makeProfile();
    const ctx = makeCtx([profile]);
    const result = await profileResolvers.Query.profile(null, { id: "p1" }, ctx);
    expect(result).toEqual(profile);
  });

  it("Query.profileByUser returns null when no row matches", async () => {
    const ctx = makeCtx([]);
    const result = await profileResolvers.Query.profileByUser(null, { user_id: "u1" }, ctx);
    expect(result).toBeNull();
  });

  it("Mutation.updateProfile patches the row and bumps updated_at", async () => {
    const profile = makeProfile({ market: "edtech" });
    const ctx = makeCtx([profile]);
    const result = await profileResolvers.Mutation.updateProfile(
      null,
      { id: "p1", patch: { market: "fintech", location: "Austin" } },
      ctx,
    );
    expect(result.market).toBe("fintech");
    expect(result.location).toBe("Austin");
    expect(result.updated_at).not.toBe(profile.updated_at);
    // Verify repo persisted it.
    const refetched = await ctx.repos.profiles.getById("p1");
    expect(refetched?.market).toBe("fintech");
  });
});
