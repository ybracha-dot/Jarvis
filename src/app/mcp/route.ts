// Authenticated MCP connector over Streamable HTTP (stateless). Needs JARVIS_MCP_TOKEN. Without it this route is off.
// Loopback only unless JARVIS_MCP_ALLOWED_HOSTS lists the host you deploy behind. A localhost URL cannot serve Claude mobile.
import crypto from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServer } from "@/lib/mcp";
import { kick } from "@/lib/runner";
import { verifyToken, rateLimited } from "@/lib/mcp-auth";
import { get, makeCtx } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const deny = (status: number, msg: string) => Response.json({ jsonrpc: "2.0", error: { code: -32001, message: msg }, id: null }, { status, headers: { "www-authenticate": "Bearer" } });

async function handle(req: Request): Promise<Response> {
  const envToken = process.env.JARVIS_MCP_TOKEN;
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  const allowed = new Set(["127.0.0.1", "localhost", "[::1]", ...(process.env.JARVIS_MCP_ALLOWED_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean)]);
  if (!allowed.has(host)) return deny(403, `Host ${host} is not allowed`);
  const bearer = (req.headers.get("authorization") ?? "").startsWith("Bearer ") ? (req.headers.get("authorization") ?? "").slice(7) : "";
  // Either a token created in Jarvis (hashed, scoped, revocable) or the legacy environment token.
  let mode: "demo" | "personal"; let scopes: string[]; let rateKey: string;
  const stored = bearer ? verifyToken(bearer) : null;
  if (stored) { mode = stored.mode; scopes = stored.scopes; rateKey = stored.id; }
  else if (envToken && envToken.length >= 16 && bearer && safeEq(bearer, envToken)) { mode = process.env.JARVIS_MCP_MODE === "personal" ? "personal" : "demo"; scopes = ["read", "write"]; rateKey = "env"; }
  else if (!bearer && !(envToken && envToken.length >= 16) && !hasAnyToken()) return deny(503, "MCP over HTTP is off. Create a connector token in Jarvis (Connections) to enable it.");
  else return deny(401, "Missing, wrong, expired or revoked bearer token");
  if (rateLimited(rateKey)) return deny(429, "Too many requests. Slow down.");
  if (req.method !== "POST") return Response.json({ error: "Use POST" }, { status: 405 });
  const server = buildMcpServer(mode, (name) => { if (["save_to_jarvis", "submit_goal", "revise_goal", "resume_goal", "share_excerpt"].includes(name)) kick(mode); }, scopes);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}
function hasAnyToken() { try { return (["personal", "demo"] as const).some((m) => !!get(makeCtx(m).db, "SELECT 1 x FROM mcp_tokens WHERE revoked_at IS NULL LIMIT 1")); } catch { return false; } }
export { handle as POST, handle as GET, handle as DELETE };
