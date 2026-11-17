// Refreshes catalog/plugins.json and catalog/icons/ from the plugin catalog (knobdeck-registry,
// /v2/index.json + /v2/plugins/<id>.json): every plugin's actions, keyed by the portable ids
// profiles use (`obs` + `record`, `os-tools` for mac-tools / win-tools / linux-tools). An action's
// platforms are where it runs and the catalog's policy allows it. build.mjs checks profiles against it.
//   node scripts/sync-catalog.mjs [base]
// base: the catalog site (default https://app.knobdeck.harshalkudale.com) or a local knobdeck-registry
// public/ folder, e.g. ../knobdeck-registry/public to try an unmerged catalog change.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2] ?? "https://app.knobdeck.harshalkudale.com";
const local = !/^https?:/.test(base);
const TOOLS = { "linux-tools": "linux", "mac-tools": "macos", "win-tools": "windows" };

async function get(path, { binary = false } = {}) {
  if (local) {
    const file = join(base, path);
    if (!existsSync(file)) throw new Error(`${file} not found`);
    return binary ? readFileSync(file) : JSON.parse(readFileSync(file, "utf8"));
  }
  const res = await fetch(new URL(path, base));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return binary ? Buffer.from(await res.arrayBuffer()) : res.json();
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const index = await get("v2/index.json");
console.log(`catalog ${index.generated}: ${index.plugins.length} plugins`);
const plugins = {};
rmSync("catalog/icons", { recursive: true, force: true });
// By id, so merged entries (os-tools) take their labels from linux-tools, then mac-tools, then win-tools.
for (const entry of [...index.plugins].sort((a, b) => a.id.localeCompare(b.id))) {
  const detail = await get(entry.detail.replace(/^\//, ""));
  const tools = TOOLS[entry.id];
  const pid = tools ? "os-tools" : entry.id;
  const p = (plugins[pid] ??= { name: tools ? "OS Tools" : entry.name, builtin: !!tools, setup: false, platforms: [], icon: null, actions: {} });
  for (const os of Object.keys(entry.latest.platforms)) if (!p.platforms.includes(os)) p.platforms.push(os);
  p.setup ||= !!detail.setup;
  if (!tools && entry.iconUrl && entry.icon) {
    mkdirSync(`catalog/icons/${pid}`, { recursive: true });
    writeFileSync(`catalog/icons/${pid}/${entry.icon}`, await download(entry.iconUrl));
    p.icon = entry.icon;
  }
  for (const [id, a] of Object.entries(detail.actions)) {
    const { disabled, ...action } = a;
    const have = p.actions[id];
    if (!have) p.actions[id] = { ...action, platforms: [...action.platforms] };
    else for (const os of action.platforms) if (!have.platforms.includes(os)) have.platforms.push(os);
  }
}
for (const p of Object.values(plugins)) {
  p.platforms.sort();
  for (const a of Object.values(p.actions)) a.platforms.sort();
}
const sorted = Object.fromEntries(Object.entries(plugins).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync("catalog/plugins.json", JSON.stringify({ tag: `catalog-${index.generated}`, plugins: sorted }, null, 2) + "\n");
console.log(`catalog/plugins.json: ${Object.keys(sorted).length} plugins`);
