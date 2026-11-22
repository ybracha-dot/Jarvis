// Who is calling the connector, as the client reports itself. Carried through a request so tools can record it without a global.
import { AsyncLocalStorage } from "node:async_hooks";
export type ClientCtx = { client: string | null; tokenLabel: string | null; transport?: "stdio" | "http" | null };
const als = new AsyncLocalStorage<ClientCtx>();
export const withClient = <T>(c: ClientCtx, fn: () => T): T => als.run(c, fn);
export const currentClient = (): ClientCtx => als.getStore() ?? { client: null, tokenLabel: null, transport: null };
/** What Jarvis can honestly say about a caller. The name is self-reported, so it is never proof of an account. */
export function classifyClient(name: string | null): { kind: "claude" | "test" | "unknown"; label: string } {
  if (!name) return { kind: "unknown", label: "unknown client" };
  if (/test|emulator|smoke|sdk|jarvis|mcp-inspector|curl|script|e2e/i.test(name)) return { kind: "test", label: `${name} (a local test client: proves the connector, not your Claude account)` };
  if (/claude/i.test(name)) return { kind: "claude", label: `${name} (reports itself as Claude; Jarvis cannot verify an account from this)` };
  return { kind: "unknown", label: `${name} (an unrecognised client)` };
}
