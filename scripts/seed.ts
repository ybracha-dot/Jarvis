/* Seed the example workspace once. `npm run seed` is idempotent. `npm run reset-demo` resets the EXAMPLE workspace only
   and never touches the private workspace's files. */
import { makeCtx, getDb, modeDir } from "../src/lib/db";
import { seedDemo, resetDemo } from "../src/lib/demo";

const reset = process.argv.includes("--reset");
const ctx = makeCtx("demo");
if (reset) { resetDemo(ctx); console.log(`Example workspace reset (${modeDir("demo")}). Private workspace untouched.`); }
const r = seedDemo(ctx);
console.log(r.seeded ? `Seeded the example week in ${modeDir("demo")}` : "Example workspace already seeded. Nothing changed.");
console.log(`Demo clock: ${ctx.now().toISOString()}`);
getDb("demo").close();
