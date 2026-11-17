// Draws profiles/<id>/preview.png: a promo card for the Get Profiles page (kind, icon, name,
// summary, what it uses). Not a picture of the layout. Run it after changing a profile:
//   node scripts/preview.mjs [id …]          (all profiles when no id is given)
// Needs `rsvg-convert` (librsvg) and Lucide's SVGs: LUCIDE_DIR, else the `lucide-static` package of
// a KnobDeck app checkout next to this repo (../Knobdeck/app/node_modules/lucide-static/icons).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";

const LUCIDE = process.env.LUCIDE_DIR ?? "../Knobdeck/app/node_modules/lucide-static/icons";
if (!existsSync(LUCIDE)) throw new Error(`Lucide icons not found at ${LUCIDE}; set LUCIDE_DIR`);

// Neutral dark canvas, KnobDeck aqua only as the accent (no teal backgrounds).
const C = { bg: "#18191c", tile: "#26282c", tileLine: "#34373c", ink: "#e8e9eb", dim: "#9a9ea6", accent: "#1f9aa3", empty: "#1f2124" };
const W = 800, H = 600;
const FONT = "Inter, 'Helvetica Neue', Arial, sans-serif";

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


/// `text` broken into at most `lines` lines of about `width` characters.
function wrap(text, width, lines) {
  const out = [""];
  for (const word of String(text ?? "").split(/\s+/)) {
    const cur = out[out.length - 1];
    if (!cur || cur.length + word.length + 1 <= width) out[out.length - 1] = cur ? `${cur} ${word}` : word;
    else if (out.length < lines) out.push(word);
    else { out[out.length - 1] = cur.replace(/[\s,.;:]*$/, "") + "…"; break; }
  }
  return out;
}

function render(id) {
  const f = JSON.parse(readFileSync(`profiles/${id}/profile.json`, "utf8"));
  const deck = f.kind === "deck";
  const plugins = (f.plugins ?? []).filter((p) => !p.builtin).map((p) => p.name);
  const kindText = deck ? "DECK PROFILE" : "DIAL PROFILE";
  const pillW = 70 + kindText.length * 12.2;
  const nameSize = f.name.length > 18 ? 46 : 56;
  const summary = wrap(f.summary, 40, 3);
  const uses = plugins.length ? `Uses ${plugins.join(" · ")}` : "Built-in actions only";
  const meta = `${f.items} actions${f.ready ? "  ·  Ready to use" : ""}`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
<defs>
  <radialGradient id="glow" cx="0.85" cy="0.1" r="0.9">
    <stop offset="0" stop-color="#2c2f35"/><stop offset="1" stop-color="${C.bg}"/>
  </radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#glow)"/>
<rect x="56" y="56" width="${pillW}" height="40" rx="20" fill="none" stroke="${C.accent}" stroke-width="2"/>
${icon(deck ? "layout-grid" : "circle-dot", 72, 64, 24, C.accent)}
<text x="106" y="83" font-size="17" font-weight="700" letter-spacing="1.5" fill="${C.accent}">${kindText}</text>
<rect x="${W - 56 - 150}" y="56" width="150" height="150" rx="36" fill="${C.tile}" stroke="${C.tileLine}" stroke-width="2"/>
${icon(f.profile?.icon, W - 56 - 150 + 35, 91, 80, C.ink, f.name)}
<text x="56" y="${300}" font-size="${nameSize}" font-weight="700" fill="${C.ink}">${esc(short(f.name, 26))}</text>
${summary.map((l, i) => `<text x="56" y="${350 + i * 34}" font-size="25" fill="${C.dim}">${esc(l)}</text>`).join("\n")}
<line x1="56" y1="${H - 104}" x2="${W - 56}" y2="${H - 104}" stroke="${C.tileLine}" stroke-width="2"/>
<text x="56" y="${H - 64}" font-size="21" font-weight="600" fill="${C.ink}">${esc(short(uses, 48))}</text>
<text x="${W - 56}" y="${H - 64}" text-anchor="end" font-size="21" fill="${f.ready ? C.accent : C.dim}">${esc(meta)}</text>
</svg>`;
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
