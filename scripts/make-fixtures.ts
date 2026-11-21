/* Writes the two synthetic BI107 test photos used by the e2e journey. Deterministic: the bytes match what the fixture reader recognises. */
import fs from "node:fs";
import path from "node:path";
import { FIXTURE_PHOTOS } from "../src/lib/images";
const dir = path.resolve("fixtures/bi107"); fs.mkdirSync(dir, { recursive: true });
for (const f of FIXTURE_PHOTOS()) { fs.writeFileSync(path.join(dir, f.name), f.bytes); console.log(`wrote fixtures/bi107/${f.name} (${f.bytes.length} bytes)`); }
