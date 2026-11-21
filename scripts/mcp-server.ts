/* Opt-in local MCP server for Claude Desktop or Claude Code. Transport: stdio. Typed read tools and one bounded proposal tool.
   Run: npm run mcp  (it reads the example workspace unless JARVIS_MCP_MODE=personal).
   A localhost server cannot serve Claude mobile. A remote MCP deployment needs authentication and is not built here. See docs/SURFACES.md. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { makeCtx } from "../src/lib/db";
import { TOOLS } from "../src/lib/agent";

const mode = process.env.JARVIS_MCP_MODE === "personal" ? "personal" : "demo";
const server = new McpServer({ name: "jarvis", version: "0.1.0" });
for (const t of TOOLS) {
  const shape = (t.schema as z.ZodObject<any>).shape ?? {};
  server.registerTool(t.name, { description: t.description + (t.mutating ? " (bounded: creates a proposal the user must review.)" : " (read only)"), inputSchema: shape }, async (args: any) => {
    const parsed = t.schema.safeParse(args ?? {});
    if (!parsed.success) return { isError: true, content: [{ type: "text" as const, text: "Invalid arguments" }] };
    const out = t.run(makeCtx(mode), parsed.data as never);
    return { content: [{ type: "text" as const, text: JSON.stringify(out) }] };
  });
}
await server.connect(new StdioServerTransport());
