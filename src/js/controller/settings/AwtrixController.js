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
    this.openList = document.querySelector("#awtrix-open-list");
    this.status = document.querySelector("#awtrix-status");

    this.nameInput.value = bridge ? bridge.getName() : "";

    this.addEventListener(this.nameInput, "input", this.onNameInput_);
    this.addEventListener(this.saveButton, "click", this.onSaveClick_);
    this.addEventListener(this.openList, "change", this.onOpenChange_);

    if (bridge) {
      this.unsubscribes.push(bridge.on("list", this.onListResult_.bind(this)));
      this.unsubscribes.push(bridge.on("status", this.setStatus_.bind(this)));
      this.unsubscribes.push(bridge.on("name", this.onNameLoaded_.bind(this)));
      bridge.requestList(); // refresh the icon list on every open
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
    if (pskl.app.awtrixBridge) {
      pskl.app.awtrixBridge.setName(this.nameInput.value);
    }
  };

  ns.AwtrixController.prototype.onNameLoaded_ = function (name) {
    this.nameInput.value = name;
  };

  ns.AwtrixController.prototype.onSaveClick_ = function () {
    if (pskl.app.awtrixBridge) {
      pskl.app.awtrixBridge.save(this.nameInput.value.trim());
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

  ns.AwtrixController.prototype.setStatus_ = function (text) {
    if (this.status) {
      this.status.textContent = text || "";
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
