/**
 * AWTRIX NG <-> Piskel embed bridge.
 *
 * Wires the icon editor to the AWTRIX NG web UI, which embeds this editor in an
 * <iframe>. The AWTRIX page is same-origin with the clock and brokers all
 * device I/O; this editor only draws and exchanges image bytes over
 * postMessage. Every message carries { ns: 'awtrix', type, ... }.
 *
 *   Editor -> AWTRIX:  ready | save | list | load | live | live-off
 *   AWTRIX -> Editor:  theme | config | list-result | load-result | save-result
 *
 * This file is transport only. The Save/Open/Live UI lives in
 * controller/settings/AwtrixController.js, which drives the bridge through the
 * public API published on `pskl.app.awtrixBridge` (see the bottom of this
 * file). Listed last in piskel-script-list.js so it loads after the app.
 */
(function () {
  "use strict";

  var AWTRIX_NS = "awtrix";
  var parentOrigin = "*"; // tightened to the real parent origin on first inbound message
  var allowedSizes = ["8x8", "32x8"];

  function query(name) {
    var m = new RegExp("[?&]" + name + "=([^&]*)").exec(window.location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function sendToParent(msg) {
    msg.ns = AWTRIX_NS;
    try {
      window.parent.postMessage(msg, parentOrigin);
    } catch (e) {
      /* not embedded */
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute(
      "data-theme",
      theme === "light" ? "light" : "dark"
    );
  }

  // ---- simple listener bus so the UI controller can react -------------------
  var listeners = {}; // type -> [fn]
  function on(type, fn) {
    (listeners[type] = listeners[type] || []).push(fn);
    return function off() {
      var a = listeners[type],
        i = a ? a.indexOf(fn) : -1;
      if (i >= 0) {
        a.splice(i, 1);
      }
    };
  }
  function emit(type, data) {
    (listeners[type] || []).slice().forEach(function (fn) {
      fn(data);
    });
  }

  // ---- export the current sprite as a GIF and hand the bytes to AWTRIX ------
  function saveToAwtrix(name) {
    var Gif = pskl.controller.settings.exportimage.GifExportController;
    var ctrl = new Gif(pskl.app.piskelController);
    ctrl.renderAsImageDataAnimatedGIF(
      1 /* native size */,
      pskl.app.piskelController.getFPS(),
      function (gifDataUri) {
        sendToParent({
          type: "save",
          name: name || "icon",
          mime: "image/gif",
          dataBase64: String(gifDataUri).split(",")[1] || ""
        });
      }
    );
  }

  // ---- load GIF/JPEG bytes coming back from AWTRIX into the editor -----------
  function loadIntoEditor(mime, dataBase64) {
    var img = new Image();
    img.onload = function () {
      pskl.app.importService.newPiskelFromImage(
        img,
        {
          importType: "single",
          // the icon *is* the sprite (8x8 or 32x8); one frame per still image,
          // animated GIFs are sliced into frames by SuperGif inside the service.
          frameSizeX: img.width,
          frameSizeY: img.height,
          frameOffsetX: 0,
          frameOffsetY: 0,
          smoothing: false,
          name: "icon"
        },
        function (piskel) {
          pskl.app.piskelController.setPiskel(piskel);
          if (pskl.app.previewController) {
            pskl.app.previewController.setFPS(piskel.getFPS());
          }
        }
      );
    };
    img.src = "data:" + (mime || "image/gif") + ";base64," + dataBase64;
  }

  // ---- live mirror to the physical matrix -----------------------------------
  // While on: push the current frame as a compact base64 RGB bitmap on every
  // change (crisp, size-exact, one JSON string); when the preview is actually
  // animating (FPS > 0, more than one visible frame, not paused) push the whole
  // sprite as a looping GIF instead. AWTRIX holds it on the panel and replaces
  // it in place.
  var liveOn = false,
    liveTimer = null,
    liveEvents = null;
  function isAnimating() {
    try {
      return (
        pskl.app.piskelController.getFPS() > 0 &&
        pskl.app.piskelController.getVisibleFrameIndexes().length > 1 &&
        !pskl.app.previewController.isPaused()
      );
    } catch (e) {
      return false;
    }
  }
  // base64 of the canvas' RGB888 bytes, row-major. A raw pixel array (256 ints
  // for 32x8, 1024 for 32x32) overflows the device's JSON document pool and
  // comes back 413 payloadTooLarge; this is one JSON string of ~w*h*4/3 bytes.
  function frameToBase64Rgb(canvas) {
    var d = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    var bin = "";
    for (var i = 0; i < d.length; i += 4) {
      bin += String.fromCharCode(d[i], d[i + 1], d[i + 2]);
    }
    return btoa(bin);
  }

  function sendLiveBitmap() {
    var pc = pskl.app.piskelController;
    var canvas = pc.renderFrameAt(pc.getCurrentFrameIndex(), true);
    sendToParent({
      type: "live",
      mode: "bitmap",
      w: canvas.width,
      h: canvas.height,
      dataBase64: frameToBase64Rgb(canvas)
    });
  }

  // One AWTRIX notification body caps at ~8 KB on the device. Both payloads sit
  // far below that — a base64 bitmap is ~1 KB at 32x8, and the exact-palette GIF
  // encoder keeps a 7-frame 32x8 animation under 600 bytes. The guard only
  // catches pathological sprites (hundreds of frames, or a photographic import
  // that falls back to the quantizing encoder); those mirror as a still frame
  // rather than failing the request.
  var LIVE_BODY_MAX = 7000;

  // A still sprite goes as a compact base64 bitmap (the AWTRIX `db` command's
  // string form). A running animation goes as a looping GIF, which the device
  // animates on its own — a single still bitmap could not.
  function pushLiveNow() {
    if (!liveOn) {
      return;
    }
    try {
      if (isAnimating()) {
        var pc = pskl.app.piskelController;
        var Gif = pskl.controller.settings.exportimage.GifExportController;
        new Gif(pc).renderAsImageDataAnimatedGIF(
          1,
          pc.getFPS(),
          function (uri) {
            var b64 = String(uri).split(",")[1] || "";
            if (b64.length > LIVE_BODY_MAX) {
              sendLiveBitmap(); // animation too big for one notification
            } else {
              sendToParent({
                type: "live",
                mode: "gif",
                mime: "image/gif",
                dataBase64: b64
              });
            }
          }
        );
      } else {
        sendLiveBitmap();
      }
    } catch (e) {
      /* editor not ready yet */
    }
  }
  function scheduleLive() {
    if (!liveOn) {
      return;
    }
    if (liveTimer) {
      clearTimeout(liveTimer);
    }
    liveTimer = setTimeout(pushLiveNow, 250); // debounce: the device serves one request at a time
  }
  function setLive(on) {
    liveOn = on;
    // Reflect the state on the transport's Live button (the primary control).
    var btn = document.querySelector(".awtrix-live-toggle");
    if (btn) {
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    emit("live", on);
    liveEvents = liveEvents || [
      Events.TOOL_RELEASED,
      Events.PISKEL_RESET,
      Events.FRAME_SIZE_CHANGED,
      Events.FPS_CHANGED,
      Events.PLAYBACK_TOGGLED // play → looping GIF, stop → still frame
    ];
    if (on) {
      liveEvents.forEach(function (ev) {
        $.subscribe(ev, scheduleLive);
      });
      pushLiveNow(); // show the first frame immediately
    } else {
      liveEvents.forEach(function (ev) {
        $.unsubscribe(ev, scheduleLive);
      });
      sendToParent({ type: "live-off" });
    }
  }

  // ---- inbound messages from AWTRIX -----------------------------------------
  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) {
      return;
    }
    var m = e.data;
    if (!m || m.ns !== AWTRIX_NS) {
      return;
    }
    if (parentOrigin === "*") {
      parentOrigin = e.origin;
    } // pin replies to the real parent

    switch (m.type) {
      case "theme":
        applyTheme(m.theme);
        break;
      case "config":
        if (Array.isArray(m.sizes) && m.sizes.length) {
          allowedSizes = m.sizes;
        }
        break;
      case "list-result":
        emit("list", m.files || []);
        break;
      case "load-result":
        loadIntoEditor(m.mime, m.dataBase64);
        break;
      case "save-result":
        emit(
          "status",
          m.ok
            ? "Saved as " + m.name
            : "Save failed: " + (m.error || "unknown error")
        );
        break;
    }
  });
  /* Leaving the editor should not leave a live preview stuck on the matrix. */
  window.addEventListener("pagehide", function () {
    if (liveOn) {
      sendToParent({ type: "live-off" });
    }
  });

  // ---- public API for the AWTRIX settings panel -----------------------------
  var api = {
    save: function (name) {
      emit("status", "Saving…");
      saveToAwtrix(name);
    },
    requestList: function () {
      sendToParent({ type: "list" });
    },
    load: function (name) {
      sendToParent({ type: "load", name: name });
    },
    setLive: setLive,
    isLiveOn: function () {
      return liveOn;
    },
    getSizes: function () {
      return allowedSizes.slice();
    },
    on: on
  };

  // ---- boot: runs after pskl.app.init() -------------------------------------
  window.piskelReadyCallbacks = window.piskelReadyCallbacks || [];
  window.piskelReadyCallbacks.push(function () {
    // Pre-paint theme/size come in via the query string so the editor looks
    // right before the first AWTRIX message arrives.
    applyTheme(query("theme") || "dark");
    if (query("sizes")) {
      allowedSizes = query("sizes").split(",");
    }

    pskl.app.awtrixBridge = api;

    // Live toggle lives in the transport dock, next to play/stop.
    var liveBtn = document.querySelector(".awtrix-live-toggle");
    if (liveBtn) {
      liveBtn.addEventListener("click", function () {
        setLive(!liveOn);
      });
    }

    sendToParent({ type: "ready" });
  });
})();
