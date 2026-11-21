/* Manage connector tokens without the web app (for the connector-only deployment).
   npm run token -- create "Claude on my Mac" [--read-only] [--days 90] [--demo]
   npm run token -- list | revoke <id> | rotate <id>
   The secret is printed once. It is stored only as a hash. */
import { makeCtx } from "../src/lib/db";
import { createToken, listTokens, revokeToken, rotateToken } from "../src/lib/mcp-auth";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n: string) => rest.includes(`--${n}`);
const val = (n: string) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : undefined; };
const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1] === "--days"));
const ctx = makeCtx(flag("demo") ? "demo" : "personal");
if (cmd === "create") {
  const t = createToken(ctx, { label: positional[0] ?? "Claude", scopes: flag("read-only") ? ["read"] : ["read", "write"], expiresInDays: val("days") ? Number(val("days")) : null });
  console.log(`Token (shown once): ${t.token}\nId: ${t.id}  Access: ${t.scopes.join("+")}  Expires: ${t.expiresAt ?? "never"}`);
} else if (cmd === "list") { for (const t of listTokens(ctx)) console.log(`${t.id}  ${t.status.padEnd(8)} ${t.scopes.join("+").padEnd(10)} ${t.label}  last used: ${t.lastUsedAt ?? "never"}`); }
else if (cmd === "revoke" && positional[0]) { revokeToken(ctx, positional[0]); console.log("Revoked."); }
else if (cmd === "rotate" && positional[0]) { const t = rotateToken(ctx, positional[0]); console.log(`New token (shown once): ${t.token}\nThe old token is revoked.`); }
else { console.error("Usage: npm run token -- create <label> [--read-only] [--days N] [--demo] | list | revoke <id> | rotate <id>"); process.exit(2); }
