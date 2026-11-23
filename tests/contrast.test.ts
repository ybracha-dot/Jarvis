import { describe, it, expect } from "vitest";
import fs from "node:fs";

// WCAG 2.x contrast for the actual semantic tokens in globals.css, in BOTH appearances: the light defaults and the dark set (the same values the OS-preference rule and the stored choice use).
const css = fs.readFileSync("src/app/globals.css", "utf8");
const block = (start: string) => { const i = css.indexOf(start); if (i < 0) throw new Error(`missing block ${start}`); return css.slice(i, css.indexOf("}", i)); };
const set = (b: string) => (n: string) => { const m = new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`).exec(b); if (!m) throw new Error(`missing token ${n}`); return m[1]; };
const light = set(block(":root {")), dark = set(block(':root[data-theme="dark"] {'));
const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

for (const [name, tok] of [["light", light], ["dark", dark]] as const) describe(`contrast, ${name} (WCAG AA: 4.5:1 for text, 3:1 for UI)`, () => {
  for (const s of ["bg", "surface", "surface2"]) it(`fg, muted, accent, amber and danger text on ${s}`, () => { for (const t of ["fg", "muted", "accent", "amber", "danger"]) expect(ratio(tok(t), tok(s)), `${t} on ${s}`).toBeGreaterThanOrEqual(4.5); });
  it("button text on the accent and amber fills", () => { expect(ratio(tok("on-accent"), tok("accent"))).toBeGreaterThanOrEqual(4.5); expect(ratio(tok("on-amber"), tok("amber-solid"))).toBeGreaterThanOrEqual(4.5); });
  it("accent, amber and danger text on their tinted backgrounds", () => { expect(ratio(tok("accent"), tok("accent-soft"))).toBeGreaterThanOrEqual(4.5); expect(ratio(tok("amber"), tok("amber-soft"))).toBeGreaterThanOrEqual(4.5); expect(ratio(tok("danger"), tok("danger-soft"))).toBeGreaterThanOrEqual(4.5); expect(ratio(tok("fg"), tok("amber-soft"))).toBeGreaterThanOrEqual(4.5); });
  it("the focus ring and the agenda's bars are visible against the background (3:1)", () => { expect(ratio(tok("accent"), tok("bg"))).toBeGreaterThanOrEqual(3); expect(ratio(tok("danger"), tok("bg"))).toBeGreaterThanOrEqual(3); });
  it("muted text keeps 4.5:1 on the hover and raised surface", () => { expect(ratio(tok("muted"), tok("surface3"))).toBeGreaterThanOrEqual(4.5); });
});
it("every semantic token exists in both appearances", () => { for (const n of ["bg", "surface", "surface2", "surface3", "line", "line-strong", "fg", "muted", "accent", "accent-soft", "accent-dim", "on-accent", "amber", "amber-soft", "amber-dim", "amber-solid", "on-amber", "danger", "danger-soft", "danger-line"]) { expect(light(n), `light ${n}`).toMatch(/^#/); expect(dark(n), `dark ${n}`).toMatch(/^#/); } });
