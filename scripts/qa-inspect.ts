/* Release QA inspection of the screens that matter, on invented data, in both appearances at laptop and phone width.
   Run: npx tsx scripts/qa-inspect.ts      (needs a build: npm run build). Writes docs/screenshots/qa/*.png and docs/qa/inspect-report.md.
   Per screen it checks: serious or critical axe violations (WCAG 2.1 AA incl. contrast), the last control is not covered by the composer or the tab bar and is reachable,
   no horizontal scroll, every interactive element at least 24 px in both directions (44 px on the phone for the primary action), and that keyboard focus is visibly drawn. */
import { chromium, type Page, type BrowserContext } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd(); const SHOTS = path.join(ROOT, "docs", "screenshots", "qa"); const REPORT = path.join(ROOT, "docs", "qa", "inspect-report.md");
fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(path.dirname(REPORT), { recursive: true });
const PORT = Number(process.env.QA_PORT ?? 3191); const base = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-qa-inspect-"));
const procs: ChildProcess[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const post = async (p: string, body: unknown = {}, cookie = "") => (await fetch(`${base}/api${p}`, { method: "POST", headers: { "content-type": "application/json", origin: base, cookie }, body: JSON.stringify(body) })).json() as Promise<any>;
const get = async (p: string, cookie = "") => (await fetch(`${base}/api${p}`, { headers: { cookie } })).json() as Promise<any>;
const axePath = createRequire(import.meta.url).resolve("axe-core");
const rows: { scene: string; view: string; scheme: string; axe: string; reach: string; hscroll: string; targets: string; focus: string; notes: string }[] = []; const problems: string[] = [];

async function inspect(page: Page, scene: string, view: "laptop" | "phone", scheme: "light" | "dark", note = "") {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOTS, `${scene}-${view}-${scheme}.png`) });
  await page.addScriptTag({ path: axePath });
  const ax: any = await page.evaluate(async () => (window as any).axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] }));
  const bad = ax.violations.filter((v: any) => ["serious", "critical"].includes(v.impact));
  // the last control, scrolled to the end, must be fully visible, not covered by the composer or the tab bar, and hit-testable
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(250);
  const reach = await page.evaluate(() => {
    const els = [...document.querySelectorAll("main a[href], main button, main summary, main input, main textarea, main select")].filter((e) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; }) as HTMLElement[];
    const e = els[els.length - 1]; if (!e) return { ok: true, why: "no controls" };
    const r = e.getBoundingClientRect(); const composer = document.querySelector('[data-testid="voice-dock"]')?.getBoundingClientRect(); const tab = document.querySelector('nav[aria-label="Primary mobile"]')?.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, Math.min(r.top + r.height / 2, window.innerHeight - 1)); const covered = !!hit && !(hit === e || e.contains(hit) || hit.contains(e));
    const underComposer = !!composer && r.bottom > composer.top && r.top < composer.bottom; const underTab = !!tab && tab.height > 0 && r.bottom > tab.top;
    return { ok: !covered && !underComposer && !underTab && r.bottom <= window.innerHeight + 1, why: `${(e.textContent ?? "").trim().slice(0, 30) || e.tagName} bottom ${Math.round(r.bottom)} of ${window.innerHeight}${covered ? ", covered" : ""}${underComposer ? ", under composer" : ""}${underTab ? ", under tab bar" : ""}` };
  });
  const hscroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.evaluate(() => window.scrollTo(0, 0));
  const small = await page.evaluate((phone) => [...document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, summary")].filter((e) => { const r = (e as HTMLElement).getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !(e as HTMLElement).closest(".sr-only") && !((e as HTMLElement).className ?? "").toString().includes("sr-only") && (r.width < 24 || r.height < 24) && !(e.tagName === "A" && (e as HTMLElement).closest("p, li, span") && cs.display === "inline"); }).slice(0, 5).map((e) => `${(e.textContent ?? "").trim().slice(0, 20) || e.getAttribute("aria-label") || e.tagName}`), view === "phone");
  // keyboard focus must be drawn: tab to the first control after the skip link and look for an outline or ring
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => { const e = document.activeElement as HTMLElement | null; if (!e || e === document.body) return { ok: false, why: "nothing focused" }; const cs = getComputedStyle(e); const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== "none"); return { ok: !!ring, why: `${(e.textContent ?? "").trim().slice(0, 24) || e.tagName}: outline ${cs.outlineStyle} ${cs.outlineWidth}, shadow ${cs.boxShadow === "none" ? "none" : "yes"}` }; });
  const row = { scene, view, scheme, axe: bad.length ? `${bad.length} serious/critical: ${bad.map((b: any) => b.id).join(", ")}` : "0 serious or critical", reach: `${reach.ok ? "ok" : "PROBLEM"} (${reach.why})`, hscroll: hscroll <= 0 ? "none" : `PROBLEM ${hscroll}px`, targets: small.length ? `small: ${small.join(", ")}` : "ok", focus: `${focus.ok ? "ok" : "PROBLEM"} (${focus.why})`, notes: note };
  rows.push(row);
  if (bad.length) problems.push(`${scene}/${view}/${scheme}: axe ${bad.map((b: any) => b.id).join(", ")}`); if (!reach.ok) problems.push(`${scene}/${view}/${scheme}: last control ${reach.why}`); if (hscroll > 0) problems.push(`${scene}/${view}/${scheme}: horizontal scroll`); if (!focus.ok) problems.push(`${scene}/${view}/${scheme}: focus ${focus.why}`);
  for (const b of bad) console.log(`    axe ${b.impact} ${b.id}: ${b.nodes.slice(0, 2).map((n: any) => n.target.join(" ")).join(" | ")}`);
}

async function scenes(browser: any, personal: boolean, name: string, prep: (p: Page, v: "laptop" | "phone") => Promise<void>, note = "") {
  for (const scheme of ["light", "dark"] as const) for (const view of ["laptop", "phone"] as const) {
    const ctx: BrowserContext = await browser.newContext(view === "phone" ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme } : { viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    if (personal) await ctx.addCookies([{ name: "jarvis_mode", value: "personal", url: base }]);
    const page = await ctx.newPage(); await prep(page, view); await inspect(page, name, view, scheme, note); await ctx.close();
  }
}

async function main() {
  const server = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(PORT)], { cwd: ROOT, env: { ...process.env, JARVIS_DATA_DIR: dataDir, JARVIS_INAPP_RUNNER: "0", JARVIS_ALLOW_LOCAL_FEEDS: "1" }, stdio: "ignore", detached: true }); procs.push(server);
  const worker = spawn("npx", ["tsx", "scripts/worker.ts"], { cwd: ROOT, env: { ...process.env, JARVIS_DATA_DIR: dataDir, JARVIS_JOB_PACE_MS: "150", JARVIS_ALLOW_LOCAL_FEEDS: "1" }, stdio: "ignore", detached: true }); procs.push(worker);
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* waiting */ } await sleep(500); }
  const exe = process.env.PW_CHROMIUM ?? (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const P = "jarvis_mode=personal";
  try {
    // 1. the private first run: nothing yet, one invitation
    await post("/erase", { confirm: "ERASE PERSONAL" }, P);
    await scenes(browser, true, "first-run", async (p) => { await p.goto(base + "/"); await p.getByTestId("brief-empty").waitFor(); }, "private, empty, three guided steps");

    // 2. a meaningful deadline change, with a requirement, a review sentence and a suggested time
    const D = (n: number) => new Date(Date.now() + n * 86400000); const long = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" }).format(d);
    const a = await post("/evidence/import", { kind: "note", title: "Essay 2 outline", text: `Essay 2 outline is due ${long(D(9))} at 11:59 PM. Write a one-page outline.`, at: new Date(Date.now() - 8 * 86400000).toISOString(), label: "My class notes" }, P);
    await post("/brief/run", {}, P); await sleep(1200);
    await post("/evidence/import", { kind: "note", title: "Class announcement", text: `Announcement: the Essay 2 outline is now due ${long(D(2))} at 9:00 AM. Please bring a printed alphanumeric outline to class. Outlines are expected on paper, stapled.`, at: new Date().toISOString(), label: "My class notes", corrects: a.id }, P);
    const ev = (day: Date, s: string, e: string, t: string) => ["BEGIN:VEVENT", `UID:${t.replace(/\W/g, "")}${day.toISOString().slice(0, 10)}`, `SUMMARY:${t}`, `DTSTART;TZID=America/New_York:${day.toISOString().slice(0, 10).replace(/-/g, "")}T${s}00`, `DTEND;TZID=America/New_York:${day.toISOString().slice(0, 10).replace(/-/g, "")}T${e}00`, "END:VEVENT"];
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//qa//EN", ...[0, 1, 2, 3].flatMap((n) => ev(D(n), "0900", "1030", "Lecture")), "END:VCALENDAR"].join("\r\n");
    const pv = await post("/import/preview", { filename: "week.ics", content: ics }, P); await post("/import/commit", { token: pv.token }, P);
    await post("/brief/run", {}, P);
    await scenes(browser, true, "deadline-change", async (p) => { await p.goto(base + "/"); await p.getByTestId("brief-lead").waitFor(); }, "lead says the deadline moved; review sentence listed; due soon");

    // 3. a project draft with its sources (demo workspace: TAMID thread), and the Office with a blocked agent that needs an answer
    await post("/demo/reset", { confirm: "RESET DEMO" }); await post("/evidence/fixtures", {});
    const sent = await post("/assistant/message", { text: "Pick up where we left off on the TAMID sponsor pitch and draft my follow-up.", via: "text" });
    let res: any = null; for (let i = 0; i < 60 && !res; i++) { await sleep(700); const r = (await get("/results")).results ?? []; res = r.find((x: any) => x.kind === "draft") ?? null; } void sent;
    const proj = (await get("/projects")).projects.find((x: any) => x.name === "TAMID");
    await scenes(browser, false, "project-draft", async (p) => { await p.goto(base + `/projects/${proj.id}`); await p.getByTestId("project-brief").waitFor(); await p.getByTestId("open-latest-draft").waitFor({ timeout: 15000 }); }, "decided, owed, latest draft");
    await scenes(browser, false, "result-draft", async (p) => { await p.goto(base + `/results/${res.id}`); await p.getByTestId("result-body").waitFor({ timeout: 30000 }); }, "draft with sources, one next action");
    await post("/assistant/message", { text: "Pick up where we left off on the garden swap and draft my follow-up.", via: "text" });
    for (let i = 0; i < 60; i++) { await sleep(600); const o = await get("/office"); if (o.jobs.some((j: any) => j.status === "blocked")) break; if (i === 59) console.log("   no blocked job; jobs:", JSON.stringify(o.jobs.map((j: any) => [j.area, j.status, j.title.slice(0, 40)]))); }
    await scenes(browser, false, "office-blocked", async (p, v) => { await p.goto(base + "/office"); await p.getByTestId("roster").waitFor(); const blocked = p.getByTestId("roster-job").filter({ has: p.locator('[data-status="blocked"]') }); void blocked; await p.locator('[data-testid="roster-job"][data-status="blocked"]').first().click(); await p.getByTestId("inspector").waitFor(); void v; }, "an agent stopped on a question, with its inspector open");
  } finally {
    await browser.close(); for (const pr of procs) { try { process.kill(-pr.pid!, "SIGTERM"); } catch { /* gone */ } }
  }
  const md = ["# Release QA inspection (invented data; Chromium only)", "", `Generated by \`npx tsx scripts/qa-inspect.ts\`. Screens: ${[...new Set(rows.map((r) => r.scene))].join(", ")}. Each in light and dark, laptop 1440x900 and phone 390x844 (touch emulation).`, "",
    "| Screen | View | Appearance | axe (serious/critical) | Last control reachable | Horizontal scroll | Small targets | Keyboard focus drawn | Notes |", "|---|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.scene} | ${r.view} | ${r.scheme} | ${r.axe} | ${r.reach} | ${r.hscroll} | ${r.targets} | ${r.focus} | ${r.notes} |`), "", problems.length ? `## Problems found\n${problems.map((p) => `- ${p}`).join("\n")}` : "## No problems found by these checks", ""].join("\n");
  fs.writeFileSync(REPORT, md); console.log(md.split("\n").slice(0, 8).join("\n")); console.log(`\n${rows.length} views inspected, ${problems.length} problems`); for (const p of problems) console.log(`  PROBLEM ${p}`);
  process.exit(problems.length ? 1 : 0);
}
main().catch((e) => { console.error(e); for (const pr of procs) { try { process.kill(-pr.pid!, "SIGTERM"); } catch { /* gone */ } } process.exit(2); });
