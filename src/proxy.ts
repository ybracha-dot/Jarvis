// Connector-only ingress. When JARVIS_PUBLIC_MODE=mcp-only, this process answers /mcp and /healthz and nothing else:
// every page, API route and static file returns 404, so an internet-facing deployment cannot expose personal state through the web app.
// Without that setting this is a no-op. Next.js 16 calls this file "proxy" (it was "middleware").
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (process.env.JARVIS_PUBLIC_MODE !== "mcp-only") return NextResponse.next();
  const p = request.nextUrl.pathname;
  if (p === "/mcp" || p === "/healthz") return NextResponse.next();
  return new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store" } });
}
export const config = { matcher: "/:path*" };
