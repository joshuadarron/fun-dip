import type {
  Conversation,
  ConversationEmbedding,
  Message,
  Profile,
  ProfileNarrative,
  Program,
  ProgramMatch,
  ProgramPage,
  Submission,
  UUID,
} from "@fundip/shared-types";

/**
 * Logical collection names exposed by the Ghost MCP server. The real
 * MCP tool names live on the server; repositories translate between
 * these names and tool invocations.
 */
export type GhostCollection =
  | "profiles"
  | "programs"
  | "program_matches"
  | "submissions"
  | "conversations"
  | "messages"
  | "program_pages"
  | "profile_narratives"
  | "conversation_embeddings";

export type GhostCollectionRow<C extends GhostCollection> = {
  profiles: Profile;
  programs: Program;
  program_matches: ProgramMatch;
  submissions: Submission;
  conversations: Conversation;
  messages: Message;
  program_pages: ProgramPage;
  profile_narratives: ProfileNarrative;
  conversation_embeddings: ConversationEmbedding;
}[C];

export interface ListQuery {
  filter?: Record<string, unknown>;
  orderBy?: { field: string; direction: "asc" | "desc" }[];
  limit?: number;
}

/**
 * The narrow surface every repository needs. Real implementation (Phase 3)
 * wraps the Ghost MCP client; tests wrap an in-memory fake.
 */
export interface GhostClient {
  list<C extends GhostCollection>(
    collection: C,
    query?: ListQuery,
  ): Promise<GhostCollectionRow<C>[]>;

  get<C extends GhostCollection>(collection: C, id: UUID): Promise<GhostCollectionRow<C> | null>;

  insert<C extends GhostCollection>(
    collection: C,
    row: Omit<GhostCollectionRow<C>, "id" | "created_at" | "updated_at"> &
      Partial<Pick<GhostCollectionRow<C>, "id">>,
  ): Promise<GhostCollectionRow<C>>;

  update<C extends GhostCollection>(
    collection: C,
    id: UUID,
    patch: Partial<GhostCollectionRow<C>>,
  ): Promise<GhostCollectionRow<C>>;

  upsert<C extends GhostCollection>(
    collection: C,
    on: Partial<GhostCollectionRow<C>>,
    row: Partial<GhostCollectionRow<C>>,
  ): Promise<GhostCollectionRow<C>>;

  /**
   * Remove a single row by id. Used by the program_pages replace flow in
   * the scraping pipeline. Returns true if a row was removed, false if no
   * row with the given id existed (idempotent).
   */
  delete<C extends GhostCollection>(collection: C, id: UUID): Promise<boolean>;
}
