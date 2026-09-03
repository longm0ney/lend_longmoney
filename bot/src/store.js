const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

const DEFAULTS = {
  config: {
    ctaUrl: "https://example.com",
    ctaTarget: "_blank",
    publicUrl: "",
    cloakEnabled: true,
    whiteAction: "inline",
    whitePageUrl: "white.html",
    preferUserSafety: true,
    geoEnabled: true,
    allowedCountries: ["UA"],
    geoFailOpen: true,
    blockAction: "stub",
    blockRedirectUrl: "https://www.google.com/",
    blockTitle: "Сервіс недоступний",
    blockText: "Ця пропозиція доступна лише для користувачів з України.",
    allowLocalhost: true,
    allowQueryBypass: false,
  },
  stats: {
    visits: 0,
    clicks: 0,
    whiteHits: 0,
    geoBlocks: 0,
    byDay: {},
  },
  domainWatch: {
    enabled: false,
    url: "",
    notifiedLive: false,
    lastCheckAt: null,
    lastStatus: null,
  },
};

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify(DEFAULTS, null, 2), "utf8");
  }
}

function read() {
  ensure();
  const raw = fs.readFileSync(STORE_FILE, "utf8");
  const data = JSON.parse(raw);
  return {
    config: { ...DEFAULTS.config, ...(data.config || {}) },
    stats: {
      ...DEFAULTS.stats,
      ...(data.stats || {}),
      byDay: { ...(DEFAULTS.stats.byDay || {}), ...((data.stats && data.stats.byDay) || {}) },
    },
    domainWatch: { ...DEFAULTS.domainWatch, ...(data.domainWatch || {}) },
  };
}

function write(data) {
  ensure();
  const tmp = STORE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, STORE_FILE);
}

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function bumpDay(stats, field) {
  const key = dayKey();
  if (!stats.byDay[key]) {
    stats.byDay[key] = { visits: 0, clicks: 0, whiteHits: 0, geoBlocks: 0 };
  }
  stats.byDay[key][field] = (stats.byDay[key][field] || 0) + 1;
}

function getConfig() {
  return read().config;
}

function updateConfig(patch) {
  const data = read();
  data.config = { ...data.config, ...patch };
  write(data);
  return data.config;
}

function getStats() {
  return read().stats;
}

function track(event) {
  const data = read();
  const map = {
    visit: "visits",
    click: "clicks",
    white: "whiteHits",
    geo_block: "geoBlocks",
  };
  const field = map[event];
  if (!field) return data.stats;

  data.stats[field] = (data.stats[field] || 0) + 1;
  bumpDay(data.stats, field);
  write(data);
  return data.stats;
}

function resetStats() {
  const data = read();
  data.stats = {
    visits: 0,
    clicks: 0,
    whiteHits: 0,
    geoBlocks: 0,
    byDay: {},
  };
  write(data);
  return data.stats;
}

function getDomainWatch() {
  return read().domainWatch;
}

function updateDomainWatch(patch) {
  const data = read();
  data.domainWatch = { ...DEFAULTS.domainWatch, ...data.domainWatch, ...patch };
  write(data);
  return data.domainWatch;
}

module.exports = {
  getConfig,
  updateConfig,
  getStats,
  track,
  resetStats,
  getDomainWatch,
  updateDomainWatch,
  read,
  write,
  DEFAULTS,
};
