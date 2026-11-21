/* End-to-end journey through the real UI with Playwright. Run: npm run e2e  (builds are not required when E2E_URL is set).
   Uses its own temporary data directory unless E2E_URL points at a running server. */
import { chromium, type Browser, type Page, type BrowserContext } from "playwright";
import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const SHOTS = path.resolve("docs/screenshots");
const PORT = Number(process.env.E2E_PORT ?? 3101);
let base = process.env.E2E_URL ?? `http://127.0.0.1:${PORT}`;
let server: ChildProcess | null = null;
let dataDir: string | null = null;
let worker: ChildProcess | null = null;
const stopWorker = (sig: NodeJS.Signals = "SIGKILL") => { if (worker?.pid) { try { process.kill(-worker.pid, sig); } catch { /* gone */ } } worker = null; };
function startWorker(pace: number) {
  if (!dataDir) return;
  stopWorker();
  worker = spawn("npx", ["tsx", "scripts/worker.ts"], { env: { ...process.env, JARVIS_DATA_DIR: dataDir, JARVIS_JOB_PACE_MS: String(pace), JARVIS_JOB_LEASE_MS: "3000" }, stdio: "ignore", detached: true });
}
function killServer() { stopWorker(); if (server?.pid) { try { process.kill(-server.pid, "SIGTERM"); } catch { /* already gone */ } } }
const problems: string[] = [];
const steps: string[] = [];
let pass = 0;

function ok(cond: unknown, msg: string) { if (!cond) { problems.push(`ASSERT FAILED: ${msg}`); console.log(`  FAIL ${msg}`); } else { pass++; console.log(`  ok   ${msg}`); } }
const step = (s: string) => { steps.push(s); console.log(`\n# ${s}`); };

async function startServer() {
  if (process.env.E2E_URL) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-e2e-")); dataDir = dir;
  server = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(PORT)], { env: { ...process.env, JARVIS_DATA_DIR: dir, JARVIS_INAPP_RUNNER: "0" }, stdio: "ignore", detached: true });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch { /* waiting */ } await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("Server did not start. Run npm run build first.");
}

function watch(page: Page, label: string) {
  page.on("console", (m) => { if (m.type() === "error") { const t = m.text(); if (!/favicon/.test(t) && !problems.includes(`console(${label}): ${t}`)) problems.push(`console(${label}): ${t}`); } });
  page.on("pageerror", (e) => problems.push(`pageerror(${label}): ${e.message}`));
  page.on("requestfailed", (r) => { if (!/_next\/webpack-hmr|\.map$/.test(r.url()) && !/ERR_ABORTED/.test(r.failure()?.errorText ?? "")) problems.push(`requestfailed(${label}): ${r.url()} ${r.failure()?.errorText}`); });
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/__expect")) problems.push(`http ${r.status()}(${label}): ${r.request().method()} ${r.url()}`); });
}
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, name), fullPage: false });
const post = (p: string, body: unknown) => fetch(`${base}/api${p}`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(body) });

async function journeyDesktop(ctx: BrowserContext) {
  const page = await ctx.newPage(); watch(page, "desktop");
  await post("/demo/reset", { confirm: "RESET DEMO" });
  await page.goto(base + "/");
  await page.waitForSelector("[data-testid=primary-action]");

  step("Today before the update");
  ok(await page.getByTestId("workspace-badge").innerText().then((t) => /EXAMPLE WORKSPACE/.test(t)), "example workspace is labeled");
  ok((await page.getByTestId("decision-card").count()) === 0, "no decisions before the update");
  await shot(page, "01-today-desktop.png");

  step("Replay update");
  await page.getByTestId("replay-update").click();
  await page.getByTestId("decision-card").first().waitFor();
  ok((await page.getByTestId("decision-card").count()) === 1, "exactly one decision after replay");
  ok(/Moved up 2 days/.test(await page.getByTestId("decision-card").first().innerText()), "decision says Moved up 2 days");
  const changesText = await page.getByTestId("changes").innerText();
  ok(/Moved up 2 days/.test(changesText), "change appears under Changes this week");
  ok((await page.getByTestId("changes").locator(":scope > li").count()) === 1, "exactly one updated assignment in Changes");

  step("Replay twice changes nothing");
  await page.getByTestId("replay-update").click();
  await page.getByTestId("replay-result").filter({ hasText: "Nothing new" }).waitFor();
  ok((await page.getByTestId("decision-card").count()) === 1, "still exactly one decision");
  const tasks = await (await fetch(`${base}/api/tasks`)).json();
  ok(tasks.tasks.filter((t: any) => t.external_id === "essay-2").length === 1, "exactly one Essay 2 task");

  step("Inspect evidence in the drawer");
  await page.getByTestId("decision-card").first().click();
  await page.getByRole("dialog").waitFor();
  const drawer = page.getByRole("dialog");
  await drawer.getByTestId("plan-chunks").waitFor();
  ok(/now due Wednesday, November 18/.test(await drawer.innerText()), "source quote shown");
  ok(/Required/.test(await drawer.innerText()) && /articles 4, 13, 16/.test(await drawer.innerText()), "print requirement with four articles shown");
  ok(/Fri, Nov 20/.test(await drawer.innerText()) && /Wed, Nov 18/.test(await drawer.innerText()), "old and new due dates shown");
  ok(/not on Google Calendar/i.test(await drawer.innerText()), "local block is distinguished from Google Calendar");
  ok((await drawer.getByTestId("plan-chunks").locator("li").count()) >= 2, "best plan has blocks");
  await drawer.getByText("Both versions and copies").click();
  await drawer.getByText("duplicate copy").first().waitFor();
  ok(/Syllabus/.test(await drawer.innerText()), "both source versions are visible");
  await shot(page, "02-decision-drawer-desktop.png");

  step("Alternative plan, then Reserve with a double click");
  await drawer.getByRole("radio", { name: /Alternative/ }).click();
  const altText = await drawer.getByTestId("plan-chunks").innerText();
  await drawer.getByRole("radio", { name: /Best available/ }).click();
  ok(altText !== (await drawer.getByTestId("plan-chunks").innerText()), "alternative differs from best");
  const reserveBtn = drawer.getByRole("button", { name: "Reserve", exact: true });
  await reserveBtn.dblclick();
  await drawer.getByTestId("decision-state").waitFor();
  const detail = await (await fetch(`${base}/api/decisions?state=accepted`)).json();
  const accepted = detail.decisions.find((d: any) => d.kind === "deadline_moved");
  ok(!!accepted, "decision is accepted");
  const full = await (await fetch(`${base}/api/decisions/${accepted.id}`)).json();
  ok(full.blocks.length === 2, `double click created one set of blocks (got ${full.blocks.length})`);
  ok(full.blocks.every((b: any) => b.sync === "local-only"), "blocks are local-only");
  await shot(page, "03-after-reserve-desktop.png");

  step("Refresh: the decision is preserved");
  await page.reload();
  await page.getByTestId("primary-action").waitFor();
  ok((await page.getByTestId("decision-card").count()) === 0, "no pending decision after refresh");
  await page.getByText("Decided").waitFor();
  ok(/Reserved|Done|reserved/.test(await page.locator("aside").innerText()), "decided list persists after refresh");

  step("Retry the same reserve through the API");
  const again = await post(`/decisions/${accepted.id}/reserve`, {});
  const againBody = await again.json();
  ok(again.status === 200 && againBody.already === true && againBody.blocks.length === 2, "retry returns the same blocks");

  return page;
}


const bodyText = (page: Page) => page.locator("body").innerText();

async function journeyTask(page: Page) {
  step("Task drawer: due history, then draft is not a receipt");
  await page.goto(base + "/");
  await page.getByTestId("changes").locator("li button").first().click();
  const d = page.getByRole("dialog"); await d.getByText("Due date history").waitFor();
  const t = await d.innerText();
  ok(/Fri, Nov 20/.test(t) && /Wed, Nov 18/.test(t) && /Moved up 2 days/.test(t), "task shows both dates and why it moved");
  await d.getByRole("tab", { name: "Work" }).click();
  await d.getByRole("button", { name: "Save draft" }).click();
  await d.getByText(/A draft is not a submission/).waitFor();
  ok(true, "saving a draft says it is not a submission");
  await d.getByRole("button", { name: /Attach receipt/ }).click();
  await d.getByText("Closed with a submission receipt.").waitFor();
  await page.goto(base + "/completed");
  await page.getByTestId("completed-row").first().waitFor();
  ok(/Submission receipt/.test(await page.getByTestId("completed-row").first().innerText()), "Completed shows the receipt that closed it");
  await page.getByRole("button", { name: "Reopen" }).first().click();
  await page.getByText("Nothing completed yet").waitFor();
  ok(true, "reopen works");
  await shot(page, "04-completed-desktop.png");
}

async function journeyResume(page: Page) {
  step("Resume and 22 minutes");
  await page.goto(base + "/");
  await page.getByRole("button", { name: /I have 20 minutes/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "22", exact: true }).click();
  const card = page.getByTestId("resume-card"); await card.getByText("Thesis paragraph").waitFor();
  ok(/Essay 2 draft/.test(await card.innerText()), "22 minutes returns the document and section");
  await page.goBack();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  ok(true, "browser Back closes the drawer");
  await page.reload(); await page.getByRole("button", { name: /Resume/ }).click();
  await page.getByTestId("resume-card").getByText("Thesis paragraph").waitFor();
  ok(true, "resume survives a reload");
  await page.keyboard.press("Escape");
}

async function journeyCouncil(page: Page) {
  step("Council: labeled sample, four seats, editor, disagreement");
  await page.goto(base + "/council");
  await page.getByText("Load the sample essay").click();
  await page.getByTestId("start-council").click();
  await page.getByTestId("council-editor").waitFor({ timeout: 20000 });
  ok(/Sample replay/.test(await page.getByTestId("council-notice").innerText()), "sample replay is labeled");
  ok((await page.getByTestId("council-seat").count()) === 4, "four seats");
  const seatsText = await page.getByTestId("council-session").innerText();
  ok(/article 16/i.test(await page.getByTestId("council-editor").innerText()), "editor names the highest-impact fix");
  ok(!/uncertain: not found/.test(seatsText), "every finding is supported by the draft or sources");
  await page.getByText("Hear disagreement").click();
  await page.getByText(/Both views are kept/).waitFor();
  ok(true, "disagreement is preserved and collapsible");
  await shot(page, "05-council-desktop.png");

  step("Council: cancel leaves partial, labeled results");
  await page.getByRole("button", { name: "Run again" }).click();
  await page.getByRole("button", { name: /Cancel/ }).waitFor();
  await page.getByRole("button", { name: /Cancel/ }).click();
  await page.getByTestId("council-status").filter({ hasText: "cancelled" }).waitFor({ timeout: 15000 });
  ok(/Cancelled/.test(await page.getByTestId("council-notice").innerText()), "cancellation is marked as partial");
  ok((await page.getByTestId("council-editor").count()) === 0, "no editor pass after cancel");

  step("Council: arbitrary text gets a checklist, never a canned verdict");
  await page.getByTestId("draft").fill("I argue that assembly mattered to the framers. Article 4 is cited here, but nothing else is. This paragraph is long enough to review.");
  await page.getByRole("button", { name: /Remove source/ }).first().click().catch(() => {});
  await page.getByTestId("start-council").click();
  await page.getByText(/Rubric checklist/).waitFor({ timeout: 15000 });
  ok(/not a review/.test(await page.getByTestId("council-notice").innerText()), "checklist is labeled as not a review");
  ok(/Not mentioned: 13, 16, 31/.test(await page.getByTestId("council-session").innerText()), "checklist computed from the actual text");
  ok((await page.getByTestId("council-editor").count()) === 0, "no fabricated editor verdict");
}

async function journeySkills(page: Page) {
  step("Correction, learning loop and skill history through the UI");
  await page.goto(base + "/council");
  await page.getByRole("button", { name: "Teach Jarvis" }).click();
  await page.getByTestId("council-teach-result").waitFor();
  ok(/Outcome: promote/.test(await page.getByTestId("council-teach-result").innerText()), "candidate was promoted");
  await page.goto(base + "/skills");
  await page.getByTestId("skill-version").first().waitFor();
  const t = await bodyText(page);
  ok(/v2/.test(t) && /active/.test(t) && /materials check/.test(t), "skill history shows v2 active with materials check");
  ok((await page.getByLabel("Diff from previous version").count()) >= 1, "compact diff is shown");
  ok(/Corrected 1×/.test(t), "last correction is shown");
  step("Brief on its normal entry point shows the requirement; rollback removes it");
  await page.goto(base + "/");
  await page.getByTestId("changes").locator("li button").first().click();
  await page.getByRole("dialog").getByRole("tab", { name: "Brief" }).click();
  await page.getByTestId("brief-materials").waitFor();
  ok(/Bring a printed excerpt of articles 4, 13, 16 and 31\./.test(await page.getByTestId("brief-materials").innerText()), "brief quotes the exact requirement with source");
  await page.keyboard.press("Escape");
  await page.goto(base + "/skills");
  await page.getByRole("button", { name: /Roll back to v1/ }).click();
  await page.getByText("rolled back").first().waitFor();
  await page.goto(base + "/");
  await page.getByTestId("changes").locator("li button").first().click();
  await page.getByRole("dialog").getByRole("tab", { name: "Brief" }).click();
  await page.getByText(/does not check required materials/).waitFor();
  ok(true, "rollback restores the earlier behavior");
  await page.goto(base + "/skills"); await shot(page, "06-skills-desktop.png");
}

async function journeyExam(page: Page) {
  step("Exam fixture: study plan, practice result changes the next milestone");
  await page.goto(base + "/");
  await page.getByRole("button", { name: /More fixtures/ }).click();
  await page.getByRole("menuitem", { name: /Biology exam/ }).click();
  await page.getByTestId("decision-card").filter({ hasText: "Midterm 2" }).waitFor();
  await page.getByTestId("decision-card").filter({ hasText: "Midterm 2" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Add task", exact: true }).click();
  await page.getByText(/Study plan created: 8 sessions over 18 days/).waitFor();
  ok(true, "8 sessions over 18 days created");
  await page.keyboard.press("Escape");
  await page.goto(base + "/tasks");
  await page.getByText("Study sessions").waitFor();
  ok(/Targeted: carrier-frequency problems/.test(await bodyText(page)) && /Targeted: X-linked crosses/.test(await bodyText(page)), "weak areas are scheduled");
  await page.getByText("Midterm 2", { exact: true }).first().click();
  const d = page.getByRole("dialog"); await d.getByRole("tab", { name: "Work" }).click();
  await d.getByLabel("Area").selectOption("carrier-frequency problems");
  await d.getByLabel("Correct").fill("2"); await d.getByRole("button", { name: "Record result" }).click();
  await d.getByText(/Added a 30 min retry/).waitFor();
  ok(true, "a weak practice result adds a retry milestone");
  await d.getByRole("tab", { name: "History" }).click();
  await d.getByText(/carrier-frequency problems: 2\/5/).first().waitFor();
  ok(true, "result stays visible in history");
  await shot(page, "07-tasks-study-desktop.png");
}

async function journeyRegistrar(page: Page) {
  step("Registrar: a reply is not a resolution");
  await page.goto(base + "/");
  await page.getByRole("button", { name: /More fixtures/ }).click();
  await page.getByRole("menuitem", { name: /Registrar/ }).click();
  await page.getByTestId("decision-card").filter({ hasText: "Promise found" }).waitFor();
  await page.getByTestId("decision-card").filter({ hasText: "Promise found" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Track it", exact: true }).click();
  await page.getByTestId("decision-state").waitFor();
  await page.keyboard.press("Escape");
  await page.goto(base + "/tasks?tab=followups");
  const c = page.getByTestId("commitment").filter({ hasText: "respond" }).first();
  await c.waitFor();
  await c.getByRole("button", { name: /Prepare follow-up draft/ }).click();
  await c.getByText(/Nothing was sent/).waitFor();
  await c.getByRole("button", { name: /delivery acknowledged/ }).click();
  await c.getByText("Sent, acknowledged").waitFor();
  await c.getByRole("button", { name: /reply arrives/ }).click();
  await c.getByTestId("commitment-status").filter({ hasText: "Reply received, still open" }).waitFor();
  ok(true, "reply received but the follow-up stays open");
  await c.getByRole("button", { name: /Fixture: correction/ }).click();
  await page.getByTestId("record-value").waitFor();
  ok(/8 credits/.test(await page.getByTestId("record-value").innerText()), "correction is visible in the student record");
  await c.getByLabel("Resolve with evidence").fill("ok");
  await c.getByRole("button", { name: "Resolve" }).click();
  await c.getByRole("alert").waitFor();
  ok(/does not resolve/.test(await c.getByRole("alert").innerText()), "resolving without real evidence is refused");
  await c.getByLabel("Resolve with evidence").fill("Registrar confirmed 8 credits in the portal");
  await c.getByRole("button", { name: "Resolve" }).click();
  await c.getByTestId("commitment-status").filter({ hasText: "Resolved" }).waitFor();
  ok(true, "resolved only with evidence");
}

async function journeyMemoryGoals(page: Page) {
  step("Goals");
  await page.goto(base + "/goals");
  await page.getByTestId("goal-line").waitFor();
  ok(/4\/10 conversations · 5 planned by today · 6 weeks left/.test(await page.getByTestId("goal-line").innerText()), "goal line shows actual, target to date and weeks left");
  await page.getByRole("button", { name: "+1" }).click();
  await page.getByText(/^5\/10 conversations/).waitFor();
  await page.reload();
  await page.getByTestId("goal-line").waitFor();
  ok(/5\/10 conversations/.test(await page.getByTestId("goal-line").innerText()), "+1 persists after reload");

  step("Memory: search, map, vault, forget");
  await page.goto(base + "/memory");
  await page.getByLabel("Search notes").fill("shabbat");
  await page.getByRole("button", { name: /Protect Shabbat/ }).first().click();
  await page.getByTestId("note-editor").waitFor();
  ok(/Scheduling rules/.test(await page.getByTestId("note-editor").innerText()), "links and backlinks show");
  await page.getByRole("tab", { name: "Map" }).click();
  await page.locator("svg[role=img]").waitFor();
  ok(/links to/.test(await bodyText(page)), "map has a text list alternative");
  await page.getByRole("tab", { name: "Vault" }).click();
  await page.getByRole("button", { name: "Export to vault" }).click();
  await page.getByText(/Exported \d+ notes/).waitFor();
  await page.getByRole("button", { name: /Import changes/ }).click();
  await page.getByTestId("import-report").waitFor();
  ok(/Unchanged:/.test(await page.getByTestId("import-report").innerText()), "vault round trip reports unchanged notes");
  await page.getByRole("tab", { name: "Private room" }).click();
  await page.getByLabel(/Start a private session/).check();
  await page.getByLabel("Message").fill("zebra-quokka-7731 is on my mind");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByTestId("reflection-log").getByText(/Perspective A/).waitFor();
  const dump = JSON.stringify(await (await fetch(`${base}/api/export`)).json());
  ok(!dump.includes("zebra-quokka-7731"), "private room content is not stored or exported");
  await page.getByRole("tab", { name: "Notes" }).click();
  await page.getByLabel("Search notes").fill("sydney");
  await page.getByRole("button", { name: /Leaning Sydney/ }).first().click();
  await page.getByRole("button", { name: "Forget", exact: true }).click();
  await page.getByRole("button", { name: /Confirm: remove/ }).click();
  await page.getByText("No matches").waitFor();
  ok(true, "forget removes the note from search");
  await shot(page, "08-memory-desktop.png");
}

async function journeyBreak(page: Page) {
  step("Break it: malformed, oversized, unsupported imports");
  await page.goto(base + "/sources");
  const alertWith = (re: RegExp) => page.getByRole("alert").filter({ hasText: re });
  await page.getByTestId("import-text").fill("{not json");
  await page.getByLabel("File name").fill("bad.json");
  await page.getByTestId("import-preview").click();
  await alertWith(/Malformed JSON/).waitFor();
  ok(true, "malformed JSON gives a clear error");
  ok((await page.getByTestId("import-preview-result").count()) === 0, "nothing is previewed or saved");
  await page.getByLabel("File name").fill("syllabus.pdf");
  await page.getByTestId("import-text").fill("%PDF-1.4 fake");
  await page.getByTestId("import-preview").click();
  await page.getByText(/PDF is not supported yet/).waitFor();
  ok(true, "PDF is visibly unsupported");
  await page.locator("#file").setInputFiles({ name: "huge.txt", mimeType: "text/plain", buffer: Buffer.alloc(2 * 1024 * 1024 + 100, "a") });
  await page.getByText(/The limit is 2 MB/).waitFor();
  ok(true, "oversized file is rejected before upload");
  await page.getByLabel("File name").fill("update.md");
  await page.getByTestId("import-text").fill("Essay 2 is now due Thursday, November 19 at 5 p.m.");
  await page.getByLabel("Course").selectOption({ label: "SS201" });
  await page.getByTestId("import-preview").click();
  await page.getByTestId("import-preview-result").waitFor();
  await page.getByTestId("import-commit").click();
  await page.getByTestId("import-done").waitFor();
  ok(/1 decision/.test(await page.getByTestId("import-done").innerText()) || /0 decision/.test(await page.getByTestId("import-done").innerText()), "valid text imports through the normal pipeline");
  await page.getByTestId("import-preview").click().catch(() => {});

  step("Break it: a source disconnects and another goes partial");
  const row = page.locator('[data-provider="inbox-folder"]');
  if (dataDir) {
    const inbox = path.join(dataDir, "demo", "inbox"); fs.mkdirSync(inbox, { recursive: true });
    await page.getByRole("button", { name: "Run now" }).first().click();
    await page.locator('[data-provider="inbox-folder"]').getByText("ok", { exact: true }).waitFor();
    fs.writeFileSync(path.join(inbox, "broken.json"), "{oops");
    await page.getByRole("button", { name: "Run now" }).first().click();
    await page.locator('[data-provider="inbox-folder"]').getByText("partial").waitFor();
    ok(/broken\.json/.test(await page.locator('[data-provider="inbox-folder"]').innerText()), "partial check names the failing file");
    ok(/last verified/.test(await page.locator('[data-provider="inbox-folder"]').innerText()), "last verified time is kept");
  }
  await page.locator('[data-provider="example-blackboard"]').getByRole("button", { name: "Disconnect" }).click();
  await page.locator('[data-provider="example-blackboard"]').getByText("disconnected").first().waitFor();
  await page.goto(base + "/");
  await page.getByTestId("source-health").getByText(/Blackboard/).waitFor();
  ok(/disconnected/.test(await page.getByTestId("source-health").innerText()), "Today shows the source as disconnected");
  ok(/Email \(example\)\s+verified/.test(await page.getByTestId("source-health").innerText()), "other sources keep their own freshness");
  await shot(page, "09-source-disconnected-desktop.png");
  await page.goto(base + "/sources");
  await page.locator('[data-provider="example-blackboard"]').getByRole("button", { name: "Reconnect" }).click();
  await page.locator('[data-provider="example-blackboard"]').getByText("unverified").first().waitFor();
  ok(true, "reconnect asks for a new check");

  step("Break it: wrong-origin mutation and bad host");
  const evil = await fetch(`${base}/api/demo/replay`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ name: "bulletin" }) });
  ok(evil.status === 403, "cross-origin mutation is rejected");
  const bad = await fetch(`${base}/api/demo/replay`, { method: "POST", headers: { "content-type": "text/plain", origin: base }, body: "x" });
  ok(bad.status === 415, "non-JSON body is rejected");
  const rebind = await new Promise<number>((res) => { const u = new URL(base); const rq = http.request({ host: u.hostname, port: u.port, path: "/api/session", headers: { host: "evil.example" } }, (r) => { r.resume(); res(r.statusCode ?? 0); }); rq.on("error", () => res(0)); rq.end(); });
  ok(rebind === 403, `a foreign Host header is rejected (got ${rebind})`);

  step("Command palette and keyboard");
  await page.goto(base + "/");
  await page.getByTestId("primary-action").waitFor();
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: "Command", exact: true }).fill("show pace");
  await page.keyboard.press("Enter");
  await page.waitForURL("**/goals");
  ok(true, "palette navigates by plain language");
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: "Command", exact: true }).fill("what changed");
  await page.keyboard.press("Enter");
  await page.getByTestId("command-reply").waitFor();
  ok(/local command matcher \(no model\)/i.test(await page.getByTestId("command-reply").innerText()), "command mode is labeled");
  await page.keyboard.press("Escape");
  await page.goto(base + "/");
  await page.getByTestId("primary-action").waitFor();
  await page.keyboard.press("Tab");
  const skip = await page.evaluate(() => document.activeElement?.textContent);
  ok(/Skip to content/.test(skip ?? ""), "first Tab stop is the skip link");
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => { const e = document.activeElement as HTMLElement; return getComputedStyle(e).outlineStyle + " " + getComputedStyle(e).outlineWidth; });
  ok(/solid 2px/.test(outline), `focus is visible (${outline})`);

  step("Connections drawer and health check");
  await page.getByRole("button", { name: "Connections and health" }).click();
  await page.getByTestId("connections-list").waitFor();
  await page.getByRole("button", { name: "Run health check" }).click();
  await page.getByText(/Local checks only/).first().waitFor();
  const ct = await page.getByRole("dialog").innerText();
  ok(!/live verified/i.test(ct.replace(/not live verified/gi, "")), "no connection claims to be live verified");
  ok(/Blackboard/.test(ct) && /Needs connection/.test(ct), "Blackboard is honest about needing you");
  await page.keyboard.press("Escape");
}

async function journeyMobile(browser: Browser) {
  step("Phone width 390x844");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); watch(page, "mobile");
  await post("/demo/reset", { confirm: "RESET DEMO" });
  await page.goto(base + "/");
  await page.getByTestId("primary-action").waitFor();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok((await overflow()) <= 0, "Today has no horizontal scroll");
  await shot(page, "10-today-mobile.png");
  await page.getByTestId("replay-update").tap();
  await page.getByRole("link", { name: /Decisions/ }).waitFor();
  await page.getByRole("link", { name: /Decisions/ }).filter({ hasText: "1" }).waitFor();
  ok(true, "Decisions tab shows the count");
  await page.getByRole("link", { name: /Decisions/ }).tap();
  await page.getByTestId("decision-card").first().waitFor();
  ok((await overflow()) <= 0, "Decisions has no horizontal scroll");
  await page.getByTestId("decision-card").first().tap();
  const dlg = page.getByRole("dialog"); await dlg.getByTestId("plan-chunks").waitFor();
  const box = await dlg.boundingBox();
  ok(!!box && box.width <= 391 && box.x >= -1, `drawer fits the phone (${box?.width}px)`);
  ok((await overflow()) <= 0, "drawer has no horizontal scroll");
  await dlg.evaluate((el) => { const s = el.querySelector(".overflow-y-auto"); if (s) s.scrollTop = 400; });
  await page.waitForTimeout(400);
  await shot(page, "11-decision-drawer-mobile.png");
  const reserve = dlg.getByRole("button", { name: "Reserve", exact: true });
  ok(await reserve.isVisible(), "Reserve stays reachable while scrolled (sticky footer)");
  await reserve.tap();
  await dlg.getByTestId("decision-state").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Capture" }).tap();
  await page.getByRole("dialog").getByLabel("Who owes").fill("Example advisor");
  await page.getByRole("dialog").getByLabel("What was promised").fill("Send the reading list");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).tap();
  await page.getByText(/Promise saved/).waitFor();
  ok(true, "Capture works on the phone");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "More" }).tap();
  await page.getByRole("link", { name: "Council" }).tap();
  await page.getByText("Load the sample essay").waitFor();
  ok((await overflow()) <= 0, "Council has no horizontal scroll");
  await shot(page, "12-council-mobile.png");
  for (const p of ["/tasks", "/goals", "/memory", "/skills", "/sources", "/voice", "/settings"]) {
    await page.goto(base + p); await page.waitForLoadState("networkidle");
    ok((await overflow()) <= 0, `${p} has no horizontal scroll on the phone`);
  }
  await ctx.close();
}

async function journeyVoice(page: Page) {
  step("Advisor room: gap is labeled, quotes carry locators, one speaker at a time");
  await page.goto(base + "/voice");
  await page.getByRole("button", { name: /Hormozi-inspired/ }).click();
  await page.getByText(/No verified Hormozi sources are imported/).waitFor();
  await page.getByRole("button", { name: /Hormozi-inspired/ }).click(); // back to generic only
  await page.getByTestId("voice-question").fill("How should I price a tutoring offer?");
  await page.getByTestId("voice-ask").click();
  await page.getByTestId("transcript").getByText(/Jarvis application/).first().waitFor();
  ok(/Turn that disagreement into a test/.test(await page.getByTestId("transcript").innerText()), "each turn ends in a test");
  ok(!/Direct quotation/.test(await page.getByTestId("transcript").innerText()), "no invented quotations");
  await shot(page, "13-voice-desktop.png");
}

async function journeySettings(page: Page) {
  step("Settings and scheduler honesty");
  await page.goto(base + "/settings");
  await page.getByTestId("scheduler-message").waitFor();
  ok(/No worker is running/.test(await page.getByTestId("scheduler-message").innerText()), "scheduler says no worker is running");
  step("Private workspace is separate and starts empty");
  await page.getByRole("button", { name: "Open private workspace" }).click();
  await page.getByTestId("primary-action").waitFor();
  await page.waitForFunction(() => /PRIVATE WORKSPACE/.test(document.body.innerText));
  ok((await page.getByTestId("decision-card").count()) === 0, "no example decisions in the private workspace");
  ok(!/Argument and primary sources/.test(await bodyText(page)), "no example data leaks into the private workspace");
  ok(/empty/.test(await bodyText(page)), "private workspace shows a first-run state");
  await shot(page, "14-private-empty-desktop.png");
  await page.getByRole("button", { name: "Back to example" }).click();
  await page.waitForFunction(() => /EXAMPLE WORKSPACE/.test(document.body.innerText));
}

async function journeyA11y(browser: Browser) {
  step("Accessibility audit with axe-core (WCAG 2 A and AA), desktop and phone");
  const axePath = createRequire(import.meta.url).resolve("axe-core");
  const scan = async (page: Page, label: string) => {
    await page.addScriptTag({ path: axePath });
    const res: any = await page.evaluate(async () => (window as any).axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] }));
    const bad = res.violations.filter((v: any) => ["serious", "critical"].includes(v.impact));
    for (const v of bad) console.log(`    axe ${v.impact} ${v.id} on ${label}: ${v.nodes.slice(0, 2).map((n: any) => n.target.join(" ")).join(" | ")}`);
    ok(bad.length === 0, `no serious or critical axe violations on ${label} (${res.violations.length} minor/moderate)`);
  };
  for (const vp of [{ w: 1440, h: 900, n: "desktop" }, { w: 390, h: 844, n: "phone" }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage(); watch(page, `a11y-${vp.n}`);
    await post("/demo/reset", { confirm: "RESET DEMO" }); await post("/demo/replay", { name: "bulletin" });
    for (const p of ["/", "/tasks", "/goals", "/completed", "/memory", "/skills", "/council", "/sources", "/voice", "/settings", "/activity"]) {
      await page.goto(base + p); await page.waitForLoadState("networkidle"); await scan(page, `${p} (${vp.n})`);
    }
    await page.goto(base + (vp.n === "phone" ? "/decisions" : "/")); await page.getByTestId("decision-card").first().waitFor();
    await page.getByTestId("decision-card").first().click(); await page.getByRole("dialog").getByTestId("plan-chunks").waitFor(); await page.waitForTimeout(300);
    await scan(page, `decision drawer (${vp.n})`);
    await ctx.close();
  }
}

const api = async (p: string) => (await fetch(`${base}/api${p}`)).json() as Promise<any>;
const waitFor = async (what: string, fn: () => Promise<boolean>, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)); } ok(false, `timed out waiting for ${what}`); return false; };

async function journeyOffice(page: Page, browser: Browser) {
  step("Office: capture the TAMID promise, watch the supervisor assign a specialist");
  await post("/demo/reset", { confirm: "RESET DEMO" });
  startWorker(900);
  await page.goto(base + "/office");
  await page.getByTestId("capture-send").waitFor();
  ok(/Idle desks make zero model calls/.test(await page.getByTestId("office-runner").innerText()), "idle office says it makes zero model calls");
  await page.getByTestId("capture-send").click();
  await page.getByTestId("capture-receipt").waitFor();
  ok(/SYNTHETIC SOURCE EVENT/.test(await page.getByTestId("capture-receipt").innerText()), "the receipt labels the source event as synthetic");
  ok(await page.getByTestId("receipt-open").isVisible(), "the receipt opens the saved commitment");
  ok(/three pitch angles/.test(await page.getByTestId("receipt-message").innerText()), "receipt says what was saved");
  await page.getByTestId("roster-job").filter({ hasText: "Capacity specialist" }).first().waitFor({ timeout: 20000 });
  ok(true, "the supervisor assigned a Capacity specialist");
  const spec = page.getByTestId("roster-job").filter({ hasText: "Capacity specialist" }).first();
  await spec.click();
  const insp = page.getByTestId("inspector");
  await insp.getByText("Delegated by").waitFor();
  const it = await insp.innerText();
  ok(/Handle:/.test(it) && /cap_/.test(it) && /No model used/.test(it) && /Last heartbeat/.test(it), "inspector shows who delegated it, evidence, usage and heartbeat");
  await shot(page, "15-office-desktop.png");
  await waitFor("the decision to arrive", async () => (await api("/decisions")).decisions.some((d: any) => d.kind === "commitment_plan"));
  await page.getByTestId("decision-card").filter({ hasText: "TAMID" }).first().waitFor();
  ok(true, "a decision arrived at the Decisions desk");
  await waitFor("helpers to finish", async () => (await api("/office")).jobs.every((j: any) => j.status === "done"));
  const counts = async () => { const o = await api("/office"); const c = await api("/commitments"); const d = await api("/decisions"); return { jobs: o.jobs.length, cmts: c.commitments.filter((x: any) => /pitch angles/.test(x.action)).length, decs: d.decisions.filter((x: any) => x.kind === "commitment_plan").length }; };
  const c1 = await counts();
  ok(c1.cmts === 1 && c1.decs === 1 && c1.jobs === 2, `one commitment, one decision, two jobs (${JSON.stringify(c1)})`);

  step("Office: replay the same message");
  await page.getByTestId("capture-replay").click();
  await page.getByTestId("capture-receipt").getByText(/duplicate: nothing new/).waitFor();
  await page.waitForTimeout(2500);
  const c2 = await counts();
  ok(JSON.stringify(c1) === JSON.stringify(c2), "replaying created no new commitment, decision or job");
  ok(/Already saved/.test(await page.getByTestId("receipt-message").innerText()), "the receipt says nothing was duplicated");

  step("Office: reconnect (reload) recovers the view");
  await page.reload();
  await page.getByTestId("roster").waitFor();
  await page.getByTestId("roster-job").first().waitFor();
  ok((await page.getByTestId("roster-job").count()) === 2, "the roster is rebuilt from saved state after a reload");

  step("Office: kill the worker mid-job, start another, still one commitment and one decision");
  startWorker(1500);
  await page.getByTestId("capture-text").fill("Remember for Jarvis: I owe the SM team two slide drafts by Friday.");
  await page.getByTestId("capture-send").click();
  await waitFor("the specialist to start a step", async () => { const o = await api("/office"); return o.jobs.some((j: any) => j.kind === "capture_planner" && j.status === "running" && j.steps.length >= 1 && /SM team/.test(j.title)); }, 40000);
  stopWorker("SIGKILL");                      // the worker process dies without cleanup
  const mid = await api("/office");
  const dead = mid.jobs.find((j: any) => /SM team/.test(j.title) && j.kind === "capture_planner");
  ok(dead.status === "running" && (await api("/decisions")).decisions.filter((d: any) => /SM team/.test(d.title)).length === 0, "the job is stuck mid-run and no decision exists yet");
  await page.waitForTimeout(3500);            // the lease expires
  startWorker(300);
  await waitFor("the replacement worker to finish it", async () => (await api("/office")).jobs.filter((j: any) => /SM team/.test(j.title)).every((j: any) => j.status === "done"), 40000);
  const fin = await api("/office"); const d2 = await api("/decisions"); const c3 = await api("/commitments");
  ok(d2.decisions.filter((d: any) => /SM team/.test(d.title)).length === 1, "exactly one decision after the restart");
  ok(c3.commitments.filter((x: any) => /slide drafts/.test(x.action)).length === 1, "exactly one commitment after the restart");
  const recovered = fin.jobs.find((j: any) => /SM team/.test(j.title) && j.kind === "capture_planner");
  ok(recovered.attempts >= 2 && recovered.events.some((e: any) => /recover|Picked up/.test(e.kind + e.summary)), "the job records that a new worker picked it up");
  await page.reload(); await page.getByTestId("roster").waitFor();
  await shot(page, "15b-office-after-restart-desktop.png");

  step("Office on the phone: compact roster, no horizontal scroll");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await ctx.newPage(); watch(m, "mobile-office");
  await m.goto(base + "/office"); await m.getByTestId("roster").waitFor();
  ok((await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, "Office has no horizontal scroll on the phone");
  await m.getByTestId("roster-job").first().tap();
  await m.getByTestId("inspector").getByText("Delegated by").waitFor();
  await shot(m, "16-office-mobile.png");
  await ctx.close();
}
async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  await startServer();
  const exe = process.env.PW_CHROMIUM ?? (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  const browser: Browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await journeyDesktop(desktop);
    await journeyTask(page); await journeyResume(page); await journeyCouncil(page); await journeySkills(page);
    await journeyExam(page); await journeyRegistrar(page); await journeyMemoryGoals(page); await journeyVoice(page);
    await journeyBreak(page); await journeySettings(page);
    await journeyOffice(page, browser);
    await desktop.close();
    await journeyMobile(browser);
    await journeyA11y(browser);
  } finally { await browser.close(); killServer(); }
  // Failures the journeys cause on purpose (malformed file, PDF, resolve without evidence) are expected. Everything else is a problem.
  const expected = [/http (422|415)\(desktop\): POST .*\/api\/import\/preview/, /http 422\(desktop\): POST .*\/commitments\/.*\/resolve/, /console\(desktop\): Failed to load resource: .*\b(422|415)\b/];
  const real = problems.filter((p) => !expected.some((e) => e.test(p)));
  console.log(`\n${pass} checks passed, ${real.length} problems (${problems.length - real.length} expected failures from deliberate break tests ignored)`);
  for (const p of real) console.log(" - " + p);
  process.exit(real.length ? 1 : 0);
}
main().catch((e) => { console.error(e); killServer(); process.exit(2); });
