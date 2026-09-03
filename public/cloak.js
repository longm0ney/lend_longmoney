(function cloakAndGeo() {
  function boot() {
    var cfg = window.LANDING_CONFIG || {};
    var body = document.body;
    var q = new URLSearchParams(location.search);
    var preferSafe = cfg.preferUserSafety !== false;
    var geoFailOpen = cfg.geoFailOpen !== false;

    function emit(name) {
      document.dispatchEvent(new Event(name));
    }

    function showWhite() {
      body.classList.remove("geo-pending", "geo-denied", "geo-ok", "cloak-black");
      body.classList.add("cloak-white");

      var frame = document.getElementById("white-frame");
      if (frame && !frame.getAttribute("src")) {
        frame.setAttribute("src", cfg.whitePageUrl || "white.html");
      }

      emit("cloak:white");

      if (cfg.whiteAction === "redirect" && cfg.whitePageUrl) {
        if (!/white\.html$/i.test(location.pathname)) {
          window.location.replace(cfg.whitePageUrl);
        }
      }
    }

    function showBlack() {
      body.classList.remove("cloak-white", "geo-pending", "geo-denied");
      body.classList.add("cloak-black", "geo-ok");
      emit("geo:allowed");
      emit("cloak:black");
    }

    function showGeoBlock(country) {
      var action = cfg.blockAction || "stub";
      if (action === "redirect" && cfg.blockRedirectUrl) {
        window.location.replace(cfg.blockRedirectUrl);
        return;
      }

      body.classList.remove("geo-pending", "cloak-white", "geo-ok");
      body.classList.add("cloak-black", "geo-denied");

      var root = document.getElementById("geo-block");
      if (!root) return;
      var title = root.querySelector("[data-geo-title]");
      var text = root.querySelector("[data-geo-text]");
      if (title) title.textContent = cfg.blockTitle || "Access denied";
      if (text) {
        text.textContent =
          cfg.blockText ||
          "This offer is available only in selected countries.";
      }
      if (country) root.setAttribute("data-country", country);
      emit("cloak:geo_block");
    }

    function isLocalHost() {
      var h = location.hostname;
      return (
        h === "localhost" ||
        h === "127.0.0.1" ||
        h === "[::1]" ||
        h === "0.0.0.0"
      );
    }

    function normalizeCountry(code) {
      return code ? String(code).trim().toUpperCase() : "";
    }

    function isAllowedCountry(country) {
      var list = cfg.allowedCountries || ["UA"];
      var c = normalizeCountry(country);
      return list.some(function (item) {
        return normalizeCountry(item) === c;
      });
    }

    function isFacebookUserTraffic() {
      var ua = (navigator.userAgent || "").toLowerCase();
      if (
        ua.indexOf("fban") !== -1 ||
        ua.indexOf("fbav") !== -1 ||
        ua.indexOf("fb_iab") !== -1 ||
        ua.indexOf("fbios") !== -1 ||
        ua.indexOf("fb4a") !== -1 ||
        ua.indexOf("fbiab") !== -1 ||
        ua.indexOf("instagram") !== -1 ||
        ua.indexOf("messenger") !== -1
      ) {
        return true;
      }

      var ref = (document.referrer || "").toLowerCase();
      if (
        ref.indexOf("facebook.com") !== -1 ||
        ref.indexOf("fb.com") !== -1 ||
        ref.indexOf("fb.me") !== -1 ||
        ref.indexOf("instagram.com") !== -1 ||
        ref.indexOf("l.facebook.com") !== -1 ||
        ref.indexOf("lm.facebook.com") !== -1 ||
        ref.indexOf("m.facebook.com") !== -1
      ) {
        return true;
      }
      return false;
    }

    function isKnownCrawler() {
      var ua = (navigator.userAgent || "").toLowerCase();
      if (!ua) return preferSafe ? false : true;
      if (isFacebookUserTraffic()) return false;

      var patterns = [
        "googlebot",
        "google-inspectiontool",
        "adsbot-google",
        "mediapartners-google",
        "apis-google",
        "feedfetcher-google",
        "bingbot",
        "slurp",
        "duckduckbot",
        "baiduspider",
        "yandexbot",
        "yandex.com/bots",
        "applebot",
        "petalbot",
        "facebookexternalhit",
        "facebot",
        "facebookcatalog",
        "meta-externalagent",
        "meta-externalfetcher",
        "twitterbot",
        "linkedinbot",
        "embedly",
        "quora link preview",
        "skypeuripreview",
        "slackbot-linkexpanding",
        "discordbot",
        "semrushbot",
        "ahrefsbot",
        "mj12bot",
        "dotbot",
        "rogerbot",
        "screaming frog",
        "bytespider",
        "gptbot",
        "ccbot",
        "curl/",
        "wget/",
        "python-requests",
        "python-urllib",
        "scrapy",
        "headlesschrome",
        "phantomjs",
        "puppeteer",
        "playwright",
        "selenium",
        "chrome-lighthouse",
      ];

      for (var i = 0; i < patterns.length; i++) {
        if (ua.indexOf(patterns[i]) !== -1) return true;
      }

      if (navigator.webdriver === true) return true;
      if (window.callPhantom || window._phantom) return true;
      if (window.__nightmare) return true;
      return false;
    }

    function runGeoThenBlack() {
      if (!cfg.geoEnabled || (cfg.allowQueryBypass && q.get("geo") === "off")) {
        showBlack();
        return;
      }

      if (cfg.allowLocalhost && isLocalHost()) {
        showBlack();
        return;
      }

      body.classList.add("geo-pending");
      body.classList.remove("cloak-white");

      function pickCountry(data) {
        if (!data) return "";
        return (
          data.country_code ||
          data.countryCode ||
          data.country ||
          data.loc ||
          ""
        );
      }

      var providers = [
        function () {
          return fetch("https://ipapi.co/json/", { cache: "no-store" }).then(
            function (r) {
              if (!r.ok) throw new Error("ipapi");
              return r.json();
            }
          );
        },
        function () {
          return fetch("https://ipwho.is/", { cache: "no-store" }).then(
            function (r) {
              if (!r.ok) throw new Error("ipwho");
              return r.json();
            }
          );
        },
        function () {
          return fetch("https://api.country.is/", { cache: "no-store" }).then(
            function (r) {
              if (!r.ok) throw new Error("country.is");
              return r.json();
            }
          );
        },
      ];

      function tryProvider(index) {
        if (index >= providers.length) {
          if (geoFailOpen) showBlack();
          else showGeoBlock("");
          return;
        }

        providers[index]()
          .then(function (data) {
            if (data && data.success === false) throw new Error("fail");
            var country = normalizeCountry(pickCountry(data));
            if (!country || country.length !== 2) throw new Error("bad");
            if (isAllowedCountry(country)) showBlack();
            else showGeoBlock(country);
          })
          .catch(function () {
            tryProvider(index + 1);
          });
      }

      tryProvider(0);
    }

    body.classList.add("geo-pending");

    if (cfg.allowQueryBypass) {
      if (q.get("view") === "white") {
        showWhite();
        return;
      }
      if (q.get("view") === "black") {
        runGeoThenBlack();
        return;
      }
      if (q.get("cloak") === "off") {
        runGeoThenBlack();
        return;
      }
    }

    if (cfg.allowLocalhost && isLocalHost() && !q.get("view")) {
      runGeoThenBlack();
      return;
    }

    if (isFacebookUserTraffic()) {
      runGeoThenBlack();
      return;
    }

    if (cfg.cloakEnabled !== false && isKnownCrawler()) {
      showWhite();
      return;
    }

    runGeoThenBlack();
  }

  var ready = window.__configReady;
  if (ready && typeof ready.then === "function") {
    ready.then(boot).catch(boot);
  } else {
    boot();
  }
})();
