const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { webcrypto, createHash } = require("node:crypto");
const source = fs.readFileSync(
  path.join(__dirname, "../../src/js/embed-bridge.js"),
  "utf8"
);
const copy = (value) => JSON.parse(JSON.stringify(value));
const pngHeader = Buffer.alloc(33);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(pngHeader);
pngHeader.write("IHDR", 12);
pngHeader.writeUInt32BE(16, 16);
pngHeader.writeUInt32BE(8, 20);
const PNG = "data:image/png;base64," + pngHeader.toString("base64");
function native(name = "", pixels = "original") {
  return {
    modelVersion: 2,
    piskel: {
      name,
      description: "",
      width: 8,
      height: 8,
      fps: 10,
      layers: [
        JSON.stringify({
          name: pixels,
          opacity: 1,
          frameCount: 2,
          chunks: [{ base64PNG: PNG, layout: [[0], [1]] }]
        })
      ],
      hiddenFrames: []
    }
  };
}
function boot(host = "device") {
  const sent = [],
    requests = [],
    events = {},
    subscriptions = {},
    timers = new Map(),
    emitted = [];
  let timerId = 0,
    doc = { name: "" },
    data = native(),
    paused = false;
  let exportBytes = Buffer.from("GIF89a-export").toString("base64"),
    exports = 0;
  const setTimer = (fn, delay) => {
    timers.set(++timerId, { fn, delay });
    return timerId;
  };
  const clearTimer = (id) => timers.delete(id);
  const model = (json, descriptor = { name: json.piskel.name }) => ({
    json: copy(json),
    descriptor,
    getDescriptor: () => descriptor,
    getFPS: () => json.piskel.fps
  });
  const inner = { piskel: { getDescriptor: () => doc } };
  const canvas = {
    width: 8,
    height: 8,
    getContext: () => ({
      getImageData: () => ({ data: new Uint8Array(8 * 8 * 4) })
    })
  };
  const pc = {
    getWrappedPiskelController: () => inner,
    getFPS: () => data.piskel.fps,
    setFPS(value) {
      data.piskel.fps = value;
      emitEvent("FPS_CHANGED");
    },
    getVisibleFrameIndexes: () => [0, 1],
    getCurrentFrameIndex: () => 0,
    renderFrameAt: () => canvas,
    getPiskel: () => model(data, doc),
    setPiskel(piskel) {
      data = copy(piskel.json);
      doc = piskel.descriptor;
      emitEvent("PISKEL_RESET");
    }
  };
  function emitEvent(event) {
    for (const fn of (subscriptions[event] || []).slice()) {
      fn();
    }
  }
  const parent = { postMessage: (message) => sent.push(copy(message)) };
  const liveButton = {
    hidden: false,
    classList: { toggle() {} },
    setAttribute() {},
    addEventListener() {}
  };
  const document = {
    documentElement: { setAttribute() {} },
    querySelector: (selector) =>
      selector === ".awtrix-live-toggle" ? liveButton : null
  };
  const window = {
    parent,
    crypto: webcrypto,
    setTimeout: setTimer,
    location: {
      search: `?host=${host}&iconapi=/icons/`,
      href: "https://hub.example/piskel/index.html"
    },
    addEventListener: (event, handler) => {
      events[event] = handler;
    }
  };
  const Events = new Proxy({}, { get: (_target, key) => key });
  const $ = {
    subscribe(event, fn) {
      (subscriptions[event] ||= []).push(fn);
    },
    unsubscribe(event, fn) {
      subscriptions[event] = (subscriptions[event] || []).filter(
        (f) => f !== fn
      );
    },
    publish(event) {
      emitted.push(event);
      emitEvent(event);
    }
  };
  const pskl = {
    app: {
      piskelController: pc,
      previewController: { isPaused: () => paused },
      importService: {
        newPiskelFromImage: (_image, options, callback) =>
          callback(model(native(options.name)))
      }
    },
    utils: {
      serialization: {
        Serializer: {
          serialize() {
            const result = copy(data);
            result.piskel.name = doc.name;
            return JSON.stringify(result);
          }
        },
        Deserializer: {
          deserialize(json, success, failure) {
            if (json.piskel.layers.some((l) => /BROKEN/.test(l))) {
              failure(new Error("bad image"));
            } else {
              success(model(json));
            }
          }
        }
      }
    },
    controller: {
      settings: {
        exportimage: {
          GifExportController: function () {
            this.renderAsImageDataAnimatedGIF = (_scale, _fps, callback) => {
              exports++;
              callback("data:image/gif;base64," + exportBytes);
            };
          }
        }
      }
    }
  };
  class Image {
    constructor() {
      this.width = 8;
      this.height = 8;
    }
    set src(value) {
      if (value.includes("invalid")) {
        this.onerror();
      } else {
        this.onload();
      }
    }
  }
  vm.runInNewContext(source, {
    window,
    document,
    pskl,
    Image,
    URL,
    Blob,
    FormData,
    Uint8Array,
    Array,
    Promise,
    atob,
    btoa,
    setTimeout: setTimer,
    clearTimeout: clearTimer,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ ok: true, slug: "sun" }) };
    },
    Events,
    $,
    Constants: { MODEL_VERSION: 2 }
  });
  window.piskelReadyCallbacks[0]();
  const receive = (
    message,
    origin = host === "hub" ? "https://hub.example" : "http://clock.local",
    messageSource = parent
  ) =>
    events.message({
      source: messageSource,
      origin,
      data: { ns: "awtrix", ...copy(message) }
    });
  function tick(limit = 500) {
    const due = [...timers.entries()].filter(([, t]) => t.delay <= limit);
    for (const [id, t] of due) {
      if (timers.delete(id)) {
        t.fn();
      }
    }
  }
  return {
    sent,
    requests,
    receive,
    api: pskl.app.awtrixBridge,
    liveButton,
    emitted,
    tick,
    emitEvent,
    pskl,
    change(pixels) {
      data.piskel.layers = native("", pixels).piskel.layers;
      emitEvent("HISTORY_STATE_SAVED");
    },
    fps(value) {
      data.piskel.fps = value;
      emitEvent("FPS_CHANGED");
    },
    pause(value) {
      paused = value;
      emitEvent("PLAYBACK_TOGGLED");
    },
    newDocument() {
      doc = { name: "Unrelated" };
      data = native("Unrelated");
      emitEvent("PISKEL_RESET");
    },
    setExport(value) {
      exportBytes = value;
    },
    exportCount: () => exports,
    project() {
      receive({ type: "project-request", requestId: "read" });
      return sent.findLast((m) => m.type === "project-result");
    },
    original() {
      receive({
        type: "load-result",
        name: "sun.gif",
        mime: "image/gif",
        dataBase64: "R0lGODlhb3JpZ2luYWw=",
        based_on: "sun",
        origin: {
          hub: "https://hub.example/icons/",
          slug: "sun",
          sha256: "1".repeat(64)
        }
      });
    }
  };
}

for (const host of ["device", "hub"]) {
  test(`${host}: private save never publishes`, () => {
    const app = boot(host);
    app.receive({ type: "config", host, publishViaParent: true });
    app.original();
    app.api.save("34334");
    const save = app.sent.findLast(
      (m) => m.type === (host === "hub" ? "project-save" : "save")
    );
    assert.equal(host === "hub" ? save.project.name : save.name, "34334");
    assert.equal(app.requests.length, 0);
    assert.equal(app.sent.filter((m) => m.type === "publish").length, 0);
    if (host === "hub") {
      assert.equal(save.project.based_on, "sun");
    } else {
      assert.equal(save.based_on, "sun");
    }
  });
}

test("device publish remains explicit, correlated, and retains origin after renaming", () => {
  const app = boot();
  app.receive({ type: "config", publishViaParent: true });
  app.api.saveToCloud("Sun");
  const request = app.sent.find((m) => m.type === "publish");
  assert.ok(request.requestId);
  assert.equal(app.requests.length, 0);
  const origin = {
    hub: "https://hub.example/icons/",
    slug: "sun",
    sha256: "b".repeat(64)
  };
  app.receive({
    type: "publish-result",
    requestId: "wrong",
    ok: true,
    slug: "evil",
    origin
  });
  assert.equal(app.sent.filter((m) => m.type === "published").length, 0);
  app.receive({
    type: "publish-result",
    requestId: request.requestId,
    ok: true,
    status: "existing",
    slug: "sun",
    origin
  });
  app.api.save("my-sun");
  assert.deepEqual(app.sent.at(-1).origin, origin);
  assert.equal(
    app.sent.find((m) => m.type === "published").dataBase64,
    request.dataBase64
  );
  app.newDocument();
  app.api.save("new");
  assert.equal(app.sent.at(-1).origin, null);
});

test("Hub publish opens the host dialog without exporting or uploading", () => {
  const app = boot("hub");
  app.receive({ type: "config", publishViaParent: true });
  app.api.saveToCloud("");
  assert.ok(app.sent.find((m) => m.type === "publish-open").project);
  assert.equal(app.sent.filter((m) => m.type === "publish").length, 0);
  assert.equal(app.requests.length, 0);
  assert.equal(app.exportCount(), 1); // automatic browser preview only
});

for (const host of ["hub", "device"]) {
  test(`${host}: actual publication requires a descriptive name`, () => {
    const app = boot(host);
    const statuses = [];
    app.api.on("status", (text) => statuses.push(text));
    app.receive({ type: "config", publishViaParent: true });
    const publish = (name) =>
      host === "hub"
        ? app.receive({ type: "publish-request", name })
        : app.api.saveToCloud(name);
    for (const name of ["", "  ", "34334", "123-45", "--_", "１２３", "☀️"]) {
      publish(name);
    }
    assert.equal(app.sent.filter((m) => m.type === "publish").length, 0);
    assert.ok(statuses.some((text) => /descriptive name/.test(text)));
    for (const name of ["Sonne123", "太阳", "Étoile"]) {
      assert.equal(app.api.publicationNameError(name), "");
    }
    publish("  Sonne123  ");
    assert.equal(app.sent.find((m) => m.type === "publish").name, "Sonne123");
  });
}

test("project round-trip keeps layers, hidden frames, FPS, original bytes and provenance", () => {
  const app = boot("hub");
  app.original();
  app.api.setName("Sun v1.2");
  const before = app.project();
  assert.equal(before.project.name, "Sun v1.2");
  assert.equal(before.unchangedOriginal, true);
  app.change("edited");
  app.fps(8);
  const saved = app.project().project;
  app.newDocument();
  app.receive({ type: "project-load", requestId: "restore", project: saved });
  assert.equal(
    app.sent.findLast((m) => m.type === "project-load-result").ok,
    true
  );
  assert.deepEqual(app.project().project, saved);
  assert.equal(app.project().unchangedOriginal, false);
});

test("unchanged original and undo reuse exact bytes, avoiding GIF timing normalization", () => {
  const app = boot("hub");
  app.original();
  app.api.setName("Renamed sun");
  app.receive({ type: "export-request", requestId: "first" });
  let result = app.sent.findLast((m) => m.type === "export-result");
  assert.equal(result.dataBase64, "R0lGODlhb3JpZ2luYWw=");
  assert.equal(result.unchangedOriginal, true);
  app.change("different");
  app.receive({ type: "export-request", requestId: "changed" });
  assert.equal(
    app.sent.findLast((m) => m.type === "export-result").unchangedOriginal,
    false
  );
  app.change("original");
  app.emitEvent("HISTORY_STATE_LOADED");
  app.receive({ type: "export-request", requestId: "undo" });
  result = app.sent.findLast((m) => m.type === "export-result");
  assert.equal(result.unchangedOriginal, true);
  assert.equal(result.dataBase64, "R0lGODlhb3JpZ2luYWw=");
  app.fps(5);
  assert.equal(app.project().unchangedOriginal, false);
  app.fps(10);
  assert.equal(app.project().unchangedOriginal, true);
});

test("origin and baseline are discarded on unrelated import", () => {
  const app = boot("hub");
  app.original();
  app.newDocument();
  const project = app.project().project;
  assert.equal(project.original, null);
  assert.equal(project.origin, null);
  assert.equal(project.based_on, null);
});

test("only a matching successful current save clears dirty state", () => {
  const app = boot("hub");
  app.api.setName("Sun");
  app.api.saveProject();
  const first = app.sent.findLast((m) => m.type === "project-save");
  app.receive({ type: "project-save-result", requestId: "unknown", ok: true });
  assert.equal(app.api.isDirty(), true);
  app.change("newer");
  app.receive({
    type: "project-save-result",
    requestId: first.requestId,
    ok: true
  });
  assert.equal(app.api.isDirty(), true);
  assert.equal(app.emitted.includes("PISKEL_SAVED"), false);
  app.api.saveProject();
  const second = app.sent.findLast((m) => m.type === "project-save");
  app.receive({
    type: "project-save-result",
    requestId: second.requestId,
    ok: false
  });
  assert.equal(app.api.isDirty(), true);
  app.api.saveProject();
  const third = app.sent.findLast((m) => m.type === "project-save");
  app.receive({
    type: "project-save-result",
    requestId: third.requestId,
    ok: true
  });
  assert.equal(app.api.isDirty(), false);
  app.api.setName("New title");
  assert.equal(app.api.isDirty(), true);
});

test("automatic changes and successful autosave use the same revision contract", () => {
  const app = boot("hub");
  app.change("one");
  app.tick();
  const first = app.sent.findLast((m) => m.type === "project-changed");
  app.change("two");
  app.tick();
  const second = app.sent.findLast((m) => m.type === "project-changed");
  assert.ok(second.revision > first.revision);
  app.receive({ type: "project-saved", revision: first.revision, ok: true });
  assert.equal(app.api.isDirty(), true);
  app.receive({ type: "project-saved", revision: second.revision, ok: true });
  assert.equal(app.api.isDirty(), false);
});

test("Ctrl+S delegates to the Hub draft broker, never legacy IndexedDB", () => {
  const app = boot("hub"),
    namespace = {};
  const storage = fs.readFileSync(
    path.join(__dirname, "../../src/js/service/storage/StorageService.js"),
    "utf8"
  );
  vm.runInNewContext(storage, {
    pskl: app.pskl,
    $: { namespace: () => namespace }
  });
  const service = new namespace.StorageService({});
  service.onSaveKey_();
  assert.equal(app.sent.filter((m) => m.type === "project-save").length, 1);
});

test("Hub auto preview has no device payload limit; NG still falls back safely", () => {
  const hub = boot("hub"),
    device = boot();
  for (const app of [hub, device]) {
    app.setExport("A".repeat(8000));
  }
  hub.receive({ type: "config", host: "hub", publishViaParent: true });
  assert.equal(hub.liveButton.hidden, true);
  assert.equal(hub.sent.findLast((m) => m.type === "live").mode, "gif");
  assert.equal(
    hub.sent.findLast((m) => m.type === "live").dataBase64.length,
    8000
  );
  device.receive({ type: "config", publishViaParent: true });
  assert.equal(device.sent.filter((m) => m.type === "live").length, 0);
  device.api.setLive(true);
  assert.equal(device.sent.findLast((m) => m.type === "live").mode, "bitmap");
  hub.pause(true);
  hub.tick();
  assert.equal(hub.sent.findLast((m) => m.type === "live").mode, "bitmap");
});

test("owner update forwards target ID and captured draft to the host", () => {
  const app = boot("hub");
  app.receive({ type: "config", publishViaParent: true });
  app.original();
  app.change("variant");
  app.receive({
    type: "publish-request",
    action: "update",
    slug: "sun",
    name: "Sun"
  });
  const request = app.sent.findLast((m) => m.type === "publish");
  assert.equal(request.action, "update");
  assert.equal(request.slug, "sun");
  assert.equal(request.based_on, "sun");
  assert.equal(request.unchangedOriginal, false);
  assert.ok(request.project);
  app.change("kept-editing");
  app.receive({
    type: "publish-result",
    requestId: request.requestId,
    ok: true,
    status: "updated",
    slug: "sun",
    origin: {
      hub: "https://hub.example/icons/",
      slug: "sun",
      sha256: "2".repeat(64)
    }
  });
  assert.equal(app.project().unchangedOriginal, false);
  app.change("variant");
  assert.equal(app.project().unchangedOriginal, true);
});

test("late publication cannot attach a source to a different document", () => {
  const app = boot("hub");
  app.receive({ type: "config", publishViaParent: true });
  app.receive({ type: "publish-request", name: "Old" });
  const request = app.sent.findLast((m) => m.type === "publish");
  app.newDocument();
  app.receive({
    type: "publish-result",
    requestId: request.requestId,
    ok: true,
    slug: "sun",
    origin: { slug: "sun" }
  });
  assert.equal(app.project().project.original, null);
  assert.equal(app.project().project.based_on, null);
});

test("publication failure releases explicit retry and shows server name errors", () => {
  const app = boot("hub"),
    statuses = [];
  app.api.on("status", (text) => statuses.push(text));
  app.receive({ type: "config", publishViaParent: true });
  app.receive({ type: "publish-request", name: "Sun" });
  const request = app.sent.findLast((m) => m.type === "publish");
  app.receive({
    type: "publish-result",
    requestId: request.requestId,
    ok: false,
    error: "descriptiveNameRequired"
  });
  assert.ok(statuses.some((text) => /descriptive name/.test(text)));
  app.receive({ type: "publish-request", name: "Sun" });
  assert.equal(app.sent.filter((m) => m.type === "publish").length, 2);
});

test("invalid drafts fail before replacing the current drawing", () => {
  const app = boot("hub");
  app.original();
  const before = app.project().project;
  const invalid = [
    null,
    { ...before, version: 999 },
    { ...before, piskel: native() }
  ];
  invalid[2].piskel.piskel.width = 128;
  const badImage = copy(before);
  badImage.piskel.piskel.layers = [
    JSON.stringify({
      name: "bad",
      frameCount: 1,
      chunks: [
        { base64PNG: "https://external.example/image.png", layout: [[0]] }
      ]
    })
  ];
  invalid.push(badImage);
  const missing = copy(before);
  missing.piskel.piskel.layers = [
    JSON.stringify({
      name: "bad",
      frameCount: 2,
      chunks: [{ base64PNG: PNG, layout: [[0]] }]
    })
  ];
  invalid.push(missing);
  for (const project of invalid) {
    app.receive({ type: "project-load", requestId: "invalid", project });
    assert.equal(
      app.sent.findLast((m) => m.type === "project-load-result").ok,
      false
    );
    assert.deepEqual(app.project().project, before);
  }
});

test("messages from another frame or changed origin cannot read or replace drafts", () => {
  const app = boot("hub");
  app.receive({ type: "config", publishViaParent: true });
  const count = app.sent.length;
  app.receive(
    { type: "project-request", requestId: "evil" },
    "https://other.example"
  );
  app.receive(
    { type: "project-request", requestId: "evil" },
    "https://hub.example",
    {}
  );
  assert.equal(app.sent.length, count);
});

test("publication timeout releases retry and ignores the expired response", () => {
  const app = boot("hub");
  app.receive({ type: "publish-request", name: "Sun" });
  const expired = app.sent.findLast((m) => m.type === "publish");
  app.tick(60000);
  app.receive({ type: "publish-request", name: "Sun" });
  const current = app.sent.findLast((m) => m.type === "publish");
  assert.notEqual(current.requestId, expired.requestId);
  app.receive({
    type: "publish-result",
    requestId: expired.requestId,
    ok: true,
    slug: "expired",
    origin: { slug: "expired" }
  });
  assert.equal(app.project().project.based_on, null);
});

test("same-origin Hub publish cannot fall back to a direct request", () => {
  const app = boot("hub");
  app.receive({ type: "config", publishViaParent: false });
  app.receive({ type: "publish-request", name: "Sun" });
  assert.equal(app.requests.length, 0);
  assert.ok(app.sent.find((m) => m.type === "publish"));
});

test("source JPEG export and publication keep their actual MIME type", () => {
  const app = boot("hub");
  app.receive({
    type: "load-result",
    name: "photo.jpg",
    mime: "image/jpeg",
    dataBase64: "/9j/2Q==",
    based_on: "photo"
  });
  app.receive({ type: "publish-request", name: "Photo" });
  const request = app.sent.findLast((m) => m.type === "publish");
  assert.equal(request.mime, "image/jpeg");
  assert.equal(request.dataBase64, "/9j/2Q==");
  app.receive({
    type: "publish-result",
    requestId: request.requestId,
    ok: true,
    slug: "photo",
    origin: { slug: "photo" }
  });
  assert.equal(
    app.sent.findLast((m) => m.type === "published").mime,
    "image/jpeg"
  );
});

test("NG opts into full drafts without enabling physical live or device writes", () => {
  const app = boot();
  app.receive({
    type: "config",
    host: "awtrix",
    draftViaParent: true,
    publishViaParent: true
  });
  assert.equal(app.api.supportsProjects(), true);
  assert.equal(app.api.isHub(), false);
  app.change("private");
  app.tick();
  assert.ok(app.sent.find((m) => m.type === "project-changed"));
  app.api.saveProject("Private sun");
  const saved = app.sent.findLast((m) => m.type === "project-save");
  assert.equal(saved.project.name, "Private sun");
  assert.equal(app.sent.filter((m) => m.type === "save").length, 0);
  assert.equal(app.sent.filter((m) => m.type === "live").length, 0);
  app.newDocument();
  app.receive({
    type: "project-load",
    requestId: "ng-restore",
    project: saved.project
  });
  assert.deepEqual(app.project().project, saved.project);
  app.api.save("local-sun");
  assert.equal(app.sent.findLast((m) => m.type === "save").name, "local-sun");
});

test("NG Ctrl+S uses the project broker once configured", () => {
  const app = boot(),
    namespace = {};
  app.receive({ type: "config", host: "awtrix", draftViaParent: true });
  const storage = fs.readFileSync(
    path.join(__dirname, "../../src/js/service/storage/StorageService.js"),
    "utf8"
  );
  vm.runInNewContext(storage, {
    pskl: app.pskl,
    $: { namespace: () => namespace }
  });
  new namespace.StorageService({}).onSaveKey_();
  assert.ok(app.sent.find((m) => m.type === "project-save"));
  assert.equal(app.sent.filter((m) => m.type === "save").length, 0);
});

for (const matches of [true, false]) {
  test(`NG original baseline requires verified local source bytes (matches=${matches})`, async () => {
    const app = boot();
    app.receive({
      type: "config",
      draftViaParent: true,
      publishViaParent: true
    });
    const bytes = Buffer.from("GIF89a-original");
    const origin = {
      hub: "https://hub.example/icons/",
      slug: "sun",
      sha256: matches
        ? createHash("sha256").update(bytes).digest("hex")
        : "f".repeat(64)
    };
    app.receive({
      type: "load-result",
      name: "sun.gif",
      mime: "image/gif",
      dataBase64: bytes.toString("base64"),
      based_on: "sun",
      origin
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(app.project().unchangedOriginal, matches);
    assert.equal(app.project().project.based_on, "sun");
    assert.deepEqual(app.project().project.origin, origin);
  });
}

test("NG explicit owner update uses the known base SHA; regular publish remains a variation", () => {
  const app = boot();
  app.receive({ type: "config", publishViaParent: true });
  app.original();
  assert.equal(app.api.canUpdatePublished(), true);
  app.api.updatePublished("Sun");
  const update = app.sent.findLast((m) => m.type === "publish");
  assert.equal(update.action, "update");
  assert.equal(update.slug, "sun");
  assert.equal(update.expected_sha256, "1".repeat(64));
  app.receive({
    type: "publish-result",
    requestId: update.requestId,
    ok: false,
    error: "conflict"
  });
  app.api.saveToCloud("My variation");
  assert.equal(
    app.sent.findLast((m) => m.type === "publish").action,
    "publish"
  );
});

test("NG does not offer owner updates for a different Hub or missing provenance", () => {
  const app = boot();
  app.receive({ type: "config", publishViaParent: true });
  assert.equal(app.api.canUpdatePublished(), false);
  app.receive({
    type: "load-result",
    name: "sun.gif",
    mime: "image/gif",
    dataBase64: "R0lG",
    based_on: "sun",
    origin: {
      hub: "https://different.example/icons/",
      slug: "sun",
      sha256: "1".repeat(64)
    }
  });
  assert.equal(app.api.canUpdatePublished(), false);
  app.api.updatePublished("Sun");
  assert.equal(app.sent.filter((m) => m.type === "publish").length, 0);
});

test("Hub image RPC acknowledges only after original bytes and baseline are established", () => {
  const app = boot("hub");
  app.receive({
    type: "load-result",
    requestId: "open-sun",
    name: "sun.gif",
    mime: "image/gif",
    dataBase64: "R0lG",
    based_on: "sun"
  });
  const reply = app.sent.findLast((m) => m.type === "icon-load-result");
  assert.equal(reply.requestId, "open-sun");
  assert.equal(reply.ok, true);
  assert.equal(app.project().unchangedOriginal, true);
  assert.equal(app.project().project.original.dataBase64, "R0lG");
});

test("NG image RPC waits for source SHA verification before acknowledging success", async () => {
  const app = boot();
  app.receive({ type: "config", draftViaParent: true });
  const data = Buffer.from("GIF89a-original");
  app.receive({
    type: "load-result",
    requestId: "open-verified",
    name: "sun.gif",
    mime: "image/gif",
    dataBase64: data.toString("base64"),
    based_on: "sun",
    origin: {
      hub: "https://hub.example/icons/",
      slug: "sun",
      sha256: createHash("sha256").update(data).digest("hex")
    }
  });
  assert.equal(app.sent.filter((m) => m.type === "icon-load-result").length, 0);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    app.sent.findLast((m) => m.type === "icon-load-result").ok,
    true
  );
  assert.equal(app.project().unchangedOriginal, true);
});

for (const failure of ["image-error", "import-error", "timeout"]) {
  test(`image RPC reports ${failure} without changing current draft`, () => {
    const app = boot("hub");
    app.original();
    const before = app.project().project;
    if (failure === "import-error") {
      app.pskl.app.importService.newPiskelFromImage = () => {
        throw new Error("bad import");
      };
    }
    if (failure === "timeout") {
      app.pskl.app.importService.newPiskelFromImage = () => {};
    }
    app.receive({
      type: "load-result",
      requestId: "bad-image",
      name: "broken.jpg",
      mime: "image/jpeg",
      dataBase64: failure === "image-error" ? "invalid" : "R0lG"
    });
    if (failure === "timeout") {
      app.tick(15000);
    }
    const replies = app.sent.filter((m) => m.type === "icon-load-result");
    assert.equal(replies.length, 1);
    assert.equal(replies[0].requestId, "bad-image");
    assert.equal(replies[0].ok, false);
    assert.equal(replies[0].error, "imageLoadFailed");
    assert.deepEqual(app.project().project, before);
  });
}

test("legacy image loading without requestId does not emit an RPC response", () => {
  const app = boot();
  app.original();
  assert.equal(app.sent.filter((m) => m.type === "icon-load-result").length, 0);
});

test("actual initial Hub project from browser QA restores with real preview API shape", () => {
  const app = boot("hub");
  const project = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "fixtures/studio-empty-project.json"),
      "utf8"
    )
  );
  assert.equal(typeof app.pskl.app.previewController.setFPS, "undefined");
  app.receive({ type: "project-load", requestId: "real-qa", project });
  assert.equal(
    app.sent.findLast((m) => m.type === "project-load-result").ok,
    true
  );
  assert.deepEqual(app.project().project, project);
});
