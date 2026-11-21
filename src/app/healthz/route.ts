export const dynamic = "force-dynamic";
/** Liveness only. Reveals nothing about the workspace. */
export function GET() { return Response.json({ ok: true }); }
