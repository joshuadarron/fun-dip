# Pipeline Contracts

Four pipelines, all defined in the RocketRide runtime. Each has a stable input/output contract that the app layer and other pipelines depend on. Internal composition (which nodes, which LLMs, prompt structure, fan-out) is left to the implementor. The contracts below are the hard edges.

## Global conventions

- All pipelines source from `webhook` except the chat pipeline, which may alternately source from `chat`. The invocation path is app layer to RocketRide SDK.
- All pipelines return JSON. No streaming responses except the chat pipeline's assistant reply (optional streaming via `response_answers` sink).
- Error shape across all pipelines: `{ status: "error", error: string, retryable: boolean, code?: string }`.
- MCP access to Ghost is available on every pipeline via an MCP client on the deep_agent_langchain node. Ghost is the state store. Do not keep state in pipeline memory.
- HTTP callbacks to the app layer are signed with HMAC-SHA256 over the raw request body using the shared secret. Header: `X-Fundip-Signature: sha256=<hex>`.

## Chat Pipeline

User-facing copilot. Owns chat memory read/write. Only pipeline with access to the other three as tools.

### Input

```ts
{
  user_id: string;
  profile_id: string;
  conversation_id: string;
  current_page: "dashboard" | "profile" | "programs" | "submissions";
  current_selection: { type: "program" | "submission" | "match"; id: string } | null;
  message: string;
}
```

### Output

```ts
{
  status: "ok";
  reply: string;
  conversation_id: string;
  tool_calls: Array<{
    tool: "profile" | "scraping" | "submissions";
    input: object;
    output: object;
  }>;
  surfaced: {
    pending_submissions?: string[]; // submission ids surfaced this turn
    new_matches?: string[];         // program_match ids surfaced this turn
  };
}
```

### Tools available (via `pipeline_as_tool`)

- `profile`: conversational profile updates. Chat extracts facts and calls this explicitly.
- `scraping` with `mode=match` **only**. Chat may not call `full_scrape`. Enforce at the tool-definition level.
- `submissions`: prefill or submit.

### Rules

- Read the last 20 messages from Ghost before each turn. Load `conversations.summary` as the older-context header. Load structured profile fields and any `status=awaiting_user_input` submissions tied to this profile.
- Write the user and assistant messages to Ghost after composing the reply.
- Every 20 new messages, update `conversations.summary`.
- Fact extraction is explicit. If the user states a persistable fact, invoke the profile pipeline as a tool. Never silently mutate profiles.
- On the submissions page with a selected submission in `awaiting_user_input`, bias toward resolving the missing fields in this turn.

## Profile Pipeline

Conversational profile construction and editing. Called by chat, or directly by the app for bulk import flows.

### Input

```ts
{
  profile_id: string;
  mode: "create" | "update" | "read";
  // For update:
  facts?: Array<{ field: string; value: unknown; source: "chat" | "import" }>;
  // For create/update, optional context to infer more from:
  context?: string;
}
```

### Output

```ts
{
  status: "ok";
  profile_id: string;
  delta: {
    fields_updated: string[];
    fields_added: string[];
    narrative_appended: boolean;
  };
  profile_summary: string; // short natural-language summary suitable for chat context
}
```

### Rules

- Writes to `profiles` and `profile_narratives` only.
- Never triggers scraping or submissions. Profile changes are observed by the app layer's cron, which decides whether to re-match.
- When `context` is supplied, the pipeline may infer fields not explicitly stated, but must record `source: "inferred"` and set lower confidence. Inferred fields are still user-visible; no hidden state.

## Scraping Pipeline

Two modes. Full scrape hits the web via Tinyfish and populates `programs`. Match evaluates a profile against the current `programs` collection and writes `program_matches`.

### Input

```ts
// Full scrape
{
  mode: "full_scrape";
  source_urls?: string[]; // defaults to configured known sources
}

// Match
{
  mode: "match";
  profile_id: string;
}
```

### Output

```ts
// Full scrape
{
  status: "ok";
  mode: "full_scrape";
  programs_added: number;
  programs_updated: number;
  pages_scraped: number;
}

// Match
{
  status: "ok";
  mode: "match";
  profile_id: string;
  matches: Array<{
    program_match_id: string;
    program_id: string;
    score: number;  // 0 to 100
    tier: "hot" | "warm" | "cold";
    positioning_summary: string; // 3 to 5 sentences
  }>;
}
```

### Rules

- `full_scrape` may only be invoked by the app layer's cron (Sunday). Not exposed to chat.
- `match` may be invoked by chat (as a tool) or by the app cron (post-scrape pass for every active profile).
- Writes in `match` mode: `program_matches` only.
- Writes in `full_scrape` mode: `programs` and `program_pages` only.
- Scoring and tiering logic lives inside the pipeline. 0-100 score, tier mapping per `GHOST_SCHEMA.md` (`>=75` hot, `40-74` warm, `<40` cold).
- After a successful match run triggered by cron, emit a `matches_ready` HTTP callback to the app layer so the digest composer knows to run.

### Callback: `matches_ready`

```http
POST /internal/callbacks/matches-ready
X-Fundip-Signature: sha256=<hex>
Content-Type: application/json

{
  "profile_id": "...",
  "match_count": 23,
  "max_tier": "hot"
}
```

## Submissions Pipeline

Pure function over (profile, program, provided_data). Idempotent. Retryable. Returns one of four states.

### Input

```ts
{
  profile_id: string;
  program_id: string;
  submission_id?: string;  // null for first invocation, present for continuation
  action: "prefill_only" | "submit";
  provided_data?: Record<string, unknown>; // user-supplied answers to prior missing_fields
}
```

### Output

```ts
// Prefill complete, nothing missing
{
  status: "prefilled";
  submission_id: string;
  prefilled_fields: Record<string, unknown>;
}

// Needs user input before submission is possible
{
  status: "needs_input";
  submission_id: string;
  missing_fields: Array<{
    field_name: string;
    description: string;
    type: "string" | "text" | "number" | "boolean" | "enum" | "file";
    enum_values?: string[];
  }>;
}

// Successfully submitted
{
  status: "submitted";
  submission_id: string;
  confirmation_ref: string | null;
}

// Error (retryable or terminal)
{
  status: "error";
  submission_id: string;
  error: string;
  retryable: boolean;
}
```

### Rules

- Reads from `profiles`, `programs`, `submissions` (if continuation), `profile_narratives` (for prose answers).
- Writes to `submissions` every invocation. Status transitions per `GHOST_SCHEMA.md`.
- Tinyfish `application` mode is called only when `action=submit` **and** no missing fields remain.
- Never calls chat pipeline. Never sends email. Emit callbacks for the app to act on.
- Idempotency: if a submission in `submitted` state is invoked again with `action=submit`, return the existing `submitted` result, do not resubmit.

### Callback: `submission_needs_input`

```http
POST /internal/callbacks/submission-needs-input
X-Fundip-Signature: sha256=<hex>
Content-Type: application/json

{
  "submission_id": "...",
  "profile_id": "...",
  "program_id": "...",
  "missing_fields": [ { "field_name": "...", "description": "...", "type": "..." } ]
}
```

### Callback: `submission_submitted`

```http
POST /internal/callbacks/submission-submitted
X-Fundip-Signature: sha256=<hex>
Content-Type: application/json

{
  "submission_id": "...",
  "profile_id": "...",
  "program_id": "...",
  "confirmation_ref": "..." | null
}
```

## Invocation matrix

| Caller | chat | profile | scraping (full) | scraping (match) | submissions |
|---|---|---|---|---|---|
| App API routes | yes | no | no | no | yes |
| App cron | no | no | **yes** | yes | no |
| Chat pipeline | N/A | yes | **no** | yes | yes |
| Profile pipeline | no | N/A | no | no | no |
| Scraping pipeline | no | no | N/A | N/A | no |
| Submissions pipeline | no | no | no | no | N/A |

Circular invocations are forbidden by design. The app layer is the only non-chat entry point.
