// Refreshes catalog/plugins.json and catalog/icons/ from the latest knobdeck-plugins release:
// every published bundle's manifest.json, actions.json and icons, merged per plugin across the
// three OSes and keyed by the portable ids profiles use (`obs` + `record`, `os-tools` for
// mac-tools / win-tools / linux-tools). build.mjs checks profiles against it.
//   node scripts/sync-catalog.mjs [tag]        (needs `gh` and `unzip`)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = "Knobdeck/knobdeck-plugins";
const OSES = ["linux", "macos", "windows"];
const TOOLS = { "linux-tools": "linux", "mac-tools": "macos", "win-tools": "windows" };

const tag = process.argv[2] ?? execFileSync("gh", ["release", "view", "-R", REPO, "--json", "tagName", "-q", ".tagName"]).toString().trim();
const work = mkdtempSync(join(tmpdir(), "knobdeck-catalog-"));
try {
  console.log(`downloading ${REPO} ${tag} bundles…`);
  execFileSync("gh", ["release", "download", tag, "-R", REPO, "-p", "*.knobdeck", "-p", "registry.json", "-D", work], { stdio: "inherit" });
  // The store names (index.json in the plugins repo), e.g. "Browser Controls".
  const names = Object.fromEntries(JSON.parse(readFileSync(join(work, "registry.json"), "utf8")).plugins.map((p) => [p.id, p.name]));

  const plugins = {};
  rmSync("catalog/icons", { recursive: true, force: true });
  for (const file of readdirSync(work).filter((f) => f.endsWith(".knobdeck")).sort()) {
    const dir = join(work, file.replace(/\.knobdeck$/, ""));
    try {
      execFileSync("unzip", ["-q", "-o", join(work, file), "manifest.json", "actions.json", "icons/*", "-d", dir], { stdio: "ignore" });
    } catch (e) {
      if (e.status !== 11) throw e; // 11: a pattern matched nothing (a bundle without icons/)
    }
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    const { actions } = JSON.parse(readFileSync(join(dir, "actions.json"), "utf8"));
    const pid = manifest.id;
    const tools = TOOLS[pid];
    const os = tools ?? OSES.find((o) => pid.endsWith(`-${o}`));
    if (!os) throw new Error(`${pid}: can't tell its OS`);
    const base = tools ? "os-tools" : pid.slice(0, -(os.length + 1));

    const p = (plugins[base] ??= { name: tools ? "OS Tools" : names[pid] ?? manifest.name, builtin: !!tools, setup: false, platforms: [], icon: null, actions: {} });
    p.platforms.push(os);
    // A plugin with a setup step (a sign-in, an address) needs it run before its actions work.
    p.setup ||= !!manifest.setup_required;
    if (!tools && manifest.icon && /\.(svg|png)$/i.test(manifest.icon) && existsSync(join(dir, "icons", manifest.icon))) {
      mkdirSync(`catalog/icons/${base}`, { recursive: true });
      copyFileSync(join(dir, "icons", manifest.icon), `catalog/icons/${base}/${manifest.icon}`);
      p.icon = manifest.icon;
    }
    for (const a of actions) {
      const local = a.id.slice(pid.length + 1, -9);
      const runsHere = (a.platforms?.length ? a.platforms : manifest.platforms ?? [os]).includes(os);
      const entry = (p.actions[local] ??= {
        type: a.type,
        label: a.label,
        icon: a.icon ?? null,
        platforms: [],
        inputs: (a.inputs ?? []).map((i) => ({
          key: i.key, type: i.type, ...(i.label && { label: i.label }), ...(i.default !== undefined && { default: i.default }),
          ...(i.showIf && { showIf: i.showIf }), ...(i.options && { options: i.options.map((o) => o.value ?? o) }),
        })),
        ...(a.states && { states: a.states }),
        ...(a.type === "slider" && { min: a.min ?? 0, max: a.max ?? 100, step: a.step ?? 1, unit: a.unit ?? null }),
        ...(a.released && { released: a.released }),
        ...(a.held && { held: a.held }),
      });
      if (runsHere && !entry.platforms.includes(os)) entry.platforms.push(os);
    }
  }
  for (const p of Object.values(plugins)) {
    p.platforms.sort();
    for (const a of Object.values(p.actions)) a.platforms.sort();
  }
  const sorted = Object.fromEntries(Object.entries(plugins).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync("catalog/plugins.json", JSON.stringify({ tag, plugins: sorted }, null, 2) + "\n");
  console.log(`catalog/plugins.json: ${Object.keys(sorted).length} plugins from ${tag}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
