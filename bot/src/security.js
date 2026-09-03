const rateBuckets = new Map();

function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (xf) return String(xf).split(",")[0].trim();
  return req.ip || req.socket.remoteAddress || "unknown";
}

/** Simple fixed-window rate limit. Returns true if allowed. */
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(key, b);
  }
  b.count += 1;
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) {
      if (now >= v.resetAt) rateBuckets.delete(k);
    }
  }
  return b.count <= limit;
}

function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  next();
}

function blockSensitivePaths(req, res, next) {
  const p = String(req.path || "").toLowerCase();
  const blocked =
    p === "/bot" ||
    p.startsWith("/bot/") ||
    p.includes("/.") ||
    p.endsWith(".env") ||
    p.endsWith("package.json") ||
    p.endsWith("package-lock.json") ||
    p.includes("node_modules") ||
    p.includes("store.json") ||
    p.endsWith(".md") ||
    p.startsWith("/.git");
  if (blocked) return res.sendStatus(404);
  next();
}

module.exports = {
  clientIp,
  rateLimit,
  securityHeaders,
  blockSensitivePaths,
};
