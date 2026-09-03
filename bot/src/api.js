const express = require("express");
const path = require("path");
const store = require("./store");
const {
  clientIp,
  rateLimit,
  securityHeaders,
  blockSensitivePaths,
} = require("./security");

// ленд лежит в /public — bot/ и .env снаружи статики
const LAND_ROOT = path.join(__dirname, "..", "..", "public");

function createApi() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "16kb" }));
  app.use(securityHeaders);
  app.use(blockSensitivePaths);

  // same-origin по умолчанию; CORS только если задан ALLOW_ORIGIN
  app.use((req, res, next) => {
    const allow = process.env.ALLOW_ORIGIN || "";
    if (allow) {
      res.setHeader("Access-Control-Allow-Origin", allow);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/config", (req, res) => {
    if (!rateLimit(`cfg:${clientIp(req)}`, 120, 60_000)) {
      return res.status(429).json({ ok: false, error: "rate_limited" });
    }
    const cfg = store.getConfig();
    // только то, что нужно фронту ленда — без лишней телеметрии/админки
    res.json({
      ctaUrl: cfg.ctaUrl,
      ctaTarget: cfg.ctaTarget || "_blank",
      cloakEnabled: !!cfg.cloakEnabled,
      whiteAction: cfg.whiteAction || "inline",
      whitePageUrl: cfg.whitePageUrl || "white.html",
      preferUserSafety: cfg.preferUserSafety !== false,
      geoEnabled: !!cfg.geoEnabled,
      allowedCountries: Array.isArray(cfg.allowedCountries)
        ? cfg.allowedCountries
        : ["UA"],
      geoFailOpen: cfg.geoFailOpen !== false,
      blockAction: cfg.blockAction || "stub",
      blockRedirectUrl: cfg.blockRedirectUrl || "https://www.google.com/",
      blockTitle: cfg.blockTitle,
      blockText: cfg.blockText,
      // на проде всегда false, даже если в store кто-то включил
      allowLocalhost: false,
      allowQueryBypass: false,
    });
  });

  function handleEvent(req, res) {
    const ip = clientIp(req);
    // жёсткий лимит: антинакрутка визитов/кликов
    if (!rateLimit(`evt:${ip}`, 40, 60_000)) {
      return res.status(429).json({ ok: false, error: "rate_limited" });
    }

    const type = String(
      (req.body && req.body.type) || req.query.type || ""
    ).toLowerCase();
    const allowed = ["visit", "click", "white", "geo_block"];
    if (!allowed.includes(type)) {
      return res.status(400).json({ ok: false, error: "bad_type" });
    }

    store.track(type);
    // не отдаём полную статистику наружу
    res.json({ ok: true });
  }

  app.post("/api/event", handleEvent);
  app.get("/api/event", handleEvent);

  app.use(
    express.static(LAND_ROOT, {
      index: "index.html",
      extensions: ["html"],
      dotfiles: "deny",
      fallthrough: true,
    })
  );

  app.use((_req, res) => {
    res.status(404).send("Not found");
  });

  return app;
}

module.exports = { createApi, LAND_ROOT };
