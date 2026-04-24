/**
 * Wondergraph-shaped schema description.
 *
 * ASSUMPTION: the real Wondergraph adapter SDK is not referenced in this
 * repo yet. Root `AGENTS.md` pins Wondergraph as the mandatory GraphQL
 * layer but provides no package name, and `pnpm list` does not show one
 * installed. Per the Phase 3 directive we scaffold a plain resolver
 * shape that mirrors the Wondergraph resolver contract (context holds
 * the repository layer, resolvers are async functions that accept
 * `{parent, args, context, info}` and return plain objects). When the
 * real adapter SDK lands, the shape here should plug in directly.
 *
 * The SDL below is documentation of the shape resolvers implement; it
 * is not currently parsed by a server. A real Wondergraph mount will
 * parse it. Until then, `resolvers.ts` holds the runtime wiring and
 * `server.ts` exposes a minimal JSON endpoint for direct-edit tests.
 */
export const PROFILE_SCHEMA_SDL = /* GraphQL */ `
  enum ProfileStage {
    idea
    pre_seed
    seed
    series_a
    series_b_plus
  }

  enum ProfileLookingFor {
    increase_mrr
    technology_pea
    investors
    incubator
  }

  type Profile {
    id: ID!
    user_id: ID!
    startup_name: String!
    stage: ProfileStage
    location: String
    market: String
    goals: [String!]!
    looking_for: [ProfileLookingFor!]!
    narrative: String!
    updated_at: String!
    created_at: String!
  }

  input ProfilePatch {
    startup_name: String
    stage: ProfileStage
    location: String
    market: String
    goals: [String!]
    looking_for: [ProfileLookingFor!]
    narrative: String
  }

  type Query {
    profile(id: ID!): Profile
    profileByUser(user_id: ID!): Profile
  }

  type Mutation {
    updateProfile(id: ID!, patch: ProfilePatch!): Profile!
  }
`;
