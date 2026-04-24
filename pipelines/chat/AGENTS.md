# AGENTS.md: Chat Pipeline

User-facing copilot. Persistent on the right side of every page in the app. Runs on every user message.

## Contract

See `.claude/docs/PIPELINE_CONTRACTS.md` for the full I/O spec. Summary:

- Input: `{ user_id, profile_id, conversation_id, current_page, current_selection, message }`
- Output: `{ status, reply, conversation_id, tool_calls, surfaced }`

Source node: `chat` or `webhook`. Either works, implementor's call.

## Required components

- `deep_agent_langchain` node with MCP client wired to Ghost MCP server.
- Three tools exposed to the agent via `pipeline_as_tool`:
  - `profile_pipeline`: full access
  - `scraping_pipeline`: **`mode=match` only**. Do not expose a generic tool that could be called with `mode=full_scrape`. Wrap it with a schema that fixes `mode` to `"match"`.
  - `submissions_pipeline`: full access

## Memory handling (hard requirement)

Chat memory lives in Ghost, not in the agent node. Every invocation:

1. Read `conversations` row for `user_id` to get the rolling `summary`.
2. Read the last 20 `messages` for this `conversation_id`, ordered ascending.
3. Assemble the LLM context: `summary` as system-level older-context header, then 20 messages, then the new user message.
4. Before returning, append the user message and the assistant reply to `messages`.
5. If the message count since last summary update exceeds 20, regenerate the summary (cheap model is fine) and write it back.

No Wave memory tool. No pipeline-side caching of conversations.

## Contextual behavior by page

- **Dashboard**: orientation. Answer status questions, nudge toward pending actions. No mutations unless the user explicitly asks.
- **Profile**: biased toward profile construction. If the user states facts, extract and call the profile pipeline. If profile fields are sparse, proactively ask for the biggest gaps (stage, market, looking_for are highest leverage).
- **Programs**: biased toward match explanation and submission initiation. With a selected program, "apply" is unambiguous. Without one, ask which.
- **Submissions**: biased toward resolving missing fields. With a selected submission in `awaiting_user_input`, attempt to resolve its `missing_fields` this turn. The user's answers become `provided_data` on the next submissions pipeline invocation.

## Fact extraction

Explicit, not inferred silently. When the user states a persistable fact ("we just raised our seed round", "we're in Chicago", "we're targeting B2B fintech"), call the profile pipeline with the extracted fact. The profile pipeline decides whether to accept, update, or narrative-append.

Do **not** include a "silent profile update" path. Every profile change must be observable in `tool_calls`.

## Surfacing pending submissions

At the start of each turn, check Ghost for `submissions` with `status=awaiting_user_input` tied to `profile_id`. If any exist and have not been surfaced in the last N turns (N = 3 is a reasonable default), surface them in `surfaced.pending_submissions` and mention them in the reply.

## Safety rails

- Never invoke `scraping_pipeline` with `mode=full_scrape`. Tool definition must prevent this.
- Never call the submissions pipeline with `action=submit` without explicit user confirmation in the current turn. Prefill is fine without confirmation; actual submission is not.
- Never mutate profiles silently. Always through the profile pipeline tool.
- If the agent emits a reply that includes newly discovered facts about the startup, those facts must be committed via the profile pipeline within the same turn. Do not defer.

## Latitude

Model selection is yours. Orchestration shape inside the deep_agent graph is yours. RAG over `conversation_embeddings` for very long conversations is optional and your call. Streaming the reply back through `response_answers` is optional.

## Tests to include

- Turn with no tool calls. Pure conversational reply. Reads and writes memory correctly.
- Turn that triggers profile update. Verifies the profile pipeline was called with extracted facts.
- Turn on the Programs page with a selected program, user says "apply". Verifies submissions pipeline invoked with `action=prefill_only` and correct ids.
- Turn on the Submissions page with a submission in `awaiting_user_input`. User provides the missing data. Verifies re-invocation with `action=submit` and the provided_data merged correctly.
- 21st message turn. Verifies summary regeneration and write-back.
