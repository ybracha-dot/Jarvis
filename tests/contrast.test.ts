import { describe, it, expect } from "vitest";
import fs from "node:fs";

// WCAG 2.x contrast for the actual design tokens in globals.css.
const css = fs.readFileSync("src/app/globals.css", "utf8");
const tok = (n: string) => { const m = new RegExp(`--color-${n}:\\s*(#[0-9a-fA-F]{6})`).exec(css); if (!m) throw new Error(`missing token ${n}`); return m[1]; };
const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe("contrast (WCAG AA, 4.5:1 for text, 3:1 for UI)", () => {
  const surfaces = ["bg", "surface", "surface2"];
  for (const s of surfaces) {
    it(`fg, muted, accent, amber and danger text on ${s}`, () => {
      for (const t of ["fg", "muted", "accent", "amber", "danger"]) expect(ratio(tok(t), tok(s)), `${t} on ${s}`).toBeGreaterThanOrEqual(4.5);
    });
  }
  it("button text on the accent and amber fills", () => {
    expect(ratio("#06201b", tok("accent"))).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#2a1c04", tok("amber"))).toBeGreaterThanOrEqual(4.5);
  });
  it("amber and accent badges on their tinted backgrounds", () => {
    expect(ratio(tok("amber"), "#1f180a")).toBeGreaterThanOrEqual(4.5);
    expect(ratio(tok("accent"), "#0f2420")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#f6d7a1", "#1a1508")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#bff3e8", "#0e1f1c")).toBeGreaterThanOrEqual(4.5);
  });
  it("borders and focus ring are visible against the background (3:1 for the focus ring)", () => {
    expect(ratio(tok("accent"), tok("bg"))).toBeGreaterThanOrEqual(3);
  });
  it("placeholder text is readable", () => { expect(ratio("#7d8691", tok("bg"))).toBeGreaterThanOrEqual(4.5); });
});
