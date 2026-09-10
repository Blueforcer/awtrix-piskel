const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(
  path.join(__dirname, "../../src/js/utils/serialization/Deserializer.js"),
  "utf8"
);
function setup(mode) {
  const ns = {};
  const pskl = {
    model: {
      piskel: {
        Descriptor: function (name, description) {
          this.name = name;
          this.description = description;
        }
      },
      Piskel: function (width, height, fps, descriptor) {
        Object.assign(this, { width, height, fps, descriptor, layers: [] });
        this.addLayer = (layer) => this.layers.push(layer);
      },
      Layer: function (name) {
        this.name = name;
        this.frames = [];
        this.setOpacity = (value) => {
          this.opacity = value;
        };
        this.addFrame = (frame) => this.frames.push(frame);
      }
    },
    utils: {
      FrameUtils: {
        createFramesFromChunk(_image, layout) {
          if (mode === "extract-error") {
            throw new Error("corrupt frame");
          }
          return layout.flat().map((index) => ({ index, frame: { index } }));
        }
      }
    }
  };
  const Q = {
    all: (values) => Promise.all(values),
    defer() {
      let resolve, reject;
      const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      return { promise, resolve, reject };
    }
  };
  class Image {
    set src(_value) {
      queueMicrotask(() =>
        mode === "image-error" ? this.onerror() : this.onload()
      );
    }
  }
  vm.runInNewContext(source, {
    pskl,
    Q,
    Image,
    Constants: { MODEL_VERSION: 2 },
    $: { namespace: () => ns },
    console
  });
  return ns.Deserializer;
}
const data = {
  modelVersion: 2,
  piskel: {
    name: "Private sun",
    description: "Draft",
    width: 8,
    height: 8,
    fps: 7,
    hiddenFrames: [1],
    layers: [
      JSON.stringify({
        name: "Glow",
        opacity: 0.5,
        frameCount: 2,
        chunks: [
          { base64PNG: "data:image/png;base64,test", layout: [[0], [1]] }
        ]
      })
    ]
  }
};

test("real Deserializer retains editable layer metadata, frame order, hidden frames and FPS", async () => {
  const result = await new Promise((resolve, reject) =>
    setup("ok").deserialize(data, resolve, reject)
  );
  assert.equal(result.descriptor.name, "Private sun");
  assert.equal(result.fps, 7);
  assert.equal(result.layers[0].name, "Glow");
  assert.equal(result.layers[0].opacity, 0.5);
  assert.deepEqual([...result.hiddenFrames], [1]);
  assert.deepEqual(
    result.layers[0].frames.map((f) => f.index),
    [0, 1]
  );
});
for (const mode of ["image-error", "extract-error"]) {
  test(`real Deserializer reports ${mode} instead of hanging`, async () => {
    let replaced = false;
    const error = await new Promise((resolve) =>
      setup(mode).deserialize(
        data,
        () => {
          replaced = true;
          resolve(null);
        },
        resolve
      )
    );
    assert.ok(error);
    assert.equal(replaced, false);
  });
}
