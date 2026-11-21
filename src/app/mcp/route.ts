// Authenticated MCP connector over Streamable HTTP (stateless). Needs JARVIS_MCP_TOKEN. Without it this route is off.
// Loopback only unless JARVIS_MCP_ALLOWED_HOSTS lists the host you deploy behind. A localhost URL cannot serve Claude mobile.
import crypto from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServer } from "@/lib/mcp";
import { kick } from "@/lib/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const deny = (status: number, msg: string) => Response.json({ jsonrpc: "2.0", error: { code: -32001, message: msg }, id: null }, { status, headers: { "www-authenticate": "Bearer" } });

async function handle(req: Request): Promise<Response> {
  const token = process.env.JARVIS_MCP_TOKEN;
  if (!token || token.length < 16) return deny(503, "MCP over HTTP is off. Set JARVIS_MCP_TOKEN (16+ characters) to enable it.");
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  const allowed = new Set(["127.0.0.1", "localhost", "[::1]", ...(process.env.JARVIS_MCP_ALLOWED_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean)]);
  if (!allowed.has(host)) return deny(403, `Host ${host} is not allowed`);
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !safeEq(auth.slice(7), token)) return deny(401, "Missing or wrong bearer token");
  if (req.method !== "POST") return Response.json({ error: "Use POST" }, { status: 405 });
  const mode = process.env.JARVIS_MCP_MODE === "personal" ? "personal" : "demo";
  const server = buildMcpServer(mode, (name) => { if (name === "save_to_jarvis") kick(mode); });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}
export { handle as POST, handle as GET, handle as DELETE };
