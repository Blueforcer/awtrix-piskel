/**
 * AWTRIX NG resize panel — two fixed matrix-size buttons (8×8, 32×8) instead of
 * Piskel's free width/height inputs. Existing pixels are kept, anchored
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
    var buttons = document.querySelectorAll(".resize-preset");
    Array.prototype.forEach.call(
      buttons,
      function (button) {
        this.addEventListener(button, "click", this.onPresetClick_);
      },
      this
    );
  };

  ns.ResizeController.prototype.onPresetClick_ = function (evt) {
    var button = evt.currentTarget || evt.target;
    var width = parseInt(button.getAttribute("data-width"), 10);
    var height = parseInt(button.getAttribute("data-height"), 10);

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
    $.publish(Events.CLOSE_SETTINGS_DRAWER);
  };
})();
