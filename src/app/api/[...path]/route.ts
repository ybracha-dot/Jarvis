import { handle } from "@/lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function run(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = new URL(req.url);
  const bodyText = req.method === "GET" || req.method === "HEAD" ? "" : await req.text();
  if (bodyText.length > 4_400_000) return Response.json({ error: "Request too large" }, { status: 413 });
  const res = await handle(req.method, "/" + path.join("/"), url.searchParams, req.headers, bodyText);
  if (res.binary) return new Response(new Uint8Array(res.binary.data), { headers: { "content-type": res.binary.contentType, "cache-control": "private, no-store", ...(res.binary.filename ? { "content-disposition": `inline; filename="${res.binary.filename}"` } : {}) } });
  return Response.json(res.body, { status: res.status ?? 200, headers: { "cache-control": "no-store", ...(res.headers ?? {}) } });
}
export { run as GET, run as POST, run as PUT, run as PATCH, run as DELETE };
