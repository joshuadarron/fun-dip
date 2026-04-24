import { describe, expect, it, vi } from "vitest";
import { GHOST_MCP_TOOLS, createGhostMcpClient, type McpClientLike } from "./mcp.js";

function mkTransport(handler: (name: string, args: Record<string, unknown>) => unknown): {
  transport: McpClientLike;
  callTool: ReturnType<typeof vi.fn>;
} {
  const callTool = vi.fn(async (req: { name: string; arguments?: Record<string, unknown> }) => {
    const result = handler(req.name, req.arguments ?? {});
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  });
  return { transport: { callTool }, callTool };
}

describe("createGhostMcpClient", () => {
  it("translates list() into a list_records tool call with the collection and filter", async () => {
    const { transport, callTool } = mkTransport((_name, args) => {
      expect(args.collection).toBe("profiles");
      return [{ id: "p1", user_id: "u1" }];
    });
    const client = await createGhostMcpClient({
      url: "https://ghost.invalid",
      token: "t",
      transport,
    });
    const rows = await client.list("profiles", { filter: { user_id: "u1" }, limit: 1 });
    expect(rows).toEqual([{ id: "p1", user_id: "u1" }]);
    expect(callTool).toHaveBeenCalledWith({
      name: GHOST_MCP_TOOLS.list,
      arguments: {
        collection: "profiles",
        filter: { user_id: "u1" },
        order_by: [],
        limit: 1,
      },
    });
  });

  it("parses a JSON content block returned by get()", async () => {
    const row = { id: "p1", user_id: "u1", startup_name: "Acme" };
    const { transport } = mkTransport(() => row);
    const client = await createGhostMcpClient({
      url: "https://ghost.invalid",
      token: "t",
      transport,
    });
    const got = await client.get("profiles", "p1");
    expect(got).toEqual(row);
  });

  it("throws on isError=true results", async () => {
    const errTransport: McpClientLike = {
      callTool: vi.fn(async () => ({
        isError: true,
        content: [{ type: "text" as const, text: "not found" }],
      })),
    };
    const client = await createGhostMcpClient({
      url: "https://ghost.invalid",
      token: "t",
      transport: errTransport,
    });
    await expect(client.get("profiles", "missing")).rejects.toThrow(/not found/);
  });

  it("routes update() and upsert() to their tool names with the expected args", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const transport: McpClientLike = {
      callTool: vi.fn(async ({ name, arguments: args = {} }) => {
        calls.push({ name, args });
        return { content: [{ type: "text" as const, text: JSON.stringify({ id: "p1" }) }] };
      }),
    };
    const client = await createGhostMcpClient({
      url: "https://ghost.invalid",
      token: "t",
      transport,
    });
    await client.update("profiles", "p1", { market: "fintech" });
    await client.upsert("profiles", { user_id: "u1" }, { market: "fintech" });

    expect(calls[0]).toEqual({
      name: GHOST_MCP_TOOLS.update,
      args: { collection: "profiles", id: "p1", patch: { market: "fintech" } },
    });
    expect(calls[1]).toEqual({
      name: GHOST_MCP_TOOLS.upsert,
      args: {
        collection: "profiles",
        on: { user_id: "u1" },
        row: { market: "fintech" },
      },
    });
  });
});
