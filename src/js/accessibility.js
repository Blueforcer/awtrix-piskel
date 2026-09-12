(function () {
  "use strict";

  function setControlState(element) {
    if (element.getAttribute("role") === "radio") {
      var checked = element.classList.contains("selected");
      element.setAttribute("aria-checked", checked ? "true" : "false");
      element.tabIndex = checked ? 0 : -1;
      return;
    }

    if (element.hasAttribute("aria-pressed")) {
      element.setAttribute(
        "aria-pressed",
        element.classList.contains("selected") ||
          element.classList.contains("on") ||
          element.classList.contains("playing") ||
          element.classList.contains("preview-toggle-onion-skin-enabled") ||
          element.classList.contains("has-expanded-drawer")
          ? "true"
          : "false"
      );
    }
  }

  function annotate(root) {
    var scope = root && root.querySelectorAll ? root : document;

    scope
      .querySelectorAll("[role=button], [role=radio]")
      .forEach(setControlState);
    scope.querySelectorAll("canvas").forEach(function (canvas) {
      // The editor is a stack of canvases. Expose the labelled composite
      // container once instead of several indistinguishable bitmap nodes.
      canvas.setAttribute("aria-hidden", "true");
      canvas.tabIndex = -1;
    });
  }

  function activate(element) {
    element.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    );
    element.click();
  }

  function onKeydown(event) {
    var element =
      event.target.closest &&
      event.target.closest("[role=button], [role=radio]");

    if (!element || element.tagName === "BUTTON") {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(element);
      element.focus();
      return;
    }

    if (
      element.getAttribute("role") === "radio" &&
      ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].indexOf(event.key) !==
        -1
    ) {
      var radios = Array.prototype.slice.call(
        element.parentElement.querySelectorAll("[role=radio]")
      );
      var direction =
        event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      var next =
        radios[
          (radios.indexOf(element) + direction + radios.length) % radios.length
        ];

      event.preventDefault();
      activate(next);
      next.focus();
    }
  }

  window.piskelReadyCallbacks = window.piskelReadyCallbacks || [];
  window.piskelReadyCallbacks.push(function () {
    annotate(document);
    document.addEventListener("keydown", onKeydown);

    var observer = new MutationObserver(function (records) {
      records.forEach(function (record) {
        if (record.type === "attributes") {
          setControlState(record.target);
        } else {
          record.addedNodes.forEach(annotate);
        }
      });
    });

    observer.observe(document.getElementById("main-wrapper"), {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"]
    });

    $.subscribe(Events.TOOL_SELECTED, function (event, tool) {
      var status = document.getElementById("editor-accessibility-status");
      if (status && tool) {
        status.textContent = "Selected tool: " + tool.getHelpText();
      }
    });
  });
})();
