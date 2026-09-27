/**
 * AWTRIX NG resize panel — the host's matrix sizes as buttons instead of
 * Piskel's free width/height form, plus a width × height of your own when the
 * host allows any size up to a maximum. Existing pixels are kept, anchored
 * top-left, so an 8×8 icon promoted to 32×8 lands in the corner and can be
 * extended.
 */
(function () {
  var ns = $.namespace("pskl.controller.settings.resize");

  ns.ResizeController = function (piskelController) {
    this.piskelController = piskelController;
  };

  pskl.utils.inherit(
    ns.ResizeController,
    pskl.controller.settings.AbstractSettingController
  );

  ns.ResizeController.prototype.init = function () {
    var bridge = pskl.app.awtrixBridge;
    var width = this.piskelController.getWidth();
    var height = this.piskelController.getHeight();

    this.presets = document.querySelector(".resize-presets");
    bridge.getSizes().forEach(function (size) {
      var parts = size.split("x");
      var button = document.createElement("button");
      button.type = "button";
      button.className = "button button-primary resize-preset";
      button.setAttribute("data-width", parts[0]);
      button.setAttribute("data-height", parts[1]);
      button.setAttribute(
        "aria-pressed",
        String(Number(parts[0]) === width && Number(parts[1]) === height)
      );
      button.textContent = parts[0] + " × " + parts[1];
      this.presets.appendChild(button);
      this.addEventListener(button, "click", this.onPresetClick_);
    }, this);

    this.error = document.querySelector(".resize-error");
    var max = bridge.getMaxSize();
    if (!max) {
      return;
    }
    this.form = document.querySelector(".resize-custom");
    this.widthInput = this.form.querySelector(".resize-width");
    this.heightInput = this.form.querySelector(".resize-height");
    this.widthInput.max = max.width;
    this.heightInput.max = max.height;
    this.widthInput.value = width;
    this.heightInput.value = height;
    this.form.hidden = false;
    this.addEventListener(this.form, "submit", this.onCustomSubmit_);
    this.addEventListener(this.form, "input", this.onCustomInput_);
  };

  ns.ResizeController.prototype.onCustomInput_ = function () {
    this.error.textContent = "";
  };

  ns.ResizeController.prototype.onPresetClick_ = function (evt) {
    var button = evt.currentTarget || evt.target;
    this.resize_(
      parseInt(button.getAttribute("data-width"), 10),
      parseInt(button.getAttribute("data-height"), 10)
    );
  };

  ns.ResizeController.prototype.onCustomSubmit_ = function (evt) {
    evt.preventDefault();
    var bridge = pskl.app.awtrixBridge;
    var width = Number(this.widthInput.value);
    var height = Number(this.heightInput.value);
    if (!bridge.isSizeAllowed(width, height)) {
      this.error.textContent = bridge.sizeHint();
      return;
    }
    this.resize_(width, height);
  };

  ns.ResizeController.prototype.resize_ = function (width, height) {
    if (
      width !== this.piskelController.getWidth() ||
      height !== this.piskelController.getHeight()
    ) {
      var piskel = pskl.utils.ResizeUtils.resizePiskel(
        this.piskelController.getPiskel(),
        {
          width: width,
          height: height,
          origin: "TOPLEFT",
          resizeContent: false
        }
      );
      pskl.app.piskelController.setPiskel(piskel, { preserveState: true });
    }
    $.publish(Events.CLOSE_SETTINGS_DRAWER);
  };
})();
