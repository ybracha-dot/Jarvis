export const dynamic = "force-dynamic";
import { MODE_COOKIE } from "@/lib/server";

/** The launcher opens this address: it selects the private workspace for this browser and lands on Today. A link on another site cannot use it. */
export function GET(req: Request) {
  if ((req.headers.get("sec-fetch-site") ?? "none") === "cross-site") return new Response("Open Jarvis from its own address.", { status: 403 });
  const to = new URL("/", req.url);
  return new Response(null, { status: 303, headers: { location: to.toString(), "set-cookie": `${MODE_COOKIE}=personal; Path=/; SameSite=Strict; HttpOnly; Max-Age=31536000`, "cache-control": "no-store" } });
}
