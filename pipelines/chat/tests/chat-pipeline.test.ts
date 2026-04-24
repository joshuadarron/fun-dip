import type {
  ChatPipelineInput,
  Conversation,
  Message,
  ProfileFact,
  ProfilePipelineOutput,
  ScrapingMatchInput,
  ScrapingMatchOutput,
  Submission,
  SubmissionsPipelineInput,
  SubmissionsPipelineOutput,
  UUID,
} from "@fundip/shared-types";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ChatToolRejection,
  HISTORY_WINDOW,
  SUMMARY_INTERVAL,
  makeScrapingMatchWrapper,
  makeSubmissionsPrefillWrapper,
  makeSubmissionsSubmitWrapper,
  pickSurfacingCandidates,
  runChatPipeline,
  type ChatAgent,
  type ChatAgentContext,
  type ChatAgentDecision,
  type ChatConversationsRepo,
  type ChatMessagesRepo,
  type ChatRunDeps,
  type ChatSubmissionsRepo,
  type ChatTools,
  type Summarize,
} from "../src/chat.js";

/**
 * These tests exercise the chat-pipeline LOGIC, not the RocketRide runtime.
 * The deep agent in `pipeline.pipe` implements the same rules the reference
 * `runChatPipeline` does. Running the real pipeline would need RocketRide
 * creds, a Ghost MCP server, and the other three pipelines. Unit tests
 * inject a deterministic agent and tool stubs.
 */

// ---- In-memory store -------------------------------------------------------

interface Store {
  conversations: Map<UUID, Conversation>;
  conversationsByUser: Map<UUID, UUID>;
  messages: Message[];
  submissions: Map<UUID, Submission>;
}

function newStore(): Store {
  return {
    conversations: new Map(),
    conversationsByUser: new Map(),
    messages: [],
    submissions: new Map(),
  };
}

let monoSeq = 0;
function nextMonoTimestamp(): string {
  // Monotonic increasing timestamps so list ordering is deterministic
  // across rapid-fire inserts in tests AND so message timestamps line
  // up with conversation updated_at on the same scale (no real-clock
  // races between the two).
  monoSeq += 1;
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);
  return new Date(base + monoSeq * 1000).toISOString();
}

function makeConversationsRepo(store: Store): ChatConversationsRepo {
  return {
    async upsertByUserId(userId, init) {
      const existingId = store.conversationsByUser.get(userId);
      if (existingId) {
        const existing = store.conversations.get(existingId);
        if (existing) return { ...existing };
      }
      const id = randomUUID();
      const now = nextMonoTimestamp();
      const row: Conversation = {
        id,
        user_id: userId,
        summary: init?.summary ?? "",
        created_at: now,
        updated_at: now,
      };
      store.conversations.set(id, row);
      store.conversationsByUser.set(userId, id);
      return { ...row };
    },
    async updateSummary(id, summary) {
      const existing = store.conversations.get(id);
      if (!existing) throw new Error(`conversation ${id} not found`);
      const next: Conversation = {
        ...existing,
        summary,
        updated_at: nextMonoTimestamp(),
      };
      store.conversations.set(id, next);
      return { ...next };
    },
  };
}

function nextMessageTimestamp(): string {
  return nextMonoTimestamp();
}

function makeMessagesRepo(store: Store): ChatMessagesRepo {
  return {
    async listLastN(conversationId, n) {
      const all = store.messages
        .filter((m) => m.conversation_id === conversationId)
        .slice()
        .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
      // Last N (newest) returned in desc order to match the production repo.
      const lastN = all.slice(-n);
      return lastN
        .slice()
        .reverse()
        .map((m) => ({ ...m }));
    },
    async append(input) {
      const row: Message = {
        id: randomUUID(),
        conversation_id: input.conversation_id,
        role: input.role,
        content: input.content,
        page_context: input.page_context,
        selection_context: input.selection_context,
        tool_calls: input.tool_calls,
        created_at: nextMessageTimestamp(),
      };
      store.messages.push(row);
      return { ...row };
    },
    async countSinceSummaryUpdate(conversationId) {
      const conversation = store.conversations.get(conversationId);
      if (!conversation) {
        return store.messages.filter((m) => m.conversation_id === conversationId).length;
      }
      return store.messages.filter(
        (m) => m.conversation_id === conversationId && m.created_at > conversation.updated_at,
      ).length;
    },
  };
}

function makeSubmissionsRepo(store: Store): ChatSubmissionsRepo {
  return {
    async listForProfile(profileId, status) {
      const out: Submission[] = [];
      for (const row of store.submissions.values()) {
        if (row.profile_id !== profileId) continue;
        if (status && row.status !== status) continue;
        out.push({ ...row });
      }
      return out;
    },
  };
}

// ---- Tool spies ------------------------------------------------------------

interface ToolSpies {
  profile: ReturnType<typeof vi.fn>;
  scrapingMatch: ReturnType<typeof vi.fn>;
  submissionsPrefill: ReturnType<typeof vi.fn>;
  submissionsSubmit: ReturnType<typeof vi.fn>;
}

function makeTools(overrides: Partial<ChatTools> = {}): { tools: ChatTools; spies: ToolSpies } {
  const profileSpy = vi.fn(
    overrides.profile ??
      ((async () => ({
        status: "ok",
        profile_id: "p1",
        delta: { fields_updated: [], fields_added: [], narrative_appended: false },
        profile_summary: "summary",
      })) as ChatTools["profile"]),
  );
  const scrapingSpy = vi.fn(
    overrides.scrapingMatch ??
      ((async (input: ScrapingMatchInput): Promise<ScrapingMatchOutput> => ({
        status: "ok",
        mode: "match",
        profile_id: input.profile_id,
        matches: [],
      })) as ChatTools["scrapingMatch"]),
  );
  const prefillSpy = vi.fn(
    overrides.submissionsPrefill ??
      ((async (input: SubmissionsPipelineInput): Promise<SubmissionsPipelineOutput> => ({
        status: "prefilled",
        submission_id: input.submission_id ?? "sub-prefilled",
        prefilled_fields: { ok: true },
      })) as ChatTools["submissionsPrefill"]),
  );
  const submitSpy = vi.fn(
    overrides.submissionsSubmit ??
      ((async (
        input: SubmissionsPipelineInput & { user_confirmation_phrase: string },
      ): Promise<SubmissionsPipelineOutput> => ({
        status: "submitted",
        submission_id: input.submission_id ?? "sub-submitted",
        confirmation_ref: "CONF-1",
      })) as ChatTools["submissionsSubmit"]),
  );
  const tools: ChatTools = {
    profile: profileSpy as unknown as ChatTools["profile"],
    scrapingMatch: scrapingSpy as unknown as ChatTools["scrapingMatch"],
    submissionsPrefill: prefillSpy as unknown as ChatTools["submissionsPrefill"],
    submissionsSubmit: submitSpy as unknown as ChatTools["submissionsSubmit"],
  };
  return {
    tools,
    spies: {
      profile: profileSpy,
      scrapingMatch: scrapingSpy,
      submissionsPrefill: prefillSpy,
      submissionsSubmit: submitSpy,
    },
  };
}

// ---- Agent stub ------------------------------------------------------------

function makeAgent(producer: (ctx: ChatAgentContext) => ChatAgentDecision): ChatAgent {
  return {
    async decide(ctx) {
      return producer(ctx);
    },
  };
}

// ---- Setup helper ----------------------------------------------------------

interface SetupOptions {
  agent?: ChatAgent;
  tools?: Partial<ChatTools>;
  summarize?: Summarize;
}

function setup(opts: SetupOptions = {}) {
  const store = newStore();
  const conversations = makeConversationsRepo(store);
  const messages = makeMessagesRepo(store);
  const submissions = makeSubmissionsRepo(store);
  const { tools, spies } = makeTools(opts.tools);
  const summarize = vi.fn<Summarize>(
    opts.summarize ?? (async (msgs) => `summary of ${msgs.length} msgs`),
  );
  const agent =
    opts.agent ??
    makeAgent(() => ({
      reply: "ok",
      facts: [],
      surfaced_pending_submission_ids: [],
    }));
  const deps: ChatRunDeps = {
    repos: { conversations, messages, submissions },
    agent,
    tools,
    summarize: summarize as unknown as Summarize,
  };
  return { store, deps, spies, summarize };
}

// ---- Fixtures --------------------------------------------------------------

function baseInput(overrides: Partial<ChatPipelineInput> = {}): ChatPipelineInput {
  return {
    user_id: overrides.user_id ?? "user-1",
    profile_id: overrides.profile_id ?? "p1",
    conversation_id: overrides.conversation_id ?? "c1",
    current_page: overrides.current_page ?? "dashboard",
    current_selection:
      overrides.current_selection === undefined ? null : overrides.current_selection,
    message: overrides.message ?? "hi",
  };
}

function awaitingSubmission(profileId: UUID, programId: UUID, id?: UUID): Submission {
  const now = new Date().toISOString();
  return {
    id: id ?? randomUUID(),
    profile_id: profileId,
    program_id: programId,
    program_match_id: null,
    status: "awaiting_user_input",
    prefilled_fields: {},
    missing_fields: [
      { field_name: "team_size", description: "Current FT team size", type: "number" },
    ],
    provided_data: {},
    submitted_at: null,
    confirmation_ref: null,
    response_text: null,
    error: null,
    created_at: now,
    updated_at: now,
  };
}

// ---- Tests ----------------------------------------------------------------

describe("runChatPipeline", () => {
  it("turn with no tool calls: writes user + assistant messages, leaves summary untouched", async () => {
    const { deps, store, spies, summarize } = setup({
      agent: makeAgent(() => ({
        reply: "Hello back.",
        facts: [],
        surfaced_pending_submission_ids: [],
      })),
    });
    const input = baseInput({ message: "Hello" });
    const out = await runChatPipeline(input, deps);

    expect(out.status).toBe("ok");
    expect(out.reply).toBe("Hello back.");
    expect(out.tool_calls).toEqual([]);
    expect(out.surfaced).toEqual({ pending_submissions: [] });
    expect(spies.profile).not.toHaveBeenCalled();
    expect(spies.scrapingMatch).not.toHaveBeenCalled();
    expect(spies.submissionsPrefill).not.toHaveBeenCalled();
    expect(spies.submissionsSubmit).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();

    // Two messages persisted, in order.
    const persisted = store.messages.filter((m) => m.role === "user" || m.role === "assistant");
    expect(persisted.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(persisted[0]!.content).toBe("Hello");
    expect(persisted[1]!.content).toBe("Hello back.");

    // Conversation summary unchanged (default empty).
    const conversationId = persisted[0]!.conversation_id;
    expect(store.conversations.get(conversationId)?.summary).toBe("");
  });

  it("extracts facts and calls profile tool with mode=update", async () => {
    const facts: ProfileFact[] = [{ field: "stage", value: "seed", source: "chat" }];
    const { deps, spies } = setup({
      agent: makeAgent(() => ({
        reply: "Got it: you raised your seed round.",
        facts,
        surfaced_pending_submission_ids: [],
      })),
      tools: {
        profile: vi.fn(
          async (): Promise<ProfilePipelineOutput> => ({
            status: "ok",
            profile_id: "p1",
            delta: { fields_updated: ["stage"], fields_added: [], narrative_appended: true },
            profile_summary: "Seed-stage startup.",
          }),
        ) as unknown as ChatTools["profile"],
      },
    });
    const out = await runChatPipeline(
      baseInput({ message: "We just raised our seed round.", current_page: "profile" }),
      deps,
    );

    expect(spies.profile).toHaveBeenCalledTimes(1);
    expect(spies.profile).toHaveBeenCalledWith({
      profile_id: "p1",
      mode: "update",
      facts,
    });
    expect(out.tool_calls).toHaveLength(1);
    expect(out.tool_calls[0]!.tool).toBe("profile");
    expect(out.tool_calls[0]!.input).toMatchObject({ mode: "update" });
  });

  it("on /programs with a selected program, 'apply' triggers submissions prefill_only with correct ids", async () => {
    const programId = "prog-42";
    const { deps, spies } = setup({
      agent: makeAgent((ctx) => {
        const sel = ctx.input.current_selection;
        if (sel?.type === "program") {
          return {
            reply: `Starting prefill for ${sel.id}.`,
            facts: [],
            surfaced_pending_submission_ids: [],
            submissions_request: { kind: "prefill", program_id: sel.id },
          };
        }
        return { reply: "?", facts: [], surfaced_pending_submission_ids: [] };
      }),
    });
    const out = await runChatPipeline(
      baseInput({
        current_page: "programs",
        current_selection: { type: "program", id: programId },
        message: "apply",
      }),
      deps,
    );

    expect(spies.submissionsPrefill).toHaveBeenCalledTimes(1);
    expect(spies.submissionsPrefill).toHaveBeenCalledWith({
      profile_id: "p1",
      program_id: programId,
      action: "prefill_only",
    });
    expect(spies.submissionsSubmit).not.toHaveBeenCalled();
    const call = out.tool_calls.find((c) => c.tool === "submissions");
    expect(call).toBeTruthy();
    expect(call?.input).toMatchObject({ action: "prefill_only", program_id: programId });
  });

  it("on /submissions with awaiting_user_input selected, supplied data routes through prefill (resume)", async () => {
    const programId = "prog-99";
    const submissionId = "sub-99";
    const { deps, spies } = setup({
      agent: makeAgent((ctx) => {
        const sel = ctx.input.current_selection;
        if (sel?.type === "submission") {
          return {
            reply: "Got it, refreshing your application.",
            facts: [],
            surfaced_pending_submission_ids: [],
            submissions_request: {
              kind: "prefill",
              program_id: programId,
              submission_id: sel.id,
              provided_data: { team_size: 5 },
            },
          };
        }
        return { reply: "?", facts: [], surfaced_pending_submission_ids: [] };
      }),
    });

    const out = await runChatPipeline(
      baseInput({
        current_page: "submissions",
        current_selection: { type: "submission", id: submissionId },
        message: "team_size is 5",
      }),
      deps,
    );

    expect(spies.submissionsPrefill).toHaveBeenCalledWith({
      profile_id: "p1",
      program_id: programId,
      submission_id: submissionId,
      action: "prefill_only",
      provided_data: { team_size: 5 },
    });
    expect(spies.submissionsSubmit).not.toHaveBeenCalled();
    const call = out.tool_calls.find((c) => c.tool === "submissions");
    expect(call?.input).toMatchObject({
      submission_id: submissionId,
      provided_data: { team_size: 5 },
    });
  });

  it("21st new message turn triggers summary regeneration via summarize() and writes back", async () => {
    const { deps, store, summarize } = setup({
      agent: makeAgent(() => ({
        reply: "ack",
        facts: [],
        surfaced_pending_submission_ids: [],
      })),
    });

    // Each runChatPipeline call appends one user + one assistant message
    // (= 2 new messages per turn). The contract says regenerate the
    // rolling summary every SUMMARY_INTERVAL=20 new messages. So:
    //  - 9 turns (= 18 new messages): summarize NOT called yet.
    //  - 10th turn (= 20 new messages): threshold reached, summarize fires.
    const turnsBelowThreshold = (SUMMARY_INTERVAL - 2) / 2; // 9
    for (let i = 0; i < turnsBelowThreshold; i += 1) {
      await runChatPipeline(baseInput({ message: `m${i}` }), deps);
    }
    expect(summarize).not.toHaveBeenCalled();

    // The 10th turn pushes the count to 20, which equals the threshold.
    await runChatPipeline(baseInput({ message: "m9" }), deps);
    expect(summarize).toHaveBeenCalledTimes(1);

    const conversationId = [...store.conversations.keys()][0]!;
    const conversation = store.conversations.get(conversationId)!;
    expect(conversation.summary.length).toBeGreaterThan(0);
    expect(conversation.summary).toMatch(/summary of/);
  });

  it("safety: agent attempts action=submit without in-turn confirmation -> wrapper rejects", async () => {
    const submitWrapper = makeSubmissionsSubmitWrapper(async () => ({
      status: "submitted",
      submission_id: "sub",
      confirmation_ref: "CONF",
    }));
    await expect(
      submitWrapper(
        {
          profile_id: "p1",
          program_id: "prog-1",
          submission_id: "sub-1",
          action: "submit",
          user_confirmation_phrase: "yes submit",
        },
        { user_message: "I think we should apply now." },
      ),
    ).rejects.toBeInstanceOf(ChatToolRejection);
    // Sanity: same call passes when the phrase appears in the user message.
    await expect(
      submitWrapper(
        {
          profile_id: "p1",
          program_id: "prog-1",
          submission_id: "sub-1",
          action: "submit",
          user_confirmation_phrase: "yes submit",
        },
        { user_message: "yes submit it now please" },
      ),
    ).resolves.toMatchObject({ status: "submitted" });
  });

  it("safety: agent attempts scraping mode=full_scrape -> wrapper rejects", async () => {
    const wrapper = makeScrapingMatchWrapper(async () => ({
      status: "ok",
      mode: "match",
      profile_id: "p1",
      matches: [],
    }));
    // Force a payload with mode=full_scrape via cast: the wrapper exists
    // precisely to defend against this.
    await expect(
      wrapper({ mode: "full_scrape" } as unknown as ScrapingMatchInput),
    ).rejects.toBeInstanceOf(ChatToolRejection);
    // And rejects emit_callback=true.
    await expect(
      wrapper({ mode: "match", profile_id: "p1", emit_callback: true }),
    ).rejects.toBeInstanceOf(ChatToolRejection);
  });

  it("submissions prefill wrapper rejects action=submit", async () => {
    const wrapper = makeSubmissionsPrefillWrapper(async () => ({
      status: "prefilled",
      submission_id: "sub",
      prefilled_fields: {},
    }));
    await expect(
      wrapper({ profile_id: "p1", program_id: "prog-1", action: "submit" }),
    ).rejects.toBeInstanceOf(ChatToolRejection);
  });

  it("surfacing: pending submissions appear in surfaced.pending_submissions and persist in tool_calls hint", async () => {
    const profileId = "p1";
    const sub = awaitingSubmission(profileId, "prog-7");
    const { deps, store } = setup({
      agent: makeAgent((ctx) => {
        const ids = ctx.surfacing_candidates.map((s) => s.id);
        return {
          reply: ids.length ? `You have ${ids.length} pending applications.` : "ok",
          facts: [],
          surfaced_pending_submission_ids: ids,
        };
      }),
    });
    store.submissions.set(sub.id, sub);

    const out1 = await runChatPipeline(baseInput({ profile_id: profileId }), deps);
    expect(out1.surfaced.pending_submissions).toEqual([sub.id]);

    // Subsequent turn within the lookback window should NOT re-surface.
    const out2 = await runChatPipeline(baseInput({ profile_id: profileId }), deps);
    expect(out2.surfaced.pending_submissions).toEqual([]);
  });
});

describe("pickSurfacingCandidates", () => {
  it("excludes submissions whose id appears in the last 3 assistant tool_calls", async () => {
    const profileId = "p1";
    const sub = awaitingSubmission(profileId, "prog-7", "submission-X");
    const earlier: Message = {
      id: "m1",
      conversation_id: "c1",
      role: "assistant",
      content: "...",
      page_context: "submissions",
      selection_context: null,
      tool_calls: [
        {
          tool: "submissions",
          input: { submission_id: "submission-X" },
          output: { status: "needs_input", submission_id: "submission-X", missing_fields: [] },
        },
      ],
      created_at: "2026-01-01T00:00:00Z",
    };
    const filtered = pickSurfacingCandidates([sub], [earlier]);
    expect(filtered).toEqual([]);
  });

  it("includes submissions whose id is older than the lookback window", async () => {
    const profileId = "p1";
    const sub = awaitingSubmission(profileId, "prog-7", "submission-Y");
    // Four assistant turns; the mention is on the oldest, lookback=3.
    const oldHistory: Message[] = [
      {
        id: "m0",
        conversation_id: "c1",
        role: "assistant",
        content: "first surface",
        page_context: "submissions",
        selection_context: null,
        tool_calls: [
          {
            tool: "submissions",
            input: { kind: "surface_only" },
            output: { surfaced: { pending_submissions: ["submission-Y"] } },
          },
        ],
        created_at: "2026-01-01T00:00:00Z",
      },
      ...(["m1", "m2", "m3"].map(
        (id, i): Message => ({
          id,
          conversation_id: "c1",
          role: "assistant",
          content: "...",
          page_context: "dashboard",
          selection_context: null,
          tool_calls: null,
          created_at: `2026-01-0${2 + i}T00:00:00Z`,
        }),
      ) satisfies Message[]),
    ];
    const filtered = pickSurfacingCandidates([sub], oldHistory);
    expect(filtered.map((s) => s.id)).toEqual(["submission-Y"]);
  });
});

describe("HISTORY_WINDOW", () => {
  it("is 20 per the chat memory contract", () => {
    expect(HISTORY_WINDOW).toBe(20);
  });
});
