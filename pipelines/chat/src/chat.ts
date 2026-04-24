import type {
  ChatPipelineInput,
  ChatPipelineOutput,
  ChatSurfaced,
  Conversation,
  Message,
  PageContext,
  ProfileFact,
  ProfilePipelineInput,
  ProfilePipelineOutput,
  ScrapingMatchInput,
  ScrapingMatchOutput,
  Selection,
  Submission,
  SubmissionsPipelineInput,
  SubmissionsPipelineOutput,
  ToolCallRecord,
  UUID,
} from "@fundip/shared-types";

/**
 * Reference implementation of the chat pipeline orchestration.
 *
 * Mirrors the contract the deep agent in `pipeline.pipe` implements. The
 * RocketRide runtime owns the real execution (LLM, tool routing); this
 * function exists to:
 *
 * 1. Document the chat memory protocol, surfacing rules, fact extraction,
 *    and safety rails in executable form (see tests).
 * 2. Serve as a local harness for unit testing the chat pipeline without
 *    requiring a live RocketRide server, MCP server, or LLM access.
 *
 * Contract: see .claude/docs/PIPELINE_CONTRACTS.md and
 * pipelines/chat/AGENTS.md. Input/output types come from
 * @fundip/shared-types; do not widen them here.
 *
 * RAG over `conversation_embeddings` is intentionally NOT implemented in
 * this reference. The hook point is `loadOlderContext()` below: a future
 * extension can replace the conversations.summary read with a semantic
 * retrieval pass over conversation_embeddings, then assemble the same
 * LLM context shape. Optional per pipelines/chat/AGENTS.md.
 */

// ---- Dep contracts ---------------------------------------------------------

/** Narrow conversations repo surface the chat pipeline needs. */
export interface ChatConversationsRepo {
  upsertByUserId(userId: UUID, init?: { summary?: string }): Promise<Conversation>;
  updateSummary(id: UUID, summary: string): Promise<Conversation>;
}

/** Narrow messages repo surface the chat pipeline needs. */
export interface ChatMessagesRepo {
  listLastN(conversationId: UUID, n: number): Promise<Message[]>;
  append(input: {
    conversation_id: UUID;
    role: Message["role"];
    content: string;
    page_context: PageContext;
    selection_context: Selection | null;
    tool_calls: ToolCallRecord[] | null;
  }): Promise<Message>;
  countSinceSummaryUpdate(conversationId: UUID): Promise<number>;
}

/** Narrow submissions repo surface for surfacing pending input. */
export interface ChatSubmissionsRepo {
  listForProfile(profileId: UUID, status?: Submission["status"]): Promise<Submission[]>;
}

/**
 * Output of the agent step (LLM + extraction). The chat pipeline routes
 * this through tool wrappers and persistence; the agent is injected so
 * tests can stub a deterministic decision.
 */
export interface ChatAgentDecision {
  /** Composed natural-language reply for the user. */
  reply: string;
  /**
   * Profile facts the agent extracted from the current user message.
   * When non-empty, the pipeline calls the profile tool with mode='update'.
   */
  facts: ProfileFact[];
  /**
   * If the agent decided to call submissions on the user's behalf
   * (e.g. user said "apply" with a selected program, or supplied data
   * for an awaiting_user_input submission), the request is included
   * here. The pipeline routes it through the prefill or submit tool
   * based on `kind`.
   */
  submissions_request?:
    | {
        kind: "prefill";
        program_id: UUID;
        submission_id?: UUID;
        provided_data?: Record<string, unknown>;
      }
    | {
        kind: "submit";
        program_id: UUID;
        submission_id: UUID;
        provided_data?: Record<string, unknown>;
        /**
         * Verbatim phrase from the current-turn user message that the
         * agent treats as confirmation. The submit tool wrapper rejects
         * the call if this string does not appear (case-insensitive
         * substring) in the user message.
         */
        user_confirmation_phrase: string;
      };
  /**
   * If the agent wants to refresh matches for the current profile (e.g.
   * the user said "find new ones"), include this. The pipeline routes
   * it through the match-only scraping tool.
   */
  scraping_match_request?: {
    profile_id: UUID;
  };
  /**
   * Submission ids the agent surfaced to the user this turn. Persisted on
   * the assistant message's tool_calls hint so the next turn can avoid
   * re-surfacing the same items within the N=3 turn lookback window.
   */
  surfaced_pending_submission_ids: UUID[];
}

export interface ChatAgentContext {
  input: ChatPipelineInput;
  conversation: Conversation;
  history: Message[];
  /** Older-context header (rolling summary) loaded by `loadOlderContext`. */
  summary: string;
  /**
   * Submissions in awaiting_user_input that are CANDIDATES for surfacing
   * this turn (already filtered against the recent-mention window).
   */
  surfacing_candidates: Submission[];
}

export interface ChatAgent {
  decide(ctx: ChatAgentContext): Promise<ChatAgentDecision>;
}

/**
 * Tool wrappers around the three pipelines. Each wrapper enforces the
 * chat-side safety rails before delegating to the underlying invoker.
 */
export interface ChatTools {
  profile(input: ProfilePipelineInput): Promise<ProfilePipelineOutput>;
  /**
   * Match-only scraping wrapper. Mode is locked to 'match' and
   * emit_callback to false: the wrapper rejects (with a thrown error)
   * any input that violates these constraints.
   */
  scrapingMatch(input: ScrapingMatchInput): Promise<ScrapingMatchOutput>;
  /**
   * Submissions wrapper for the prefill path. Action is locked to
   * 'prefill_only'; the wrapper rejects 'submit'.
   */
  submissionsPrefill(input: SubmissionsPipelineInput): Promise<SubmissionsPipelineOutput>;
  /**
   * Submissions wrapper for the submit path. Requires an in-turn
   * confirmation phrase: `user_confirmation_phrase` must appear (case
   * insensitive substring) in the current-turn user message. Otherwise
   * the wrapper rejects.
   */
  submissionsSubmit(
    input: SubmissionsPipelineInput & { user_confirmation_phrase: string },
    context: { user_message: string },
  ): Promise<SubmissionsPipelineOutput>;
}

/** Cheap LLM call that compresses history into a rolling summary. */
export type Summarize = (messages: Message[]) => Promise<string>;

export interface ChatRunDeps {
  repos: {
    conversations: ChatConversationsRepo;
    messages: ChatMessagesRepo;
    submissions: ChatSubmissionsRepo;
  };
  agent: ChatAgent;
  tools: ChatTools;
  summarize: Summarize;
  /**
   * Optional. The reference impl reads conversations.summary directly. A
   * future RAG path can override this to retrieve semantically-relevant
   * older context from `conversation_embeddings`. See the docstring at
   * the top of this file for the hook description.
   */
  loadOlderContext?: (conversation: Conversation, history: Message[]) => Promise<string>;
}

// ---- Constants -------------------------------------------------------------

/** Last-N messages window per the chat memory contract. */
export const HISTORY_WINDOW = 20;

/** Regenerate the rolling summary every N new messages. */
export const SUMMARY_INTERVAL = 20;

/**
 * How many of the most recent assistant messages to scan for prior
 * surfacing of a given submission. Per pipelines/chat/AGENTS.md, N=3.
 */
export const SURFACE_LOOKBACK = 3;

// ---- Wrapper helpers (the chat-side safety rails) --------------------------

/**
 * Build a match-only scraping wrapper around an underlying invoker. The
 * wrapper rejects any input that does not declare mode='match' or that
 * tries to flip emit_callback to true. Use this in production wiring
 * where `runScrapingPipeline` accepts the full discriminated union.
 */
export function makeScrapingMatchWrapper(
  underlying: (input: ScrapingMatchInput) => Promise<ScrapingMatchOutput>,
): (input: ScrapingMatchInput) => Promise<ScrapingMatchOutput> {
  return async (input) => {
    if (input.mode !== "match") {
      throw new ChatToolRejection(
        "scraping_pipeline_match",
        "Chat may only invoke scraping in mode=match. full_scrape is cron-only.",
      );
    }
    if (input.emit_callback === true) {
      throw new ChatToolRejection(
        "scraping_pipeline_match",
        "Chat-driven match pass must not emit the matches_ready callback. " +
          "The chat reply path is synchronous and the digest email path is cron-driven.",
      );
    }
    // Force emit_callback=false defensively even when omitted.
    return underlying({
      mode: "match",
      profile_id: input.profile_id,
      emit_callback: false,
    });
  };
}

/**
 * Build a prefill-only submissions wrapper. Rejects action='submit'.
 */
export function makeSubmissionsPrefillWrapper(
  underlying: (input: SubmissionsPipelineInput) => Promise<SubmissionsPipelineOutput>,
): (input: SubmissionsPipelineInput) => Promise<SubmissionsPipelineOutput> {
  return async (input) => {
    if (input.action !== "prefill_only") {
      throw new ChatToolRejection(
        "submissions_pipeline_prefill",
        "submissions_pipeline_prefill is locked to action=prefill_only. " +
          "Use submissions_pipeline_submit (with explicit confirmation) for submit.",
      );
    }
    return underlying(input);
  };
}

/**
 * Build a submit submissions wrapper that enforces the in-turn
 * confirmation rule. The caller must supply the verbatim
 * `user_confirmation_phrase`; the wrapper rejects unless that phrase
 * appears (case-insensitive substring) inside the current-turn user
 * message.
 */
export function makeSubmissionsSubmitWrapper(
  underlying: (input: SubmissionsPipelineInput) => Promise<SubmissionsPipelineOutput>,
): (
  input: SubmissionsPipelineInput & { user_confirmation_phrase: string },
  context: { user_message: string },
) => Promise<SubmissionsPipelineOutput> {
  return async (input, context) => {
    if (input.action !== "submit") {
      throw new ChatToolRejection(
        "submissions_pipeline_submit",
        "submissions_pipeline_submit requires action=submit.",
      );
    }
    const phrase = (input.user_confirmation_phrase ?? "").trim().toLowerCase();
    const haystack = (context.user_message ?? "").toLowerCase();
    if (phrase.length < 3 || !haystack.includes(phrase)) {
      throw new ChatToolRejection(
        "submissions_pipeline_submit",
        "Refused: action=submit requires the user to confirm in the current turn. " +
          "user_confirmation_phrase must appear in the current user message.",
      );
    }
    const forwarded: SubmissionsPipelineInput = {
      profile_id: input.profile_id,
      program_id: input.program_id,
      action: "submit",
      ...(input.submission_id ? { submission_id: input.submission_id } : {}),
      ...(input.provided_data ? { provided_data: input.provided_data } : {}),
    };
    return underlying(forwarded);
  };
}

/** Thrown by the chat-side wrappers when a safety rail blocks a call. */
export class ChatToolRejection extends Error {
  readonly tool: string;
  constructor(tool: string, message: string) {
    super(`[${tool}] ${message}`);
    this.name = "ChatToolRejection";
    this.tool = tool;
  }
}

// ---- Surfacing logic --------------------------------------------------------

/**
 * Choose which awaiting_user_input submissions to surface this turn.
 * Excludes any submission whose id appears in the last
 * SURFACE_LOOKBACK assistant turns' tool_calls or the surfaced hint
 * persisted on those rows.
 */
export function pickSurfacingCandidates(pending: Submission[], history: Message[]): Submission[] {
  const recentlySurfaced = collectRecentlySurfacedIds(history, SURFACE_LOOKBACK);
  return pending.filter((s) => !recentlySurfaced.has(s.id));
}

function collectRecentlySurfacedIds(history: Message[], lookback: number): Set<UUID> {
  const ids = new Set<UUID>();
  // Scan most-recent assistant messages first.
  const assistant = history.filter((m) => m.role === "assistant");
  const recent = assistant.slice(-lookback);
  for (const msg of recent) {
    const calls = msg.tool_calls ?? [];
    for (const call of calls) {
      // `call.input` and `call.output` are flexible JSON; we do a defensive
      // dive looking for both submission_id and surfaced.pending_submissions.
      const fromInput = readSubmissionId(call.input);
      if (fromInput) ids.add(fromInput);
      const fromOutput = readSubmissionId(call.output);
      if (fromOutput) ids.add(fromOutput);
      const surfacedHint = readSurfacedHint(call.output);
      for (const id of surfacedHint) ids.add(id);
    }
    // Also tolerate a structured surfaced hint persisted on the assistant
    // message itself (out-of-band shape, included for robustness).
    const messageHint = (msg as unknown as { surfaced?: ChatSurfaced }).surfaced;
    if (messageHint?.pending_submissions) {
      for (const id of messageHint.pending_submissions) ids.add(id);
    }
  }
  return ids;
}

function readSubmissionId(record: unknown): UUID | null {
  if (!record || typeof record !== "object") return null;
  const obj = record as Record<string, unknown>;
  const candidate = obj.submission_id;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function readSurfacedHint(record: unknown): UUID[] {
  if (!record || typeof record !== "object") return [];
  const obj = record as Record<string, unknown>;
  const surfaced = obj.surfaced;
  if (!surfaced || typeof surfaced !== "object") return [];
  const pending = (surfaced as Record<string, unknown>).pending_submissions;
  if (!Array.isArray(pending)) return [];
  return pending.filter((id): id is string => typeof id === "string");
}

// ---- Entry point -----------------------------------------------------------

/**
 * Run the chat pipeline turn end-to-end.
 *
 * Order of operations (matches pipeline.pipe system prompt):
 * 1. Upsert conversations row for user_id.
 * 2. Load last 20 messages ascending and the rolling summary.
 * 3. Pull awaiting_user_input submissions for this profile, filter out
 *    anything surfaced in the last SURFACE_LOOKBACK turns.
 * 4. Delegate to the agent for reply + fact extraction + tool intent.
 * 5. Run any extracted profile facts through tools.profile.
 * 6. Run any submissions_request through the prefill or submit wrapper.
 * 7. Run any scraping_match_request through the match-only wrapper.
 * 8. Persist the user message.
 * 9. Persist the assistant message (with tool_calls + surfaced hints).
 * 10. If countSinceSummaryUpdate >= SUMMARY_INTERVAL, regenerate summary.
 * 11. Return the typed ChatPipelineOutput.
 */
export async function runChatPipeline(
  input: ChatPipelineInput,
  deps: ChatRunDeps,
): Promise<ChatPipelineOutput> {
  // --- 1. conversation row ----------------------------------------------
  const conversation = await deps.repos.conversations.upsertByUserId(input.user_id);

  // --- 2. load history + older-context header ---------------------------
  const historyDesc = await deps.repos.messages.listLastN(conversation.id, HISTORY_WINDOW);
  // listLastN returns DESC by created_at; the LLM context wants ASC.
  const history = [...historyDesc].reverse();
  const summary = deps.loadOlderContext
    ? await deps.loadOlderContext(conversation, history)
    : conversation.summary;

  // --- 3. surfacing candidates ------------------------------------------
  const pending = await deps.repos.submissions.listForProfile(
    input.profile_id,
    "awaiting_user_input",
  );
  const surfacing_candidates = pickSurfacingCandidates(pending, history);

  // --- 4. agent decision -------------------------------------------------
  const decision = await deps.agent.decide({
    input,
    conversation,
    history,
    summary,
    surfacing_candidates,
  });

  // --- 5..7. run tool calls in deterministic order ----------------------
  const tool_calls: ToolCallRecord[] = [];

  // 5. profile facts.
  if (decision.facts.length > 0) {
    const profileInput: ProfilePipelineInput = {
      profile_id: input.profile_id,
      mode: "update",
      facts: decision.facts,
    };
    const profileOutput = await deps.tools.profile(profileInput);
    tool_calls.push({
      tool: "profile",
      input: profileInput as unknown as Record<string, unknown>,
      output: profileOutput as unknown as Record<string, unknown>,
    });
  }

  // 6. submissions request.
  if (decision.submissions_request) {
    const req = decision.submissions_request;
    if (req.kind === "prefill") {
      const subInput: SubmissionsPipelineInput = {
        profile_id: input.profile_id,
        program_id: req.program_id,
        action: "prefill_only",
        ...(req.submission_id ? { submission_id: req.submission_id } : {}),
        ...(req.provided_data ? { provided_data: req.provided_data } : {}),
      };
      const subOutput = await deps.tools.submissionsPrefill(subInput);
      tool_calls.push({
        tool: "submissions",
        input: subInput as unknown as Record<string, unknown>,
        output: subOutput as unknown as Record<string, unknown>,
      });
    } else {
      // kind === "submit"
      const submitInput: SubmissionsPipelineInput & { user_confirmation_phrase: string } = {
        profile_id: input.profile_id,
        program_id: req.program_id,
        submission_id: req.submission_id,
        action: "submit",
        user_confirmation_phrase: req.user_confirmation_phrase,
        ...(req.provided_data ? { provided_data: req.provided_data } : {}),
      };
      const subOutput = await deps.tools.submissionsSubmit(submitInput, {
        user_message: input.message,
      });
      tool_calls.push({
        tool: "submissions",
        input: submitInput as unknown as Record<string, unknown>,
        output: subOutput as unknown as Record<string, unknown>,
      });
    }
  }

  // 7. scraping match request.
  if (decision.scraping_match_request) {
    const scrapeInput: ScrapingMatchInput = {
      mode: "match",
      profile_id: decision.scraping_match_request.profile_id,
      emit_callback: false,
    };
    const scrapeOutput = await deps.tools.scrapingMatch(scrapeInput);
    tool_calls.push({
      tool: "scraping",
      input: scrapeInput as unknown as Record<string, unknown>,
      output: scrapeOutput as unknown as Record<string, unknown>,
    });
  }

  // --- 8. persist user message ------------------------------------------
  await deps.repos.messages.append({
    conversation_id: conversation.id,
    role: "user",
    content: input.message,
    page_context: input.current_page,
    selection_context: input.current_selection,
    tool_calls: null,
  });

  // --- surfacing hint embedded in tool_calls so the next turn can detect it.
  // We store the surfaced ids both on the dedicated `surfaced` field of
  // the output and as a synthetic tool_calls entry on the persisted
  // assistant row. The synthetic entry uses a non-pipeline `tool` value
  // would violate the typed shape, so we put the hint INSIDE one of the
  // real tool outputs when present, else encode it as a separate
  // book-keeping record on the assistant row's tool_calls. To stay typed,
  // we do not push a fake ToolCallRecord; we rely on the structured
  // search of `surfaced.pending_submissions` inside real tool outputs and
  // the `messages.tool_calls` scan above. To make detection robust when
  // no tools were called, persist the surfaced ids inside `tool_calls`
  // ONLY if a tool was called this turn; otherwise the surfaced hint
  // lives on the message row through a standalone "surfaced-only"
  // record. Because ToolCallRecord requires tool ∈ pipeline names, we
  // attach the hint to the FIRST real tool call's output when one exists,
  // and otherwise encode it as a profile-tool-shaped audit record only
  // when the agent actually called profile (avoids polluting outputs
  // with synthetic data).
  const surfaced: ChatSurfaced = {
    pending_submissions: decision.surfaced_pending_submission_ids,
  };

  // Decorate the first tool_call with a surfaced hint so the next turn's
  // recently-surfaced scan sees it. Only mutate when there is a tool_call
  // to attach to; otherwise rely on the standalone `surfaced_pending`
  // field below.
  if (tool_calls.length > 0 && surfaced.pending_submissions?.length) {
    const first = tool_calls[0]!;
    first.output = {
      ...first.output,
      surfaced: {
        ...(typeof first.output.surfaced === "object" && first.output.surfaced !== null
          ? (first.output.surfaced as Record<string, unknown>)
          : {}),
        pending_submissions: [...surfaced.pending_submissions],
      },
    };
  }

  // Persist the assistant row. tool_calls is null when no tools fired
  // AND no surfaced ids exist; otherwise we write the array (possibly
  // augmented with a standalone "chat-surfaced" record so that next-turn
  // scans pick it up even without tool invocations).
  let assistantToolCalls: ToolCallRecord[] | null = tool_calls.length > 0 ? tool_calls : null;
  if (
    !assistantToolCalls &&
    surfaced.pending_submissions &&
    surfaced.pending_submissions.length > 0
  ) {
    // No real tool call, but we surfaced something. Persist a synthetic
    // submissions-shaped record whose output carries the surfaced hint.
    // input is the empty object; the next-turn scan only looks at output
    // for `surfaced.pending_submissions`, which is a stable shape.
    assistantToolCalls = [
      {
        tool: "submissions",
        input: { kind: "surface_only" },
        output: {
          surfaced: {
            pending_submissions: [...surfaced.pending_submissions],
          },
        },
      },
    ];
  }

  await deps.repos.messages.append({
    conversation_id: conversation.id,
    role: "assistant",
    content: decision.reply,
    page_context: input.current_page,
    selection_context: input.current_selection,
    tool_calls: assistantToolCalls,
  });

  // --- 10. summary regeneration -----------------------------------------
  const newCount = await deps.repos.messages.countSinceSummaryUpdate(conversation.id);
  if (newCount >= SUMMARY_INTERVAL) {
    const fresh = await deps.repos.messages.listLastN(conversation.id, HISTORY_WINDOW * 2);
    // listLastN returns desc; pass ascending into summarize for legibility.
    const ordered = [...fresh].reverse();
    const next = await deps.summarize(ordered);
    await deps.repos.conversations.updateSummary(conversation.id, next);
  }

  // --- 11. return -------------------------------------------------------
  return {
    status: "ok",
    reply: decision.reply,
    conversation_id: conversation.id,
    tool_calls,
    surfaced,
  };
}
