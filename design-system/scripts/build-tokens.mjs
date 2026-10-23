#!/usr/bin/env node
// Compiles design-system/tokens.json -> design-system/tokens.css (CSS custom properties,
// one class per type style, @font-face per font file). No dependencies.
// Usage: node design-system/scripts/build-tokens.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const t = JSON.parse(readFileSync(join(root, "tokens.json"), "utf8"));

const themes = t.color.themes.map((th) => th.id);
const first = themes[0];
const alias = (v) => (/^\{[^}]+\}$/.test(v) ? `var(--${v.slice(1, -1)})` : v);
const valueFor = (tok, theme) =>
  typeof tok.value === "string" ? (theme === first ? tok.value : undefined) : tok.value[theme];

const out = [`/* ${t.name} — generated from tokens.json */`];

for (const theme of themes) {
  const sel = theme === first ? `:root, [data-theme="${theme}"]` : `[data-theme="${theme}"]`;
  const lines = [];
  for (const fam of ["color", "shadow"]) {
    for (const tok of t[fam]?.tokens ?? []) {
      const v = valueFor(tok, theme);
      if (v !== undefined) lines.push(`  --${tok.name}: ${alias(v)};`);
    }
  }
  if (lines.length) out.push(`${sel} {`, ...lines, "}");
}

const plain = [];
for (const [fam, block] of Object.entries(t)) {
  if (["name", "version", "meta", "color", "shadow", "type"].includes(fam)) continue;
  for (const tok of block.tokens ?? []) plain.push(`  --${tok.name}: ${tok.value};`);
}
for (const [k, v] of Object.entries(t.type.families)) plain.push(`  --font-${k}: ${v};`);
out.push(":root {", ...plain, "}");

for (const g of t.type.groups) {
  for (const s of g.styles) {
    const fam = s.family ?? g.family;
    const decl = [
      `font-family: var(--font-${fam})`,
      `font-size: ${s.fontSize}`,
      `line-height: ${s.lineHeight}`,
      `font-weight: ${s.fontWeight}`,
      s.letterSpacing ? `letter-spacing: ${s.letterSpacing}` : null,
    ].filter(Boolean);
    out.push(`.${s.name} { ${decl.join("; ")}; }`);
  }
}

for (const f of t.type.fonts) {
  out.push(
    `@font-face { font-family: "${f.family}"; src: url("${f.file}") format("woff2"); font-weight: ${f.weight}; font-style: ${f.style ?? "normal"}; font-display: swap; }`,
  );
}

writeFileSync(join(root, "tokens.css"), out.join("\n") + "\n");
console.log(`tokens.css written (${t.color.tokens.length} colours, ${t.type.fonts.length} fonts)`);
