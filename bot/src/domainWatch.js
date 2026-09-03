const dns = require("dns").promises;
const store = require("./store");

const DEFAULT_SERVER_IP = process.env.SERVER_PUBLIC_IP || "";
const CHECK_EVERY_MS = Number(process.env.DOMAIN_CHECK_MS || 60_000);

function normalizePublicUrl(url) {
  let u = String(url || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u.replace(/\/?$/, "/");
}

function hostnameFromUrl(url) {
  try {
    return new URL(normalizePublicUrl(url)).hostname;
  } catch {
    return "";
  }
}

function dnsHelpMessage(domainUrl, serverIp = DEFAULT_SERVER_IP) {
  const host = hostnameFromUrl(domainUrl) || "your-domain.com";
  const url = normalizePublicUrl(domainUrl) || `https://${host}/`;
  const ipLine = serverIp
    ? [
        "Сделай в панели домена:",
        `1) A-запись @ → ${serverIp}`,
        `2) A-запись www → ${serverIp} (если нужен www)`,
      ]
    : [
        "Сделай в панели домена A-запись на IP сервера.",
        "IP задаётся в .env → SERVER_PUBLIC_IP",
      ];
  return [
    "✅ URL сохранён: " + url,
    "",
    "Бот сам сайт на домен не переносит — нужно DNS.",
    "",
    ...ipLine,
    "",
    "Потом подожди 5–60 мин.",
    "Я проверяю домен каждую минуту и напишу тебе, как ленд встанет.",
    serverIp ? `\nПока можно лить трафик на:\nhttp://${serverIp}/` : "",
    "",
    "Проверить сейчас: кнопка «🛰 Статус домена» или /domain_status",
  ]
    .filter(Boolean)
    .join("\n");
}

async function resolveHostIps(hostname) {
  try {
    const res = await dns.lookup(hostname, { all: true, family: 4 });
    return res.map((r) => r.address);
  } catch {
    return [];
  }
}

async function fetchOk(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "raif-land-domain-watch/1.0" },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      text: "",
      error: String(err && err.message ? err.message : err),
    };
  } finally {
    clearTimeout(t);
  }
}

async function checkDomainLive(publicUrl, serverIp = DEFAULT_SERVER_IP) {
  const url = normalizePublicUrl(publicUrl);
  const host = hostnameFromUrl(url);
  if (!host) {
    return { live: false, reason: "bad_url", detail: "Некорректный URL", ips: [], dnsOk: false, appOk: false };
  }

  const ips = await resolveHostIps(host);
  const dnsOk = serverIp ? ips.includes(serverIp) : true;

  const healthUrl = url.replace(/\/?$/, "/") + "api/health";
  const health = await fetchOk(healthUrl);
  let healthOk = false;
  try {
    healthOk = health.ok && JSON.parse(health.text).ok === true;
  } catch {
    healthOk = false;
  }

  let htmlOk = false;
  if (!healthOk) {
    const home = await fetchOk(url);
    htmlOk =
      home.ok &&
      /Райффайзен|Оформити|LANDING_CONFIG|raiffeisen-giebel/i.test(home.text || "");
  }

  const appOk = healthOk || htmlOk;

  if (appOk && dnsOk) {
    return {
      live: true,
      reason: "ok",
      detail: serverIp
        ? `DNS → ${ips.join(", ") || "—"} · ленд отвечает`
        : `Ленд отвечает (SERVER_PUBLIC_IP не задан — DNS не сверялся)`,
      ips,
      dnsOk,
      appOk,
    };
  }

  if (appOk && !dnsOk) {
    return {
      live: false,
      reason: "dns_mismatch",
      detail: ips.length
        ? `Ленд где-то отвечает, но DNS сейчас ${ips.join(", ")}, нужно ${serverIp}`
        : `DNS ещё не резолвится. Нужен A → ${serverIp}`,
      ips,
      dnsOk,
      appOk,
    };
  }

  if (!appOk && dnsOk) {
    return {
      live: false,
      reason: "app_down",
      detail: serverIp
        ? `DNS уже на ${serverIp}, но ленд по домену ещё не отвечает (${health.error || health.status})`
        : `Ленд по домену ещё не отвечает (${health.error || health.status})`,
      ips,
      dnsOk,
      appOk,
    };
  }

  return {
    live: false,
    reason: "waiting",
    detail: !serverIp
      ? "Задай SERVER_PUBLIC_IP в .env и проверь DNS/ленд"
      : ips.length
        ? `Ждём. DNS сейчас ${ips.join(", ")} (нужен ${serverIp}), ленд по домену молчит`
        : `Ждём DNS. Поставь A @ → ${serverIp}`,
    ips,
    dnsOk,
    appOk,
  };
}

function formatStatus(result, url) {
  const mark = result.live ? "✅ ВСТАЛ" : "⏳ Ещё нет";
  return [
    `🛰 Статус домена: ${mark}`,
    url || "—",
    "",
    result.detail,
    result.ips && result.ips.length ? `DNS IP: ${result.ips.join(", ")}` : "DNS IP: —",
  ].join("\n");
}

function armWatchForUrl(url) {
  const normalized = normalizePublicUrl(url);
  store.updateDomainWatch({
    enabled: true,
    url: normalized,
    notifiedLive: false,
    lastCheckAt: null,
    lastStatus: null,
  });
  return normalized;
}

function startDomainWatch(bot, adminIds) {
  async function notifyAdmins(text) {
    for (const id of adminIds) {
      try {
        await bot.api.sendMessage(id, text, { disable_web_page_preview: true });
      } catch (err) {
        console.error("[domain-watch] notify fail", id, err.message || err);
      }
    }
  }

  async function tick() {
    const watch = store.getDomainWatch();
    if (!watch.enabled || !watch.url) return;

    const result = await checkDomainLive(watch.url, DEFAULT_SERVER_IP);
    store.updateDomainWatch({
      lastCheckAt: new Date().toISOString(),
      lastStatus: result,
    });

    if (result.live && !watch.notifiedLive) {
      store.updateDomainWatch({ notifiedLive: true, enabled: true });
      await notifyAdmins(
        [
          "🚀 Домен поднялся!",
          "",
          watch.url,
          result.detail,
          "",
          "Можно лить трафик на этот URL.",
        ].join("\n")
      );
      console.log("[domain-watch] LIVE", watch.url);
    } else if (!result.live && watch.notifiedLive) {
      store.updateDomainWatch({ notifiedLive: false });
    }
  }

  setTimeout(() => {
    tick().catch((e) => console.error("[domain-watch]", e));
  }, 5000);

  setInterval(() => {
    tick().catch((e) => console.error("[domain-watch]", e));
  }, CHECK_EVERY_MS);

  console.log(
    `[domain-watch] every ${CHECK_EVERY_MS}ms` +
      (DEFAULT_SERVER_IP ? `, server IP ${DEFAULT_SERVER_IP}` : " (SERVER_PUBLIC_IP not set)")
  );
}

module.exports = {
  DEFAULT_SERVER_IP,
  normalizePublicUrl,
  hostnameFromUrl,
  dnsHelpMessage,
  checkDomainLive,
  formatStatus,
  startDomainWatch,
  armWatchForUrl,
};
