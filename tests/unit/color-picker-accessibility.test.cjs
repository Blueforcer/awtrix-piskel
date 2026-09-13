const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");

test("color sliders retain a visible keyboard focus indicator", () => {
  const selector = '.color-picker-slider input[type="range"]:focus-visible';
  const source = fs.readFileSync(
    path.join(root, "src/css/color-picker-slider.css"),
    "utf8"
  );

  assert.ok(source.includes(selector));
  assert.match(
    source,
    /:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+#fff;/s
  );
});
