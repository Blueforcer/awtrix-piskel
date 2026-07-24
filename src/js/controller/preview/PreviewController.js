(function () {
  var ns = $.namespace("pskl.controller.preview");

  // Preview is a square of PREVIEW_SIZE x PREVIEW_SIZE.
  // AWTRIX NG: sized for the slot in the frames dock (was 200 in the removed
  // right column).
  var PREVIEW_SIZE = 96;
  var RENDER_MINIMUM_DELAY = 300;

  ns.PreviewController = function (piskelController, container) {
    this.piskelController = piskelController;
    this.container = container;

    this.elapsedTime = 0;
    this.currentIndex = 0;
    this.lastRenderTime = 0;
    this.renderFlag = true;
    // AWTRIX NG: play/stop state of the animation preview. While paused the
    // preview shows the currently edited frame. Starts paused — the editor
    // opens quiet, the ▶ button starts the animation (and, with Live on, the
    // looping GIF on the matrix).
    this.paused = true;

    this.renderer = new pskl.rendering.frame.BackgroundImageFrameRenderer(
      this.container
    );
    this.popupPreviewController = new ns.PopupPreviewController(
      piskelController
    );
    this.previewActionsController = new ns.PreviewActionsController(
      this,
      container
    );
  };

  ns.PreviewController.prototype.init = function () {
    // AWTRIX NG: the preview lives in the frames dock; the shell CSS owns its
    // geometry (upstream forced a 210px right-column width here).

    $.subscribe(Events.FRAME_SIZE_CHANGED, this.onFrameSizeChange_.bind(this));
    $.subscribe(
      Events.USER_SETTINGS_CHANGED,
      this.onUserSettingsChange_.bind(this)
    );
    $.subscribe(Events.PISKEL_SAVE_STATE, this.setRenderFlag_.bind(this, true));
    $.subscribe(Events.PISKEL_RESET, this.setRenderFlag_.bind(this, true));

    this.popupPreviewController.init();
    this.previewActionsController.init();

    // AWTRIX NG: play/stop toggle in the dock's FPS row.
    this.playToggle = document.querySelector(".awtrix-play-toggle");
    if (this.playToggle) {
      this.playToggle.addEventListener(
        "click",
        function () {
          this.setPaused(!this.paused);
        }.bind(this)
      );
      this.playToggle.classList.toggle("playing", !this.paused);
    }

    this.updateZoom_();
    this.updateContainerDimensions_();
  };

  /**
   * AWTRIX NG: stop/resume the animation playback. Paused shows the currently
   * edited frame; the state is broadcast so the live matrix preview can switch
   * between the looping GIF and a still frame.
   */
  ns.PreviewController.prototype.setPaused = function (paused) {
    this.paused = !!paused;
    this.elapsedTime = 0;
    this.setRenderFlag_(true);
    if (this.playToggle) {
      this.playToggle.classList.toggle("playing", !this.paused);
    }
    $.publish(Events.PLAYBACK_TOGGLED, [this.paused]);
  };

  ns.PreviewController.prototype.isPaused = function () {
    return !!this.paused;
  };

  ns.PreviewController.prototype.openPopupPreview = function () {
    this.popupPreviewController.open();
  };

  ns.PreviewController.prototype.onUserSettingsChange_ = function (
    evt,
    name,
    value
  ) {
    if (name === pskl.UserSettings.SEAMLESS_MODE) {
      this.onFrameSizeChange_();
    } else {
      this.updateZoom_();
      this.updateContainerDimensions_();
    }
  };

  ns.PreviewController.prototype.updateZoom_ = function () {
    // AWTRIX NG: the monitor always shows the sprite as large as fits its dock
    // slot, floored to whole pixels for a crisp preview (the 1x/best/full size
    // options are not exposed in this fork).
    this.renderer.setZoom(Math.max(1, Math.floor(this.calculateZoom_())));
    this.setRenderFlag_(true);
  };

  ns.PreviewController.prototype.getZoom = function () {
    return this.calculateZoom_();
  };

  ns.PreviewController.prototype.getCoordinates = function (x, y) {
    var containerRect = this.container.getBoundingClientRect();
    x = x - containerRect.left;
    y = y - containerRect.top;
    var zoom = this.getZoom();
    return {
      x: Math.floor(x / zoom),
      y: Math.floor(y / zoom)
    };
  };

  ns.PreviewController.prototype.render = function (delta) {
    this.elapsedTime += delta;
    var index = this.getNextIndex_(delta);
    if (this.shouldRender_() || this.currentIndex != index) {
      this.currentIndex = index;
      var frame = pskl.utils.LayerUtils.mergeFrameAt(
        this.piskelController.getLayers(),
        index
      );
      this.renderer.render(frame);
      this.renderFlag = false;
      this.lastRenderTime = Date.now();

      this.popupPreviewController.render(frame);
    }
  };

  ns.PreviewController.prototype.getNextIndex_ = function (delta) {
    var fps = this.piskelController.getFPS();
    if (fps === 0 || this.paused) {
      return this.piskelController.getCurrentFrameIndex();
    } else {
      var index = Math.floor(this.elapsedTime / (1000 / fps));
      var frameIndexes = this.piskelController.getVisibleFrameIndexes();
      if (frameIndexes.length <= index) {
        this.elapsedTime = 0;
        index = frameIndexes.length
          ? frameIndexes[0]
          : this.piskelController.getCurrentFrameIndex();
        return index;
      }
      return frameIndexes[index];
    }
  };

  // AWTRIX NG: the monitor's usable box is its dock slot (the container's
  // parent), measured live so the sprite fills whatever width the layout gives
  // it. Falls back to the old fixed square if the slot has no size yet.
  ns.PreviewController.prototype.getSlotSize_ = function () {
    var slot = this.container.parentNode;
    var w = (slot && slot.clientWidth) || PREVIEW_SIZE;
    var h = (slot && slot.clientHeight) || PREVIEW_SIZE;
    return { width: w, height: h };
  };

  /**
   * Calculate the preview zoom so the sprite is as large as fits the slot,
   * independently on each axis (a 32x8 sprite fills the width, an 8x8 fills
   * the height).
   */
  ns.PreviewController.prototype.calculateZoom_ = function () {
    var frame = this.piskelController.getCurrentFrame();
    var slot = this.getSlotSize_();
    return Math.min(
      slot.width / frame.getWidth(),
      slot.height / frame.getHeight()
    );
  };

  ns.PreviewController.prototype.onFrameSizeChange_ = function () {
    this.updateZoom_();
    this.updateContainerDimensions_();
  };

  ns.PreviewController.prototype.updateContainerDimensions_ = function () {
    var isSeamless = pskl.UserSettings.get(pskl.UserSettings.SEAMLESS_MODE);
    this.renderer.setRepeated(isSeamless);

    var slot = this.getSlotSize_();
    var width;
    var height;

    if (isSeamless) {
      height = slot.height;
      width = slot.width;
    } else {
      // Use the zoom actually rendered (floored to whole pixels) so the canvas
      // box matches the pixels exactly.
      var zoom = this.renderer.getZoom();
      var frame = this.piskelController.getCurrentFrame();
      height = frame.getHeight() * zoom;
      width = frame.getWidth() * zoom;
    }

    // The dock slot centers the canvas with flexbox; no margins needed.
    var containerEl = this.container;
    containerEl.style.height = height + "px";
    containerEl.style.width = width + "px";
    containerEl.style.margin = "0";
  };

  ns.PreviewController.prototype.setRenderFlag_ = function (bool) {
    this.renderFlag = bool;
  };

  ns.PreviewController.prototype.shouldRender_ = function () {
    return (
      (this.renderFlag || this.popupPreviewController.renderFlag) &&
      Date.now() - this.lastRenderTime > RENDER_MINIMUM_DELAY
    );
  };
})();
