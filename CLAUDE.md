# Fundip

Entry point for Claude Code. Imports the root orientation inline; read the PRD docs on demand per the read order in `AGENTS.md`.

@AGENTS.md

## Requirements / PRD

Canonical spec lives in `.claude/docs/`. Treat these as the build contract, not suggestions:

- `.claude/docs/ARCHITECTURE.md` — layers, data flow, weekly + submission cycles.
- `.claude/docs/GHOST_SCHEMA.md` — collections, fields, ownership, indexes.
- `.claude/docs/PIPELINE_CONTRACTS.md` — pipeline I/O, callbacks, invocation matrix.

## Per-pipeline specs

- `pipelines/chat/AGENTS.md`
- `pipelines/profile/AGENTS.md`
- `pipelines/scraping/AGENTS.md`
- `pipelines/submissions/AGENTS.md`

Before editing a pipeline, read its `AGENTS.md` and `.claude/docs/PIPELINE_CONTRACTS.md`.

## Working rules

- PRD changes require human sign-off. Do not edit `.claude/docs/*.md` without explicit instruction.
- Any conflict between PRD and existing frontend scaffold: flag, do not silently diverge.
- Non-negotiable tech choices in `AGENTS.md` are fixed. Raise concerns before substituting.
