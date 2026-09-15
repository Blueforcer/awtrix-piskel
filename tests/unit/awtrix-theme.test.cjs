const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../../src/css/awtrix-theme.css"),
  "utf8"
);
const concatPlugin = fs.readFileSync(
  path.join(__dirname, "../../vite-plugins/concat-scripts.js"),
  "utf8"
);
const cssPlugin = fs.readFileSync(
  path.join(__dirname, "../../vite-plugins/css-replace.js"),
  "utf8"
);
const componentStyles = [
  "dialogs-import.css",
  "dialogs-browse-backups.css",
  "frames-list.css",
  "minimap.css",
  "settings-application.css",
  "toolbox-animated-preview.css",
  "transformations.css"
]
  .map((file) =>
    fs.readFileSync(path.join(__dirname, "../../src/css", file), "utf8")
  )
  .join("\n");

function themeTokens(theme) {
  const block = source.match(
    new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`)
  );
  assert.ok(block, `${theme} theme block exists`);

  return Object.fromEntries(
    [...block[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].trim()
    ])
  );
}

test("dark theme mirrors the AWTRIX host palette", () => {
  assert.deepEqual(themeTokens("dark"), {
    bg: "#171717",
    card: "#222221",
    card2: "#292927",
    border: "#373632",
    brd2: "#302f2b",
    fg: "#f3f1ec",
    dim: "#a6a198",
    acc: "#f5a568",
    pri: "#f5a568",
    ok: "#8fbf72",
    err: "#ff9d90",
    warn: "#ffb65c",
    con: "#10100f",
    confg: "#f3f1ec",
    sh: "#0008",
    trk: "#514e47",
    field: "#1c1c1b",
    "button-fg": "#23170e",
    "highlight-color": "#f5a568",
    "awx-letterbox": "#10100f"
  });
});

test("light theme mirrors the AWTRIX host palette", () => {
  assert.deepEqual(themeTokens("light"), {
    bg: "#f5f4f1",
    card: "#ffffff",
    card2: "#f0eee9",
    border: "#e2dfd8",
    brd2: "#ebe8e2",
    fg: "#242321",
    dim: "#706c65",
    acc: "#ac470f",
    pri: "#ac470f",
    ok: "#3d762e",
    err: "#b3261e",
    warn: "#945813",
    con: "#181817",
    confg: "#f7f3ec",
    sh: "#342a201f",
    trk: "#c8c3b9",
    field: "#fcfbf9",
    "button-fg": "#ffffff",
    "highlight-color": "#ac470f",
    "awx-letterbox": "#181817"
  });
});

test("interactive states consume theme tokens instead of legacy blue colours", () => {
  assert.match(source, /:focus-visible/);
  assert.match(source, /var\(--button-fg\)/);
  assert.match(
    source,
    /\.preview-tile\.selected::after[\s\S]*border-left-color: var\(--acc\)/
  );
  assert.doesNotMatch(
    source,
    /#(?:0d1117|161b22|1c2129|2d333b|e6edf3|8b949e|58a6ff|1f6feb|0969da|30363d|484f58)/i
  );
});

test("production CSS preserves the runtime theme accent", () => {
  assert.match(concatPlugin, /source: concatenatedCss/);
  assert.doesNotMatch(concatPlugin, /replace\(\/var\\\(--highlight-color/);
  assert.doesNotMatch(cssPlugin, /replace\(\/var\\\(--highlight-color/);
  assert.doesNotMatch(componentStyles, /:\s*gold\s*;/i);
});
