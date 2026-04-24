import type { Profile, UUID } from "@fundip/shared-types";
import type { Repositories } from "../ghost/repos.js";

export interface GraphQLContext {
  repos: Repositories;
}

export type ProfilePatch = Partial<
  Pick<
    Profile,
    "startup_name" | "stage" | "location" | "market" | "goals" | "looking_for" | "narrative"
  >
>;

/**
 * Resolvers in Wondergraph shape: async functions `(parent, args, ctx, info)`
 * that return plain objects. All data access goes through the repository
 * layer (ctx.repos), never raw MCP. Direct profile form edits land here.
 */
export const profileResolvers = {
  Query: {
    profile: async (
      _parent: unknown,
      args: { id: UUID },
      ctx: GraphQLContext,
    ): Promise<Profile | null> => {
      return ctx.repos.profiles.getById(args.id);
    },
    profileByUser: async (
      _parent: unknown,
      args: { user_id: UUID },
      ctx: GraphQLContext,
    ): Promise<Profile | null> => {
      return ctx.repos.profiles.getByUserId(args.user_id);
    },
  },
  Mutation: {
    updateProfile: async (
      _parent: unknown,
      args: { id: UUID; patch: ProfilePatch },
      ctx: GraphQLContext,
    ): Promise<Profile> => {
      // Direct edits bypass the profile pipeline. They write to Ghost via
      // the repository layer and do not touch profile_narratives.
      return ctx.repos.profiles.update(args.id, args.patch);
    },
  },
} as const;
