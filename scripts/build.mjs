// Checks and completes every profiles/<id>/profile.json against the action catalog, then
// writes registry.json. Run it after any change and commit what it writes:
//   node scripts/build.mjs           fix up the files and write registry.json
//   node scripts/build.mjs --check   fail if anything would change (CI)
//
// What it does to a profile file (all of it is idempotent):
//   - shorthand items `{ "label", "icon"?, "action": "obs/record", "inputs"? }` become full items
//     with the kind the editor would give them (toggle states, slider range, input defaults);
//   - every item, folder and workflow step gets an id;
//   - deck grids are laid out to 64 cells: `"cell": n` places an item, the rest fill in order;
//     a folder gets its Back cell; a slider's `span` claims the cells after it;
//   - each item and step gets `platforms` when its action doesn't run on every OS
//     (the app leaves it out elsewhere);
//   - `"icon": "plugin:obs"` becomes the plugin's logo as a data URI (catalog/icons/);
//   - `plugins`, `platforms`, `ready` and `items` are filled in for the registry.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const OSES = ["linux", "macos", "windows"];
const GRID = 64;
const COLS = 8;
const FORMAT = "knobdeck-registry-profile";
const check = process.argv.includes("--check");

const catalog = JSON.parse(readFileSync("catalog/plugins.json", "utf8")).plugins;
const builtin = JSON.parse(readFileSync("catalog/builtin.json", "utf8")).actions;
const problems = [];
const changed = [];

/// The catalog entry of an action ref: `obs/record` (a plugin's) or `volume` (built-in).
function lookup(ref) {
  const slash = ref.indexOf("/");
  if (slash < 0) {
    const a = builtin[ref];
    return a && { ...a, plugin: null, platforms: a.platforms ?? OSES };
  }
  const base = ref.slice(0, slash);
  const p = catalog[base];
  const a = p?.actions[ref.slice(slash + 1)];
  return a && { ...a, plugin: base };
}

const pluginName = (base) => catalog[base]?.name ?? base;

/// The input values an item starts with: the action's defaults under the given ones.
function withDefaults(def, inputs = {}) {
  const out = {};
  for (const i of def.inputs ?? []) if (i.default !== undefined) out[i.key] = i.default;
  return { ...out, ...inputs };
}

/// Inputs the user still has to fill in: a pick from a list (scene, entity, voice…) with no
/// value and no default, unless hidden by showIf or labelled optional. Free-text fields don't
/// count: they have a fallback or the profile sets them. A profile marks a field it leaves
/// empty on purpose with `""`.
const OPTIONAL = new Set(["browser-plugin:browser"]); // empty = whichever browser is connected
function missingInputs(def, inputs = {}) {
  return (def.inputs ?? []).filter((i) => {
    if (inputs[i.key] !== undefined && inputs[i.key] !== null) return false;
    if (i.default !== undefined || OPTIONAL.has(`${def.plugin}:${i.key}`) || /optional/i.test(i.label ?? "")) return false;
    if (i.showIf) {
      const v = inputs[i.showIf.key];
      if (i.showIf.equals !== undefined ? v !== i.showIf.equals : i.showIf.truthy && !v) return false;
    }
    return i.needs || i.type === "select" || i.type === "combobox";
  }).map((i) => i.key);
}

/// Exactly two dial toggle states, [On, Off] (items.js onOffStates).
function onOffStates(states) {
  const list = (states?.length ? states : [{ value: "off", label: "Off", icon: "toggle-left" }, { value: "on", label: "On", icon: "toggle-right" }])
    .map((s) => ({ value: s.value, label: s.label ?? s.value, icon: s.icon ?? null }));
  const on = list.find((s) => s.value === "on") ?? list[0];
  const off = list.find((s) => s.value === "off") ?? list.find((s) => s !== on) ?? { value: "off", label: "Off", icon: "toggle-left" };
  return [on, off];
}

const DIAL_TYPE = { button: "button", toggle: "toggle", slider: "slider", wheel: "dynamic" };
const DECK_TYPE = { button: "button", toggle: "toggle", slider: "slider", wheel: "dynamic_wheel", hold: "hold" };

/// The kind the editor gives an item bound to `ref` (dial items.js / deck model.js newKind).
function kindFor(ref, def, inputs, deck, span) {
  const type = (deck ? DECK_TYPE : DIAL_TYPE)[def.type];
  if (!type) throw new Error(`a ${def.type} action can't go on a ${deck ? "deck" : "dial"}`);
  const plugin = def.plugin ? def.plugin : "knobdeck-actions";
  const body = { type, plugin, action_type: ref, inputs: withDefaults(def, inputs) };
  if (type === "toggle") {
    const states = deck
      ? (def.states?.length ? def.states : [{ value: "off", label: "Off", icon: "○" }, { value: "on", label: "On", icon: "●" }]).map((s) => ({ value: s.value, label: s.label ?? s.value, icon: s.icon ?? null }))
      : onOffStates(def.states);
    return { ...body, states, default_state: states[0].value };
  }
  if (type === "slider") {
    return { ...body, min: def.min ?? 0, max: def.max ?? 100, step: def.step ?? 1, unit: def.unit ?? null, ...(deck && { span: span ?? { axis: "row", length: 2 } }) };
  }
  if (type === "hold") {
    return { ...body, released: { label: def.released?.label ?? "Idle", icon: def.released?.icon ?? "○" }, held: { label: def.held?.label ?? "Holding", icon: def.held?.icon ?? "●" } };
  }
  return body;
}

const emptyCell = (id) => ({ id, label: "", icon: null, show_title: false, kind: { type: "empty" } });

function iconData(value, where) {
  if (typeof value !== "string" || !value.startsWith("plugin:")) return value;
  const base = value.slice("plugin:".length);
  const file = catalog[base]?.icon;
  if (!file || !existsSync(`catalog/icons/${base}/${file}`)) {
    problems.push(`${where}: no logo for plugin '${base}'`);
    return null;
  }
  const bytes = readFileSync(`catalog/icons/${base}/${file}`);
  const mime = file.endsWith(".svg") ? "image/svg+xml" : "image/png";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function buildProfile(id) {
  const path = `profiles/${id}/profile.json`;
  const before = readFileSync(path, "utf8");
  const file = JSON.parse(before);
  const where = (s) => `${id}: ${s}`;
  if (file.format !== FORMAT) problems.push(where(`format must be "${FORMAT}"`));
  if (file.version !== 1) problems.push(where("version must be 1"));
  if (file.id !== id) problems.push(where(`id must be the folder name "${id}"`));
  if (!["dial", "deck"].includes(file.kind)) problems.push(where('kind must be "dial" or "deck"'));
  for (const k of ["name", "summary", "author"]) if (typeof file[k] !== "string" || !file[k].trim()) problems.push(where(`${k} is required`));
  if (!/^\d+\.\d+\.\d+$/.test(file.profileVersion ?? "")) problems.push(where('profileVersion must be semver, e.g. "1.0.0"'));

  const deck = file.kind === "deck";
  const key = deck ? "slices" : "items";
  let counter = 0;
  const ids = new Set();
  const fresh = (prefix) => {
    let next;
    do next = `${id}-${prefix}${++counter}`; while (ids.has(next));
    ids.add(next);
    return next;
  };
  // Keep the ids already there, so a rebuild changes nothing.
  JSON.stringify(file.profile, (k, v) => { if ((k === "id" || k === "cid") && typeof v === "string") ids.add(v); return v; });

  const used = new Set();
  const perOs = Object.fromEntries(OSES.map((o) => [o, { kept: 0, skipped: 0 }]));
  const toConfigure = [];
  let count = 0;

  /// Complete one item; returns the OSes it runs on.
  function item(it, depth) {
    const at = `${where(it.label ?? "item")}`;
    if (it.action) {
      const def = lookup(it.action);
      if (!def) { problems.push(`${at}: unknown action '${it.action}'`); return OSES; }
      try {
        it.kind = kindFor(it.action, def, it.inputs, deck, it.span);
      } catch (e) { problems.push(`${at}: ${e.message}`); return OSES; }
      it.label ??= def.label;
      it.icon ??= def.icon;
      delete it.action; delete it.inputs; delete it.span;
    }
    it.id ??= fresh(deck ? "slice" : "item");
    if (it.icon !== undefined) it.icon = iconData(it.icon, at);
    if (deck) it.show_title ??= true;
    const k = it.kind ?? {};
    let platforms = OSES;
    const bind = (ref, inputs, label) => {
      const def = lookup(ref);
      if (!def) { problems.push(`${at}: unknown action '${ref}'`); return OSES; }
      if (def.plugin) used.add(def.plugin);
      if (def.platforms.length === 0) problems.push(`${at}: '${ref}' is disabled on every OS`);
      const missing = missingInputs(def, inputs);
      if (missing.length) toConfigure.push(`${label} (${missing.join(", ")})`);
      return def.platforms;
    };
    if (typeof k.action_type === "string") platforms = bind(k.action_type, k.inputs, it.label);
    for (const steps of ["actions", "toggles"]) {
      if (!Array.isArray(k[steps])) continue;
      const union = new Set();
      for (const s of k[steps]) {
        s.cid ??= fresh("step");
        if (s.action && !s.action_type) {
          const def = lookup(s.action);
          if (def) {
            s.action_type = s.action; s.inputs = withDefaults(def, s.inputs);
            if (def.type === "toggle") Object.assign(s, { states: onOffStates(def.states), mode: s.mode ?? "flip" });
          }
          delete s.action;
        }
        const p = typeof s.action_type === "string" ? bind(s.action_type, s.inputs, `${it.label} → step`) : OSES;
        setPlatforms(s, p);
        p.forEach((o) => union.add(o));
      }
      platforms = OSES.filter((o) => union.has(o));
    }
    if (Array.isArray(k[key])) {
      if (deck && depth > 0) problems.push(`${at}: a deck folder can't hold a folder`);
      k[key] = grid(k[key], depth + 1);
    }
    setPlatforms(it, platforms);
    if (!["empty", "back", "slider_span"].includes(k.type)) {
      count++;
      for (const o of OSES) perOs[o][platforms.includes(o) ? "kept" : "skipped"]++;
    }
    return platforms;
  }

  /// A dial ring as given; a deck level as a 64-cell grid (Back first in a folder).
  function grid(items, depth) {
    if (!deck) {
      for (const it of items) item(it, depth);
      return items;
    }
    const cells = new Array(GRID).fill(null);
    const loose = [];
    const placed = items.filter((it) => it?.kind?.type !== "empty");
    for (const it of placed) {
      const at = Number.isInteger(it.cell) ? it.cell : null;
      delete it.cell;
      if (at === null) { loose.push(it); continue; }
      if (at < 0 || at >= GRID || cells[at]) problems.push(where(`cell ${at} is out of the grid or taken`));
      else cells[at] = it;
    }
    // Cells keep their place when the file is already laid out (64 cells).
    if (items.length === GRID && loose.length === placed.length) {
      items.forEach((it, i) => { cells[i] = it.kind?.type === "empty" ? null : it; });
      loose.length = 0;
    }
    if (depth > 0 && !cells.some((c) => c?.kind?.type === "back")) {
      const back = { id: fresh("back"), label: "Back", icon: null, show_title: true, kind: { type: "back" } };
      if (cells[0]) loose.unshift(back); else cells[0] = back;
    }
    for (const it of loose) {
      const free = cells.findIndex((c, i) => !c && !reservedBySpan(cells, i));
      if (free < 0) { problems.push(where("more items than the grid holds")); break; }
      cells[free] = it;
    }
    for (let i = 0; i < GRID; i++) {
      const it = cells[i];
      if (!it || it.kind?.type === "slider_span") continue;
      item(it, depth);
      if (it.kind?.type === "slider") {
        const { axis = "row", length = 2 } = it.kind.span ?? {};
        for (let n = 1; n < length; n++) {
          const j = axis === "col" ? i + n * COLS : i + n;
          if (j >= GRID || (axis === "row" && Math.floor(j / COLS) !== Math.floor(i / COLS))) { problems.push(where(`slider '${it.label}' runs off the grid`)); break; }
          const c = cells[j];
          if (c && !(c.kind?.type === "slider_span" && c.kind.owner === it.id)) { problems.push(where(`slider '${it.label}' overlaps '${c.label ?? c.kind?.type}'`)); break; }
          cells[j] = c ?? { id: fresh("span"), label: "", icon: null, show_title: false, kind: { type: "slider_span", owner: it.id } };
        }
      }
    }
    // An empty cell keeps its id across rebuilds.
    const was = items.length === GRID ? items : [];
    return cells.map((c, i) => c ?? (was[i]?.kind?.type === "empty" ? was[i] : emptyCell(fresh("cell"))));
  }

  if (!file.profile || typeof file.profile !== "object") problems.push(where("profile is required"));
  else {
    const p = file.profile;
    p.name ??= file.name;
    p.icon = iconData(p.icon ?? null, where("profile icon"));
    p.keybind ??= null;
    p.auto_open ??= null;
    if (deck) p.show_labels ??= true;
    p[key] = grid(p[key] ?? [], 0);
  }

  file.plugins = [...used].sort().map((base) => ({
    id: base,
    name: pluginName(base),
    ...(catalog[base]?.builtin && { builtin: true }),
    ...(catalog[base]?.setup && { setup: true }),
  }));
  file.platforms = OSES.filter((o) => perOs[o].kept > 0);
  file.skippedOn = Object.fromEntries(OSES.filter((o) => perOs[o].skipped > 0 && perOs[o].kept > 0).map((o) => [o, perOs[o].skipped]));
  file.ready = toConfigure.length === 0;
  file.toConfigure = toConfigure;
  file.items = count;
  if (count === 0) problems.push(where("the profile has no items"));

  const after = JSON.stringify(ordered(file), null, 2) + "\n";
  if (after !== before) {
    changed.push(path);
    if (!check) writeFileSync(path, after);
  }
  return file;
}

function setPlatforms(v, platforms) {
  if (platforms.length === OSES.length) delete v.platforms;
  else v.platforms = [...platforms];
}

function reservedBySpan(cells, i) {
  return cells.some((c, j) => {
    if (c?.kind?.type !== "slider" && !(c?.action && lookup(c.action)?.type === "slider")) return false;
    const { axis = "row", length = 2 } = c.kind?.span ?? c.span ?? {};
    for (let n = 1; n < length; n++) if ((axis === "col" ? j + n * COLS : j + n) === i) return true;
    return false;
  });
}

/// Registry fields first, the profile last, so the files read top-down.
function ordered(f) {
  const head = ["format", "version", "id", "kind", "name", "summary", "description", "author", "profileVersion", "tags",
    "plugins", "platforms", "skippedOn", "ready", "toConfigure", "items"];
  const out = {};
  for (const k of head) if (f[k] !== undefined) out[k] = f[k];
  for (const [k, v] of Object.entries(f)) if (!(k in out) && k !== "profile") out[k] = v;
  out.profile = f.profile;
  return out;
}

const ids = readdirSync("profiles", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const entries = [];
for (const id of ids) {
  if (!/^[a-z0-9-]{1,64}$/.test(id)) { problems.push(`${id}: folder names are lowercase letters, digits and dashes`); continue; }
  if (!existsSync(`profiles/${id}/profile.json`)) { problems.push(`${id}: no profile.json`); continue; }
  let f;
  try { f = buildProfile(id); } catch (e) { problems.push(`${id}: ${e.message}`); continue; }
  const text = readFileSync(`profiles/${id}/profile.json`);
  entries.push({
    id, kind: f.kind, name: f.name, summary: f.summary, ...(f.description && { description: f.description }),
    author: f.author, version: f.profileVersion, tags: f.tags ?? [], icon: typeof f.profile?.icon === "string" && !f.profile.icon.startsWith("data:") ? f.profile.icon : null,
    plugins: f.plugins, platforms: f.platforms, skippedOn: f.skippedOn, ready: f.ready, configure: f.toConfigure.length, items: f.items,
    profile: `${id}/profile.json`,
    sha256: check ? null : createHash("sha256").update(text).digest("hex"),
  });
}
entries.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "dial" ? -1 : 1) || (b.featured ?? 0) - (a.featured ?? 0) || a.name.localeCompare(b.name));

if (!check) {
  const registry = JSON.stringify({ format: "knobdeck-profile-registry", version: 1, profiles: entries }, null, 2) + "\n";
  if (!existsSync("registry.json") || readFileSync("registry.json", "utf8") !== registry) changed.push("registry.json");
  writeFileSync("registry.json", registry);
} else {
  // The registry must list exactly the profiles here, with these files' hashes.
  const reg = existsSync("registry.json") ? JSON.parse(readFileSync("registry.json", "utf8")) : { profiles: [] };
  const want = entries.map((e) => `${e.id}:${createHash("sha256").update(readFileSync(`profiles/${e.id}/profile.json`)).digest("hex")}`).sort();
  const have = reg.profiles.map((e) => `${e.id}:${e.sha256}`).sort();
  if (JSON.stringify(want) !== JSON.stringify(have)) changed.push("registry.json");
}

for (const p of problems) console.error(`error: ${p}`);
if (check && changed.length) console.error(`out of date (run node scripts/build.mjs and commit): ${changed.join(", ")}`);
else if (changed.length) console.log(`updated ${changed.join(", ")}`);
console.log(`${entries.length} profile(s): ${entries.filter((e) => e.kind === "dial").length} dial, ${entries.filter((e) => e.kind === "deck").length} deck`);
if (problems.length || (check && changed.length)) process.exit(1);
