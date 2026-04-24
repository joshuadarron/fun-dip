# Ghost Schema

Two logical stores behind the Ghost MCP server. All runtime writes go through the MCP client on the agent node. All frontend reads go through Wondergraph. Direct profile form edits are the only case where the frontend writes (via Wondergraph mutations).

**Read this first**: before finalizing any collection shape, inspect the existing frontend components on Dashboard, Profile, Programs, and Submissions pages. If a component already expects a field shape, match it. Do not invent a schema the frontend cannot consume.

## Structured store

### profiles

One row per startup. Source of truth for all structured profile facts.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK to auth user, unique |
| `startup_name` | string | |
| `stage` | enum | `idea`, `pre_seed`, `seed`, `series_a`, `series_b_plus` |
| `location` | string | Free text, city/region. |
| `market` | string | |
| `goals` | string[] | Free-form tags the user selected or entered. |
| `looking_for` | enum[] | `increase_mrr`, `technology_pea`, `investors`, `incubator`. Extensible. |
| `narrative` | text | Long-form description built conversationally. |
| `updated_at` | timestamp | |
| `created_at` | timestamp | |

Write owners: profile pipeline (conversational), frontend via Wondergraph (direct form edits).
Indexes: `user_id` unique, `updated_at`.

### programs

One row per funding program discovered by scraping. Global, not per-profile.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `source_url` | string | |
| `name` | string | |
| `provider` | string | Incubator/investor/grant body name. |
| `description` | text | |
| `requirements` | text | Structured-ish requirements, extracted by LLM. |
| `apply_method` | enum | `form`, `email`, `website_info_only` |
| `apply_url` | string \| null | If `apply_method=form`. |
| `deadline` | timestamp \| null | |
| `stage_fit` | enum[] | Stages this program suits. |
| `market_fit` | string[] | Markets/verticals. |
| `geo_scope` | string[] | Locations it accepts applicants from. |
| `last_scraped_at` | timestamp | |
| `first_seen_at` | timestamp | |

Write owner: scraping pipeline only.
Indexes: `source_url` unique, `last_scraped_at`, `deadline`.

### program_matches

One row per (profile, program) pair that the match logic evaluated. Per-profile match state, not per-program.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `profile_id` | uuid | FK profiles |
| `program_id` | uuid | FK programs |
| `score` | integer | 0 to 100 |
| `tier` | enum | Derived from score. `hot` >= 75, `warm` 40-74, `cold` < 40. Stored for query efficiency. |
| `positioning_summary` | text | 3 to 5 sentences describing how the profile fits. Generated at match time. Used in digest email. |
| `status` | enum | `new`, `surfaced`, `dismissed`, `interested`, `applied` |
| `rationale` | text | LLM-written explanation of fit. |
| `matched_at` | timestamp | |

Write owner: scraping pipeline (mode=match) creates rows. Chat pipeline and submissions pipeline update `status`.
Indexes: `(profile_id, program_id)` unique, `(profile_id, status)`, `(profile_id, score DESC)`.

### submissions

One row per application attempt (draft, pending input, submitted, etc.). Driven by the submissions pipeline state machine.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `profile_id` | uuid | FK profiles |
| `program_id` | uuid | FK programs |
| `program_match_id` | uuid \| null | FK program_matches when originated from a match. |
| `status` | enum | `draft`, `prefilled`, `awaiting_user_input`, `ready`, `submitting`, `submitted`, `awaiting_program_response`, `accepted`, `rejected`, `error` |
| `prefilled_fields` | jsonb | Generated form payload. Full payload, not the summary. |
| `missing_fields` | jsonb | Array of `{field_name, description, type}`. Populated when status is `awaiting_user_input`. |
| `provided_data` | jsonb | User-supplied answers to missing fields, accumulated across turns. |
| `submitted_at` | timestamp \| null | |
| `confirmation_ref` | string \| null | Reference id returned by the program. |
| `response_text` | text \| null | Populated if/when an email parser (v2) finds a response. |
| `error` | text \| null | Last error message. |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

Write owner: submissions pipeline. Frontend may update `status` (e.g., user dismisses a draft).
Indexes: `(profile_id, status)`, `(profile_id, program_id)`, `updated_at`.

### conversations

One row per user. Single-threaded conversation history. Chat context (last 20 turns plus rolling summary) is computed at read time by the chat pipeline.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | unique |
| `summary` | text | Rolling summary of turns older than the last 20. Updated every 20 turns. |
| `updated_at` | timestamp | |
| `created_at` | timestamp | |

### messages

Append-only log of chat turns. One row per message (user or assistant).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `conversation_id` | uuid | FK conversations |
| `role` | enum | `user`, `assistant` |
| `content` | text | |
| `page_context` | enum | `dashboard`, `profile`, `programs`, `submissions` |
| `selection_context` | jsonb \| null | `{type, id}` if the user had something selected. |
| `tool_calls` | jsonb \| null | If assistant turn called pipeline-as-tool, record the calls and results. |
| `created_at` | timestamp | |

Write owner: chat pipeline only.
Indexes: `(conversation_id, created_at DESC)`.

## Qualitative / vector store

Used for RAG, long-term memory, and scraped page content. Not queried by the frontend directly.

### program_pages

Raw and parsed content from scraped program pages, chunked and embedded.

| Field | Type |
|---|---|
| `id` | uuid |
| `program_id` | uuid \| null (null during initial scrape, backfilled once program row exists) |
| `source_url` | string |
| `chunk_index` | integer |
| `text` | text |
| `embedding` | vector |
| `scraped_at` | timestamp |

Write owner: scraping pipeline.

### profile_narratives

Longer-form conversational context behind a profile's structured fields. Useful for the submissions pipeline when generating prose answers to open-ended form questions.

| Field | Type |
|---|---|
| `id` | uuid |
| `profile_id` | uuid |
| `text` | text |
| `embedding` | vector |
| `source_message_id` | uuid \| null |
| `created_at` | timestamp |

Write owner: profile pipeline.

### conversation_embeddings

Chunked and embedded message history for semantic retrieval across long conversations. Complements the last-20-turns window.

| Field | Type |
|---|---|
| `id` | uuid |
| `conversation_id` | uuid |
| `message_id` | uuid |
| `text` | text |
| `embedding` | vector |
| `created_at` | timestamp |

Write owner: chat pipeline.

## Ownership summary

| Collection | Primary writer | Secondary writers |
|---|---|---|
| profiles | profile pipeline | frontend (direct edits via WG) |
| programs | scraping pipeline | none |
| program_matches | scraping pipeline (create) | chat pipeline, submissions pipeline (status updates) |
| submissions | submissions pipeline | frontend (status `draft` -> `dismissed`) |
| conversations | chat pipeline | none |
| messages | chat pipeline | none |
| program_pages | scraping pipeline | none |
| profile_narratives | profile pipeline | none |
| conversation_embeddings | chat pipeline | none |

## Notes for Claude

- Ghost's MCP interface determines the actual query/mutation shape. This document is the logical schema. Implementation-side, expose Wondergraph types that mirror these, and read the frontend component prop shapes before finalizing.
- `tier` on `program_matches` is denormalized from `score` for query efficiency. If computing on the fly is cheap in Wondergraph, drop it.
- No cascading deletes defined. Submissions pipeline must handle the case where a program row is deleted between prefill and submit (unlikely, but cheap to guard).
- All timestamps UTC.
