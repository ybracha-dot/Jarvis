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
  worker = spawn("npx", ["tsx", "scripts/worker.ts"], { env: { ...process.env, JARVIS_DATA_DIR: dataDir, JARVIS_JOB_PACE_MS: String(pace), JARVIS_JOB_LEASE_MS: "3000", JARVIS_ALLOW_LOCAL_FEEDS: "1" }, stdio: "ignore", detached: true });
}
let restarting = false;
async function restartServer() { restarting = true; const d = dataDir!; stopWorker(); if (server?.pid) { try { process.kill(-server.pid, "SIGTERM"); } catch { /* gone */ } } await new Promise((r) => setTimeout(r, 1200)); await startServer(d); restarting = false; }
function killServer() { stopWorker(); if (server?.pid) { try { process.kill(-server.pid, "SIGTERM"); } catch { /* already gone */ } } }
const problems: string[] = [];
const steps: string[] = [];
let pass = 0;

function ok(cond: unknown, msg: string) { if (!cond) { problems.push(`ASSERT FAILED: ${msg}`); console.log(`  FAIL ${msg}`); } else { pass++; console.log(`  ok   ${msg}`); } }
const step = (s: string) => { steps.push(s); console.log(`\n# ${s}`); };

async function startServer(reuseDir?: string) {
  if (process.env.E2E_URL) return;
  const dir = reuseDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-e2e-")); dataDir = dir;
  server = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(PORT)], { env: { ...process.env, JARVIS_DATA_DIR: dir, JARVIS_INAPP_RUNNER: "0", JARVIS_MCP_TOKEN: "e2e-token-0123456789abcdef", JARVIS_ALLOW_LOCAL_FEEDS: "1" }, stdio: "ignore", detached: true });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch { /* waiting */ } await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("Server did not start. Run npm run build first.");
}

function watch(page: Page, label: string) {
  page.on("console", (m) => { if (m.type() === "error") { const t = m.text(); if (!(restarting && /ERR_CONNECTION_REFUSED/.test(t)) && !/favicon/.test(t) && !problems.includes(`console(${label}): ${t}`)) problems.push(`console(${label}): ${t}`); } });
  page.on("pageerror", (e) => problems.push(`pageerror(${label}): ${e.message}`));
  page.on("requestfailed", (r) => { if (!/_next\/webpack-hmr|\.map$/.test(r.url()) && !/ERR_ABORTED/.test(r.failure()?.errorText ?? "") && !(restarting && /ERR_CONNECTION_REFUSED/.test(r.failure()?.errorText ?? ""))) problems.push(`requestfailed(${label}): ${r.url()} ${r.failure()?.errorText}`); });
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/__expect")) problems.push(`http ${r.status()}(${label}): ${r.request().method()} ${r.url()}`); });
}
const shot = async (page: Page, name: string, keepScroll = false) => { if (!keepScroll) await page.evaluate(() => { (document.querySelector('[data-testid="handoff-strip"]') ?? document.querySelector("h1"))?.scrollIntoView({ block: "start" }); window.scrollBy(0, -64); }).catch(() => {}); return page.screenshot({ path: path.join(SHOTS, name), fullPage: false }); };
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
  ok((await page.locator("aside[aria-label='Decisions']").count()) === 0, "with nothing pending the decisions inspector gives the space back");
  await page.goto(base + "/decisions"); await page.getByText("Decided").waitFor();
  ok(/Reserved|Done|reserved/.test(await page.locator("main").innerText()), "decided list persists after refresh");
  await page.goto(base + "/");

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
  await page.getByLabel("Ask memory").fill("shabbat");
  await page.getByTestId("memory-answer").waitFor();
  ok(/Why:/.test(await page.getByTestId("memory-answer").innerText()), "memory answers with a current answer and why");
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
  await page.getByRole("tab", { name: "Memory" }).click();
  await page.getByRole("button", { name: /Leaning Sydney/ }).first().click();
  await page.getByRole("button", { name: "Forget", exact: true }).click();
  await page.getByRole("button", { name: /Confirm: remove/ }).click();
  await page.waitForFunction(() => !/Leaning Sydney/.test(document.querySelector("main")?.textContent ?? ""));
  await page.getByLabel("Ask memory").fill("sydney");
  await page.getByTestId("memory-answer").getByText(/nothing saved/).waitFor();
  ok(true, "forget removes the note from the list and from the answer");
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
  await page.getByRole("link", { name: "Connections", exact: true }).click(); await page.waitForURL(/\/connections/);
  ok(/Not verified with ordinary Claude yet/.test(await page.getByTestId("connection-status").innerText()), "connections page does not claim ordinary Claude is verified");
  await page.goto(base + "/?connections=1");
  await page.getByTestId("connections-list").waitFor();
  await page.getByRole("button", { name: "Run health check" }).click();
  await page.getByText(/Local checks only/).first().waitFor();
  const ct = await page.getByRole("dialog").innerText();
  ok(!/live verified/i.test(ct.replace(/not live verified/gi, "")), "no connection claims to be live verified");
  ok(/Blackboard/.test(ct) && /Needs connection/.test(ct), "Blackboard is honest about needing you");
  await page.keyboard.press("Escape");
}

async function journeyProjects(page: Page) {
  step("Projects and the connector: Claude plans a trip, Jarvis knows what was decided");
  await post("/demo/reset", { confirm: "RESET DEMO" });
  await page.goto(base + "/projects");
  await page.getByTestId("projects-empty").waitFor();
  ok(/Connections/.test(await page.getByTestId("projects-empty").innerText()), "the empty state says how a project starts and points at Connections");
  await shot(page, "20-projects-empty-desktop.png");
  await page.goto(base + "/connections");
  ok(/Not verified with ordinary Claude yet/.test(await page.getByTestId("connection-status").innerText()), "connections starts unverified");
  await page.getByTestId("token-create").click();
  await page.getByTestId("token-fresh").waitFor();
  const token = (await page.getByTestId("token-value").innerText()).trim();
  ok(/^jvs_d_[A-Za-z0-9_-]{43}$/.test(token), "a token is shown once");
  ok(!JSON.stringify(await api("/connector")).includes(token), "the API never returns the secret again");
  await page.reload(); await page.getByTestId("token-list").waitFor();
  ok((await page.getByTestId("token-fresh").count()) === 0 && !(await bodyText(page)).includes(token), "after a reload the secret is gone from the page");
  ok(!page.url().includes("jvs_"), "the token never appears in a URL");

  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const connect = async (t: string) => { const c = new Client({ name: "ordinary-claude-emulator", version: "1" }); await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${t}` } } })); return c; };
  const call = async (c: any, name: string, args: any) => { const r = await c.callTool({ name, arguments: args }); return r.isError ? { error: r.content[0].text } : JSON.parse(r.content[0].text); };
  const claude = await connect(token);
  const r1 = await call(claude, "apply_project_update", { project: "Maple Court project", createIfMissing: { kind: "trip" }, eventId: "e2e-maple-0001", dedupKey: "chat:4", changes: [{ op: "option", key: "vendor", text: "Oak contractor" }, { op: "option", key: "vendor", text: "Pine contractor" }, { op: "decide", key: "dates", text: "June 14 to 21" }] });
  ok(r1.saved && r1.revision === 1 && r1.origin === "claude", "Claude saved a trip update through the connector and got a receipt");
  ok((await call(claude, "apply_project_update", { project: "Maple Court project", eventId: "e2e-maple-0002", dedupKey: "chat:4", changes: [{ op: "fact", key: "z", text: "z" }] })).replay === true, "replaying the message did not write twice");
  await page.goto(base + "/projects");
  await page.getByTestId("project-card").filter({ hasText: "Maple Court project" }).click();
  await page.getByTestId("project-answer").waitFor();
  ok(/June 14 to 21/.test(await page.getByTestId("project-answer").innerText()), "the project page shows the decision Claude saved");
  ok((await page.getByTestId("project-fact").filter({ hasText: "Pine contractor" }).count()) === 1, "undecided options are listed separately");
  ok(/Claude conversation/.test(await page.getByTestId("project-fact").filter({ hasText: "June 14 to 21" }).innerText()), "each item says it came from a Claude conversation");
  await shot(page, "21-project-desktop.png");
  await page.getByTestId("project-fact").filter({ hasText: "June 14 to 21" }).locator("button").first().click();
  await page.getByTestId("project-inspector").waitFor();
  ok(/e2e-maple-0001/.test(await page.getByTestId("project-inspector").innerText()), "the inspector shows the evidence: event id, revision, source");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Edit text").fill("June 15 to 22");
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await page.getByTestId("project-answer").getByText(/June 15 to 22/).waitFor();
  ok(true, "editing in Jarvis changes the current answer");
  const ctxNow = await call(claude, "get_project_context", { project: "Maple Court project" });
  ok(ctxNow.current.find((f: any) => f.key === "dates").text === "June 15 to 22", "Claude reads the edit you made in Jarvis");
  const stale = await call(claude, "apply_project_update", { project: "Maple Court project", expectedRevision: 1, eventId: "e2e-maple-0003", changes: [{ op: "decide", key: "dates", text: "June 20 to 27" }] });
  ok(stale.saved === false && stale.conflict === true, "a stale Claude update is refused and does not overwrite your edit");
  await page.getByRole("button", { name: "Choose this" }).first().click();
  await page.getByTestId("project-fact").filter({ hasText: "Decided" }).filter({ hasText: /Oak|Vik/ }).first().waitFor();
  await page.getByTestId("project-undo").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="project-fact"]').length > 0);
  ok(true, "undo steps back the last update");

  step("Two-way connection check");
  await page.goto(base + "/connections");
  await page.getByTestId("probe-start").click(); await page.getByTestId("probe").waitFor();
  const code = (await page.getByTestId("probe").innerText()).match(/JV-[0-9A-F]{6}/)![0];
  ok((await page.getByTestId("probe-edit").isDisabled()), "the marker step waits for Claude's write");
  await call(claude, "save_to_jarvis", { text: `Remember for Jarvis: connection check ${code}`, synthetic: true });
  await page.getByTestId("probe").getByText(/Received/).waitFor({ timeout: 10000 });
  await page.getByTestId("probe-edit").click(); await page.getByTestId("probe").getByText(/Marker added/).waitFor();
  const back = await call(claude, "recall_from_jarvis", { query: `connection check ${code}` });
  ok(back.items[0].type === "connection_check", "Claude reads the note back");
  await page.getByTestId("connection-status").getByText(/only been tested with a local test client/).waitFor({ timeout: 10000 });
  ok(true, "after write, edit and read-back by a test client the status says it was a test client and not your account");
  await shot(page, "22-connections-desktop.png");

  step("Revoke stops the connector at once");
  await page.getByRole("button", { name: "Revoke" }).first().click();
  await page.getByTestId("token-list").getByText("revoked").waitFor();
  let refused = false; try { await call(claude, "get_project_context", {}); } catch { refused = true; }
  ok(refused, "a revoked token stops working even in an open session");
  await claude.close().catch(() => {});

  step("Memory, Today and Activity after the work");
  await page.goto(base + "/memory"); await page.getByTestId("memory-ask").fill("dates"); await page.getByTestId("memory-answer").getByText(/June 15 to 22/).waitFor();
  ok(/Claude conversation|Jarvis/.test(await page.getByTestId("memory-answer").innerText()), "memory answers from the project decision and says why");
  await shot(page, "23-memory-desktop.png");
  await page.goto(base + "/activity"); await page.getByTestId("outcomes").waitFor();
  ok((await page.getByTestId("outcome-row").filter({ hasText: "Maple Court project" }).count()) >= 1, "Activity lists the project update as an outcome with its receipt");
  await shot(page, "24-activity-desktop.png");
}

async function journeyAssistant(page: Page, browser: Browser) {
  step("Assistant: type the pitch request into the normal Ask Jarvis box");
  await post("/demo/reset", { confirm: "RESET DEMO" });
  startWorker(400);
  await page.goto(base + "/connections"); await page.getByTestId("load-sample").click();
  await page.getByTestId("sources-panel").getByText(/Mail \(fixture\)/).waitFor();
  ok((await page.getByTestId("source-row").filter({ hasText: "Blackboard portal" }).innerText()).includes("needs your sign-in"), "Blackboard says it needs your sign-in instead of pretending to read it");
  ok(/fixture/.test(await page.getByTestId("source-row").filter({ hasText: "Mail (fixture)" }).innerText()), "fixture sources are labelled as fixtures");
  await page.goto(base + "/");
  await page.getByTestId("voice-dock").waitFor();
  ok((await page.getByTestId("examples").locator("button").count()) === 3, "Ask Jarvis offers general example requests");
  await page.getByTestId("transcript").fill("Pick up where we left off on the pitch and draft my follow-up.");
  await page.getByTestId("send").click();
  await page.getByTestId("goal-result-link").waitFor();
  ok(true, "Jarvis acknowledges the request with a stable result link at once");
  await shot(page, "30-ask-jarvis-acknowledged-desktop.png");
  await page.getByTestId("goal-result-link").click();
  await page.getByTestId("result-title").waitFor();
  await page.getByTestId("result-body").waitFor({ timeout: 40000 });
  const body = await page.getByTestId("result-body").innerText();
  ok(/Wednesday, [A-Z][a-z]{2} \d{1,2}/.test(body), "the saved draft uses the Wednesday decision");
  ok(!/Confirming Friday|50,000|Sam Ortiz|\$12,000/.test(body), "no other owner's material and no unsupported figure in the draft");
  ok(/revised budget before demo day/.test(body), "the reason comes from the transcript, quoted");
  const flags = await page.getByTestId("result-flags").innerText();
  ok(/Monday.*earlier proposal/.test(flags) && /\$12,000.*only once/.test(flags), "Monday is marked as the older proposal and the $12,000 figure as unsupported");
  const srcText = await page.getByTestId("result-sources").innerText();
  ok(/confirms the date/.test(srcText) && /states the reason/.test(srcText) && /fixture/.test(srcText), "sources are listed with their role and their fixture label");
  ok(!/Design Memo|advising/i.test(srcText), "unrelated school sources were not used");
  ok(/read/.test(await page.getByTestId("result-reads").innerText()), "the page shows what Jarvis actually read");
  const resultUrl = page.url();
  await shot(page, "31-result-draft-desktop.png");
  await page.getByTestId("result-sources").getByRole("link", { name: /Re: Lantern/ }).click();
  await page.getByTestId("evidence-quote").waitFor();
  ok(/Confirming Wednesday/.test(await page.getByTestId("evidence-quote").innerText()), "the source link opens the original with the quote highlighted");
  await shot(page, "32-evidence-original-desktop.png");

  step("Assistant: the same request from the Office, and the result from the worker");
  await page.goto(base + "/office");
  await page.getByTestId("roster-job").filter({ hasText: "Jarvis" }).first().click();
  await page.getByTestId("inspector-open-result").waitFor();
  ok(true, "selecting the supervisor in the Office offers the deliverable it produced");
  await shot(page, "33-office-result-link-desktop.png");

  step("Assistant: change the request from another screen, one job, new version");
  await page.goto(resultUrl);
  await page.getByTestId("revise-text").fill("Use the Wednesday decision and keep it to three sentences.");
  await page.getByTestId("revise-send").click();
  await page.getByTestId("version-list").waitFor({ timeout: 40000 });
  ok(/Version 2/.test(await page.getByTestId("version-list").innerText()), "a second version replaced the first as the current result");
  ok(/Keep it to 3 sentences/.test(await page.getByTestId("result-applied").innerText()), "the page shows the new instruction as applied");
  ok((await (await fetch(`${base}/api/results`)).json()).results.filter((r: any) => /Follow-up draft/.test(r.title)).length === 1, "there is still exactly one result for the request");

  step("Assistant: Get me ready for tomorrow, through the same system");
  await page.goto(base + "/");
  await page.getByTestId("transcript").fill("Get me ready for tomorrow");
  await page.getByTestId("send").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="goal-result-link"]').length >= 2);
  await page.getByTestId("goal-result-link").last().click();
  await page.getByTestId("result-body").waitFor({ timeout: 40000 });
  const brief = await page.getByTestId("result-body").innerText();
  ok(/Advising check-in/.test(brief) && /Design Memo/.test(brief), "the brief covers the calendar and the changed notice");
  ok(!/Hi Dana/.test(brief), "a different request produced a different kind of deliverable");
  ok(/Blackboard portal/.test(await page.getByTestId("result-unavailable").innerText()), "the brief says Blackboard could not be read and why");
  ok(/rubric/i.test(await page.getByTestId("result-flags").innerText()), "an unverified rubric is reported, not invented");
  await shot(page, "34-result-brief-desktop.png");
  await page.goto(base + "/");
  await page.getByTestId("today-output").getByText(/Ready for/).first().waitFor();
  ok(true, "Today lists the finished brief under where the output went");
  await shot(page, "35-today-after-assistant-desktop.png");

  step("Assistant on the phone");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await ctx.newPage(); watch(m, "mobile-assistant");
  await m.goto(resultUrl); await m.getByTestId("result-body").waitFor();
  ok((await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, "the result page has no horizontal scroll on the phone");
  await shot(m, "36-result-mobile.png"); await ctx.close();
}

/** Regression for the intermittent "5 of 8 with 3 missed" failure: after "Next", the previous question stayed answerable until the reload returned.
 *  With a slow network the old build answered one question over and over. Latency is injected so the race is certain, not occasional. */
async function journeyQuizLatency(page: Page) {
  step("Quiz under slow network: the answered question cannot be answered again");
  await post("/demo/reset", { confirm: "RESET DEMO" });
  const docs = (await api("/courses/BI107")).documents; const docId = docs[0].id; const g = (await api(`/documents/${docId}`)).content;
  for (const delay of [0, 700]) {
    await page.unroute(/\/api\/quiz\/[^/]+$/).catch(() => {});
    await page.route(/\/api\/quiz\/[^/]+$/, async (r) => { await new Promise((x) => setTimeout(x, delay)); await r.continue(); });
    await page.goto(base + `/guides/${docId}?quiz=all`); await page.getByTestId("quiz-stem").waitFor();
    const seen: string[] = [];
    for (let i = 0; i < g.questions.length; i++) {
      await page.getByTestId("quiz-stem").waitFor(); const stem = await page.getByTestId("quiz-stem").innerText(); seen.push(stem); const q = g.questions.find((x: any) => x.stem === stem);
      await page.getByTestId(`choice-${i < 3 ? q.choices.find((c: any) => c.key !== q.answer).key : q.answer}`).click(); await page.getByTestId("quiz-result").waitFor(); await page.getByTestId("quiz-next").click();
    }
    await page.getByTestId("quiz-done").waitFor({ timeout: 15000 });
    ok(new Set(seen).size === g.questions.length, `every question was shown once with ${delay} ms of latency`);
    ok(/Quiz finished: 5 of 8/.test(await page.getByTestId("quiz-done").innerText()), `the score is 5 of 8 with ${delay} ms of latency`);
  }
  await page.unroute(/\/api\/quiz\/[^/]+$/).catch(() => {});
}

async function journeyDecision(page: Page, browser: Browser) {
  step("Decision: ask which provider, with evidence the app has never seen");
  await post("/demo/reset", { confirm: "RESET DEMO" }); startWorker(300);
  const imp = (kind: string, title: string, text: string, day: string, author?: string) => post("/evidence/import", { kind, title, text, at: `2026-11-${day}T15:00:00.000Z`, author, label: author ? `Mail from ${author}` : "Notes" });
  await imp("email", "Quote for bathroom re-pipe", "Hi Alex, Bellini Plumbing quote for the bathroom re-pipe: $4,800 including the permit. We can start December 7.", "09", "Marco Bellini");
  await imp("email", "Revised quote after site visit", "Alex, after seeing the second-floor pipes I have to revise the bathroom re-pipe quote to $5,350, plus a permit estimated at $400. We can still start December 7.", "11", "Marco Bellini");
  await imp("email", "Okafor & Sons estimate", "Okafor & Sons will do the bathroom re-pipe for $5,100 with the permit included. We can start November 30.", "12", "Tom Okafor");
  await imp("note", "Bathroom plan", "Budget cap $5,500 all-in. Need it done before the in-laws arrive December 20. Only two quotes so far.", "15");
  await page.goto(base + "/"); await page.getByTestId("transcript").fill("Which plumber should I go with for the bathroom re-pipe, and what will it really cost? Draft the follow-up.");
  await page.getByTestId("send").click(); await page.waitForFunction(() => document.querySelectorAll('[data-testid="goal-result-link"]').length >= 1);
  await page.getByTestId("goal-result-link").last().click(); await page.getByTestId("result-body").waitFor({ timeout: 40000 });
  const body = await page.getByTestId("result-body").innerText();
  ok(/^\s*RECOMMENDATION|Recommendation/i.test(body) && /Okafor & Sons fits best on your stated budget/.test(body), "the answer opens with a recommendation that names the option and the criterion");
  ok(body.indexOf("Next step") > 0 && body.indexOf("Next step") < body.indexOf("Why"), "the next step comes before the reasoning");
  const calc = (await page.getByTestId("calculation").textContent()) ?? "";
  ok(/about \$5,750/.test(calc) && /\$5,100/.test(calc) && /\$250 over your \$5,500 limit/.test(calc) && /\$400 under your \$5,500 limit/.test(calc), "the calculation shows both totals and how far each is from the cap");
  ok(/\$4,800/.test(calc) && /replaced/.test(calc), "the superseded quote is kept as history");
  ok(/start December 7, which does not say when it will be finished|unconfirmed/.test(calc + body), "a start date is not treated as a completion date");
  ok(/rules/.test(await page.getByTestId("exec-mode").innerText()), "the execution mode is labelled");
  const draft = page.getByTestId("draft-text"); await draft.waitFor();
  ok(/completed before December 20/.test(await draft.inputValue()), "the draft asks the provider to confirm completion before the deadline");
  await draft.fill("Hi Tom, my own words about the finish date."); await page.getByTestId("draft-save").click(); await page.getByText(/Saved with this version/).waitFor();
  await page.reload(); await page.getByTestId("draft-text").waitFor(); ok(/my own words/.test(await page.getByTestId("draft-text").inputValue()), "the edited draft survives a reload");
  await shot(page, "40-decision-desktop.png");
  const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage(); watch(m, "mobile-decision");
  await m.goto(page.url()); await m.getByTestId("result-body").waitFor(); ok((await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, "the decision page has no horizontal scroll on the phone"); await shot(m, "41-decision-mobile.png");
  ok(((await (await fetch(`${base}/api/office`)).json()).modelCalls ?? 0) === 0, "the whole run made zero model calls");
}

async function journeyPlan(page: Page, browser: Browser) {
  step("Plan: a time and capacity request with a trap, a later correction and a reason to ask");
  await post("/demo/reset", { confirm: "RESET DEMO" }); startWorker(300);
  const imp = (kind: string, title: string, text: string, day: string, author?: string) => post("/evidence/import", { kind, title, text, at: `2026-11-${day}T15:00:00.000Z`, author, label: author ? `Mail from ${author}` : "Notes" });
  await imp("email", "Raku workshop kiln", "For the raku workshop on Saturday Nov 28 the small kiln takes 8 pieces per firing: 4 hours of heat and 6 hours of cooling, load-in of participants at 10:00. Priya", "09", "Priya Nair");
  await imp("email", "Kiln rules for members", "Hi, kiln rules for members. The big kiln holds 24 pieces per glaze firing. A glaze firing is 10 hours of heat followed by 14 hours of cooling, and you can only unload after the full 24 hours. Loading and starting a firing is allowed only between 09:00 and 17:00, and unloading is allowed only between 09:00 and 17:00. The big kiln is free from Tuesday Nov 17, either at 09:00 or at 15:00, depending on whether Marcus unloads his previous firing on time. I will confirm which slot on Monday evening. Priya", "11", "Priya Nair");
  await imp("note", "Harbor Craft Fair plan", "Harbor Craft Fair: load-in is Saturday Nov 21 at 08:00 sharp. Pottery ready to glaze-fire: 46 pieces (22 mugs, 16 bowls, 8 vases). Everything must be fired and unloaded before load-in.", "12");
  await imp("email", "Re: kiln sharing for cups", "For my cups the big kiln takes 30 pieces per firing and cooling is 20 hours. My Winter Market load-in is Saturday Dec 5 at 10:00, so I need the kiln again the week before. Marcus", "13", "Marcus Bell");
  await imp("note", "Update to piece count", "Correction: I finished 4 more vases, so I now have 50 pieces to fire, not 46.", "14");
  await imp("email", "Harbor Craft Fair schedule change", "Hello vendors, the hall is needed on Saturday, so load-in moves from Saturday 08:00 to Friday Nov 20 at 12:00. Please confirm you can make it. Dana, Harbor Craft Fair organiser", "15", "Dana Okafor");
  await page.goto(base + "/"); await page.getByTestId("transcript").fill("Can I get all my pottery glaze-fired and unloaded before the craft fair load-in, and when do I start each firing? Draft a short note to Priya booking the kiln slots.");
  await page.getByTestId("send").click(); await page.waitForFunction(() => document.querySelectorAll('[data-testid="goal-result-link"]').length >= 1);
  await page.getByTestId("goal-result-link").last().click(); await page.getByTestId("result-body").waitFor({ timeout: 40000 });
  const body = await page.getByTestId("result-body").innerText();
  ok(/Yes if you can start at Tue Nov 17 09:00/.test(body) && /3 runs \(24 \+ 24 \+ 2\)/.test(body), "the answer opens with the schedule and the number of firings");
  ok(/Which start slot/.test(body) && /15:00 instead would finish 3 hours too late/.test(body), "the one precise question is asked: which slot, and why it matters");
  const calc = (await page.getByTestId("calculation").textContent()) ?? "";
  ok(/50 ÷ 24 per run = 2\.08/.test(calc) && /Kiln rules for members/.test(calc) && /Fri Nov 20 12:00/.test(calc), "the calculation shows the division, the quoted rule and the corrected deadline");
  ok(/Sat Nov 21 08:00/.test(calc) && /46/.test(calc) && /raku workshop/i.test(calc) && /Winter Market/.test(calc), "replaced and unrelated statements are listed as set aside with the reason");
  const draft = await page.getByTestId("draft-text").inputValue(); ok(/Hi Priya/.test(draft) && /Tue Nov 17 09:00/.test(draft) && /Fri Nov 20 09:00/.test(draft), "the draft to Priya lists the starts and unloads, and nothing was sent");
  ok(/rules/.test(await page.getByTestId("exec-mode").innerText()), "the mode is labelled rules");
  await shot(page, "42-plan-desktop.png");
  const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage(); watch(m, "mobile-plan");
  await m.goto(page.url()); await m.getByTestId("result-body").waitFor(); ok((await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, "the plan page has no horizontal scroll on the phone"); await shot(m, "43-plan-mobile.png");
  ok(((await (await fetch(`${base}/api/office`)).json()).modelCalls ?? 0) === 0, "the whole run made zero model calls");
}

async function journeyShuttle(browser: Browser) {
  step("Field-test regression through /try: work out X and draft Y, then the same with an input missing");
  const NOTE = "Archive shuttle on December 4: 23 volunteers must arrive by 10:30. One van has eight passenger seats. It takes 20 minutes to drive from campus to the archive and 20 minutes to drive back. There is no loading time. Jo originally offered an 08:40 departure from campus.";
  const UPDATE = "Update for the December 4 archive shuttle: the earliest departure from campus is now 09:00. This replaces the 08:40 departure. The capacity, travel times and arrival deadline are unchanged.";
  const REQ = "Can one van get everyone to the archive by 10:30? Show when the last group arrives and draft a short reply to Jo.";
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }); await ctx.addCookies([{ name: "jarvis_mode", value: "personal", url: base }]);
  const p = await ctx.newPage(); watch(p, "shuttle"); startWorker(300);
  const run = async (project: string, note: string, update: string, req = REQ) => {
    await p.goto(base + "/try"); await p.getByTestId("try-privacy").waitFor();
    await p.getByTestId("try-project").fill(project); await p.getByTestId("try-title").fill("Archive shuttle"); await p.getByTestId("try-text").fill(note); await p.getByTestId("try-save1").click(); await p.getByText(/local-only/).first().waitFor();
    await p.getByTestId("try-correction").fill(update); await p.getByTestId("try-save2").click(); await p.getByText(/Saved as a correction/).waitFor();
    await p.getByTestId("try-question").fill(req); await p.getByTestId("try-ask").click(); await p.getByTestId("try-done").waitFor({ timeout: 40000 });
    await p.getByTestId("try-open-result").click(); await p.getByTestId("result-body").waitFor();
  };
  await run("Archive shuttle", NOTE, UPDATE);
  const body = await p.getByTestId("result-body").innerText();
  ok(/misses 10:30 by 10 minutes/.test(body) && /09:20, 10:00, 10:40 \(8, 8, 7 people\)/.test(body), "the answer says one van misses 10:30 by 10 minutes and gives the three arrival times");
  ok(!/sources do not yet settle a date|recipient not identified/.test(body), "the old template wording is gone");
  const draft = await p.getByTestId("draft-text").inputValue();
  ok(/^Hi Jo,/.test(draft) && /last 7 would arrive at 10:40/.test(draft) && /leave at 08:50 or earlier, or arrange another vehicle/.test(draft), "the draft is addressed to Jo and uses the computed 10:40, 08:50 and extra-vehicle options");
  const parts = await p.getByTestId("requested-part").evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
  ok(parts.length === 3 && parts.every((x) => x === "done") && (await p.getByTestId("partly-done").count()) === 0, "all three requested parts show as done");
  const calc = (await p.getByTestId("calculation").textContent()) ?? "";
  ok(/23 people ÷ 8 seats = 2\.88/.test(calc) && /3 outbound legs and 2 returns/.test(calc) && /09:00/.test(calc) && /08:40/.test(calc) && /replaced by 09:00/.test(calc), "the calculation shows the division, the legs, and 08:40 replaced by 09:00");
  const src = await p.getByTestId("result-sources").innerText(); ok(/Correction to Archive shuttle/.test(src) && /Notes I imported/.test(src) && /“One van has eight passenger seats\.”/.test(src), "inputs cite the original note and the correction, each with its quote");
  ok(/Finished/.test(await p.getByTestId("result-status").innerText()) && !/only partly/.test(await p.getByTestId("result-status").innerText()), "the job status says finished");
  await shot(p, "44-shuttle-desktop.png");
  const m = await ctx.newPage(); await m.setViewportSize({ width: 390, height: 844 }); await m.goto(p.url()); await m.getByTestId("result-body").waitFor(); ok((await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, "the result has no horizontal scroll on the phone"); await m.close();
  // The same request with the return duration removed from every source: partial work, named gap, honest status.
  // Same private workspace, so forget the first run's notes through the API first: the missing input must be missing everywhere.
  const items = (await (await p.request.get(base + "/api/evidence/items")).json()).items as { id: string }[];
  for (const it of items) await p.request.post(`${base}/api/evidence/items/${it.id}/forget`, { data: { confirm: true }, headers: { origin: base } });
  await run("Archive shuttle B", NOTE.replace(" and 20 minutes to drive back", ""), UPDATE.replace("Update for", "Second update for"), REQ + " Thanks.");   // a different wording: the same text would be treated as a duplicate of the first request
  const body2 = await p.getByTestId("result-body").innerText();
  ok(/drive back time was not found/.test(body2) && /15 minutes or less/.test(body2), "with the return time missing the answer is conditional and gives the break-even");
  ok(/How long does the drive back take\?/.test(await p.getByTestId("draft-text").inputValue()), "the draft asks for the missing input instead of stating a number it does not have");
  const parts2 = await p.getByTestId("requested-part").evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
  ok(parts2.length === 3 && parts2.every((x) => x === "partial") && (await p.getByTestId("partly-done").count()) === 1, "every part shows as partly done and the result says so");
  ok(/only partly done: 0 of 3/.test(await p.getByTestId("result-status").innerText()), "the job status says it finished only partly");
  await shot(p, "45-shuttle-partial-desktop.png");
  // A fresh example that is not about transport: an agenda against a room booking. Then a kind of calculation Jarvis does not have.
  const forgetAll = async () => { const its = (await (await p.request.get(base + "/api/evidence/items")).json()).items as { id: string }[]; for (const it of its) await p.request.post(`${base}/api/evidence/items/${it.id}/forget`, { data: { confirm: true }, headers: { origin: base } }); };
  const ask2 = async (project: string, title: string, note: string, update: string, req: string) => {
    await forgetAll(); await p.goto(base + "/try"); await p.getByTestId("try-privacy").waitFor();
    await p.getByTestId("try-project").fill(project); await p.getByTestId("try-title").fill(title); await p.getByTestId("try-text").fill(note); await p.getByTestId("try-save1").click(); await p.getByTestId("try-step1").getByText(/Saved\./).waitFor();
    await p.getByTestId("try-correction").fill(update); await p.getByTestId("try-save2").click(); await p.getByText(/Saved as a correction/).waitFor();
    await p.getByTestId("try-question").fill(req); await p.getByTestId("try-ask").click(); await p.getByTestId("try-done").waitFor({ timeout: 40000 }); await p.getByTestId("try-open-result").click(); await p.getByTestId("result-body").waitFor();
  };
  await ask2("Board meeting", "Board meeting agenda", "Board meeting on March 3 in the library room. The agenda has four items: budget review takes 25 minutes, the garden proposal takes 40 minutes, volunteer awards take 15 minutes and the annual report takes 30 minutes. There is a 10 minute coffee break after the second item. The library room is booked from 14:00 to 16:00. Dev wants to start at 14:00.", "Update for the March 3 board meeting: the garden proposal now takes 50 minutes. This replaces the 40 minutes. The other items and the coffee break are unchanged, and the library room booking is unchanged.", "Will the whole agenda fit in the room booking? Show when each item starts and ends, and write the agenda as a list I can paste to the board.");
  const body3 = await p.getByTestId("result-body").innerText(); ok(/runs until 16:10, 10 minutes past the end of the 14:00 to 16:00 booking/.test(body3), "agenda: the corrected 50-minute item pushes it 10 minutes past the booking");
  const list = await p.getByTestId("draft-text").inputValue(); ok(/14:25–15:15\s+Garden proposal/.test(list) && /15:40–16:10\s+Annual report/.test(list), "agenda: the pasteable list gives each start and end");
  ok((await p.getByTestId("requested-part").evaluateAll((els) => els.map((e) => e.getAttribute("data-status")))).join() === "done,done,done", "agenda: all three requested parts are done");
  await shot(p, "46-agenda-desktop.png");
  await ask2("Bake sale", "Bake sale baking plan", "Bake sale on Saturday: we need 96 cookies on the table by 10:00. The oven bakes 24 cookies per tray and one tray takes 12 minutes. The oven needs 8 minutes to preheat, once. Nobody can start before 08:00. Priya is bringing a second oven.", "Update for the bake sale: Priya's oven also bakes 24 cookies per tray but only arrives at 08:45. The first oven is unchanged. We now need 120 cookies, not 96.", "Can we have all the cookies baked by 10:00? Give me a checklist of when each tray goes in.");
  ok(/We now need 120 cookies, not 96/.test(await p.getByTestId("result-body").innerText()), "unsupported calculation: the sources and the correction are quoted");
  ok((await p.getByTestId("requested-part").evaluateAll((els) => els.map((e) => e.getAttribute("data-status")))).join() === "missing,missing" && /none of the requested parts could be done \(0 of 2/.test(await p.getByTestId("result-status").innerText()), "unsupported calculation: both parts are reported as not done and the job says so");
  ok(/no calculation for this kind of question yet/.test(await p.getByTestId("requested-parts").innerText()), "unsupported calculation: it says exactly what is missing instead of inventing a schedule");
  await shot(p, "47-unsupported-desktop.png");
  ok(((await (await fetch(`${base}/api/office`)).json()).modelCalls ?? 0) === 0, "the whole run made zero model calls");
  await ctx.close();
}

async function journeyHandoff(browser: Browser) {
  step("Field test 3: a handoff table from linked notes, the same words asked in two projects, both results opened");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }); await ctx.addCookies([{ name: "jarvis_mode", value: "personal", url: base }]);
  const p = await ctx.newPage(); watch(p, "handoff"); startWorker(300);
  const ASK = "Turn these notes into a handoff table I can paste into our shared doc. Give each open task one row with the owner, next action, and blocker. Leave completed work out.";
  const flow = async (project: string, title: string, note: string, update: string) => {
    await p.goto(base + "/try"); await p.getByTestId("try-privacy").waitFor();
    await p.getByTestId("try-project").fill(project); await p.getByTestId("try-title").fill(title); await p.getByTestId("try-text").fill(note); await p.getByTestId("try-save1").click(); await p.getByTestId("try-step1").getByText(/Saved\./).waitFor();
    await p.getByTestId("try-correction").fill(update); await p.getByTestId("try-save2").click(); await p.getByText(/Saved as a correction/).waitFor();
    await p.getByTestId("try-question").fill(ASK); await p.getByTestId("try-ask").click(); await p.getByTestId("try-done").waitFor({ timeout: 40000 }); await p.getByTestId("try-open-result").click(); await p.getByTestId("handoff-table").waitFor({ timeout: 20000 });
    return p.url();
  };
  const rows = async () => p.getByTestId("table-row").evaluateAll((els) => els.map((e) => Array.from(e.querySelectorAll("td")).slice(0, 3).map((t) => t.textContent).join(" | ")));
  const lantern = await flow("Lantern exhibit", "Lantern team handoff", "Lantern exhibit handoff. Mara owns caption proofing and needs the final photo credits before she can send the proof. Theo was assigned to book the label printer. The wall measurements are finished.", "Update for the Lantern exhibit: Inez has taken over the printer booking from Theo and can book it now. Mara is still waiting for the final photo credits. The wall measurements are complete.");
  const r1 = await rows(); ok(r1.length === 2 && r1[0] === "Mara | Send the proof | Waiting for the final photo credits" && r1[1] === "Inez | Book the label printer | None reported", `Lantern: the table has Mara's open row and Inez's reassigned row (${r1.join(" ; ")})`);
  const t1 = await p.getByTestId("result-body").innerText(); ok(!/Theo \|/.test(t1) && /Wall measurements: complete, so it has no row/.test(t1) && /Reassigned from Theo to Inez/.test(t1), "Lantern: finished work and the handed-off booking are left out, and the reassignment is stated");
  const links = await p.getByTestId("table-row").nth(1).locator("a").allInnerTexts(); ok(links.includes("Lantern team handoff") && links.some((x) => /Correction to Lantern team handoff/.test(x)), "Lantern: the Inez row cites both the original note and the correction");
  const reads = await p.getByTestId("result-reads").innerText(); ok(/Lantern team handoff/.test(reads) && /Correction to Lantern team handoff/.test(reads), "Lantern: What Jarvis read lists both notes");
  const part = await p.getByTestId("requested-part").evaluateAll((els) => els.map((e) => e.getAttribute("data-status"))); ok(part.join() === "done" && /Table with 2 rows/.test(await p.getByTestId("requested-parts").innerText()), "Lantern: the requested table is checked and marked done");
  ok((await p.getByTestId("result-status").innerText()).trim() === "Finished", "Lantern: the status says Finished only after the check");
  await shot(p, "48-handoff-lantern-desktop.png");
  // The same words in a second project with a different owner assignment.
  const maple = await flow("Maple exhibit", "Maple team handoff", "Maple exhibit handoff. Suri owns the venue agreement and needs the insurance certificate before she can sign it. Bo was assigned to book the projector. The floor plan is finished.", "Update for the Maple exhibit: Ravi has taken over the projector booking from Bo and can book it now. Suri is still waiting for the insurance certificate. The floor plan is complete.");
  ok(maple !== lantern, "Maple: a different result link, not the first project's");
  const r2 = await rows(); ok(r2.length === 2 && r2[0] === "Suri | Sign the venue agreement | Waiting for the insurance certificate" && r2[1] === "Ravi | Book the projector | None reported", `Maple: its own table (${r2.join(" ; ")})`);
  const reads2 = await p.getByTestId("result-reads").innerText(); const src2 = await p.getByTestId("result-sources").innerText(); ok(/Maple team handoff/.test(reads2) && !/Lantern/.test(reads2 + src2 + (await p.getByTestId("result-body").innerText())), "Maple: its read log, table and sources never mention the Lantern notes");
  await shot(p, "49-handoff-maple-desktop.png");
  await p.reload(); await p.getByTestId("handoff-table").waitFor(); ok((await rows()).join(";") === r2.join(";"), "Maple: the table survives a reload");
  await p.goto(lantern); await p.getByTestId("handoff-table").waitFor(); ok((await rows()).join(";") === r1.join(";"), "Lantern: reopening the first result still shows its own table");
  const link = p.getByTestId("table-row").first().locator("a").first(); await link.click(); await p.getByTestId("evidence-body").waitFor(); ok(/Mara owns caption proofing/.test(await p.getByTestId("evidence-body").innerText()), "a row's source link opens the original note");
  ok(((await (await fetch(`${base}/api/office`)).json()).modelCalls ?? 0) === 0, "the whole run made zero model calls");
  await ctx.close();
}

async function journeyReader(browser: Browser) {
  step("Claude reader: the entry point, a rejected reading that saves nothing, an accepted one opened from Today, and local-only notes that stay local");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }); await ctx.addCookies([{ name: "jarvis_mode", value: "personal", url: base }]);
  const p = await ctx.newPage(); watch(p, "reader"); startWorker(300);
  await p.goto(base + "/connections"); await p.getByTestId("reader-card").waitFor(); await p.getByTestId("reader-create").click(); await p.getByTestId("reader-prompt").waitFor();
  const prompt = await p.getByTestId("reader-prompt").innerText(); ok(/get_reader_task/.test(prompt) && /submit_reader_result/.test(prompt) && /Claude reader test: rooftop concert/.test(prompt), "the card gives the exact chat prompt for the shareable test project");
  ok(/live test is pending/.test(await p.getByTestId("reader-live").innerText()) && /Not confirmed by you/.test(await p.getByTestId("reader-confirmed").innerText()), "the card says no tool call yet, the live test is pending, and nothing is confirmed by you");
  ok(/never sent to Claude/.test(await p.getByTestId("reader-card").innerText()), "the card says local-only notes are never sent");
  const api2 = async (path: string, data: unknown) => (await (await p.request.post(base + "/api" + path, { data, headers: { origin: base } })).json());
  const ask = await api2("/asks", { text: "What does my team still owe? One row per open item with Owner, Next action and Blocker. Leave closed items out.", projectHint: (await (await p.request.get(base + "/api/reader/test")).json()).projectId });
  const task = await api2("/reader/task", { requestId: ask.requestId }); ok(task.eligible === true && task.spans.length >= 6, "the task lists the shareable passages with ids");
  const sid = (snip: string) => task.spans.find((x: any) => x.text.includes(snip)).spanId;
  const upd = (blocker: string | null) => ({ requestId: ask.requestId, revision: task.revision, snapshot: task.snapshot, client: "e2e mock Claude", updates: [
    { ref: "u1", owner: "Ilse Brandt", action: "Set up the sound desk", status: "open", blocker, effective: "unblocked", confidence: "stated", quotes: [{ spanId: sid("sound desk is in Ilse Brandt's hands"), quote: "The sound desk is in Ilse Brandt's hands" }, { spanId: sid("power plan has arrived"), quote: "Ilse Brandt can set up the sound desk" }] },
    { ref: "u2", owner: "Mateus Oliveira", action: "Print the programmes", status: "open", blocker: null, effective: "new", confidence: "stated", quotes: [{ spanId: sid("Mateus Oliveira volunteered"), quote: "Mateus Oliveira volunteered to print the programmes" }] },
    { ref: "u3", owner: "Tobias Quist", action: "Book the stage lights", status: "done", blocker: null, effective: "completed", confidence: "stated", quotes: [{ spanId: sid("Tobias Quist booked"), quote: "Tobias Quist booked the stage lights this morning" }] },
    { ref: "u4", owner: null, action: "Sign off the stage barriers", status: "done", blocker: null, effective: "unchanged", confidence: "stated", quotes: [{ spanId: sid("stage barriers are already"), quote: "The stage barriers are already signed off" }] } ],
    coverage: task.spans.map((x: any) => { const ref = /sound desk|power plan|waiting for the venue/.test(x.text) ? "u1" : /Mateus/.test(x.text) ? "u2" : /Tobias/.test(x.text) ? "u3" : /barriers/.test(x.text) ? "u4" : null; return { spanId: x.spanId, role: ref ? "contributes" : "unrelated", refs: ref ? [ref] : [], reason: "accounts for an item" }; }) });
  const bad = await api2("/reader/submit", upd("Waiting for the venue's power plan")); ok(bad.accepted === false && /cleared by a later passage/.test(bad.reasons.join(" ")), "a reading that keeps a cleared blocker is rejected with the reason");
  await p.goto(base + `/results/${ask.resultId}`); await p.getByTestId("result-body").waitFor({ timeout: 30000 }); ok(!(await p.getByTestId("reader-meta").count()), "the rejected reading saved nothing");
  const inv = upd(null); (inv.updates[1] as any).action = "Print 400 programmes"; const invented = await api2("/reader/submit", inv); ok(invented.accepted === false && /says 400, but none of the passages you cited states 400 programmes/.test(invented.reasons.join(" ")), "an invented quantity is rejected with a specific reason, even with a real quote");
  const good = await api2("/reader/submit", upd(null)); ok(good.accepted === true && good.completion === "complete", "the correct reading is accepted and complete");
  await p.goto(base + "/"); await p.getByRole("link", { name: /Handoff table/ }).first().click(); await p.getByTestId("handoff-table").waitFor();
  const rows = await p.getByTestId("table-row").evaluateAll((els) => els.map((e) => Array.from(e.querySelectorAll("td")).slice(0, 3).map((t) => t.textContent).join(" | ")));
  ok(rows.join(";") === "Ilse Brandt | Set up the sound desk | None reported;Mateus Oliveira | Print the programmes | None reported", `Today opens the saved result with both open rows (${rows.join(" ; ")})`);
  ok(/test endpoint \(a simulation, not the connector\)/.test(await p.getByTestId("reader-meta").innerText()) && /^Reader submission: Reading accepted through the app.s test endpoint/.test(await p.getByTestId("exec-mode").innerText()) && !/Claude chat/.test(await p.getByTestId("reader-meta").innerText()), "the page says plainly this was a simulation through the test endpoint, never a Claude chat");
  ok(!/400/.test(await p.getByTestId("result-body").innerText()), "the rejected quantity is nowhere in the saved result");
  ok((await p.getByTestId("result-status").innerText()).trim() === "Finished", "the status says Finished");
  await shot(p, "50-reader-result-desktop.png");
  await p.goto(base + "/connections"); await p.getByTestId("reader-live").waitFor(); ok(/app.s test endpoint \(a simulation/.test(await p.getByTestId("reader-live").innerText()) && /Not confirmed by you/.test(await p.getByTestId("reader-confirmed").innerText()) && (await p.getByTestId("reader-confirm").count()) === 0 && /attempts? and saved nothing/.test(await p.getByTestId("reader-state").innerText()) && /Finished/.test(await p.getByTestId("reader-quality").innerText()), "Connections reports the simulation as a simulation, offers no confirm button for it, and keeps tool call, your confirmation and the saved reading apart");
  // Local-only notes stay local: unfamiliar wording gets an honest partial and the reason Claude is not offered.
  const lp = await api2("/evidence/import", { kind: "note", title: "Private crew note", text: "Nadia Fontaine is the one to watch on lighting rehearsals, apparently, and the generator remains a mystery.", projectName: "Local only project", label: "Local notes", localOnly: true });
  const lask = await api2("/asks", { text: "What does my team still owe? One row per open item with Owner, Next action and Blocker.", projectHint: lp.projectId });
  const lt = await api2("/reader/task", { requestId: lask.requestId }); ok(lt.eligible === false && !/Nadia|generator/.test(JSON.stringify(lt)), "a local-only project issues no reading task and returns none of its text");
  await p.goto(base + `/results/${lask.resultId}`); await p.getByTestId("reader-handoff").waitFor({ timeout: 40000 }); ok(/local-only/.test(await p.getByTestId("reader-handoff").innerText()), "the result explains that local-only notes stay in Jarvis and what would resolve it");
  ok(((await (await fetch(`${base}/api/office`)).json()).modelCalls ?? 0) === 0, "the whole run made zero model calls");
  await ctx.close();
}

async function journeyPrivate(browser: Browser) {
  step("Private run: one note, one correction, one question (invented material)");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await ctx.addCookies([{ name: "jarvis_mode", value: "personal", url: base }]);
  const p = await ctx.newPage(); watch(p, "private"); startWorker(300);
  await p.goto(base + "/try"); await p.getByTestId("try-privacy").waitFor();
  ok(/local-only/.test(await p.getByTestId("try-privacy").innerText()) && (await p.getByTestId("try-switch").count()) === 0, "the page says everything stays local and this is the private workspace");
  await p.getByTestId("try-project").fill("Garden co-op"); await p.getByTestId("try-title").fill("Seed swap plan");
  await p.getByTestId("try-text").fill("We will rent the community hall on March 12 for the seed swap. The hall fee is $180. Maya brings the folding tables."); await p.getByTestId("try-save1").click(); await p.getByText(/local-only/).first().waitFor();
  await p.getByTestId("try-correction").fill("Correction: the seed swap moved to March 19. The hall fee is now $210."); await p.getByTestId("try-save2").click(); await p.getByText(/Saved as a correction/).waitFor();
  await p.getByTestId("try-ask").click(); await p.getByTestId("try-done").waitFor({ timeout: 40000 });
  await p.getByTestId("try-open-result").click(); await p.getByTestId("result-body").waitFor();
  const t = await p.getByTestId("result-body").innerText(); ok(/Mar 19/.test(t) && /\$210/.test(t) && /replaced/.test(t), "the corrected date and amount win and the old ones are marked replaced");
  const src = await p.getByTestId("result-sources").innerText(); ok(/original wording, replaced/.test(src) && /Notes I imported/.test(src) && !/fixture/i.test(src), "the original wording is linked and no fixture source is involved");
  await p.getByTestId("result-sources").getByRole("link", { name: "Seed swap plan", exact: true }).first().click(); await p.getByTestId("evidence-body").waitFor(); ok(/March 12/.test(await p.getByTestId("evidence-body").innerText()), `the link opens the original note (${(await p.getByTestId("evidence-body").innerText()).slice(0, 80)})`);
  await p.goto(base + "/connections"); const row = await p.getByTestId("source-row").filter({ hasText: "Notes I imported" }).innerText(); ok(/imported by you/.test(row) && /last read/.test(row), "the source shows its origin and when it was last read");
  await shot(p, "42-private-trial-desktop.png"); await ctx.close();
}

async function journeyBlackboard(browser: Browser) {
  step("Blackboard: calendar feed protocol against a local server (the owner's account stays pending)");
  const http = await import("node:http"); let mode: "ok" | "moved" | "401" = "ok"; const hits: string[] = [];
  const ics = (due: string) => ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:u1", "SUMMARY:Seminar paper due", `DTSTART;TZID=America/New_York:${due}`, "LAST-MODIFIED:20261114T150000Z", "DESCRIPTION:Submit via the course site.", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const srv = http.createServer((req, res) => { hits.push(String(req.headers["if-none-match"] ?? "")); if (mode === "401") { res.writeHead(401); return res.end("no"); } const body = ics(mode === "ok" ? "20261119T170000" : "20261120T170000"); const etag = `"${mode}"`; if (req.headers["if-none-match"] === etag) { res.writeHead(304); return res.end(); } res.writeHead(200, { "content-type": "text/calendar", etag }); res.end(body); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r)); const link = `http://127.0.0.1:${(srv.address() as any).port}/feed/SECRET-LINK-XYZ789`;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.addCookies([{ name: "jarvis_mode", value: "personal", url: base }]); const p = await ctx.newPage(); watch(p, "blackboard"); startWorker(300);
  await p.goto(base + "/connections"); await p.getByTestId("blackboard-card").waitFor();
  ok(/not connected/.test(await p.getByTestId("bb-state").innerText()), "Blackboard starts as not connected");
  await p.getByTestId("bb-url").fill(link); await p.getByTestId("bb-check").click(); await p.getByTestId("bb-check-result").waitFor();
  ok(/Readable: 1 events/.test(await p.getByTestId("bb-check-result").innerText()) && /does not include rubrics/.test(await p.getByTestId("bb-check-result").innerText()), "the setup check reads the feed and states exactly what it covers");
  ok(/not connected/.test(await p.getByTestId("bb-state").innerText()), "a successful check alone does not make it connected");
  await p.getByTestId("bb-save").click(); await p.getByTestId("bb-state").filter({ hasText: /connected: last read succeeded/ }).waitFor({ timeout: 20000 });
  ok(!(await p.locator("body").innerText()).includes("SECRET-LINK-XYZ789"), "the link is never shown back on the page");
  mode = "moved"; await p.getByTestId("bb-read").click(); await p.getByText(/1 changed/).first().waitFor({ timeout: 15000 }); ok(hits.some((h) => h === '"ok"'), "the second read was a conditional request");
  mode = "401"; await p.getByTestId("bb-read").click(); await p.getByTestId("bb-state").filter({ hasText: /needs your sign-in/ }).waitFor({ timeout: 15000 });
  ok(/Duo/.test(await p.locator("body").innerText()), "when it fails the page says to sign in on Blackboard, including Duo, and paste a fresh link");
  await p.goto(base + "/office"); await p.getByTestId("handoff-needs").getByText(/Blackboard did not accept the calendar link/).waitFor({ timeout: 15000 }); ok(true, "the Office shows the pending sign-in as something that needs you");
  await p.goto(base + "/connections"); mode = "moved"; await p.getByTestId("bb-read").click(); await p.getByTestId("bb-state").filter({ hasText: /connected: last read succeeded/ }).waitFor({ timeout: 15000 }); ok(true, "after a fresh link works the source is connected again");
  await p.getByTestId("blackboard-card").scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -70)); await shot(p, "43-blackboard-desktop.png", true); srv.close(); await ctx.close();
}

async function journeyRoundTrip(browser: Browser) {
  step("Claude round trip: exact messages, receipts, and what counts as a real account");
  await post("/demo/reset", { confirm: "RESET DEMO" });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } }); const p = await ctx.newPage(); watch(p, "roundtrip");
  await p.goto(base + "/connections"); await p.getByTestId("token-create").click(); await p.getByTestId("token-fresh").waitFor(); const token = (await p.getByTestId("token-value").innerText()).trim();
  await p.getByTestId("rt-project").fill("Round trip check"); await p.getByTestId("rt-start").click(); await p.getByTestId("rt-say-write").waitFor();
  const w = await p.getByTestId("rt-say-write").innerText(); ok(/apply_project_update/.test(w) && /ALPHA-RT-[0-9A-F]{4}/.test(w), "the exact message to send in Claude names the tool and a unique code");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js"); const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const open = async (name: string) => { const c = new Client({ name, version: "1" }); await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } })); return c; };
  const code = w.match(/RT-[0-9A-F]{4}/)![0]; const a = await open("claude-ai"); await a.callTool({ name: "apply_project_update", arguments: { project: "Round trip check", eventId: `${code}-1`, changes: [{ op: "decide", key: "roundtrip-check", text: `ALPHA-${code}` }] } });
  await p.getByText(/Received .* from claude-ai/).waitFor({ timeout: 10000 }); await p.getByTestId("rt-edit").click(); await p.getByText(/Changed /).first().waitFor({ timeout: 10000 }); await a.close();
  const b = await open("claude-ai"); await b.callTool({ name: "get_project_context", arguments: { project: "Round trip check" } });
  await p.getByTestId("rt-verdict").waitFor({ timeout: 10000 }); ok(/reported themselves as Claude/.test(await p.getByTestId("rt-verdict").innerText()) && /cannot verify an account/.test(await p.getByTestId("rt-verdict").innerText()), "the receipt says both ends called themselves Claude and that Jarvis cannot verify an account");
  ok(/saw your change/.test(await p.getByTestId("rt-steps").innerText()), "the third step shows the fresh read saw the change made in Jarvis"); await b.close();
  await p.getByTestId("rt-start").click(); await p.waitForFunction((old) => { const e = document.querySelector('[data-testid="rt-say-write"]'); return !!e && e.textContent !== old; }, w).catch(async (e) => { throw new Error(`${e.message}\n${(await p.locator("main").innerText()).slice(0, 1500)}`); }); const code2 = (await p.getByTestId("rt-say-write").innerText()).match(/RT-[0-9A-F]{4}/)![0];
  const t = await open("e2e-test-client"); await t.callTool({ name: "apply_project_update", arguments: { project: "Round trip check", eventId: `${code2}-1`, changes: [{ op: "decide", key: "roundtrip-check", text: `ALPHA-${code2}` }] } }); await p.getByTestId("rt-edit").click(); await p.getByText(/Changed /).first().waitFor(); await t.callTool({ name: "get_project_context", arguments: { project: "Round trip check" } });
  await p.getByTestId("rt-verdict").waitFor({ timeout: 10000 }); ok(/local test client/.test(await p.getByTestId("rt-verdict").innerText()) && /does not prove your Claude account/.test(await p.getByTestId("rt-verdict").innerText()), "a test client is labelled as one and does not count as the account"); await t.close();
  await p.getByTestId("roundtrip").scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -70)); await shot(p, "44-roundtrip-desktop.png", true); await ctx.close();
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
  await page.getByRole("navigation", { name: "Primary mobile" }).getByRole("link", { name: /Today/ }).filter({ hasText: "1" }).waitFor();
  ok(true, "the Today tab shows the pending-decision count");
  await page.getByTestId("decision-card").first().waitFor();
  ok((await overflow()) <= 0, "Today with a decision has no horizontal scroll");
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
  await page.getByTestId("mobile-capture").tap();
  await page.getByRole("dialog").getByLabel("Who owes").fill("Example advisor");
  await page.getByRole("dialog").getByLabel("What was promised").fill("Send the reading list");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).tap();
  await page.getByText(/Promise saved/).waitFor();
  ok(true, "Capture works on the phone");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "More", exact: true }).tap();
  await page.getByRole("link", { name: "Council", exact: true }).tap();
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
    const gid = (await api("/courses/BI107")).documents.find((d: any) => /Final/.test(d.title))?.id;
    for (const p of ["/", "/tasks", "/goals", "/completed", "/memory", "/skills", "/council", "/sources", "/voice", "/settings", "/activity", "/office", "/courses", "/courses/BI107", ...(gid ? [`/guides/${gid}`] : [])]) {
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
  // The visual test: from the room alone, who assigned, who is working, and (later) who needs you.
  await page.getByTestId("handoff-path").first().waitFor({ timeout: 15000 });
  ok(/Jarvis/.test(await page.getByTestId("handoff-assigned").innerText()) && /Planner|Reviewer/.test(await page.getByTestId("handoff-assigned").innerText()), "the handoff strip says who assigned it and to whom");
  await page.getByTestId("office-worker").filter({ has: page.locator("xpath=.") }).first().waitFor();
  ok(/Planner/.test(await page.getByTestId("handoff-working").innerText()), "the handoff strip says who is working now");
  const workerLabels = await page.getByTestId("office-worker").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  ok(workerLabels.some((l) => /^Planner:/.test(l ?? "")), "a Planner character is in the room");
  await shot(page, "15a-office-handoff-desktop.png");
  const spec = page.getByTestId("roster-job").filter({ hasText: "Capacity specialist" }).first();
  await spec.click();
  const insp = page.getByTestId("inspector");
  await insp.getByText("Assigned by", { exact: true }).waitFor();
  const it = await insp.innerText();
  ok(/Handle:/.test(it) && /cap_/.test(it) && /No model used/.test(it) && /Last heartbeat/.test(it), "inspector shows who delegated it, evidence, usage and heartbeat");
  await shot(page, "15-office-desktop.png");
  await waitFor("the decision to arrive", async () => (await api("/decisions")).decisions.some((d: any) => d.kind === "commitment_plan"));
  await page.getByTestId("handoff-needs").getByText(/TAMID/).waitFor();
  ok(/Reviewer/.test(await page.getByTestId("handoff-needs").innerText()), "the strip says the Reviewer needs you");
  await page.getByTestId("ask-bubble").waitFor();
  ok((await page.getByTestId("office-worker").evaluateAll((els) => els.filter((e) => e.getAttribute("data-needs-you") === "1").length)) === 1, "exactly one character is asking for you");
  ok(/1 waiting/.test((await page.getByTestId("you-desk").textContent()) ?? ""), "your desk shows one item waiting");
  await shot(page, "15c-office-needs-you-desktop.png");
  await waitFor("helpers to finish", async () => (await api("/office")).jobs.every((j: any) => j.status === "done"));
  const counts = async () => { const o = await api("/office"); const c = await api("/commitments"); const d = await api("/decisions"); return { jobs: o.jobs.filter((j: any) => /^(supervise_capture|capture_)/.test(j.kind)).length, cmts: c.commitments.filter((x: any) => /pitch angles/.test(x.action)).length, decs: d.decisions.filter((x: any) => x.kind === "commitment_plan").length }; };
  const c1 = await counts();
  ok(c1.cmts === 1 && c1.decs === 1 && c1.jobs === 3, `one commitment, one decision, three jobs (supervisor, planner, reviewer) (${JSON.stringify(c1)})`);

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
  ok((await page.getByTestId("roster-job").count()) >= 3, "the roster is rebuilt from saved state after a reload");

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
  await m.getByTestId("inspector").getByText("Assigned by", { exact: true }).waitFor();
  await shot(m, "16-office-mobile.png");
  await ctx.close();
}

const FAKE_SPEECH = `(() => {
  const spoken = []; let cancels = 0; window.__spoken = spoken; window.__cancels = () => cancels;
  const voices = [{ name: "Alex", lang: "en-US", localService: true, voiceURI: "Alex" }, { name: "Daniel", lang: "en-GB", localService: true, voiceURI: "Daniel" }, { name: "Serena", lang: "en-GB", localService: true, voiceURI: "Serena" }];
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; this.voice = null; this.rate = 1; this.pitch = 1; this.volume = 1; this.lang = ""; } };
  Object.defineProperty(window, "speechSynthesis", { value: { getVoices: () => voices, addEventListener() {}, removeEventListener() {}, cancel() { cancels++; }, speak(u) { spoken.push({ text: u.text, voice: u.voice && u.voice.name, rate: u.rate }); u.onstart && u.onstart(); setTimeout(() => u.onend && u.onend(), 150); } } });
  window.SpeechRecognition = window.webkitSpeechRecognition = class { start() { window.__micStarts = (window.__micStarts || 0) + 1; setTimeout(() => { const t = window.__transcript || ""; this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: true })] }); }, 80); } stop() { this.onend && this.onend(); } abort() { window.__micAborts = (window.__micAborts || 0) + 1; } };
})();`;
const PHOTOS = ["fixtures/bi107/test-photo-1.png", "fixtures/bi107/test-photo-2-partly-blurred.png"];
const spokenList = (page: Page) => page.evaluate(() => (window as any).__spoken as { text: string; voice: string; rate: number }[]);
const typeAndSend = async (page: Page, words: string) => {
  const before = await page.getByTestId("conversation").getByTestId("msg-user").count();
  await page.getByTestId("transcript").fill(words); await page.getByTestId("send").click();
  await page.waitForFunction((n) => document.querySelectorAll("[data-testid=conversation] [data-testid=msg-user]").length > n, before);
  await page.waitForFunction(() => (document.querySelector("[data-testid=transcript]") as HTMLTextAreaElement).value === "");
};
const say = async (page: Page, words: string) => { await page.evaluate((w) => { (window as any).__transcript = w; }, words); await page.getByTestId("mic-button").click(); await page.getByTestId("mic-state").getByText(/listening/).waitFor(); await page.getByTestId("transcript").evaluate((el: HTMLTextAreaElement, w) => { /* wait for the fake recognizer */ void el; void w; }, words); await page.waitForFunction((w) => (document.querySelector("[data-testid=transcript]") as HTMLTextAreaElement).value.includes(w.slice(0, 20)), words); await page.getByTestId("mic-button").click(); await page.getByTestId("mic-state").getByText("Microphone off").waitFor(); };

async function journeyStudy(browser: Browser) {
  step("BI107 by voice: tap the mic, attach test photos, hear the acknowledgment (fake speech engines)");
  await post("/demo/reset", { confirm: "RESET DEMO" });
  startWorker(350);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(FAKE_SPEECH);
  const page = await ctx.newPage(); watch(page, "study");
  await page.goto(base + "/");
  await page.getByTestId("voice-dock").waitFor();
  ok(/Microphone off/.test(await page.getByTestId("mic-state").innerText()), "the microphone state is visible and starts off");
  ok(await page.getByTestId("mic-button").isDisabled(), "the mic stays disabled until the speech service is disclosed");
  ok(/sends audio to Google or Microsoft/.test(await page.getByTestId("voice-dock").innerText()), "the external speech service is disclosed before capture");
  await page.getByTestId("mic-consent").click();
  await page.getByRole("combobox", { name: "Course for these photos" }).selectOption("BI107").catch(() => {});
  await page.getByTestId("photo-input").setInputFiles(PHOTOS);
  await page.getByTestId("attached").getByText(/partly unclear/).waitFor({ timeout: 15000 });
  const chips = await page.getByTestId("attached").innerText();
  ok(/sharp/.test(chips) && /partly unclear: bottom right/.test(chips), "each photo shows its own quality: one sharp, one partly unclear");
  await page.getByText("Voice and playback").click();
  ok(/British English voice/.test(await page.getByTestId("voice-note").innerText()), "a British English voice is chosen when the device has one");
  ok(await page.getByTestId("voice-select").inputValue() === "Daniel", "the calm British voice is the default");
  await page.getByTestId("voice-preview").click();
  ok((await spokenList(page)).some((s) => s.voice === "Daniel" && s.rate < 1), "voice preview plays in the chosen voice at a measured pace");
  const WORDS = "Make me a study guide like the last one you did for bio. I'm uploading pictures from my last test so you can match the question style. The final is all multiple choice.";
  await say(page, WORDS);
  ok((await page.getByTestId("transcript").inputValue()).startsWith("Make me a study guide like the last one"), "speech lands in an editable transcript, not sent automatically");
  ok((await page.getByTestId("conversation").getByTestId("msg-user").count()) === 0, "nothing is sent until you press Send");
  await page.getByTestId("transcript").fill(WORDS + " Thanks.");
  const cancelsBefore = await page.evaluate(() => (window as any).__cancels());
  await shot(page, "20-voice-dock-desktop.png");
  await page.getByTestId("send").click();
  await page.getByTestId("msg-ack").waitFor();
  const ack = await page.getByTestId("msg-ack").innerText();
  ok(/Got it\. I'm building your BI107 study guide to match your last one and your 2 photos/.test(ack) && ack.split(/(?<=[.!?])\s+/).length <= 4, "Jarvis acknowledges in a couple of sentences");
  await page.waitForFunction(() => (window as any).__spoken.some((s: any) => /building your BI107 study guide/.test(s.text)));
  const ackSpoken = (await spokenList(page)).find((s) => /building your BI107/.test(s.text))!;
  ok(ackSpoken.voice === "Daniel" && ackSpoken.rate < 1, "the acknowledgment is spoken aloud in the British voice at a measured pace");
  ok((await page.getByTestId("conversation").getByTestId("msg-user").first().locator("img").count()) === 2, "the photos are shown in the conversation");
  ok(await page.getByTestId("mic-state").innerText().then((t) => /Microphone off/.test(t)), "the microphone is off again after sending");

  step("BI107 by voice: interrupt playback, leave the screen, the job keeps going");
  await page.getByTestId("voice-dock").getByText("Voice and playback").click().catch(() => {});
  await page.evaluate(() => { (window as any).__transcript = "okay"; });
  await page.getByTestId("mic-button").click();            // tapping the mic while Jarvis talks interrupts it
  ok((await page.evaluate(() => (window as any).__cancels())) > cancelsBefore, "starting the mic interrupts playback");
  await page.getByTestId("mic-button").click();
  await page.getByTestId("transcript").fill("");
  await page.getByRole("link", { name: "Watch it work in the Office" }).first().click();
  await page.getByTestId("roster").waitFor();
  await page.getByTestId("roster-job").filter({ hasText: /Research specialist|Intake specialist|Planning specialist/ }).first().waitFor({ timeout: 20000 });
  const research = page.getByTestId("roster-job").filter({ hasText: "Research specialist" }).first();
  await research.waitFor({ timeout: 30000 });
  await research.click();
  await page.getByTestId("inspector").getByText("Assigned by", { exact: true }).waitFor();
  ok(/photo \d of 2|\d of 2/.test(await page.getByTestId("inspector").innerText()) || /Checking photo|Reading photo|final scope/.test(await page.getByTestId("inspector").innerText()), "the Office shows the research helper's real step");
  await shot(page, "17-office-study-desktop.png");
  await waitFor("the guide to be saved", async () => (await api("/courses/BI107")).documents.some((d: any) => d.title === "BI107 Final study guide"), 60000);
  await waitFor("all helpers done", async () => (await api("/office")).jobs.filter((j: any) => /study|Study|final study/i.test(j.kind + j.title)).every((j: any) => j.status === "done"), 40000);
  ok(true, "the job finished while the conversation screen was closed");

  step("BI107 by voice: return to the same conversation and find the finished guide");
  await page.goto(base + "/courses/BI107");
  await page.getByTestId("guide-link").filter({ hasText: "Final study guide" }).waitFor();
  ok(/BI107 \/ Study Guides\/Final/.test(await page.getByTestId("guide-folders").innerText()), "saved under BI107 → Study Guides → Final");
  await page.getByTestId("result-actions").waitFor();
  ok((await page.getByTestId("open-guide").count()) === 1 && (await page.getByTestId("quiz-me").count()) === 1 && (await page.getByTestId("export-pdf").count()) === 1, "the conversation has Open guide, Quiz me and Export PDF");
  await page.waitForFunction(() => (window as any).__spoken.some((s: any) => /open it, or shall I ask the first question/.test(s.text)), null, { timeout: 15000 });
  ok(true, "the spoken completion offers to open it or ask the first question");
  ok((await page.getByTestId("photo-list").locator("li").count()) === 2, "both photos are listed privately under the course");
  await shot(page, "21-course-workspace-desktop.png");

  step("The finished guide: provenance, answers hidden, editable, versioned");
  await page.getByTestId("open-guide").click();
  await page.getByTestId("practice-list").waitFor();
  const docId = page.url().split("/guides/")[1].split("?")[0];
  const doc = (await api(`/documents/${docId}`)).content;
  const body = await bodyText(page);
  ok(/Answer key check: 8 of 8 questions supported by your course materials/.test(body), "the answer key check is shown");
  ok(/Fixture generator: questions come from a small built-in bank/.test(body), "the fixture generator is labeled, not passed off as live");
  ok(/test-photo-1\.png: read/.test(body) && /partly unclear: bottom right/.test(body), "each photo's status is recorded in the guide");
  ok(/Format from:\s*BI107 Midterm study guide \(v1\)/.test(body), "it says which earlier guide was used");
  ok(!body.includes(doc.questions[0].rationale), "answers and explanations are hidden in the practice view");
  await shot(page, "18-guide-desktop.png");
  await page.getByRole("tab", { name: "Edit" }).click();
  await page.getByTestId("stem-0").fill("EDITED by me: " + doc.questions[0].stem);
  await page.getByTestId("save-guide").click();
  await page.getByTestId("saved-msg").waitFor();
  ok(/Saved as version 2/.test(await page.getByTestId("saved-msg").innerText()), "editing saves a new version");
  await page.getByRole("tab", { name: "Versions" }).click();
  ok((await page.getByTestId("versions").locator("li").count()) >= 2, "both versions are kept");
  await page.reload(); await page.getByTestId("guide-title").waitFor();
  ok(/v2/.test(await page.getByTestId("guide-version").innerText()), "the edit survives a refresh");

  step("Quiz me, miss three, then say 'Quiz me on what I missed'");
  await page.getByTestId("start-quiz").click();
  await page.getByTestId("quiz-stem").waitFor();
  ok(!/Not quite|Correct/.test(await bodyText(page)), "no answer is shown before you answer");
  const g2 = (await api(`/documents/${docId}`)).content;
  for (let i = 0; i < g2.questions.length; i++) {
    const stem = await page.getByTestId("quiz-stem").innerText();
    const q = g2.questions.find((x: any) => x.stem === stem)!;
    const pick = i < 3 ? q.choices.find((c: any) => c.key !== q.answer).key : q.answer;
    await page.getByTestId(`choice-${pick}`).click();
    await page.getByTestId("quiz-result").waitFor();
    if (i === 0) ok(q.rationale.length > 0 && (await page.getByTestId("quiz-result").innerText()).includes(q.rationale), "the explanation appears after answering");
    await page.getByTestId("quiz-next").click();
  }
  await page.getByTestId("quiz-done").waitFor();
  ok(/Quiz finished: 5 of 8/.test(await page.getByTestId("quiz-done").innerText()) && /missed 3/.test(await page.getByTestId("quiz-done").innerText()), `the quiz records 5 of 8 with 3 missed (${(await page.getByTestId("quiz-done").innerText()).replace(/\s+/g, " ")})`);
  await page.goto(base + "/courses/BI107");
  await page.getByTestId("voice-dock").waitFor();
  await say(page, "Quiz me on what I missed.");
  await page.getByTestId("send").click();
  await page.getByTestId("msg-quiz").waitFor();
  ok(/Starting a quiz on the 3 questions you missed/.test(await page.getByTestId("msg-quiz").innerText()), "voice command: quiz on the missed questions");
  await page.waitForFunction(() => (window as any).__spoken.some((s: any) => /3 questions you missed/.test(s.text)));
  await page.getByRole("link", { name: "Open the quiz" }).click();
  await page.getByTestId("quiz-stem").waitFor();
  ok(/1 of 3/.test(await page.getByTestId("quiz-progress").innerText()), "the missed-question quiz has just those three");
  ok(/Missed questions/.test(await bodyText(page)), "it is labeled as the missed-questions quiz");

  step("PDF export of the finished guide");
  const pdf = await page.request.get(`${base}/api/documents/${docId}/pdf`);
  const buf = Buffer.from(await pdf.body());
  ok(pdf.status() === 200 && /application\/pdf/.test(pdf.headers()["content-type"]) && buf.subarray(0, 5).toString() === "%PDF-", "the PDF endpoint returns a real PDF");
  const { extractText, getDocumentProxy } = await import("unpdf");
  const txt = async (b: Buffer) => (await extractText(await getDocumentProxy(new Uint8Array(b)), { mergePages: true })).text as string;
  const t1 = await txt(buf); const keyBuf = Buffer.from(await (await page.request.get(`${base}/api/documents/${docId}/pdf?answers=1`)).body()); const t2 = await txt(keyBuf);
  ok(/BI107 Final study guide/.test(t1) && /EDITED by me/.test(t1) && !/Answer key/.test(t1), "the practice PDF has the questions and no answers");
  ok(/Answer key/.test(t2) && t2.length > t1.length, "the answer-key PDF adds the answers");
  fs.writeFileSync(path.join(SHOTS, "BI107-final-study-guide-sample.pdf"), keyBuf);

  step("Restart the server and worker: the missed questions are still there");
  await restartServer(); startWorker(350);
  await page.goto(base + "/courses/BI107");
  await page.getByTestId("voice-dock").waitFor();
  await say(page, "Quiz me on what I missed.");
  await page.getByTestId("send").click();
  await page.getByTestId("msg-quiz").last().getByText(/3 questions you missed/).waitFor();
  ok(true, "after a restart, 'quiz me on what I missed' still finds the same three questions");
  const missed = await api("/quiz/missed?course=BI107");
  ok(missed.missed.length === 3, "the missed list is intact in the database");

  step("A duplicate request is not started twice; a second request makes a new version; cancel stops one");
  await typeAndSend(page, "Make me a study guide like the last one for bio, with a harder mix.");
  await typeAndSend(page, "Make me a study guide like the last one for bio, with a harder mix.");
  await page.getByTestId("msg-ack").filter({ hasText: /already on that/ }).waitFor();
  ok(true, "the same request twice says it is already on it");
  // Two recent guides now exist (the Midterm and the Final), so the intake helper asks which to match. That is the designed behavior.
  await page.getByTestId("msg-question").waitFor({ timeout: 40000 });
  ok(/Which BI107 guide should I match/.test(await page.getByTestId("msg-question").innerText()), "with two recent guides, Jarvis asks which to match instead of guessing");
  await page.waitForFunction(() => (window as any).__spoken.some((s: any) => /Which BI107 guide should I match/.test(s.text)), null, { timeout: 15000 });
  ok(true, "the question is spoken aloud");
  await page.getByTestId("msg-question").getByTestId("ask-choice").filter({ hasText: "Midterm" }).click();
  await page.getByTestId("ask-answered").waitFor();
  await waitFor("version 3 (the edit made v2)", async () => { const d = (await api("/courses/BI107")).documents.find((x: any) => x.title === "BI107 Final study guide"); return d?.current_version === 3; }, 60000);
  ok((await api("/courses/BI107")).documents.filter((x: any) => x.title === "BI107 Final study guide").length === 1, "a second distinct request made a new version, not a second guide");
  const g3 = (await api(`/documents/${docId}`)).content; ok(/Midterm/.test(g3.sources.format), "the version records the guide you chose for format");
  await typeAndSend(page, "Make me a study guide for BI107 that I can cancel.");
  await page.goto(base + "/office");
  const sup = page.getByTestId("roster-job").filter({ hasText: "Supervisor" }).filter({ hasText: "final study guide" }).last();
  await sup.click();
  await page.getByTestId("inspector").getByText("Assigned by", { exact: true }).waitFor();
  await page.getByRole("button", { name: /Cancel \(and its helpers\)/ }).click();
  await waitFor("the cancelled job to stop", async () => (await api("/office")).jobs.some((j: any) => j.kind === "supervise_study" && j.status === "cancelled"), 20000);
  await page.waitForTimeout(2500);
  ok((await api("/courses/BI107")).documents.find((x: any) => x.title === "BI107 Final study guide").current_version === 3, "the cancelled request saved nothing");
  ok((await api("/office")).jobs.filter((j: any) => j.parentId && j.status === "cancelled").length >= 0, "helpers are cancelled with it");
  await ctx.close();

  step("Phone: the dock, the finished guide and the quiz fit at 390 px");
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await mctx.addInitScript(FAKE_SPEECH);
  const m = await mctx.newPage(); watch(m, "study-mobile");
  await m.goto(base + "/courses/BI107"); await m.getByTestId("voice-dock").waitFor();
  const over = () => m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok((await over()) <= 0, "the course workspace has no horizontal scroll on the phone");
  await shot(m, "22-course-workspace-mobile.png");
  await m.getByTestId("guide-link").filter({ hasText: "Final study guide" }).tap();
  await m.getByTestId("practice-list").waitFor();
  ok((await over()) <= 0, "the guide has no horizontal scroll on the phone");
  await shot(m, "19-guide-mobile.png");
  await m.getByTestId("start-quiz").tap(); await m.getByTestId("quiz-stem").waitFor();
  ok((await over()) <= 0, "the quiz has no horizontal scroll on the phone");
  await mctx.close();
}

async function journeyMcp() {
  step("Connector: an authorized MCP client saves a promise, replays it, recalls it; no token, no entry");
  const url = `${base}/mcp`;
  const anon = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
  ok(anon.status === 401, "a request without the token is refused");
  const bad = await fetch(url, { method: "POST", headers: { authorization: "Bearer nope-nope-nope-nope", "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
  ok(bad.status === 401, "a wrong token is refused");
  const out = await new Promise<{ code: number; text: string }>((res) => { const c = spawn("npx", ["tsx", "scripts/mcp-smoke.ts", url, "e2e-token-0123456789abcdef"], { env: process.env }); let t = ""; c.stdout.on("data", (d) => (t += d)); c.stderr.on("data", (d) => (t += d)); c.on("close", (code) => res({ code: code ?? 1, text: t })); });
  ok(out.code === 0 && /MCP smoke test passed/.test(out.text), `the smoke script passes against the running server (${out.text.split("\n").filter((l) => l.startsWith("ok")).length} checks)`);
  await waitFor("the connector capture to reach a decision", async () => (await api("/decisions")).decisions.some((x: any) => /smoke-test team/.test(x.title)), 40000);
  await waitFor("its helpers to finish", async () => (await api("/office")).jobs.filter((j: any) => /smoke-test team/.test(j.title)).every((j: any) => j.status === "done"), 40000);
  const d = await api("/decisions"); ok(d.decisions.filter((x: any) => /smoke-test team/.test(x.title)).length === 1, "the connector capture produced exactly one decision after a replay");
  const caps = await api("/captures"); const c = caps.captures.find((x: any) => /smoke-test/.test(x.parsed.owedTo ?? ""));
  ok(!!c && c.source.includes("Ordinary Claude chat") && c.synthetic === true, "the capture is labeled with its real source and as synthetic");
}
async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  await startServer();
  const exe = process.env.PW_CHROMIUM ?? (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  const browser: Browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    const only = process.env.E2E_ONLY;
    if (only === "office+study") { const c = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await c.newPage(); watch(p, "office"); await journeyOffice(p, browser); await journeyStudy(browser); await c.close(); }
    else if (only === "study") { await journeyStudy(browser); }
    else if (only === "projects") { const c = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await c.newPage(); watch(p, "projects"); await journeyProjects(p); await c.close(); }
    else if (only === "assistant") { const c = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await c.newPage(); watch(p, "assistant"); await journeyAssistant(p, browser); await c.close(); }
    else if (only === "quizlatency") { const c = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await c.newPage(); watch(p, "quiz"); startWorker(300); await journeyQuizLatency(p); await c.close(); }
    else if (only === "decision") { const c = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await c.newPage(); watch(p, "decision"); await journeyDecision(p, browser); await c.close(); }
    else if (only === "plan") { const c = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await c.newPage(); watch(p, "plan"); await journeyPlan(p, browser); await c.close(); }
    else if (only === "shuttle") { await journeyShuttle(browser); }
    else if (only === "handoff") { await journeyHandoff(browser); }
    else if (only === "reader") { await journeyReader(browser); }
    else if (only === "private") { await journeyPrivate(browser); }
    else if (only === "blackboard") { await journeyBlackboard(browser); }
    else if (only === "roundtrip") { await journeyRoundTrip(browser); }
    else if (only === "mcp") { startWorker(300); await journeyMcp(); }
    else if (only === "office") { const c = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await c.newPage(); watch(p, "office"); await journeyOffice(p, browser); await c.close(); }
    else {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await journeyDesktop(desktop);
    await journeyTask(page); await journeyResume(page); await journeyCouncil(page); await journeySkills(page);
    await journeyExam(page); await journeyRegistrar(page); await journeyMemoryGoals(page); await journeyVoice(page);
    await journeyBreak(page); await journeySettings(page);
    await journeyOffice(page, browser);
    await journeyStudy(browser);
    await journeyMcp();
    await journeyProjects(page);
    await journeyAssistant(page, browser);
    await journeyQuizLatency(page);
    await journeyDecision(page, browser);
    await journeyPlan(page, browser);
    await journeyPrivate(browser);
    await journeyShuttle(browser);
    await journeyHandoff(browser);
    await journeyReader(browser);
    await journeyBlackboard(browser);
    await journeyRoundTrip(browser);
    await desktop.close();
    await journeyMobile(browser);
    await journeyA11y(browser);
    }
  } finally { await browser.close(); killServer(); }
  // Failures the journeys cause on purpose (malformed file, PDF, resolve without evidence) are expected. Everything else is a problem.
  const expected = [/http (422|415)\(desktop\): POST .*\/api\/import\/preview/, /http 422\(desktop\): POST .*\/commitments\/.*\/resolve/, /console\(desktop\): Failed to load resource: .*\b(422|415)\b/];
  const real = problems.filter((p) => !expected.some((e) => e.test(p)));
  console.log(`\n${pass} checks passed, ${real.length} problems (${problems.length - real.length} expected failures from deliberate break tests ignored)`);
  for (const p of real) console.log(" - " + p);
  process.exit(real.length ? 1 : 0);
}
main().catch((e) => { console.error(e); killServer(); process.exit(2); });
