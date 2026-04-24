# AGENTS.md: Profile Pipeline

Builds and edits startup profiles conversationally. Called by the chat pipeline as a tool, or directly by the app layer for bulk imports.

## Contract

See `.claude/docs/PIPELINE_CONTRACTS.md` for the full I/O spec. Summary:

- Input: `{ profile_id, mode: "create" | "update" | "read", facts?, context? }`
- Output: `{ status, profile_id, delta, profile_summary }`

## Required components

- `deep_agent_langchain` node with MCP client wired to Ghost MCP server. Deep agent is mandatory per project-wide constraint, but if the complexity of this pipeline does not warrant heavy agentic orchestration, use the deep agent minimally (as a single-step extractor + writer) and let deterministic nodes do the rest.

## Writes to Ghost

- `profiles`: structured fields only. Use MCP mutations.
- `profile_narratives`: long-form conversational context, chunked and embedded. One narrative row per distinct conversational episode that contributed to the profile.

Do not write to any other collection. Profile pipeline is a narrow surface.

## Behavior by mode

### `create`
- Initialize a `profiles` row if not exists. Called when a new user signs up and hits onboarding.
- `context` is the onboarding chat transcript or import data.
- Extract whatever is extractable; leave blanks blank. Do not fabricate.

### `update`
- Apply `facts` to the profile row. Each fact has a `field`, `value`, and `source`.
- For fields that already have values, prefer the new value but record the prior in the narrative (for auditability).
- If `context` is supplied in addition to `facts`, the pipeline may infer additional fields from context but must mark them `source: "inferred"` internally and bias conservatively.

### `read`
- Return the current profile summary only. No writes. Cheap call used by chat to warm context.

## Inferred vs stated

When the user says "we're based in Chicago", that's stated. When the user says "our target customers are mid-market banks" and you infer `market=fintech`, that's inferred. Inferred fields are allowed, but:

- Never overwrite a stated field with an inferred value.
- Record the inference in the narrative so the user sees it the next time the profile surfaces in chat.
- Bias toward low-confidence inference. When in doubt, ask the chat pipeline to ask the user (via `delta` hints that chat can surface next turn).

## Profile summary

The `profile_summary` returned on every invocation is a short natural-language description (one to two paragraphs) that other pipelines (notably submissions) use as concise context. Regenerate it on every update. Keep it factual, no marketing prose, no em-dashes.

## No cross-pipeline side effects

- Does not trigger scraping. If the profile changes materially (stage, market, looking_for), the app layer's cron observes this and decides whether to re-match. Do not call scraping from here.
- Does not trigger notifications. Profile updates are silent unless the chat pipeline surfaces them.

## Latitude

- Model selection is yours.
- Fan-out or batch handling for multi-fact updates is yours.
- Embedding model for `profile_narratives` is your call, but keep it consistent across the project (same embedding model across `profile_narratives`, `program_pages`, `conversation_embeddings`).

## Tests to include

- Create with empty context. Returns an empty profile. No hallucinated fields.
- Update with a single stated fact. Verifies field written and narrative appended.
- Update that would overwrite a stated field with an inferred value. Verifies stated value preserved.
- Read after 5 updates. Verifies summary reflects current state.
