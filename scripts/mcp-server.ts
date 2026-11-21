/* Opt-in local MCP server for Claude Desktop or Claude Code. Transport: stdio.
   Run: npm run mcp  (reads the example workspace unless JARVIS_MCP_MODE=personal).
   For an authenticated HTTP connector see docs/SURFACES.md (the /mcp route, bearer token). */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcpServer } from "../src/lib/mcp";

const mode = process.env.JARVIS_MCP_MODE === "personal" ? "personal" : "demo";
await buildMcpServer(mode).connect(new StdioServerTransport());
