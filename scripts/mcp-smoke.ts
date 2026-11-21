/* Smoke test for an authorized Jarvis MCP connector over HTTP.
   Usage: npm run mcp:smoke -- <https://host/mcp> <bearer token>
   It saves one clearly synthetic capture, replays it to prove deduplication, and recalls it. It sends nothing anywhere else.
   Undo the capture afterwards from Office → Receipt → Undo, or ignore it in the example workspace. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [url, token] = process.argv.slice(2);
if (!url || !token) { console.error("Usage: npm run mcp:smoke -- <url> <token>"); process.exit(2); }
const client = new Client({ name: "jarvis-smoke", version: "1" });
await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
const call = async (name: string, args: unknown) => JSON.parse(((await client.callTool({ name, arguments: args as any })) as any).content[0].text);
const tools = (await client.listTools()).tools.map((t) => t.name);
const must = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exit(1); } console.log("ok  ", m); };
must(tools.includes("save_to_jarvis") && tools.includes("recall_from_jarvis"), `tools listed: ${tools.join(", ")}`);
const text = "Remember for Jarvis: I owe the smoke-test team two checks by Friday.";
const a = await call("save_to_jarvis", { text, synthetic: true, dedupKey: "mcp-smoke-1" });
must(a.id && a.deepLink, `saved ${a.id} -> ${a.deepLink}`);
const b = await call("save_to_jarvis", { text, synthetic: true, dedupKey: "mcp-smoke-1" });
must(b.duplicate === true && b.id === a.id, "replay was deduplicated");
const r = await call("recall_from_jarvis", { query: "smoke-test team" });
must(r.items.length > 0, `recalled ${r.items.length} item(s)`);
await client.close();
console.log("MCP smoke test passed. This proves the connector path, not any Claude account.");
