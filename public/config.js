/* Fallback, если API недоступен. Боевые значения тянет /api/config */
window.LAND_API_BASE = window.LAND_API_BASE || "";

window.LANDING_CONFIG = {
  ctaUrl: "https://example.com",
  ctaTarget: "_blank",
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
  allowQueryBypass: true,
  publicUrl: "",
};
