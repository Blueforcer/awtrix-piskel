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
  'use strict';

  var AWTRIX_NS = 'awtrix';
  var parentOrigin = '*'; // tightened to the real parent origin on first inbound message
  var allowedSizes = ['8x8', '32x8'];

  function query(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function sendToParent(msg) {
    msg.ns = AWTRIX_NS;
    try { window.parent.postMessage(msg, parentOrigin); } catch (e) { /* not embedded */ }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  }

  // ---- simple listener bus so the UI controller can react -------------------
  var listeners = {}; // type -> [fn]
  function on(type, fn) {
    (listeners[type] = listeners[type] || []).push(fn);
    return function off() {
      var a = listeners[type], i = a ? a.indexOf(fn) : -1;
      if (i >= 0) { a.splice(i, 1); }
    };
  }
  function emit(type, data) { (listeners[type] || []).slice().forEach(function (fn) { fn(data); }); }

  // ---- export the current sprite as a GIF and hand the bytes to AWTRIX ------
  function saveToAwtrix(name) {
    var Gif = pskl.controller.settings.exportimage.GifExportController;
    var ctrl = new Gif(pskl.app.piskelController);
    ctrl.renderAsImageDataAnimatedGIF(1 /* native size */, pskl.app.piskelController.getFPS(), function (gifDataUri) {
      sendToParent({
        type: 'save',
        name: name || 'icon',
        mime: 'image/gif',
        dataBase64: String(gifDataUri).split(',')[1] || ''
      });
    });
  }

  // ---- load GIF/JPEG bytes coming back from AWTRIX into the editor -----------
  function loadIntoEditor(mime, dataBase64) {
    var img = new Image();
    img.onload = function () {
      pskl.app.importService.newPiskelFromImage(img, {
        importType: 'single',
        // the icon *is* the sprite (8x8 or 32x8); one frame per still image,
        // animated GIFs are sliced into frames by SuperGif inside the service.
        frameSizeX: img.width,
        frameSizeY: img.height,
        frameOffsetX: 0,
        frameOffsetY: 0,
        smoothing: false,
        name: 'icon'
      }, function (piskel) {
        pskl.app.piskelController.setPiskel(piskel);
        if (pskl.app.previewController) { pskl.app.previewController.setFPS(piskel.getFPS()); }
      });
    };
    img.src = 'data:' + (mime || 'image/gif') + ';base64,' + dataBase64;
  }

  // ---- live mirror to the physical matrix -----------------------------------
  // While on: push the currently edited frame as raw pixels on every change
  // (crisp, size-exact, no codec); when the preview is actually animating
  // (FPS > 0 and more than one visible frame) push the whole sprite as a
  // looping GIF instead. AWTRIX holds it on the panel and replaces it in place.
  var liveOn = false, liveTimer = null, liveEvents = null;
  function isAnimating() {
    try {
      return pskl.app.piskelController.getFPS() > 0 &&
             pskl.app.piskelController.getVisibleFrameIndexes().length > 1;
    } catch (e) { return false; }
  }
  function pushLiveNow() {
    if (!liveOn) { return; }
    try {
      if (isAnimating()) {
        var Gif = pskl.controller.settings.exportimage.GifExportController;
        new Gif(pskl.app.piskelController).renderAsImageDataAnimatedGIF(
          1, pskl.app.piskelController.getFPS(), function (uri) {
            sendToParent({ type: 'live', mode: 'gif', mime: 'image/gif', dataBase64: String(uri).split(',')[1] || '' });
          });
      } else {
        var pc = pskl.app.piskelController;
        var c = pc.renderFrameAt(pc.getCurrentFrameIndex(), true); // returns an HTMLCanvasElement
        var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, pix = [];
        for (var i = 0; i < d.length; i += 4) { pix.push((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); }
        sendToParent({ type: 'live', mode: 'pixels', w: c.width, h: c.height, pixels: pix });
      }
    } catch (e) { /* editor not ready yet */ }
  }
  function scheduleLive() {
    if (!liveOn) { return; }
    if (liveTimer) { clearTimeout(liveTimer); }
    liveTimer = setTimeout(pushLiveNow, 250); // debounce: the device serves one request at a time
  }
  function setLive(on) {
    liveOn = on;
    // Live keeps mirroring while the drawer is closed — mark the Save icon.
    var icon = document.querySelector('[data-setting=save]');
    if (icon) { icon.classList.toggle('awtrix-live-on', on); }
    emit('live', on);
    liveEvents = liveEvents || [Events.TOOL_RELEASED, Events.PISKEL_RESET, Events.FRAME_SIZE_CHANGED, Events.FPS_CHANGED];
    if (on) {
      liveEvents.forEach(function (ev) { $.subscribe(ev, scheduleLive); });
      pushLiveNow(); // show the first frame immediately
    } else {
      liveEvents.forEach(function (ev) { $.unsubscribe(ev, scheduleLive); });
      sendToParent({ type: 'live-off' });
    }
  }

  // ---- inbound messages from AWTRIX -----------------------------------------
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) { return; }
    var m = e.data;
    if (!m || m.ns !== AWTRIX_NS) { return; }
    if (parentOrigin === '*') { parentOrigin = e.origin; } // pin replies to the real parent

    switch (m.type) {
      case 'theme':
        applyTheme(m.theme);
        break;
      case 'config':
        if (Array.isArray(m.sizes) && m.sizes.length) { allowedSizes = m.sizes; }
        break;
      case 'list-result':
        emit('list', m.files || []);
        break;
      case 'load-result':
        loadIntoEditor(m.mime, m.dataBase64);
        break;
      case 'save-result':
        emit('status', m.ok ? 'Saved as ' + m.name : 'Save failed: ' + (m.error || 'unknown error'));
        break;
    }
  });
  /* Leaving the editor should not leave a live preview stuck on the matrix. */
  window.addEventListener('pagehide', function () { if (liveOn) { sendToParent({ type: 'live-off' }); } });

  // ---- public API for the AWTRIX settings panel -----------------------------
  var api = {
    save: function (name) { emit('status', 'Saving…'); saveToAwtrix(name); },
    requestList: function () { sendToParent({ type: 'list' }); },
    load: function (name) { sendToParent({ type: 'load', name: name }); },
    setLive: setLive,
    isLiveOn: function () { return liveOn; },
    getSizes: function () { return allowedSizes.slice(); },
    on: on
  };

  // ---- boot: runs after pskl.app.init() -------------------------------------
  window.piskelReadyCallbacks = window.piskelReadyCallbacks || [];
  window.piskelReadyCallbacks.push(function () {
    // Pre-paint theme/size come in via the query string so the editor looks
    // right before the first AWTRIX message arrives.
    applyTheme(query('theme') || 'dark');
    if (query('sizes')) { allowedSizes = query('sizes').split(','); }

    pskl.app.awtrixBridge = api;
    sendToParent({ type: 'ready' });
  });
})();
