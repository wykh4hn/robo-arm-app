// Wraps each STL under a folder as <name>.stl.json ({"b64": ...}) for hosts that cannot
// serve .stl files. Usage: node scripts/stl-to-json.mjs dist/robot/so101/assets
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node scripts/stl-to-json.mjs <folder>');
for (const name of readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.stl'))) {
  const path = join(dir, name);
  writeFileSync(`${path}.json`, JSON.stringify({ b64: readFileSync(path).toString('base64') }));
  rmSync(path);
}
