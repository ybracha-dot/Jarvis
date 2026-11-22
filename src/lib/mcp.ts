// The Jarvis MCP server, shared by the stdio script and the authenticated HTTP route.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { makeCtx, Mode } from "./db";
import { TOOLS } from "./agent";
import { currentClient, withClient } from "./client-context";

export function buildMcpServer(mode: Mode, after?: (toolName: string) => void, scopes: string[] = ["read", "write"], transport: "stdio" | "http" = "stdio"): McpServer {
  const server = new McpServer({ name: "jarvis", version: "0.2.0" });
  for (const t of TOOLS) {
    const shape = (t.schema as z.ZodObject<any>).shape ?? {};
    server.registerTool(t.name, { description: t.description + (t.mutating ? " (writes: bounded, user-scoped.)" : " (read only)"), inputSchema: shape }, async (args: any) => {
      const parsed = t.schema.safeParse(args ?? {});
      if (!parsed.success) return { isError: true, content: [{ type: "text" as const, text: "Invalid arguments" }] };
      if (t.mutating && !scopes.includes("write")) return { isError: true, content: [{ type: "text" as const, text: "This token is read-only. Create a token with write access to save." }] };
      // Who is calling, as the client reported itself at initialize (self-reported, never proof of an account), and over which transport.
      const ci = server.server.getClientVersion(); const base = currentClient(); const reported = base.client ?? (ci?.name ? `${String(ci.name).slice(0, 40)}${ci.version ? ` ${String(ci.version).slice(0, 20)}` : ""}` : null);
      const out = withClient({ client: reported, tokenLabel: base.tokenLabel, transport }, () => t.run(makeCtx(mode), parsed.data as never));
      after?.(t.name);
      return { content: [{ type: "text" as const, text: JSON.stringify(out) }] };
    });
  }
  return server;
}
