import { describe, it, expect } from "vitest";
import { memCtx } from "./helpers";
import { importText, getItem, listItems } from "@/lib/evidence";
import { analyze, itemInFrom, parseMoney, fmtMoney, computeOption } from "@/lib/decision";

// Names and amounts live here only. The engine recognises form (money, dates, capacity), not these examples.
export type Variant = "base" | "reversal" | "bellini_permit_unknown" | "okafor_permit_unknown";
export function seedQuotes(ctx: any, v: Variant = "base") {
  const imp = (kind: string, title: string, text: string, at: string, author?: string) => importText(ctx, { kind, title, text, at: `2026-11-${at}T15:00:00.000Z`, author, label: author ? `Mail from ${author}` : "Notes" });
  imp("email", "Quote for bathroom re-pipe", "Hi Alex, Bellini Plumbing quote for the bathroom re-pipe: $4,800 including the permit. We can start December 7.", "09", "Marco Bellini");
  imp("email", "Revised quote after site visit", v === "bellini_permit_unknown"
    ? "Alex, after seeing the second-floor pipes I have to revise the bathroom re-pipe quote to $5,350. The permit is not included. We can still start December 7."
    : "Alex, after seeing the second-floor pipes I have to revise the bathroom re-pipe quote to $5,350, plus a permit estimated at $400. We can still start December 7.", "11", "Marco Bellini");
  imp("email", "Okafor & Sons estimate", v === "okafor_permit_unknown" ? "Okafor & Sons will do the bathroom re-pipe for $5,100. The permit is not included. We can start November 30." : "Okafor & Sons will do the bathroom re-pipe for $5,100 with the permit included. We can start November 30.", "12", "Tom Okafor");
  if (v === "reversal") {
    imp("email", "Revised again", "Bellini Plumbing can do the bathroom re-pipe for $5,000, plus a permit estimated at $400. We can start December 7.", "13", "Marco Bellini");
    imp("email", "Okafor revised estimate", "Okafor & Sons revised the bathroom re-pipe estimate to $5,600 with the permit included. We can start November 30.", "14", "Tom Okafor");
  }
  imp("note", "Bathroom plan", "Budget cap $5,500 all-in. Need it done before the in-laws arrive December 20. Only two quotes so far.", "15");
}
export const itemsOf = (ctx: any) => listItems(ctx).map((r) => getItem(ctx, r.id as string) as any).filter((i) => i && i.body).map((i) => itemInFrom({ ...i, sourceLabel: i.sourceLabel }));
const run = (v: Variant, req = "Which plumber should I go with for the bathroom re-pipe?") => { const ctx = memCtx("2026-11-16T10:00:00-05:00"); seedQuotes(ctx, v); return analyze(itemsOf(ctx), req); };
const opt = (a: any, name: string) => a.options.find((o: any) => o.label.includes(name))!;

describe("money in minor units", () => {
  it("parses symbols, codes and suffixes and formats without drift", () => {
    expect(parseMoney("$5,350")).toEqual({ minor: 535000, currency: "USD" }); expect(parseMoney("EUR 150")).toEqual({ minor: 15000, currency: "EUR" }); expect(parseMoney("1,250.50 GBP")).toEqual({ minor: 125050, currency: "GBP" }); expect(parseMoney("$4.8k")).toEqual({ minor: 480000, currency: "USD" });
    expect(fmtMoney(535000, "USD")).toBe("$5,350"); expect(fmtMoney(12050, "EUR")).toBe("€120.50"); expect(0.1 + 0.2).not.toBe(0.3); expect(parseMoney("$0.10")!.minor + parseMoney("$0.20")!.minor).toBe(30);
  });
});

describe("decision engine on the known quotes", () => {
  it("Bellini is about $5,750 all-in with the first quote kept as history, Okafor $5,100, and Okafor is recommended on the budget", () => {
    const a = run("base");
    expect(opt(a, "Bellini").calc.min).toBe(575000); expect(opt(a, "Bellini").calc.approx).toBe(true); expect(opt(a, "Okafor").calc.min).toBe(510000); expect(opt(a, "Okafor").calc.approx).toBe(false);
    expect(opt(a, "Bellini").history.some((t: any) => t.role === "base" && t.money.minor === 480000)).toBe(true);        // superseded quote kept
    expect(opt(a, "Bellini").checks.find((c: any) => c.constraint.kind === "budget_max").diffMinor).toBe(25000);             // about $250 over
    expect(opt(a, "Okafor").checks.find((c: any) => c.constraint.kind === "budget_max").diffMinor).toBe(-40000);           // $400 under
    expect(opt(a, "Okafor").calc.max - 0 - opt(a, "Bellini").calc.max).toBe(-65000);                                         // about $650 less than Bellini
    expect(a.recommendation).toMatchObject({ kind: "recommend", label: "Okafor & Sons" });
    expect(a.recommendation.headline).toMatch(/Okafor & Sons fits best on your stated budget/); expect(a.recommendation.headline).toMatch(/\$5,100/);
  });
  it("an included component is not counted twice, and a start date is not a completion date", () => {
    const a = run("base");
    expect(opt(a, "Okafor").calc.parts.some((p: any) => /permit.*included/.test(p.label))).toBe(true); expect(opt(a, "Okafor").calc.includedNote).toEqual(["permit"]);
    expect(opt(a, "Okafor").completion).toBeNull(); expect(opt(a, "Okafor").availability.date).toBe("2026-11-30");
    expect(opt(a, "Okafor").checks.find((c: any) => c.constraint.kind === "deadline")).toMatchObject({ status: "unconfirmed" });
    expect(a.recommendation.qualifiers.join(" ")).toMatch(/Completion before December 20 is unconfirmed/); expect(a.recommendation.nextAction).toMatchObject({ kind: "confirm_completion", option: expect.stringContaining("okafor") });
  });
  it("new information reverses the ranking", () => {
    const a = run("reversal");
    expect(opt(a, "Bellini").calc.min).toBe(540000); expect(opt(a, "Okafor").calc.min).toBe(560000);
    expect(opt(a, "Bellini").history.length).toBeGreaterThanOrEqual(2); expect(a.recommendation).toMatchObject({ kind: "recommend", label: "Bellini Plumbing" });
  });
  it("a missing required cost stays visible and changes the answer: a different option leads, or one precise question is asked", () => {
    const b = run("bellini_permit_unknown");
    expect(opt(b, "Bellini").calc.unknown.map((u: any) => u.name)).toEqual(["permit"]); expect(opt(b, "Bellini").checks.find((c: any) => c.constraint.kind === "budget_max").status).toBe("unknown");
    expect(b.recommendation).toMatchObject({ kind: "recommend", label: "Okafor & Sons" });
    const o = run("okafor_permit_unknown");
    expect(o.recommendation.kind).toBe("ask"); expect(o.recommendation.question).toMatch(/How much is the permit for Okafor & Sons\?/); expect(o.recommendation.qualifiers.join(" ")).toMatch(/Provisional/);
  });
  it("unrelated prices, scores and percentages never enter a calculation", () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00"); seedQuotes(ctx, "base");
    importText(ctx, { kind: "email", title: "Pizza party", text: "Bellini's Pizzeria party quote: $4,800. We rated the service 95%.", at: "2026-11-10T15:00:00.000Z", author: "Giulia Rossi" });
    const a = analyze(itemsOf(ctx).filter((i) => !/Pizza/.test(i.title)), "Which plumber?");
    expect(a.options.map((o) => o.label).sort()).toEqual(["Bellini Plumbing", "Okafor & Sons"]);
  });
  it("different currencies are not compared without an exchange rate you provide", () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00");
    importText(ctx, { kind: "email", title: "Offer A", text: "Alfa Studio offer: EUR 4,000 for the work. We can start December 1.", at: "2026-11-10T15:00:00.000Z", author: "Ana Costa" });
    importText(ctx, { kind: "email", title: "Offer B", text: "Beta Studio offer: $4,500 for the work. We can start December 2.", at: "2026-11-11T15:00:00.000Z", author: "Ben Hall" });
    const none = analyze(itemsOf(ctx), "Which offer?"); expect(none.currency).toBeNull(); expect(none.notes.join(" ")).toMatch(/different currencies/); expect(none.fx).toBeNull();
    const fx = analyze(itemsOf(ctx), "Which offer?", { fxRates: { EUR_USD: 1.1 } } as any); expect(fx.currency).toBe("USD"); expect(fx.fx!.basis).toMatch(/exchange rates you provided/);
  });
  it("capacity and time constraints work the same way, with no money involved", () => {
    const ctx = memCtx("2026-11-16T10:00:00-05:00");
    importText(ctx, { kind: "email", title: "Hall A", text: "Maple Hall seats 60 people and is open from December 3.", at: "2026-11-10T15:00:00.000Z", author: "Maple Hall" });
    importText(ctx, { kind: "email", title: "Hall B", text: "Cedar Rooms hold up to 30 guests and are open from December 1.", at: "2026-11-10T16:00:00.000Z", author: "Cedar Rooms" });
    importText(ctx, { kind: "note", title: "Event needs", text: "Need space for at least 45 people. Must be ready before December 10.", at: "2026-11-12T15:00:00.000Z" });
    const a = analyze(itemsOf(ctx), "Which venue?");
    expect(a.options.find((o) => o.label === "Cedar Rooms")!.checks.find((c) => c.constraint.kind === "capacity_min")).toMatchObject({ status: "violated" });
    expect(a.recommendation).toMatchObject({ kind: "recommend", label: "Maple Hall" }); expect(a.recommendation.qualifiers.join(" ")).toMatch(/unconfirmed/);
  });
});
