require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { createApi } = require("./api");
const { createBot, parseAdminIds } = require("./bot");
const { startDomainWatch, armWatchForUrl } = require("./domainWatch");
const store = require("./store");

const PORT = Number(process.env.PORT || 8787);
const TOKEN = String(process.env.BOT_TOKEN || "").trim();
const ADMIN_IDS = parseAdminIds(process.env.ADMIN_IDS || "");

function tokenLooksValid(token) {
  return /^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token);
}

async function main() {
  const app = createApi();

  await new Promise((resolve, reject) => {
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`[api] http://127.0.0.1:${PORT}`);
      resolve(server);
    });
    server.on("error", reject);
  });

  if (!tokenLooksValid(TOKEN)) {
    console.warn(
      "[bot] BOT_TOKEN не задан или невалиден — крутится только ленд/API.\n" +
        "      Пропиши токен в bot/.env и перезапусти."
    );
    return;
  }

  const bot = createBot(TOKEN, ADMIN_IDS);
  if (!ADMIN_IDS.length) {
    console.error(
      "[bot] ADMIN_IDS пуст — бот НЕ запущен (иначе любой в тг получит админку).\n" +
        "      Пропиши свой Telegram id в bot/.env → ADMIN_IDS=123456789"
    );
    return;
  }
  console.log("[bot] admins:", ADMIN_IDS.join(", "));

  // если домен уже был задан раньше — сразу следим
  const cfg = store.getConfig();
  if (cfg.publicUrl && /^https?:\/\//i.test(cfg.publicUrl)) {
    const watch = store.getDomainWatch();
    if (!watch.url) armWatchForUrl(cfg.publicUrl);
    else store.updateDomainWatch({ enabled: true, url: cfg.publicUrl });
  }

  startDomainWatch(bot, ADMIN_IDS.length ? ADMIN_IDS : []);

  bot.catch((err) => {
    console.error("[bot] error", err.error || err);
  });

  try {
    await bot.start({
      onStart: (info) => console.log(`[bot] @${info.username} online`),
    });
  } catch (err) {
    console.error("[bot] не запустился (API ленда продолжает работать):", err.message || err);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
