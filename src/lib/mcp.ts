// The Jarvis MCP server, shared by the stdio script and the authenticated HTTP route.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeCtx, Mode } from "./db";
import { TOOLS } from "./agent";

export function buildMcpServer(mode: Mode, after?: (toolName: string) => void): McpServer {
  const server = new McpServer({ name: "jarvis", version: "0.2.0" });
  for (const t of TOOLS) {
    const shape = (t.schema as z.ZodObject<any>).shape ?? {};
    server.registerTool(t.name, { description: t.description + (t.mutating ? " (writes: bounded, user-scoped.)" : " (read only)"), inputSchema: shape }, async (args: any) => {
      const parsed = t.schema.safeParse(args ?? {});
      if (!parsed.success) return { isError: true, content: [{ type: "text" as const, text: "Invalid arguments" }] };
      const out = t.run(makeCtx(mode), parsed.data as never);
      after?.(t.name);
      return { content: [{ type: "text" as const, text: JSON.stringify(out) }] };
    });
  }
  return server;
}
