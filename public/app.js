(function bootApp() {
  var base = window.LAND_API_BASE || "";

  function postEvent(type) {
    try {
      var url = base + "/api/event?type=" + encodeURIComponent(type);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url);
        return;
      }
      fetch(url, { method: "GET", keepalive: true, cache: "no-store" }).catch(
        function () {}
      );
    } catch (e) {}
  }

  function applyCtaLinks() {
    var cfg = window.LANDING_CONFIG || {};
    var url = cfg.ctaUrl || "#";
    var target = cfg.ctaTarget || "_blank";

    document.querySelectorAll(".js-cta").forEach(function (el) {
      el.setAttribute("href", url);
      el.setAttribute("target", target);
      if (target === "_blank") el.setAttribute("rel", "noopener noreferrer");
      else el.removeAttribute("rel");

      if (el.dataset.trackBound) return;
      el.dataset.trackBound = "1";
      el.addEventListener(
        "click",
        function () {
          postEvent("click");
        },
        { passive: true }
      );
    });
  }

  function onBlack() {
    applyCtaLinks();
    postEvent("visit");
  }

  function start() {
    if (document.body.classList.contains("geo-ok")) onBlack();
    else document.addEventListener("geo:allowed", onBlack, { once: true });

    document.addEventListener("cloak:white", function () {
      postEvent("white");
    });
    document.addEventListener("cloak:geo_block", function () {
      postEvent("geo_block");
    });
  }

  var ready = window.__configReady;
  if (ready && typeof ready.then === "function") {
    ready.then(start).catch(start);
  } else {
    start();
  }
})();
