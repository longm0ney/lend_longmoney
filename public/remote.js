window.__configReady = (async function loadRemoteConfig() {
  var base = window.LAND_API_BASE || "";
  try {
    var res = await fetch(base + "/api/config", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return;
    var remote = await res.json();
    window.LANDING_CONFIG = Object.assign({}, window.LANDING_CONFIG || {}, remote);
  } catch (err) {
    // оффлайн / статика без API — остаёмся на локальном config.js
  }
})();
