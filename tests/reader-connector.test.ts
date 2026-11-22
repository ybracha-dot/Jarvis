import { it, expect } from "vitest";
import path from "node:path";
import { tmpDataDir } from "./helpers";
import { closeDb, makeCtx } from "@/lib/db";
import { createReaderTestProject, readerTestState } from "@/lib/reader";
import { resultView } from "@/lib/assistant";

// The two field failures, through a REAL stdio connector process (the local connector) and a second client that reopens the saved result.
// Before the fix: "Print 400 programmes" (no count anywhere in the project) was accepted and Finished, and the accepted reading was reported as
// "A Claude chat has submitted a reading" with client null. Expected now: B is rejected with a specific reason and saves nothing; A is accepted; the state reports
// "through the local connector", the self-reported client name, no confirmation, and the quality of the saved reading as three separate facts.
it("local connector: an invented quantity is rejected, the supported reading is accepted, a second client reopens it, and the origin is reported as observed", async () => {
  closeDb("demo"); closeDb("personal"); const dir = tmpDataDir(); const tp = createReaderTestProject(makeCtx("demo")); closeDb("demo");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js"); const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const open = async (name: string) => { const c = new Client({ name, version: "1" }); await c.connect(new StdioClientTransport({ command: "npx", args: ["tsx", path.resolve("scripts/mcp-server.ts")], env: { ...(process.env as any), JARVIS_DATA_DIR: dir, JARVIS_MCP_MODE: "demo" } })); return c; };
  const call = async (c: any, name: string, args: any) => JSON.parse((await c.callTool({ name, arguments: args })).content[0].text);
  const c1 = await open("local-sdk-client");
  const g = await call(c1, "submit_goal", { text: "What does my team still owe? One row per open item with Owner, Next action and Blocker. Leave closed items out.", project: tp.project });
  const task = await call(c1, "get_reader_task", { requestId: g.requestId }); const sid = (s: string) => task.spans.find((x: any) => x.text.includes(s)).spanId;
  const make = (programmes: string) => ({ requestId: g.requestId, revision: task.revision, snapshot: task.snapshot, updates: [
    { ref: "u1", owner: "Ilse Brandt", action: "Set up the sound desk", status: "open", blocker: null, effective: "unblocked", confidence: "stated", quotes: [{ spanId: sid("sound desk is in Ilse Brandt's hands"), quote: "The sound desk is in Ilse Brandt's hands" }, { spanId: sid("power plan has arrived"), quote: "Ilse Brandt can set up the sound desk" }] },
    { ref: "u2", owner: "Mateus Oliveira", action: programmes, status: "open", blocker: null, effective: "new", confidence: "stated", quotes: [{ spanId: sid("Mateus Oliveira volunteered"), quote: "Mateus Oliveira volunteered to print the programmes" }] },
    { ref: "u3", owner: "Tobias Quist", action: "Book the stage lights", status: "done", blocker: null, effective: "completed", confidence: "stated", quotes: [{ spanId: sid("Tobias Quist booked"), quote: "Tobias Quist booked the stage lights this morning" }] },
    { ref: "u4", owner: null, action: "Sign off the stage barriers", status: "done", blocker: null, effective: "unchanged", confidence: "stated", quotes: [{ spanId: sid("stage barriers are already"), quote: "The stage barriers are already signed off" }] } ],
    coverage: task.spans.map((x: any) => { const ref = /sound desk|power plan|waiting for the venue/.test(x.text) ? "u1" : /Mateus/.test(x.text) ? "u2" : /Tobias/.test(x.text) ? "u3" : /barriers/.test(x.text) ? "u4" : null; return { spanId: x.spanId, role: ref ? "contributes" : "unrelated", refs: ref ? [ref] : [], reason: "accounts for an item" }; }) });
  const B = await call(c1, "submit_reader_result", make("Print 400 programmes"));
  expect(B.accepted).toBe(false); expect(B.reasons.join(" ")).toMatch(/“Print 400 programmes” says 400, but none of the passages you cited states 400 programmes for Mateus Oliveira/);
  let ctx = makeCtx("demo"); expect(JSON.stringify(resultView(ctx, g.resultId))).not.toMatch(/400/); expect(readerTestState(ctx)).toMatchObject({ toolAccepted: null, rejectedAttempts: 1 }); closeDb("demo");
  const A = await call(c1, "submit_reader_result", make("Print the programmes")); await c1.close(); expect(A).toMatchObject({ accepted: true, completion: "complete" });
  const c2 = await open("second-sdk-client"); const res = await call(c2, "get_result", { id: g.resultId }); await c2.close();
  expect(res.table.rows.map((r: any) => r.cells.join(" | "))).toEqual(["Ilse Brandt | Set up the sound desk | None reported", "Mateus Oliveira | Print the programmes | None reported"]); expect(res.ready).toBe(true); expect(res.status).toBe("Finished");
  ctx = makeCtx("demo"); const v: any = resultView(ctx, g.resultId); const st: any = readerTestState(ctx);
  expect(v.mode).toMatch(/^Reader submission: Reading accepted through the local connector\./); expect(v.analysis.reader).toMatchObject({ origin: "connector", transport: "stdio", client: "local-sdk-client 1" });
  expect(st.toolAccepted).toMatchObject({ origin: "connector", transport: "stdio", client: "local-sdk-client 1", viaConnector: true, label: expect.stringMatching(/^Reading accepted through the local connector\. The client reports itself as “local-sdk-client 1” \(self-reported\)\. That name looks like a test client\.$/) });
  expect(st.userConfirmed).toBeNull(); expect(st.reading).toMatchObject({ completion: "complete" }); expect(JSON.stringify(st)).not.toMatch(/A Claude chat has submitted/);
  require("node:fs").mkdirSync("/tmp/claude-0/readerfix", { recursive: true }); require("node:fs").writeFileSync("/tmp/claude-0/readerfix/after-fix.json", JSON.stringify({ B: { accepted: B.accepted, reasons: B.reasons }, A: { accepted: A.accepted, completion: A.completion }, rows: res.table.rows.map((r: any) => r.cells.join(" | ")), status: res.status, mode: v.mode, readerMeta: v.analysis.reader, state: { toolAccepted: st.toolAccepted, userConfirmed: st.userConfirmed, reading: st.reading?.completion } }, null, 2));
}, 180000);
