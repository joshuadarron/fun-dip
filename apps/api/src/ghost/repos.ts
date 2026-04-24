import type {
  Conversation,
  Message,
  MessageRole,
  PageContext,
  Profile,
  Program,
  ProgramMatch,
  ProgramPage,
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
  /**
   * Read every profile. Used by the weekly cron to iterate active
   * profiles for the per-profile match pass. The "active" filter is
   * intentionally absent here; the cron caller decides whether to
   * narrow the list (Phase 8 keeps it simple: all profiles).
   */
  list(): Promise<Profile[]>;
  update(id: UUID, patch: Partial<Profile>): Promise<Profile>;
}

export interface ProgramsRepo {
  list(): Promise<Program[]>;
  getBySourceUrl(url: string): Promise<Program | null>;
  /**
   * Create or update a program row keyed by `source_url`. Used by the
   * scraping pipeline's `full_scrape` path: each scraped page produces
   * structured fields that are merged onto any existing row, preserving
   * `first_seen_at` and bumping `last_scraped_at`.
   */
  upsertBySourceUrl(url: string, data: Partial<Program>): Promise<Program>;
}

export interface MatchesRepo {
  listForProfile(profileId: UUID): Promise<ProgramMatch[]>;
  updateStatus(id: UUID, status: ProgramMatch["status"]): Promise<ProgramMatch>;
  /**
   * Create or update a `program_matches` row keyed by
   * `(profile_id, program_id)`. Preserves `status` when the existing row
   * has progressed past the initial surfaced stage (`dismissed`,
   * `interested`, `applied`). Only resets status to the caller-provided
   * value (or `new`) when the prior status was `new` or `surfaced`. See
   * `pipelines/scraping/AGENTS.md`.
   */
  upsertByPair(
    profileId: UUID,
    programId: UUID,
    data: Partial<Omit<ProgramMatch, "id" | "profile_id" | "program_id">>,
  ): Promise<ProgramMatch>;
}

export interface ProgramPagesRepo {
  /**
   * Replace all chunks for a given `source_url`: delete existing rows,
   * insert the provided chunk list. Used when a page is re-scraped so we
   * do not accumulate stale content alongside the fresh extraction.
   */
  replaceForUrl(
    sourceUrl: string,
    chunks: Array<Omit<ProgramPage, "id" | "source_url">>,
  ): Promise<ProgramPage[]>;
  listByProgram(programId: UUID): Promise<ProgramPage[]>;
}

export interface SubmissionsRepo {
  getById(id: UUID): Promise<Submission | null>;
  listForProfile(profileId: UUID, status?: SubmissionStatus): Promise<Submission[]>;
  updateStatus(id: UUID, status: SubmissionStatus): Promise<Submission>;
  findByProfileAndProgram(profileId: UUID, programId: UUID): Promise<Submission | null>;
  create(
    input: Omit<Submission, "id" | "created_at" | "updated_at"> & Partial<Pick<Submission, "id">>,
  ): Promise<Submission>;
  update(id: UUID, patch: Partial<Submission>): Promise<Submission>;
}

export interface ConversationsRepo {
  getByUserId(userId: UUID): Promise<Conversation | null>;
  updateSummary(id: UUID, summary: string): Promise<Conversation>;
  /**
   * Single-threaded-per-user upsert. Returns the existing conversations
   * row for `userId` if one exists; otherwise inserts a fresh row with an
   * empty summary (or the supplied initial summary). The PRD's chat
   * memory rule is one conversation per user, so the chat pipeline calls
   * this at the start of every turn.
   */
  upsertByUserId(userId: UUID, init?: { summary?: string }): Promise<Conversation>;
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
  /**
   * Count messages newer than the conversation's last `summary` update.
   * The chat pipeline regenerates the rolling summary every 20 new
   * messages, so this method gives the pipeline a cheap "are we due?"
   * signal without scanning the entire conversation history. The
   * comparison key is `conversations.updated_at`, which the
   * `updateSummary` mutation bumps.
   */
  countSinceSummaryUpdate(conversationId: UUID): Promise<number>;
}

export interface Repositories {
  profiles: ProfilesRepo;
  programs: ProgramsRepo;
  matches: MatchesRepo;
  programPages: ProgramPagesRepo;
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
      list: () => client.list("profiles"),
      update: (id, patch) => client.update("profiles", id, patch),
    },

    programs: {
      list: () => client.list("programs"),
      async getBySourceUrl(url) {
        const rows = await client.list("programs", { filter: { source_url: url }, limit: 1 });
        return rows[0] ?? null;
      },
      async upsertBySourceUrl(url, data) {
        const now = new Date().toISOString();
        const existing = await client.list("programs", {
          filter: { source_url: url },
          limit: 1,
        });
        if (existing[0]) {
          const patch: Partial<Program> = {
            ...data,
            source_url: url,
            last_scraped_at: data.last_scraped_at ?? now,
          };
          return client.update("programs", existing[0].id, patch);
        }
        // Build the row using the provided fields plus sensible defaults for
        // the required shape. Unknown text fields default to "" so the Ghost
        // row remains valid; arrays default to [].
        const row: Omit<Program, "id"> = {
          source_url: url,
          name: data.name ?? "",
          provider: data.provider ?? "",
          description: data.description ?? "",
          requirements: data.requirements ?? "",
          apply_method: data.apply_method ?? "website_info_only",
          apply_url: data.apply_url ?? null,
          deadline: data.deadline ?? null,
          stage_fit: data.stage_fit ?? [],
          market_fit: data.market_fit ?? [],
          geo_scope: data.geo_scope ?? [],
          last_scraped_at: data.last_scraped_at ?? now,
          first_seen_at: data.first_seen_at ?? now,
        };
        return client.insert("programs", row);
      },
    },

    matches: {
      listForProfile: (profileId) =>
        client.list("program_matches", {
          filter: { profile_id: profileId },
          orderBy: [{ field: "score", direction: "desc" }],
        }),
      updateStatus: (id, status) => client.update("program_matches", id, { status }),
      async upsertByPair(profileId, programId, data) {
        const now = new Date().toISOString();
        const existing = await client.list("program_matches", {
          filter: { profile_id: profileId, program_id: programId },
          limit: 1,
        });
        if (existing[0]) {
          const prior = existing[0];
          // Preserve terminal/engaged statuses. Only `new` or `surfaced` get
          // reset to the incoming status (or remain `new` by default).
          const preserve =
            prior.status === "dismissed" ||
            prior.status === "interested" ||
            prior.status === "applied";
          const nextStatus = preserve ? prior.status : (data.status ?? "new");
          const patch: Partial<ProgramMatch> = {
            ...data,
            status: nextStatus,
            matched_at: data.matched_at ?? now,
          };
          return client.update("program_matches", prior.id, patch);
        }
        const row: Omit<ProgramMatch, "id"> = {
          profile_id: profileId,
          program_id: programId,
          score: data.score ?? 0,
          tier: data.tier ?? "cold",
          positioning_summary: data.positioning_summary ?? "",
          status: data.status ?? "new",
          rationale: data.rationale ?? "",
          matched_at: data.matched_at ?? now,
        };
        return client.insert("program_matches", row);
      },
    },

    programPages: {
      async replaceForUrl(sourceUrl, chunks) {
        const existing = await client.list("program_pages", {
          filter: { source_url: sourceUrl },
        });
        for (const row of existing) {
          await client.delete("program_pages", row.id);
        }
        const inserted: ProgramPage[] = [];
        for (const chunk of chunks) {
          const row = await client.insert("program_pages", { ...chunk, source_url: sourceUrl });
          inserted.push(row);
        }
        return inserted;
      },
      listByProgram: (programId) =>
        client.list("program_pages", { filter: { program_id: programId } }),
    },

    submissions: {
      getById: (id) => client.get("submissions", id),
      listForProfile: (profileId, status) =>
        client.list("submissions", {
          filter: status ? { profile_id: profileId, status } : { profile_id: profileId },
        }),
      updateStatus: (id, status) => client.update("submissions", id, { status }),
      async findByProfileAndProgram(profileId, programId) {
        const rows = await client.list("submissions", {
          filter: { profile_id: profileId, program_id: programId },
          orderBy: [{ field: "updated_at", direction: "desc" }],
          limit: 1,
        });
        return rows[0] ?? null;
      },
      create: (input) => client.insert("submissions", input),
      update: (id, patch) => client.update("submissions", id, patch),
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
      async upsertByUserId(userId, init) {
        const rows = await client.list("conversations", {
          filter: { user_id: userId },
          limit: 1,
        });
        const existing = rows[0];
        if (existing) return existing;
        const row: Omit<Conversation, "id" | "created_at" | "updated_at"> = {
          user_id: userId,
          summary: init?.summary ?? "",
        };
        return client.insert("conversations", row);
      },
    },

    messages: {
      listLastN: (conversationId, n) =>
        client.list("messages", {
          filter: { conversation_id: conversationId },
          orderBy: [{ field: "created_at", direction: "desc" }],
          limit: n,
        }),
      append: async (input) => client.insert("messages", input),
      async countSinceSummaryUpdate(conversationId) {
        const conversation = await client.get("conversations", conversationId);
        // No conversation row, no summary baseline: every message counts.
        // Rather than load and discard the full message list, fall back to
        // the cheap unfiltered count which the caller can interpret as
        // "regenerate now if past the threshold".
        if (!conversation) {
          const all = await client.list("messages", {
            filter: { conversation_id: conversationId },
          });
          return all.length;
        }
        const since = conversation.updated_at;
        const all = await client.list("messages", {
          filter: { conversation_id: conversationId },
        });
        // Strict greater-than: messages created at exactly `since` were
        // already accounted for at the last summary update.
        return all.filter((m) => m.created_at > since).length;
      },
    },
  };
}
