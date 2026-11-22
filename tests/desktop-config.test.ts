import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// The Mac setup helper, run against a throwaway copy of a Claude Desktop config. It must add one plainly named entry and change nothing else.
const script = path.resolve("scripts/desktop-config.mjs");
const run = (...a: string[]) => spawnSync(process.execPath, [script, ...a], { encoding: "utf8" });
function tmpConfig(content: string | null) { const d = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-dc-")); const f = path.join(d, "claude_desktop_config.json"); if (content !== null) fs.writeFileSync(f, content); return { d, f }; }
const EXISTING = { mcpServers: { "jarvis-reader-demo": { command: "/usr/local/bin/node", args: ["/Users/me/old/scripts/mcp-server.ts"], env: { JARVIS_DATA_DIR: "/Users/me/old/data" } }, filesystem: { command: "npx", args: ["x"] } }, globalShortcut: "Ctrl+Space" };

describe("scripts/desktop-config.mjs", () => {
  it("prints a resolved, separate jarvis-personal entry for the private workspace and changes nothing without --write", () => {
    const { f } = tmpConfig(JSON.stringify(EXISTING)); const before = fs.readFileSync(f, "utf8"); const r = run("--config", f, "--data", "/tmp/jarvis-private-data");
    expect(r.status).toBe(0); expect(r.stdout).toContain('"jarvis-personal"'); expect(r.stdout).toContain('"JARVIS_MCP_MODE": "personal"'); expect(r.stdout).toContain("/tmp/jarvis-private-data");
    const entry = JSON.parse(r.stdout.slice(r.stdout.indexOf("{\n  \"jarvis-personal\""), r.stdout.indexOf("\n}\n", r.stdout.indexOf("{\n  \"jarvis-personal\"")) + 2))["jarvis-personal"];
    for (const p of [entry.command, entry.env.TSX_TSCONFIG_PATH, entry.args[2]]) expect(path.isAbsolute(p), p).toBe(true); expect(entry.args[0]).toBe("--import"); expect(entry.args[1]).toMatch(/^file:\/\/\/.*tsx\/dist\/loader\.mjs$/); expect(fs.existsSync(entry.args[2])).toBe(true);
    expect(fs.readFileSync(f, "utf8")).toBe(before);
  });
  it("--write backs the file up, adds only jarvis-personal, and leaves every other server and setting untouched; running it twice adds nothing new", () => {
    const { d, f } = tmpConfig(JSON.stringify(EXISTING, null, 2)); const orig = fs.readFileSync(f, "utf8"); const r = run("--config", f, "--write", "--data", "/tmp/jarvis-private-data"); expect(r.status).toBe(0);
    const out = JSON.parse(fs.readFileSync(f, "utf8")); expect(out.mcpServers["jarvis-reader-demo"]).toEqual(EXISTING.mcpServers["jarvis-reader-demo"]); expect(out.mcpServers.filesystem).toEqual(EXISTING.mcpServers.filesystem); expect(out.globalShortcut).toBe("Ctrl+Space");
    expect(Object.keys(out.mcpServers)).toEqual(["jarvis-reader-demo", "filesystem", "jarvis-personal"]); expect(out.mcpServers["jarvis-personal"].env.JARVIS_DATA_DIR).toBe("/tmp/jarvis-private-data");
    const backups = fs.readdirSync(d).filter((n) => n.includes(".bak-")); expect(backups).toHaveLength(1); expect(fs.readFileSync(path.join(d, backups[0]), "utf8")).toBe(orig);
    const once = fs.readFileSync(f, "utf8"); run("--config", f, "--write", "--data", "/tmp/jarvis-private-data"); expect(fs.readFileSync(f, "utf8")).toBe(once);
  });
  it("creates a config if there is none, and refuses to touch one that is not valid JSON", () => {
    const none = tmpConfig(null); expect(run("--config", none.f, "--write").status).toBe(0); expect(Object.keys(JSON.parse(fs.readFileSync(none.f, "utf8")).mcpServers)).toEqual(["jarvis-personal"]);
    const bad = tmpConfig("{ not json"); const r = run("--config", bad.f, "--write"); expect(r.status).toBe(1); expect(fs.readFileSync(bad.f, "utf8")).toBe("{ not json"); expect(fs.readdirSync(bad.d).filter((n) => n.includes(".bak-"))).toHaveLength(0);
  });
  it("--check starts the personal connector with the resolved launcher and lists its tools", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-dc-data-")); const r = run("--check", "--data", dir, "--config", path.join(dir, "none.json")); expect(r.stdout).toMatch(/OK: the personal connector started and offers \d+ tools/);
  }, 60000);
});
