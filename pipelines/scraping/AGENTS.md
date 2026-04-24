# AGENTS.md: Scraping Pipeline

Two modes. `full_scrape` hits the web via Tinyfish and populates the global `programs` collection. `match` evaluates one profile against the current `programs` collection and writes `program_matches`.

## Contract

See `.claude/docs/PIPELINE_CONTRACTS.md` for the full I/O spec.

## Required components

- `deep_agent_langchain` node with MCP client wired to Ghost MCP server.
- `tool_tinyfish` in `online_browse` mode: used in `full_scrape` mode only. Not loaded in the `match` path.

## Mode gating

The single pipeline branches on `mode` at the top. Two fully distinct execution paths:

### `full_scrape` path

1. Resolve source URLs: either provided in input, or from a configured list of known funding-program directories and program pages.
2. For each source URL, invoke Tinyfish `online_browse` to fetch and parse. Handle JS rendering, auth walls (skip if required), multi-step navigation.
3. For each program discovered:
   - Extract structured fields per `GHOST_SCHEMA.md` `programs` shape.
   - Upsert into `programs` by `source_url`.
   - Chunk and embed the page content into `program_pages`.
4. Return `{ programs_added, programs_updated, pages_scraped }`.

**Do not** run matching here. Matching is a separate invocation per profile, fired by the cron loop after the scrape completes.

### `match` path

1. Read the profile from Ghost (structured fields + narrative summary).
2. Read candidate programs from Ghost. Pre-filter on obvious disqualifiers (stage_fit, geo_scope) with structured queries before LLM scoring, otherwise you will score irrelevant rows.
3. For each candidate, compute a 0-100 score and a 3 to 5 sentence positioning summary.
4. Derive tier from score (`>=75` hot, `40-74` warm, `<40` cold).
5. Upsert `program_matches` rows. One row per (profile, program) pair. If a row exists for this pair, update score, tier, and positioning_summary, and reset status to `new` only if the prior status was `new` or `surfaced` (preserve `dismissed`, `interested`, `applied`).
6. After writing, emit the `matches_ready` callback to the app layer.
7. Return the list of `program_match_ids` that are new or materially changed.

## Match scoring guidance

The score is yours to define internally, but the shape is fixed: integer 0 to 100, higher is better fit. Reasonable signals:

- Stage alignment (stage_fit vs profile.stage)
- Geo alignment (geo_scope vs profile.location)
- Market alignment (market_fit vs profile.market)
- Goal alignment (program description vs profile.looking_for and profile.goals)
- Deadline proximity (penalize expired, small boost for imminent)

LLM-as-judge is fine for the soft signals. Hard signals (geo, stage) should be deterministic filters before LLM scoring to save tokens.

## Writes to Ghost

- `full_scrape`: `programs` (upsert), `program_pages` (insert/replace for re-scraped URLs).
- `match`: `program_matches` (upsert).

Never write to other collections.

## Callback

On successful `match` invocation triggered by cron (not by chat), emit `matches_ready` to the app layer. The app decides whether to compose and send a digest.

When invoked by chat (tool call), the pipeline still does the work and writes matches. Chat reads the returned match list directly and surfaces it in the reply. No callback in the chat path, because chat is synchronous and the user is right there.

How to distinguish cron from chat: include an optional `emit_callback: boolean` in the input (default true when cron invokes, false when chat does). Chat's tool wrapper sets it to false.

## Latitude

- Model selection, fan-out, chunking strategy, and re-ranking approach are yours.
- The source URL list can start small and grow. Keep it configurable in the app layer, not hardcoded in the pipeline.
- You may add a per-program "freshness" check to skip re-scraping pages modified recently.

## Tests to include

- `full_scrape` with two known source URLs. Verifies programs upserted and pages embedded.
- `full_scrape` re-run. Verifies updates, not duplicates.
- `match` for a profile with sparse fields. Verifies pipeline does not fabricate high scores.
- `match` for a profile with a rich profile. Verifies reasonable tier distribution.
- `match` re-run where a prior match was `dismissed`. Verifies status preserved, score updated.
- `match` invocation with `emit_callback: false`. Verifies no callback fired.
