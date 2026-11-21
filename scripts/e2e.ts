/* End-to-end journey through the real UI with Playwright. Run: npm run e2e  (builds are not required when E2E_URL is set).
   Uses its own temporary data directory unless E2E_URL points at a running server. */
import { chromium, type Browser, type Page, type BrowserContext } from "playwright";
import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SHOTS = path.resolve("docs/screenshots");
const PORT = Number(process.env.E2E_PORT ?? 3101);
let base = process.env.E2E_URL ?? `http://127.0.0.1:${PORT}`;
let server: ChildProcess | null = null;
const problems: string[] = [];
const steps: string[] = [];
let pass = 0;

function ok(cond: unknown, msg: string) { if (!cond) { problems.push(`ASSERT FAILED: ${msg}`); console.log(`  FAIL ${msg}`); } else { pass++; console.log(`  ok   ${msg}`); } }
const step = (s: string) => { steps.push(s); console.log(`\n# ${s}`); };

async function startServer() {
  if (process.env.E2E_URL) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-e2e-"));
  server = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(PORT)], { env: { ...process.env, JARVIS_DATA_DIR: dir }, stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch { /* waiting */ } await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("Server did not start. Run npm run build first.");
}

function watch(page: Page, label: string) {
  page.on("console", (m) => { if (m.type() === "error") { const t = m.text(); if (!/favicon/.test(t) && !problems.includes(`console(${label}): ${t}`)) problems.push(`console(${label}): ${t}`); } });
  page.on("pageerror", (e) => problems.push(`pageerror(${label}): ${e.message}`));
  page.on("requestfailed", (r) => { if (!/_next\/webpack-hmr|\.map$/.test(r.url()) && !(/_rsc=/.test(r.url()) && /ERR_ABORTED/.test(r.failure()?.errorText ?? ""))) problems.push(`requestfailed(${label}): ${r.url()} ${r.failure()?.errorText}`); });
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

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  await startServer();
  const browser: Browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium" });
  try {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await journeyDesktop(desktop);
    await desktop.close();
  } finally { await browser.close(); server?.kill(); }
  console.log(`\n${pass} checks passed, ${problems.length} problems`);
  for (const p of problems) console.log(" - " + p);
  process.exit(problems.length ? 1 : 0);
}
main().catch((e) => { console.error(e); server?.kill(); process.exit(2); });
