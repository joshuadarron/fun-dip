import type { UUID } from "@fundip/shared-types";
import type { GhostClient, GhostCollection, GhostCollectionRow, ListQuery } from "./client.js";

/**
 * MCP tool names exposed by the Ghost MCP server.
 *
 * ASSUMPTION: At the time of writing, the Ghost MCP server's tool names
 * are not documented in this repository. The names below are a
 * reasonable first pass, chosen so all five CRUD-shaped operations are
 * collection-agnostic (the collection is passed as an argument).
 *
 * If the real server uses different names (for example per-collection
 * names like `list_profiles`), update this one constants object and all
 * call sites follow.
 *
 * The returned shape from each tool is expected to be JSON in a single
 * text content block, which is how the MCP spec encodes structured
 * returns. We JSON-parse `content[0].text`.
 */
export const GHOST_MCP_TOOLS = {
  list: "list_records",
  get: "get_record",
  insert: "insert_record",
  update: "update_record",
  upsert: "upsert_record",
  delete: "delete_record",
} as const;

/**
 * Narrow surface of an MCP client. The real `@modelcontextprotocol/sdk`
 * Client exposes more; we only rely on `callTool`. Kept narrow so tests
 * can inject a stub and we are not bound to a specific SDK shape at the
 * type level. The real SDK is loaded lazily via `createGhostMcpClient`.
 */
export interface McpClientLike {
  callTool(request: { name: string; arguments?: Record<string, unknown> }): Promise<McpToolResult>;
  close?(): Promise<void>;
}

export interface McpToolResult {
  content: Array<{ type: "text"; text: string } | { type: string; [k: string]: unknown }>;
  isError?: boolean;
}

export interface GhostMcpClientConfig {
  url: string;
  token: string;
  /**
   * Override to inject a custom MCP client for tests or to use a different
   * transport. If omitted, the real `@modelcontextprotocol/sdk` is loaded
   * lazily via `loadDefaultMcpClient`.
   */
  transport?: McpClientLike;
}

/**
 * Build a GhostClient backed by the Ghost MCP server. Every `list/get/
 * insert/update/upsert` call is translated into a `callTool` invocation
 * on the MCP transport, with the collection name and any query args
 * passed in the tool arguments.
 *
 * See `GHOST_MCP_TOOLS` for the assumed tool names.
 */
export async function createGhostMcpClient(config: GhostMcpClientConfig): Promise<GhostClient> {
  const transport = config.transport ?? (await loadDefaultMcpClient(config));
  return wrapMcp(transport);
}

/**
 * Lazily load `@modelcontextprotocol/sdk` and return a connected
 * streamable-HTTP client. The module specifier is kept in a variable so
 * bundlers do not statically resolve it: this SDK is optional at this
 * layer, install it in the app that creates the MCP client.
 */
async function loadDefaultMcpClient(config: GhostMcpClientConfig): Promise<McpClientLike> {
  const clientModName = "@modelcontextprotocol/sdk/client/index.js";
  const transportModName = "@modelcontextprotocol/sdk/client/streamableHttp.js";
  let ClientCtor: new (info: { name: string; version: string }) => McpClientLike & {
    connect(transport: unknown): Promise<void>;
  };
  let TransportCtor: new (url: URL, opts?: { requestInit?: RequestInit }) => unknown;
  try {
    const clientMod = (await import(clientModName)) as {
      Client: typeof ClientCtor;
    };
    const transportMod = (await import(transportModName)) as {
      StreamableHTTPClientTransport: typeof TransportCtor;
    };
    ClientCtor = clientMod.Client;
    TransportCtor = transportMod.StreamableHTTPClientTransport;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to load "@modelcontextprotocol/sdk". Install it in the api, e.g. ` +
        `"pnpm --filter @fundip/api add @modelcontextprotocol/sdk". Original error: ${reason}`,
    );
  }
  const client = new ClientCtor({ name: "fundip-api", version: "0.0.0" });
  const transport = new TransportCtor(new URL(config.url), {
    requestInit: {
      headers: { Authorization: `Bearer ${config.token}` },
    },
  });
  await client.connect(transport);
  return client;
}

function wrapMcp(transport: McpClientLike): GhostClient {
  async function callJson<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await transport.callTool({ name, arguments: args });
    if (result.isError) {
      throw new Error(`Ghost MCP tool "${name}" returned error: ${stringifyContent(result)}`);
    }
    const first = result.content.find(
      (c): c is { type: "text"; text: string } => c.type === "text",
    );
    if (!first) {
      throw new Error(`Ghost MCP tool "${name}" returned no text content`);
    }
    try {
      return JSON.parse(first.text) as T;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Ghost MCP tool "${name}" returned non-JSON content: ${reason}`);
    }
  }

  return {
    async list<C extends GhostCollection>(
      collection: C,
      query?: ListQuery,
    ): Promise<GhostCollectionRow<C>[]> {
      return callJson<GhostCollectionRow<C>[]>(GHOST_MCP_TOOLS.list, {
        collection,
        filter: query?.filter ?? {},
        order_by: query?.orderBy ?? [],
        limit: query?.limit ?? null,
      });
    },

    async get<C extends GhostCollection>(
      collection: C,
      id: UUID,
    ): Promise<GhostCollectionRow<C> | null> {
      return callJson<GhostCollectionRow<C> | null>(GHOST_MCP_TOOLS.get, { collection, id });
    },

    async insert<C extends GhostCollection>(
      collection: C,
      row: Parameters<GhostClient["insert"]>[1],
    ): Promise<GhostCollectionRow<C>> {
      return callJson<GhostCollectionRow<C>>(GHOST_MCP_TOOLS.insert, { collection, row });
    },

    async update<C extends GhostCollection>(
      collection: C,
      id: UUID,
      patch: Partial<GhostCollectionRow<C>>,
    ): Promise<GhostCollectionRow<C>> {
      return callJson<GhostCollectionRow<C>>(GHOST_MCP_TOOLS.update, { collection, id, patch });
    },

    async upsert<C extends GhostCollection>(
      collection: C,
      on: Partial<GhostCollectionRow<C>>,
      row: Partial<GhostCollectionRow<C>>,
    ): Promise<GhostCollectionRow<C>> {
      return callJson<GhostCollectionRow<C>>(GHOST_MCP_TOOLS.upsert, { collection, on, row });
    },

    async delete<C extends GhostCollection>(collection: C, id: UUID): Promise<boolean> {
      const result = await callJson<{ deleted?: boolean } | boolean>(GHOST_MCP_TOOLS.delete, {
        collection,
        id,
      });
      if (typeof result === "boolean") return result;
      return result?.deleted ?? true;
    },
  };
}

function stringifyContent(result: McpToolResult): string {
  const texts = result.content.filter(
    (c): c is { type: "text"; text: string } => c.type === "text",
  );
  return texts.map((c) => c.text).join("\n") || JSON.stringify(result);
}
