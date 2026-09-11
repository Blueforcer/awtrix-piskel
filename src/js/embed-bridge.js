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
 * The Hub owns private project storage and publication through project-*
 * messages and publish-request/publish-result. A device can opt into the same
 * publication broker. Only standalone/device legacy mode submits directly.
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
  var publishViaParent = query("host") === "hub";
  var basedOn = null;
  var iconOrigin = null;
  var originDescriptor = null;
  var pendingPublication = null;
  var publicationSequence = 0;
  var hostIsHub = query("host") === "hub";
  var draftViaParent = hostIsHub;
  var original = null;
  var projectRevision = 0;
  var projectSequence = 0;
  var projectTimer = null;
  var projectSignature = null;
  var savedSignature = null;
  var pendingSaves = {};
  var observedProjects = {};
  var loadingProject = false;
  var loadSequence = 0;

  function isHub() {
    return hostIsHub;
  }
  function supportsProjects() {
    return isHub() || draftViaParent;
  }

  function descriptor() {
    return pskl.app.piskelController
      .getWrappedPiskelController()
      .piskel.getDescriptor();
  }
  function currentOrigin() {
    // History restores the same descriptor. A newly created/imported document
    // has a different one, so it must never inherit another icon's attribution.
    if (originDescriptor !== descriptor()) {
      basedOn = null;
      iconOrigin = null;
      original = null;
      originDescriptor = descriptor();
      iconName = String(originDescriptor.name || "");
      emit("name", iconName);
    }
    return iconOrigin;
  }
  function setProvenance(base, origin) {
    basedOn = /^[A-Za-z0-9_-]{1,32}$/.test(base || "") ? base : null;
    iconOrigin = origin && typeof origin === "object" ? origin : null;
    originDescriptor = descriptor();
    emit("provenance");
  }
  function localHash(base64) {
    if (!window.crypto || !window.crypto.subtle) {
      return Promise.resolve(null);
    }
    return base64ToBlob(base64, "image/gif")
      .arrayBuffer()
      .then(function (bytes) {
        return window.crypto.subtle.digest("SHA-256", bytes);
      })
      .then(function (hash) {
        return Array.from(new Uint8Array(hash))
          .map(function (b) {
            return b.toString(16).padStart(2, "0");
          })
          .join("");
      });
  }

  function query(name) {
    var m = new RegExp("[?&]" + name + "=([^&]*)").exec(window.location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function sendToParent(msg) {
    msg.ns = AWTRIX_NS;
    try {
      window.parent.postMessage(msg, parentOrigin);
    } catch (_e) {
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
  // `extra` is optional and only "status" uses it today: a {url, label} pair the
  // UI turns into a link, so an answer that points somewhere (published icon,
  // sign-in page) can be followed instead of merely read.
  function emit(type, data, extra) {
    (listeners[type] || []).slice().forEach(function (fn) {
      fn(data, extra);
    });
  }

  // Hub owns durable storage. This envelope keeps Piskel's editable layers,
  // frame order/timing and the source bytes together, independently of filenames.
  function nativeProject() {
    var pc = pskl.app.piskelController;
    return JSON.parse(
      pskl.utils.serialization.Serializer.serialize(pc.getPiskel())
    );
  }
  function contentSignature(project) {
    var content = JSON.parse(JSON.stringify(project));
    delete content.piskel.name;
    delete content.piskel.description;
    return JSON.stringify(content);
  }
  function snapshot() {
    currentOrigin();
    var native = nativeProject();
    native.piskel.name = iconName;
    return {
      version: 1,
      name: iconName,
      piskel: native,
      based_on: basedOn,
      origin: iconOrigin,
      original: original
    };
  }
  function unchangedOriginal(project) {
    return !!(
      project.original &&
      project.original.slug &&
      project.original.baseline === contentSignature(project.piskel)
    );
  }
  function observeProject() {
    var project = snapshot();
    var signature = JSON.stringify(project);
    if (signature !== projectSignature) {
      projectRevision += 1;
      projectSignature = signature;
    }
    observedProjects[projectRevision] = signature;
    Object.keys(observedProjects).forEach(function (revision) {
      if (Number(revision) !== projectRevision) {
        delete observedProjects[revision];
      }
    });
    return {
      project: project,
      revision: projectRevision,
      unchangedOriginal: unchangedOriginal(project)
    };
  }
  function projectReply(type, requestId) {
    try {
      var result = observeProject();
      result.type = type;
      result.requestId = requestId;
      result.ok = true;
      sendToParent(result);
      return result;
    } catch (_error) {
      sendToParent({
        type: type,
        requestId: requestId,
        ok: false,
        error: "projectExportFailed",
        message: "Your draft could not be read. Please try again."
      });
      return null;
    }
  }
  function notifyProjectChanged() {
    if (!supportsProjects() || loadingProject) {
      return;
    }
    var previous = projectSignature;
    var result = projectReply("project-changed");
    if (result && previous !== projectSignature) {
      emit("dirty", true);
    }
  }
  function scheduleProjectChanged() {
    if (!supportsProjects() || loadingProject) {
      return;
    }
    clearTimeout(projectTimer);
    projectTimer = setTimeout(notifyProjectChanged, 400);
  }
  function setName(name) {
    currentOrigin();
    iconName = supportsProjects() ? String(name || "") : stripExt(name);
    if (supportsProjects()) {
      descriptor().name = iconName;
    }
    emit("name", iconName);
    scheduleProjectChanged();
  }
  function saveProject(name) {
    if (!supportsProjects()) {
      return;
    }
    if (typeof name === "string") {
      setName(name);
    }
    clearTimeout(projectTimer);
    var requestId = "draft-" + ++projectSequence;
    // Register before sending: a synchronous parent/test broker may reply at once.
    var result;
    try {
      result = observeProject();
      pendingSaves[requestId] = {
        signature: projectSignature,
        revision: result.revision
      };
    } catch (_error) {
      emit("status", "Your draft could not be read. Please try again.");
      return;
    }
    emit("status", "Saving draft…");
    result.type = "project-save";
    result.requestId = requestId;
    sendToParent(result);
  }
  function acknowledgeProject(m) {
    var saved =
      m.type === "project-saved"
        ? { signature: observedProjects[m.revision] }
        : pendingSaves[m.requestId];
    if (!saved || !saved.signature) {
      return;
    }
    delete pendingSaves[m.requestId];
    if (!m.ok) {
      emit(
        "status",
        m.message || "Your draft could not be saved. Please try again."
      );
      return;
    }
    if (saved.signature === JSON.stringify(snapshot())) {
      savedSignature = saved.signature;
      $.publish(Events.PISKEL_SAVED);
      emit("status", m.message || "Draft saved privately.");
      emit("dirty", false);
    }
  }
  function validateProject(project) {
    if (
      !project ||
      project.version !== 1 ||
      typeof project.name !== "string" ||
      project.name.length > 200 ||
      JSON.stringify(project).length > 12 * 1024 * 1024
    ) {
      throw new Error("Invalid project envelope");
    }
    var data = project.piskel && project.piskel.piskel;
    if (
      !project.piskel ||
      project.piskel.modelVersion !== Constants.MODEL_VERSION ||
      !data ||
      !allowedSizes.includes(data.width + "x" + data.height) ||
      !Number.isFinite(data.fps) ||
      data.fps < 0 ||
      data.fps > 24 ||
      !Array.isArray(data.layers) ||
      !data.layers.length ||
      data.layers.length > 64
    ) {
      throw new Error("Invalid project dimensions or layers");
    }
    var frameCount;
    data.layers.forEach(function (serialized) {
      var layer = JSON.parse(serialized);
      if (
        !Number.isInteger(layer.frameCount) ||
        layer.frameCount < 1 ||
        layer.frameCount > 2048 ||
        (frameCount && frameCount !== layer.frameCount) ||
        !Array.isArray(layer.chunks) ||
        !layer.chunks.length ||
        layer.chunks.length > layer.frameCount
      ) {
        throw new Error("Invalid project frames");
      }
      frameCount = layer.frameCount;
      var seen = {};
      layer.chunks.forEach(function (chunk) {
        if (
          !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(
            chunk.base64PNG || ""
          ) ||
          !Array.isArray(chunk.layout) ||
          !chunk.layout.length
        ) {
          throw new Error("Invalid project image");
        }
        // Validate the PNG dimensions before handing compressed input to Image.
        var header = atob(chunk.base64PNG.split(",")[1].slice(0, 44));
        function uint32(offset) {
          return [0, 1, 2, 3].reduce(function (value, i) {
            return value * 256 + header.charCodeAt(offset + i);
          }, 0);
        }
        if (
          header.charCodeAt(0) !== 137 ||
          header.slice(1, 4) !== "PNG" ||
          header.slice(12, 16) !== "IHDR" ||
          uint32(16) !== data.width * chunk.layout.length ||
          !Array.isArray(chunk.layout[0]) ||
          uint32(20) !== data.height * chunk.layout[0].length
        ) {
          throw new Error("Invalid project image dimensions");
        }
        chunk.layout.forEach(function (column) {
          if (
            !Array.isArray(column) ||
            !column.length ||
            column.length !== chunk.layout[0].length
          ) {
            throw new Error("Invalid frame layout");
          }
          column.forEach(function (index) {
            if (
              !Number.isInteger(index) ||
              index < 0 ||
              index >= frameCount ||
              seen[index]
            ) {
              throw new Error("Invalid frame index");
            }
            seen[index] = true;
          });
        });
      });
      if (Object.keys(seen).length !== frameCount) {
        throw new Error("Missing project frames");
      }
    });
    if (
      data.hiddenFrames &&
      (!Array.isArray(data.hiddenFrames) ||
        data.hiddenFrames.some(function (index) {
          return !Number.isInteger(index) || index < 0 || index >= frameCount;
        }))
    ) {
      throw new Error("Invalid hidden frame");
    }
    if (
      project.original &&
      (!/^[A-Za-z0-9_-]{1,32}$/.test(project.original.slug || "") ||
        !/^image\/(gif|jpeg|png)$/.test(project.original.mime || "") ||
        !/^[A-Za-z0-9+/]+=*$/.test(project.original.dataBase64 || "") ||
        typeof project.original.baseline !== "string")
    ) {
      throw new Error("Invalid original image");
    }
  }
  function loadProject(m) {
    var sequence = ++loadSequence;
    var timer;
    var finished = false;
    function finish(ok, message) {
      if (sequence !== loadSequence || finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      loadingProject = false;
      sendToParent({
        type: "project-load-result",
        requestId: m.requestId,
        ok: ok,
        error: ok ? null : "invalidProject",
        message: message
      });
      if (ok) {
        notifyProjectChanged();
        scheduleLive();
      }
    }
    try {
      validateProject(m.project);
      var project = JSON.parse(JSON.stringify(m.project));
      loadingProject = true;
      timer = setTimeout(function () {
        finish(
          false,
          "This draft could not be opened. Your current drawing is still here."
        );
        loadSequence += 1;
      }, 15000);
      pskl.utils.serialization.Deserializer.deserialize(
        project.piskel,
        function (piskel) {
          if (sequence !== loadSequence) {
            return;
          }
          pskl.app.piskelController.setPiskel(piskel);
          setProvenance(project.based_on, project.origin);
          original = project.original || null;
          setName(project.name);
          pskl.app.piskelController.setFPS(piskel.getFPS());
          savedSignature = null;
          finish(true);
        },
        function () {
          finish(
            false,
            "This draft could not be opened. Your current drawing is still here."
          );
        }
      );
    } catch (_error) {
      finish(false, "This draft is invalid or uses an unsupported size.");
    }
  }
  function newProject(m) {
    if (!allowedSizes.includes(m.width + "x" + m.height)) {
      sendToParent({
        type: "project-load-result",
        requestId: m.requestId,
        ok: false,
        error: "invalidSize",
        message: "Choose an 8×8 or 32×8 drawing."
      });
      return;
    }
    loadSequence += 1;
    loadingProject = true;
    var piskel = new pskl.model.Piskel(
      m.width,
      m.height,
      10,
      new pskl.model.piskel.Descriptor("", "")
    );
    var layer = new pskl.model.Layer("Layer 1");
    layer.addFrame(new pskl.model.Frame(m.width, m.height));
    piskel.addLayer(layer);
    pskl.app.piskelController.setPiskel(piskel);
    pskl.app.piskelController.setFPS(piskel.getFPS());
    setProvenance(null, null);
    original = null;
    setName("");
    loadingProject = false;
    savedSignature = null;
    sendToParent({
      type: "project-load-result",
      requestId: m.requestId,
      ok: true
    });
    notifyProjectChanged();
    scheduleLive();
  }
  function exportImage(callback) {
    try {
      var project = supportsProjects() ? snapshot() : null;
      if (project && unchangedOriginal(project)) {
        callback(null, {
          name: iconName,
          mime: project.original.mime,
          dataBase64: project.original.dataBase64,
          unchangedOriginal: true,
          originalSlug: project.original.slug
        });
        return;
      }
      var Gif = pskl.controller.settings.exportimage.GifExportController;
      new Gif(pskl.app.piskelController).renderAsImageDataAnimatedGIF(
        1,
        pskl.app.piskelController.getFPS(),
        function (uri) {
          callback(null, {
            name: iconName,
            mime: "image/gif",
            dataBase64: String(uri).split(",")[1] || "",
            unchangedOriginal: false,
            originalSlug:
              project && project.original ? project.original.slug : null
          });
        }
      );
    } catch (_error) {
      callback("The image could not be exported. Please try again.");
    }
  }

  // ---- export the current sprite as a GIF and hand the bytes to AWTRIX ------
  function saveToAwtrix(name) {
    var origin = currentOrigin();
    var base = basedOn;
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
          dataBase64: String(gifDataUri).split(",")[1] || "",
          origin: origin,
          based_on: base
        });
      }
    );
  }

  // ---- submit the current sprite to the shared icon database ----------------
  // Hub publication always goes through the parent workspace. The direct
  // endpoint remains for legacy device/standalone embeddings without a broker.
  var ICONAPI_DEFAULT = "https://awtrix.de/icons/";

  function iconApiUrl() {
    var url = query("iconapi") || ICONAPI_DEFAULT;
    return url.charAt(url.length - 1) === "/" ? url : url + "/";
  }

  function base64ToBlob(base64, mime) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  }

  // Every code the submit endpoint can answer with. tooManyFrames is never sent
  // - frames are not a limit, a 153-frame icon runs fine on a TC001 - but a
  // client with no name for a code prints the code, so the vocabulary is whole.
  var SUBMIT_ERRORS = {
    badFormat: "Not an image the database accepts",
    tooLarge: "The file is too large",
    badName: "That name cannot be used",
    descriptiveNameRequired:
      "Give your icon a descriptive name with at least one letter.",
    tooBig: "Bigger than 32x8 pixels",
    tooManyFrames: "Too many frames",
    rateLimited: "Too many submissions - try again later",
    duplicate: "Already in the database",
    notLoggedIn: "Sign in on the AWTRIX Hub to publish"
  };

  function reportSubmission(ok, body, context) {
    // The icon goes live immediately - moderation is after the fact - so there
    // is no review to wait for.
    if (ok && body.ok) {
      emit(
        "status",
        body.status === "existing"
          ? "This icon is already in the Hub. Use " + body.slug
          : body.status === "updated"
            ? "Updated " + body.slug
            : "Published as " + body.slug,
        body.pr ? { url: body.pr, label: "Open the icon" } : null
      );
      if (context && /^[A-Za-z0-9_-]{1,32}$/.test(body.slug || "")) {
        var hub = new URL(iconApiUrl(), window.location.href).href;
        var finish = function (origin) {
          if (context.descriptor === descriptor()) {
            setProvenance(body.slug, origin);
            if (context.project) {
              original = {
                slug: body.slug,
                mime: context.mime || "image/gif",
                dataBase64: context.dataBase64,
                baseline: contentSignature(context.project.piskel)
              };
              scheduleProjectChanged();
            }
          }
          sendToParent({
            type: "published",
            requestId: context.requestId,
            name: context.name,
            slug: body.slug,
            hub: hub,
            sha256: body.sha256,
            origin: origin,
            mime: context.mime || "image/gif",
            dataBase64: context.dataBase64,
            status: body.status
          });
        };
        if (body.origin) {
          finish(body.origin);
        } else {
          localHash(context.dataBase64)
            .then(function (hash) {
              finish(hash ? { hub: hub, slug: body.slug, sha256: hash } : null);
            })
            .catch(function () {
              finish(null);
            });
        }
      }
      return;
    }
    // The host can offer sign-in without discarding the private drawing.
    if (body.error === "notLoggedIn") {
      emit(
        "status",
        body.message || SUBMIT_ERRORS.notLoggedIn,
        body.pr ? { url: body.pr, label: "Open the Hub" } : null
      );
      return;
    }
    if (body.error === "duplicate" && body.slug) {
      emit(
        "status",
        "This icon is already in the Hub. Use " + body.slug,
        body.pr ? { url: body.pr, label: "Open the icon" } : null
      );
      return;
    }
    // `message` is the Hub's own human sentence and outranks the bare code.
    emit(
      "status",
      "Submit failed: " +
        (body.message ||
          SUBMIT_ERRORS[body.error] ||
          body.error ||
          "unknown error")
    );
  }

  function publicationNameError(name) {
    return /\p{L}/u.test(String(name || "").trim())
      ? ""
      : SUBMIT_ERRORS.descriptiveNameRequired;
  }

  function saveToCloud(name, options) {
    options = options || {};
    name = String(name || "").trim();
    var nameError = publicationNameError(name);
    if (nameError) {
      emit("status", nameError);
      return;
    }
    if (pendingPublication) {
      emit("status", "Publishing…");
      return;
    }
    currentOrigin();
    var context = {
      requestId: "publish-" + ++publicationSequence,
      name: name,
      based_on: basedOn,
      descriptor: descriptor(),
      project: supportsProjects() ? snapshot() : null,
      action: options.action === "update" ? "update" : "publish",
      slug: options.slug || null,
      expected_sha256: options.expected_sha256 || null
    };
    pendingPublication = context;
    context.timeout = setTimeout(function () {
      if (pendingPublication === context) {
        pendingPublication = null;
        emit(
          "status",
          "The Hub has not replied. Your draft is still here; please try again."
        );
      }
    }, 60000);
    exportImage(function (error, image) {
      if (pendingPublication !== context) {
        return;
      }
      if (error) {
        clearTimeout(context.timeout);
        pendingPublication = null;
        emit("status", error);
        return;
      }
      context.dataBase64 = image.dataBase64;
      context.mime = image.mime;
      context.unchangedOriginal = image.unchangedOriginal;
      context.originalSlug = image.originalSlug;
      if (publishViaParent) {
        sendToParent({
          type: "publish",
          requestId: context.requestId,
          name: context.name,
          mime: context.mime,
          dataBase64: context.dataBase64,
          based_on: context.based_on,
          action: context.action,
          slug: context.slug,
          expected_sha256: context.expected_sha256,
          unchangedOriginal: context.unchangedOriginal,
          originalSlug: context.originalSlug,
          project: context.project
        });
        return;
      }
      var form = new FormData();
      form.append(
        "file",
        base64ToBlob(context.dataBase64, "image/gif"),
        "icon.gif"
      );
      form.append("name", context.name);
      form.append("source", "piskel");
      form.append("agree", "1");
      form.append("response", "resolve");
      if (context.based_on) {
        form.append("based_on", context.based_on);
      }
      fetch(iconApiUrl() + "submit", {
        method: "POST",
        body: form,
        redirect: "error"
      })
        .then(function (response) {
          return response
            .json()
            .catch(function () {
              return {};
            })
            .then(function (body) {
              reportSubmission(response.ok, body, context);
            });
        })
        .catch(function () {
          emit("status", "The Hub could not be reached. Please try again.");
        })
        .finally(function () {
          clearTimeout(context.timeout);
          if (pendingPublication === context) {
            pendingPublication = null;
          }
        });
    });
  }

  // ---- name of the icon currently in the editor -----------------------------
  var iconName = "";
  function stripExt(name) {
    return String(name || "").replace(/\.[^.]+$/, "");
  }
  function setLoadedName(name) {
    iconName = stripExt(name);
    emit("name", iconName);
  }

  // ---- load GIF/JPEG bytes coming back from AWTRIX into the editor -----------
  function loadIntoEditor(mime, dataBase64, base, origin, name, requestId) {
    var sequence = ++loadSequence;
    var replied = false;
    function acknowledge(ok) {
      if (replied) {
        return;
      }
      replied = true;
      if (requestId != null) {
        sendToParent({
          type: "icon-load-result",
          requestId: requestId,
          ok: ok,
          error: ok ? null : "imageLoadFailed",
          message: ok
            ? "Image opened."
            : "This image could not be opened. Your current drawing is still here."
        });
      }
    }
    var img = new Image();
    loadingProject = true;
    var timer = setTimeout(function () {
      img.onerror();
    }, 15000);
    img.onerror = function () {
      if (sequence !== loadSequence) {
        return;
      }
      clearTimeout(timer);
      loadSequence += 1;
      loadingProject = false;
      acknowledge(false);
      emit(
        "status",
        "This image could not be opened. Your current drawing is still here."
      );
    };
    img.onload = function () {
      if (sequence !== loadSequence) {
        return;
      }
      try {
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
            name: stripExt(name) || "icon"
          },
          function (piskel) {
            if (sequence !== loadSequence) {
              return;
            }
            clearTimeout(timer);
            pskl.app.piskelController.setPiskel(piskel);
            setProvenance(base, origin);
            setLoadedName(name || "");
            pskl.app.piskelController.setFPS(piskel.getFPS());
            var baseline = supportsProjects()
              ? contentSignature(nativeProject())
              : null;
            function finishOriginal(isRegistryOriginal) {
              if (sequence !== loadSequence) {
                return;
              }
              original =
                isRegistryOriginal && basedOn
                  ? {
                      slug: basedOn,
                      mime: mime || "image/gif",
                      dataBase64: dataBase64,
                      baseline: baseline
                    }
                  : null;
              loadingProject = false;
              acknowledge(true);
              scheduleProjectChanged();
              scheduleLive();
            }
            if (
              supportsProjects() &&
              !isHub() &&
              basedOn &&
              origin &&
              origin.sha256
            ) {
              localHash(dataBase64)
                .then(function (hash) {
                  finishOriginal(hash === origin.sha256);
                })
                .catch(function () {
                  finishOriginal(false);
                });
            } else {
              finishOriginal(isHub() && !!basedOn);
            }
          }
        );
      } catch (_error) {
        img.onerror();
      }
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
    liveEvents = null,
    liveSequence = 0;
  function isAnimating() {
    try {
      return (
        pskl.app.piskelController.getFPS() > 0 &&
        pskl.app.piskelController.getVisibleFrameIndexes().length > 1 &&
        !pskl.app.previewController.isPaused()
      );
    } catch (_e) {
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
    var sequence = ++liveSequence;
    try {
      if (isAnimating()) {
        var pc = pskl.app.piskelController;
        var Gif = pskl.controller.settings.exportimage.GifExportController;
        new Gif(pc).renderAsImageDataAnimatedGIF(
          1,
          pc.getFPS(),
          function (uri) {
            var b64 = String(uri).split(",")[1] || "";
            if (!liveOn || sequence !== liveSequence) {
              return;
            }
            if (!isHub() && b64.length > LIVE_BODY_MAX) {
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
    } catch (_e) {
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
    if (liveOn === on) {
      return;
    }
    liveOn = on;
    liveSequence += 1;
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
      Events.HISTORY_STATE_SAVED,
      Events.HISTORY_STATE_LOADED,
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
    if (parentOrigin !== "*" && parentOrigin !== e.origin) {
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
        if (m.host === "hub") {
          hostIsHub = true;
        }
        publishViaParent = isHub() || m.publishViaParent === true;
        draftViaParent =
          isHub() || m.draftViaParent === true || m.projectViaParent === true;
        emit("config");
        if (Array.isArray(m.sizes) && m.sizes.length) {
          allowedSizes = m.sizes;
        }
        if (isHub()) {
          setLive(true);
        }
        break;
      case "project-request":
        if (supportsProjects()) {
          projectReply("project-result", m.requestId);
        }
        break;
      case "project-load":
        if (supportsProjects()) {
          loadProject(m);
        }
        break;
      case "project-new":
        if (supportsProjects()) {
          newProject(m);
        }
        break;
      case "project-name":
        if (supportsProjects()) {
          setName(m.name);
        }
        break;
      case "project-save-result":
      case "project-saved":
        if (supportsProjects()) {
          acknowledgeProject(m);
        }
        break;
      case "export-request":
        if (supportsProjects()) {
          exportImage(function (error, result) {
            sendToParent(
              Object.assign(
                {
                  type: "export-result",
                  requestId: m.requestId,
                  ok: !error,
                  error: error ? "exportFailed" : null,
                  message: error
                },
                result || {}
              )
            );
          });
        }
        break;
      case "publish-request":
        if (supportsProjects()) {
          saveToCloud(m.name, m);
        }
        break;
      case "list-result":
        emit("list", m.files || []);
        break;
      case "load-result":
        loadIntoEditor(
          m.mime,
          m.dataBase64,
          m.based_on,
          m.origin,
          m.name,
          m.requestId
        );
        break;
      case "publish-result":
        if (
          pendingPublication &&
          m.requestId === pendingPublication.requestId
        ) {
          var completed = pendingPublication;
          clearTimeout(completed.timeout);
          pendingPublication = null;
          reportSubmission(m.ok === true, m, completed);
        }
        break;
      case "save-result":
        if (m.ok && m.name) {
          setLoadedName(m.name);
        }
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

  function canUpdatePublished() {
    var origin = currentOrigin();
    if (
      isHub() ||
      !publishViaParent ||
      !origin ||
      !/^[A-Za-z0-9_-]{1,32}$/.test(origin.slug || "") ||
      !/^[a-f0-9]{64}$/.test(origin.sha256 || "")
    ) {
      return false;
    }
    try {
      return (
        new URL(origin.hub).href ===
        new URL(iconApiUrl(), window.location.href).href
      );
    } catch (_error) {
      return false;
    }
  }

  // ---- public API for the AWTRIX settings panel -----------------------------
  var api = {
    save: function (name) {
      emit("status", "Saving…");
      if (isHub()) {
        saveProject(name);
      } else {
        saveToAwtrix(name);
      }
    },
    saveProject: saveProject,
    isDirty: function () {
      return (
        supportsProjects() && savedSignature !== JSON.stringify(snapshot())
      );
    },
    download: function () {
      if (isHub()) {
        sendToParent({ type: "download-request" });
      } else {
        saveToAwtrix(iconName);
      }
    },
    publicationNameError: publicationNameError,
    canUpdatePublished: canUpdatePublished,
    updatePublished: function (name) {
      if (!canUpdatePublished()) {
        emit(
          "status",
          "Open your published icon from this Hub before updating it."
        );
        return;
      }
      var origin = currentOrigin();
      saveToCloud(name, {
        action: "update",
        slug: origin.slug,
        expected_sha256: origin.sha256
      });
    },
    saveToCloud: function (name) {
      if (isHub()) {
        setName(name);
        projectReply("publish-open");
      } else {
        emit("status", "Submitting…");
        saveToCloud(name);
      }
    },
    requestList: function () {
      sendToParent({ type: "list" });
    },
    load: function (name) {
      sendToParent({ type: "load", name: name });
    },
    getName: function () {
      return iconName;
    },
    setName: setName,
    setLive: setLive,
    isLiveOn: function () {
      return liveOn;
    },
    getSizes: function () {
      return allowedSizes.slice();
    },
    isHub: isHub,
    supportsProjects: supportsProjects,
    getTermsUrl: function () {
      return new URL(
        "../terms-of-service",
        new URL(iconApiUrl(), window.location.href)
      ).href;
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
    originDescriptor = descriptor();
    [
      Events.HISTORY_STATE_SAVED,
      Events.HISTORY_STATE_LOADED,
      Events.PISKEL_RESET,
      Events.PISKEL_DESCRIPTOR_UPDATED,
      Events.FPS_CHANGED
    ].forEach(function (event) {
      $.subscribe(event, scheduleProjectChanged);
    });
    if (isHub()) {
      document.documentElement.setAttribute("data-host", "hub");
      var saveTool = document.querySelector('[data-setting="save"]');
      if (saveTool) {
        saveTool.setAttribute(
          "title",
          "Draft — save privately or download your drawing"
        );
      }
    }

    // Live toggle lives in the transport dock, next to play/stop.
    var liveBtn = document.querySelector(".awtrix-live-toggle");
    if (liveBtn && isHub()) {
      liveBtn.hidden = true;
    }
    if (liveBtn) {
      liveBtn.addEventListener("click", function () {
        setLive(!liveOn);
      });
    }

    sendToParent({ type: "ready", projectVersion: 1 });
  });
})();
