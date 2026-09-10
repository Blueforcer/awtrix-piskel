/**
 * AWTRIX save/open/live panel — replaces Piskel's built-in Save drawer.
 *
 * Registered in SettingsController's settings map under the "save" key, so the
 * existing Save icon opens this panel instead of SAVE OFFLINE AS FILE / IN
 * BROWSER. It is a thin UI over the transport in embed-bridge.js, reached
 * through `pskl.app.awtrixBridge`; all device I/O is brokered by the AWTRIX
 * host page over postMessage.
 */
(function () {
  var ns = $.namespace("pskl.controller.settings");

  ns.AwtrixController = function (piskelController) {
    this.piskelController = piskelController;
    this.unsubscribes = [];
  };

  pskl.utils.inherit(
    ns.AwtrixController,
    pskl.controller.settings.AbstractSettingController
  );

  ns.AwtrixController.prototype.init = function () {
    var bridge = pskl.app.awtrixBridge;

    this.nameInput = document.querySelector("#awtrix-name");
    this.saveButton = document.querySelector("#awtrix-save");
    this.cloudButton = document.querySelector("#awtrix-save-cloud");
    this.downloadButton = document.querySelector("#awtrix-download");
    this.draftButton = document.querySelector("#awtrix-save-draft");
    this.updateButton = document.querySelector("#awtrix-update-cloud");
    this.updateHint = document.querySelector("#awtrix-update-hint");
    this.updatePublicationActions_();
    this.openList = document.querySelector("#awtrix-open-list");
    this.status = document.querySelector("#awtrix-status");

    this.nameInput.value = bridge ? bridge.getName() : "";
    this.saveButton.value =
      bridge && bridge.isHub() ? "Save draft" : "Save to AWTRIX";
    if (this.draftButton) {
      this.draftButton.hidden = !(
        bridge &&
        !bridge.isHub() &&
        bridge.supportsProjects()
      );
    }
    this.cloudButton.value =
      bridge && bridge.isHub() ? "Publish…" : "Publish in Hub";
    if (this.downloadButton) {
      this.downloadButton.hidden = !(bridge && bridge.isHub());
    }
    var title = document.querySelector(".awtrix-settings > .settings-title");
    if (title && bridge && bridge.isHub()) {
      title.textContent = "Your draft";
    }
    var hubHint = document.querySelector(".awtrix-hub-hint");
    var deviceHint = document.querySelector(".awtrix-device-hint");
    if (hubHint) {
      hubHint.hidden = !(bridge && bridge.isHub());
    }
    if (deviceHint) {
      deviceHint.hidden = !!(bridge && bridge.isHub());
    }
    var terms = document.querySelector(".awtrix-terms");
    if (terms && bridge) {
      terms.href = bridge.getTermsUrl();
    }
    var deviceOpen = document.querySelector(".awtrix-open-section");
    if (deviceOpen) {
      deviceOpen.hidden = !!(bridge && bridge.isHub());
    }

    this.addEventListener(this.nameInput, "input", this.onNameInput_);
    this.addEventListener(this.saveButton, "click", this.onSaveClick_);
    if (this.draftButton) {
      this.addEventListener(this.draftButton, "click", this.onDraftClick_);
    }
    this.addEventListener(this.cloudButton, "click", this.onCloudClick_);
    if (this.updateButton) {
      this.addEventListener(this.updateButton, "click", this.onUpdateClick_);
    }
    if (this.downloadButton) {
      this.addEventListener(
        this.downloadButton,
        "click",
        this.onDownloadClick_
      );
    }
    this.addEventListener(this.openList, "change", this.onOpenChange_);

    if (bridge) {
      this.unsubscribes.push(bridge.on("list", this.onListResult_.bind(this)));
      this.unsubscribes.push(
        bridge.on("provenance", this.updatePublicationActions_.bind(this))
      );
      this.unsubscribes.push(
        bridge.on("config", this.updatePublicationActions_.bind(this))
      );
      this.unsubscribes.push(bridge.on("status", this.setStatus_.bind(this)));
      this.unsubscribes.push(bridge.on("name", this.onNameLoaded_.bind(this)));
      if (!bridge.isHub()) {
        bridge.requestList(); // device files only
      }
    }
  };

  ns.AwtrixController.prototype.destroy = function () {
    this.unsubscribes.forEach(function (off) {
      off();
    });
    this.unsubscribes = [];
    this.superclass.destroy.call(this);
  };

  ns.AwtrixController.prototype.onNameInput_ = function () {
    this.nameInput.removeAttribute("aria-invalid");
    if (pskl.app.awtrixBridge) {
      pskl.app.awtrixBridge.setName(this.nameInput.value);
    }
  };

  ns.AwtrixController.prototype.onNameLoaded_ = function (name) {
    this.nameInput.value = name;
    this.updatePublicationActions_();
  };

  ns.AwtrixController.prototype.onSaveClick_ = function () {
    if (pskl.app.awtrixBridge) {
      pskl.app.awtrixBridge.save(this.nameInput.value.trim());
    }
  };

  ns.AwtrixController.prototype.updatePublicationActions_ = function () {
    var bridge = pskl.app.awtrixBridge;
    var available = bridge && bridge.canUpdatePublished();
    if (this.updateButton) {
      this.updateButton.hidden = !available;
    }
    if (this.updateHint) {
      this.updateHint.hidden = !available;
    }
  };

  ns.AwtrixController.prototype.onUpdateClick_ = function () {
    var bridge = pskl.app.awtrixBridge;
    if (!bridge) {
      return;
    }
    var name = this.nameInput.value.trim();
    var error = bridge.publicationNameError(name);
    if (error) {
      this.nameInput.setAttribute("aria-invalid", "true");
      this.nameInput.focus();
      this.nameInput.select();
      this.setStatus_(error);
      return;
    }
    bridge.updatePublished(name);
  };

  ns.AwtrixController.prototype.onDraftClick_ = function () {
    var bridge = pskl.app.awtrixBridge;
    if (bridge) {
      bridge.saveProject(this.nameInput.value.trim());
    }
  };

  ns.AwtrixController.prototype.onDownloadClick_ = function () {
    var bridge = pskl.app.awtrixBridge;
    if (bridge) {
      bridge.setName(this.nameInput.value.trim());
      bridge.download();
    }
  };

  ns.AwtrixController.prototype.onCloudClick_ = function () {
    var bridge = pskl.app.awtrixBridge;
    if (bridge) {
      var name = this.nameInput.value.trim();
      if (bridge.isHub()) {
        bridge.saveToCloud(name);
        return;
      }
      var nameError = bridge.publicationNameError(name);
      if (nameError) {
        this.nameInput.setAttribute("aria-invalid", "true");
        this.setStatus_(nameError);
        this.nameInput.focus();
        this.nameInput.select();
        return;
      }
      this.nameInput.removeAttribute("aria-invalid");
      bridge.saveToCloud(name);
    }
  };

  ns.AwtrixController.prototype.onOpenChange_ = function () {
    var value = this.openList.value;
    var bridge = pskl.app.awtrixBridge;
    if (value && bridge) {
      bridge.setName(value);
      this.nameInput.value = bridge.getName();
      bridge.load(value);
    }
  };

  /**
   * @param {string} text
   * @param {?{url: string, label: string}} link where the answer points, if
   *        anywhere - the published icon, or the Hub sign-in page when the
   *        editor is framed by the clock and has no Hub session to publish with.
   */
  ns.AwtrixController.prototype.setStatus_ = function (text, link) {
    if (!this.status) {
      return;
    }
    this.status.textContent = text || "";
    if (link && link.url) {
      var anchor = document.createElement("a");
      anchor.href = link.url;
      anchor.target = "_blank";
      // The editor runs framed; without noopener the opened tab could reach
      // back through window.opener.
      anchor.rel = "noopener noreferrer";
      anchor.className = "save-status-link";
      anchor.textContent = link.label || "Open";
      this.status.appendChild(document.createTextNode(" "));
      this.status.appendChild(anchor);
    }
  };

  ns.AwtrixController.prototype.onListResult_ = function (files) {
    if (!this.openList) {
      return;
    }
    this.openList.innerHTML = "";
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent =
      files && files.length ? "Pick an icon…" : "No icons on the clock";
    this.openList.appendChild(placeholder);
    (files || []).forEach(function (f) {
      var option = document.createElement("option");
      option.value = f.name;
      option.textContent = f.name;
      this.openList.appendChild(option);
    }, this);
  };
})();
