// Draws profiles/<id>/preview.png: the dial's ring or the deck's grid with every item's icon and
// label, so the Get Profiles page shows what a profile holds. Run it after changing a profile:
//   node scripts/preview.mjs [id …]          (all profiles when no id is given)
// Needs `rsvg-convert` (librsvg) and Lucide's SVGs: LUCIDE_DIR, else the `lucide-static` package of
// a KnobDeck app checkout next to this repo (../Knobdeck/app/node_modules/lucide-static/icons).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";

const LUCIDE = process.env.LUCIDE_DIR ?? "../Knobdeck/app/node_modules/lucide-static/icons";
if (!existsSync(LUCIDE)) throw new Error(`Lucide icons not found at ${LUCIDE}; set LUCIDE_DIR`);

// Neutral dark canvas, KnobDeck aqua only as the accent (no teal backgrounds).
const C = { bg: "#18191c", tile: "#26282c", tileLine: "#34373c", ink: "#e8e9eb", dim: "#9a9ea6", accent: "#1f9aa3", empty: "#1f2124" };
const W = 960, H = 600;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/// An icon value drawn at (x, y) as a `size` square: Lucide name or data URI; a monogram otherwise.
function icon(value, x, y, size, color = C.ink, fallback = "?") {
  if (typeof value === "string" && value.startsWith("data:")) {
    // Single-colour SVGs are drawn in currentColor; the app inks them for the surface, so do the same.
    const svg = value.match(/^data:image\/svg\+xml;base64,(.*)$/);
    const href = svg
      ? `data:image/svg+xml;base64,${Buffer.from(Buffer.from(svg[1], "base64").toString("utf8").replaceAll("currentColor", color)).toString("base64")}`
      : value;
    return `<image href="${href}" x="${x}" y="${y}" width="${size}" height="${size}"/>`;
  }
  const file = typeof value === "string" ? `${LUCIDE}/${value}.svg` : null;
  if (file && existsSync(file)) {
    const inner = readFileSync(file, "utf8").replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    const k = size / 24;
    return `<g transform="translate(${x} ${y}) scale(${k})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
  }
  return `<text x="${x + size / 2}" y="${y + size * 0.72}" text-anchor="middle" font-size="${size * 0.7}" font-weight="600" fill="${color}">${esc(fallback.slice(0, 1).toUpperCase())}</text>`;
}

const label = (text, x, y, size, color = C.ink, weight = 500) =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" font-weight="${weight}" fill="${color}">${esc(text)}</text>`;

const typeMark = (kind) => (kind?.type === "folder" ? "folder" : kind?.type === "multi" ? "workflow" : null);

function dial(file) {
  const items = file.profile.items;
  const cx = W / 2, cy = H / 2 + 6, r = 205, tile = 92;
  let out = `<circle cx="${cx}" cy="${cy}" r="${r + tile / 2 + 14}" fill="none" stroke="${C.tileLine}" stroke-width="2"/>`;
  out += `<circle cx="${cx}" cy="${cy}" r="88" fill="${C.tile}" stroke="${C.accent}" stroke-width="3"/>`;
  out += icon(file.profile.icon, cx - 22, cy - 46, 44, C.ink, file.name);
  out += label(short(file.name, 16), cx, cy + 28, 18, C.ink, 600);
  out += label(`${file.items} items`, cx, cy + 50, 14, C.dim);
  items.forEach((it, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / items.length;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    out += `<circle cx="${x}" cy="${y}" r="${tile / 2}" fill="${C.tile}" stroke="${C.tileLine}" stroke-width="2"/>`;
    out += icon(it.icon, x - 17, y - 26, 34, C.ink, it.label ?? "");
    out += label(short(it.label ?? "", 14), x, y + 26, 13, C.ink);
    const mark = typeMark(it.kind);
    if (mark) {
      out += `<circle cx="${x + 30}" cy="${y - 30}" r="13" fill="${C.accent}"/>` + icon(mark, x + 22, y - 38, 16, "#ffffff");
    }
  });
  return out;
}

function deck(file) {
  const cells = file.profile.slices;
  const used = cells.map((c, i) => (["empty"].includes(c.kind?.type) ? -1 : i)).filter((i) => i >= 0);
  const rows = Math.max(2, Math.floor(Math.max(...used) / 8) + 1);
  const gap = 12;
  const size = Math.min((W - 80 - 7 * gap) / 8, (H - 110 - (rows - 1) * gap) / rows);
  const gw = 8 * size + 7 * gap, gh = rows * size + (rows - 1) * gap;
  const x0 = (W - gw) / 2, y0 = 80 + (H - 80 - gh) / 2 - 10;
  let out = icon(file.profile.icon, 40, 26, 30, C.ink, file.name) + `<text x="82" y="50" font-size="22" font-weight="600" fill="${C.ink}">${esc(file.name)}</text>`;
  const pos = (i) => [x0 + (i % 8) * (size + gap), y0 + Math.floor(i / 8) * (size + gap)];
  for (let i = 0; i < rows * 8; i++) {
    const c = cells[i];
    const t = c?.kind?.type;
    const [x, y] = pos(i);
    if (t === "slider_span") continue;
    if (!c || t === "empty") {
      out += `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="14" fill="${C.empty}"/>`;
      continue;
    }
    if (t === "slider") {
      const { axis = "row", length = 2 } = c.kind.span ?? {};
      const w = axis === "row" ? length * size + (length - 1) * gap : size;
      const h = axis === "col" ? length * size + (length - 1) * gap : size;
      out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${C.tile}" stroke="${C.tileLine}" stroke-width="2"/>`;
      out += axis === "row"
        ? `<rect x="${x + 8}" y="${y + h - 16}" width="${(w - 16) * 0.6}" height="8" rx="4" fill="${C.accent}"/>`
        : `<rect x="${x + w - 16}" y="${y + h * 0.4}" width="8" height="${h * 0.6 - 8}" rx="4" fill="${C.accent}"/>`;
      out += icon(c.icon, x + 12, y + 12, size * 0.34, C.ink, c.label ?? "");
      out += `<text x="${x + 18 + size * 0.34}" y="${y + 12 + size * 0.25}" font-size="13" font-weight="500" fill="${C.ink}">${esc(short(c.label ?? "", axis === "row" ? length * 9 : 9))}</text>`;
      continue;
    }
    const isToggle = t === "toggle";
    out += `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="14" fill="${C.tile}" stroke="${isToggle ? C.accent : C.tileLine}" stroke-width="2"/>`;
    const s = size * 0.4;
    out += icon(t === "back" ? "arrow-left" : c.icon, x + (size - s) / 2, y + size * 0.16, s, C.ink, c.label ?? "");
    out += label(short(c.label ?? "", 11), x + size / 2, y + size * 0.84, 12, C.ink);
    const mark = typeMark(c.kind);
    if (mark) out += `<circle cx="${x + size - 12}" cy="${y + 12}" r="9" fill="${C.accent}"/>` + icon(mark, x + size - 18, y + 6, 12, "#ffffff");
  }
  return out;
}

function render(id) {
  const file = JSON.parse(readFileSync(`profiles/${id}/profile.json`, "utf8"));
  const body = file.kind === "deck" ? deck(file) : dial(file);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif">
<rect width="${W}" height="${H}" fill="${C.bg}"/>${body}</svg>`;
  const tmp = `profiles/${id}/.preview.svg`;
  writeFileSync(tmp, svg);
  try {
    execFileSync("rsvg-convert", ["-w", String(W), "-h", String(H), "-o", `profiles/${id}/preview.png`, tmp]);
  } finally {
    rmSync(tmp, { force: true });
  }
  console.log(`profiles/${id}/preview.png`);
}

const ids = process.argv.slice(2);
for (const id of ids.length ? ids : readdirSync("profiles").filter((d) => existsSync(`profiles/${d}/profile.json`)).sort()) render(id);
