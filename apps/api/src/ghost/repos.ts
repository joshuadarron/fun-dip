import type {
  Conversation,
  Message,
  MessageRole,
  PageContext,
  Profile,
  Program,
  ProgramMatch,
  Selection,
  Submission,
  SubmissionStatus,
  ToolCallRecord,
  UUID,
} from "@fundip/shared-types";
import type { GhostClient } from "./client.js";

export interface ProfilesRepo {
  getByUserId(userId: UUID): Promise<Profile | null>;
  getById(id: UUID): Promise<Profile | null>;
  update(id: UUID, patch: Partial<Profile>): Promise<Profile>;
}

export interface ProgramsRepo {
  list(): Promise<Program[]>;
  getBySourceUrl(url: string): Promise<Program | null>;
}

export interface MatchesRepo {
  listForProfile(profileId: UUID): Promise<ProgramMatch[]>;
  updateStatus(id: UUID, status: ProgramMatch["status"]): Promise<ProgramMatch>;
}

export interface SubmissionsRepo {
  getById(id: UUID): Promise<Submission | null>;
  listForProfile(profileId: UUID, status?: SubmissionStatus): Promise<Submission[]>;
  updateStatus(id: UUID, status: SubmissionStatus): Promise<Submission>;
}

export interface ConversationsRepo {
  getByUserId(userId: UUID): Promise<Conversation | null>;
  updateSummary(id: UUID, summary: string): Promise<Conversation>;
}

export interface MessagesRepo {
  listLastN(conversationId: UUID, n: number): Promise<Message[]>;
  append(input: {
    conversation_id: UUID;
    role: MessageRole;
    content: string;
    page_context: PageContext;
    selection_context: Selection | null;
    tool_calls: ToolCallRecord[] | null;
  }): Promise<Message>;
}

export interface Repositories {
  profiles: ProfilesRepo;
  programs: ProgramsRepo;
  matches: MatchesRepo;
  submissions: SubmissionsRepo;
  conversations: ConversationsRepo;
  messages: MessagesRepo;
}

/**
 * Thin repo factory over a GhostClient. Each repo's method is
 * intentionally narrow: it exposes only the queries the PRD calls for.
 * Expand when a concrete callsite needs a new query, not speculatively.
 */
export function createRepositories(client: GhostClient): Repositories {
  return {
    profiles: {
      async getByUserId(userId) {
        const rows = await client.list("profiles", { filter: { user_id: userId }, limit: 1 });
        return rows[0] ?? null;
      },
      getById: (id) => client.get("profiles", id),
      update: (id, patch) => client.update("profiles", id, patch),
    },

    programs: {
      list: () => client.list("programs"),
      async getBySourceUrl(url) {
        const rows = await client.list("programs", { filter: { source_url: url }, limit: 1 });
        return rows[0] ?? null;
      },
    },

    matches: {
      listForProfile: (profileId) =>
        client.list("program_matches", {
          filter: { profile_id: profileId },
          orderBy: [{ field: "score", direction: "desc" }],
        }),
      updateStatus: (id, status) => client.update("program_matches", id, { status }),
    },

    submissions: {
      getById: (id) => client.get("submissions", id),
      listForProfile: (profileId, status) =>
        client.list("submissions", {
          filter: status ? { profile_id: profileId, status } : { profile_id: profileId },
        }),
      updateStatus: (id, status) => client.update("submissions", id, { status }),
    },

    conversations: {
      async getByUserId(userId) {
        const rows = await client.list("conversations", {
          filter: { user_id: userId },
          limit: 1,
        });
        return rows[0] ?? null;
      },
      updateSummary: (id, summary) => client.update("conversations", id, { summary }),
    },

    messages: {
      listLastN: (conversationId, n) =>
        client.list("messages", {
          filter: { conversation_id: conversationId },
          orderBy: [{ field: "created_at", direction: "desc" }],
          limit: n,
        }),
      append: async (input) => client.insert("messages", input),
    },
  };
}
