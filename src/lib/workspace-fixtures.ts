// A neutral, synthetic workspace for demos and acceptance tests. Names are invented. Nothing here is routed on: the assistant finds these
// through search and the calendar like any other record. Every item is labelled fixture, and a second owner's look-alike is included to prove isolation.
import { Ctx, makeCtx, get, run, sha, setSetting } from "./db";
import { registerSource, ingestItem, markSource } from "./evidence";
import { createProject } from "./projects";
import { addDays, localDate, parseLocal, DEFAULT_TZ } from "./time";

const OTHER_OWNER = "other-owner";
const atDay = (ctx: Ctx, daysAgo: number, hm = "10:00") => parseLocal(addDays(localDate(ctx.now()), -daysAgo), hm, DEFAULT_TZ).toISOString();

export function loadWorkspaceFixtures(ctx: Ctx, o: { calendar?: boolean } = {}) {
  setSetting(ctx.db, "owner_name", "Yonathan");
  const project = createProject(ctx, { name: "Lantern Club", kind: "club", aliases: ["sponsor pitch"] });
  const meet = registerSource(ctx, { kind: "transcript", label: "Meeting transcripts (fixture)", mode: "fixture", projectId: project.id });
  const mail = registerSource(ctx, { kind: "email", label: "Mail (fixture)", mode: "fixture" });
  const claude = registerSource(ctx, { kind: "claude", label: "Shared from Claude (fixture)", mode: "fixture" });
  const notices = registerSource(ctx, { kind: "notice", label: "Course notice emails (fixture)", mode: "fixture" });
  const portal = registerSource(ctx, { kind: "portal", label: "Blackboard portal", mode: "unavailable", state: "needs_signin", message: "Needs your sign-in (Duo) on this computer. Until then Jarvis reads notification emails, the course calendar feed or files you export." });
  void portal;
  ingestItem(ctx, { sourceId: meet.id, externalId: "sync-1", kind: "transcript", title: "Lantern Club sponsor pitch sync", author: "Dana Reyes", participants: ["Dana Reyes", "Yonathan"], at: atDay(ctx, 6), projectId: project.id,
    body: [
      "[00:00:41] Dana Reyes: Thanks for joining. Let's follow up with the sponsors soon, because they asked for the revised budget before demo day.",
      "[00:01:12] Yonathan: I'll draft the follow-up and send it to Dana for review.",
      "[00:01:30] Dana Reyes: How about Monday for the sponsor follow-up?",
      "[00:02:05] Dana Reyes: I'll book the room and confirm the attendee list.",
      "[00:02:40] Yonathan: We have about 40 members, so the room needs to be big.",
    ].join("\n") });
  ingestItem(ctx, { sourceId: mail.id, externalId: "re-follow-up", kind: "email", title: "Re: Lantern Club sponsor pitch follow-up", author: "Dana Reyes", participants: ["Dana Reyes", "Yonathan"], at: atDay(ctx, 3, "16:20"), projectId: project.id,
    body: "Hi Yonathan,\nConfirming Wednesday for the sponsor follow-up. We moved it from Monday since Priya is out.\nPlease mention the club's 40 members and that we are asking sponsors for $12,000.\nThanks, Dana" });
  // A same-name look-alike that belongs to someone else. It must never be read, quoted or counted.
  const other = makeCtx(ctx.mode, { db: ctx.db, owner: OTHER_OWNER, now: ctx.now });
  const om = registerSource(other, { kind: "email", label: "Mail (fixture)", mode: "fixture" });
  ingestItem(other, { sourceId: om.id, externalId: "lantern-friday", kind: "email", title: "Lantern Club sponsor pitch follow-up", author: "Sam Ortiz", at: atDay(other, 1), body: "Confirming Friday for the Lantern Club sponsor follow-up. Budget is $50,000." });
  // Unrelated but present: a school notice and an earlier Claude outline. The pitch request must not pull these in.
  ingestItem(ctx, { sourceId: notices.id, externalId: "memo-rubric", kind: "notice", title: "Design Memo: rubric updated", author: "Course staff", at: atDay(ctx, 1, "09:00"),
    body: "The submission for the Design Memo moved to Thursday 5:00 PM. An updated rubric is posted on the course site. The rubric contents are not included in this email." });
  ingestItem(ctx, { sourceId: claude.id, externalId: "advising-outline", kind: "claude", title: "Outline for the advising check-in", author: "Claude (shared by you)", at: atDay(ctx, 2, "20:15"),
    body: "Claude outline for the advising check-in: 1) Summarize progress on the Design Memo. 2) Ask about the rubric. 3) Confirm the term plan." });
  if (o.calendar !== false) setCalendar(ctx, [{ title: "Advising check-in", start: "14:00", end: "14:30", dayOffset: 1 }, { title: "Studio critique", start: "11:00", end: "12:30", dayOffset: 1 }]);
  return { projectId: project.id };
}

/** Replace the fixture calendar for the days used by the brief. */
export function setCalendar(ctx: Ctx, events: { title: string; start: string; end: string; dayOffset: number }[]) {
  run(ctx.db, "DELETE FROM blocks WHERE owner_id=? AND kind='calendar' AND source='fixture'", ctx.owner);
  const today = localDate(ctx.now());
  for (const e of events) { const d = addDays(today, e.dayOffset); run(ctx.db, "INSERT INTO blocks(id,owner_id,start_at,end_at,tz,kind,title,source,idempotency_key,sync,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", `blk_${sha(`${e.title}${d}${e.start}`).slice(0, 10)}`, ctx.owner, parseLocal(d, e.start).toISOString(), parseLocal(d, e.end).toISOString(), DEFAULT_TZ, "calendar", e.title, "fixture", `fx:${e.title}:${d}:${e.start}`, "read-only", "active", ctx.now().toISOString()); }
}
export { markSource, get };
