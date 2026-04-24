import { GraphQLClient, type Variables } from "graphql-request";
import type { Profile, ProgramMatch, Submission, UUID } from "@fundip/shared-types";

/**
 * Wondergraph endpoint. App layer exposes `/graphql` per ARCHITECTURE.md.
 * `graphql-request` v7 requires an absolute URL, so we resolve against
 * `window.location.origin` at call time. Vite dev proxies `/graphql`
 * to the api; in prod the web host proxies the same path.
 */
function resolveGraphQLUrl(): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/graphql`;
  }
  return "http://localhost:4000/graphql";
}

let clientInstance: GraphQLClient | null = null;

export function getGraphQLClient(): GraphQLClient {
  if (!clientInstance) {
    clientInstance = new GraphQLClient(resolveGraphQLUrl());
  }
  return clientInstance;
}

/**
 * Test seam: lets test suites swap in a stub client without
 * touching module state between tests.
 */
export function setGraphQLClient(client: GraphQLClient | null): void {
  clientInstance = client;
}

export async function graphqlRequest<TData, TVariables extends Variables = Variables>(
  document: string,
  variables?: TVariables,
): Promise<TData> {
  const client = getGraphQLClient();
  // `graphql-request`'s request overload uses a rest-args tuple that gets
  // fussy with generic `TVariables`. Cast the bound call to a simpler
  // shape here so callers can keep a direct `(document, variables)` API.
  const boundRequest = client.request.bind(client) as unknown as (
    document: string,
    variables?: TVariables,
  ) => Promise<TData>;
  return boundRequest(document, variables);
}

// --- Queries and mutations ---------------------------------------------------

export const ProfileQuery = /* GraphQL */ `
  query Profile($id: ID!) {
    profile(id: $id) {
      id
      user_id
      startup_name
      stage
      location
      market
      goals
      looking_for
      narrative
      updated_at
      created_at
    }
    profileSummary(id: $id)
  }
`;

export interface ProfileQueryResult {
  profile: Profile | null;
  profileSummary: string | null;
}

export interface ProfileQueryVariables extends Variables {
  id: UUID;
}

export const ProgramMatchesQuery = /* GraphQL */ `
  query ProgramMatches($profileId: ID!) {
    programMatches(profile_id: $profileId) {
      id
      profile_id
      program_id
      score
      tier
      positioning_summary
      status
      rationale
      matched_at
      program {
        id
        name
        provider
        description
        apply_method
        apply_url
        deadline
      }
    }
  }
`;

export interface ProgramSummary {
  id: UUID;
  name: string;
  provider: string;
  description: string;
  apply_method: string;
  apply_url: string | null;
  deadline: string | null;
}

export interface ProgramMatchWithProgram extends ProgramMatch {
  program?: ProgramSummary | null;
}

export interface ProgramMatchesQueryResult {
  programMatches: ProgramMatchWithProgram[];
}

export interface ProgramMatchesQueryVariables extends Variables {
  profileId: UUID;
}

export const SubmissionsQuery = /* GraphQL */ `
  query Submissions($profileId: ID!) {
    submissions(profile_id: $profileId) {
      id
      profile_id
      program_id
      program_match_id
      status
      prefilled_fields
      missing_fields
      provided_data
      submitted_at
      confirmation_ref
      response_text
      error
      created_at
      updated_at
      program {
        id
        name
        provider
      }
    }
  }
`;

export interface SubmissionWithProgram extends Submission {
  program?: Pick<ProgramSummary, "id" | "name" | "provider"> | null;
}

export interface SubmissionsQueryResult {
  submissions: SubmissionWithProgram[];
}

export interface SubmissionsQueryVariables extends Variables {
  profileId: UUID;
}

export const UpdateProfileMutation = /* GraphQL */ `
  mutation UpdateProfile($id: ID!, $patch: ProfilePatch!) {
    updateProfile(id: $id, patch: $patch) {
      id
      user_id
      startup_name
      stage
      location
      market
      goals
      looking_for
      narrative
      updated_at
      created_at
    }
  }
`;

export type ProfilePatch = Partial<
  Pick<
    Profile,
    "startup_name" | "stage" | "location" | "market" | "goals" | "looking_for" | "narrative"
  >
>;

export interface UpdateProfileResult {
  updateProfile: Profile;
}

export interface UpdateProfileVariables extends Variables {
  id: UUID;
  patch: ProfilePatch;
}
