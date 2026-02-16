// StreamBDIX - By Corpse
const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");

const manifest = require("./addon.json");
const builder = new addonBuilder(manifest);

// Additional addon builders for Stream4U and AnimeKai
const stream4uManifest = require("./stream4u.manifest.json");
const animekaiManifest = require("./animekai.manifest.json");
const stream4uBuilder = new addonBuilder(stream4uManifest);
const animekaiBuilder = new addonBuilder(animekaiManifest);

// Lightweight HTML helpers
function extractAnchors(html) {
  const anchors = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const text = m[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    anchors.push({ href, text });
  }
  return anchors;
}

async function fetchHtml(url) {
  try {
    const r = await axios.get(url, {
      timeout: 12000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": url,
      },
    });
    return { status: r.status, html: r.data || "" };
  } catch (e) {
    return { status: 0, html: "", error: e.message };
  }
}

// API: /api/scrape/streamm4u?q=title
async function scrapeStreamM4U(q) {
  const base = "https://streamm4u.com.co";
  const searchUrl = `${base}/?s=${encodeURIComponent(q)}`;
  const { status, html, error } = await fetchHtml(searchUrl);
  if (status !== 200 || !html) return { status, items: [], error };

  const anchors = extractAnchors(html);
  // Filter typical result anchors to posts
  const results = anchors
    .filter(a => /\/\d{4}\/|\/movies\//i.test(a.href) || (a.text && a.text.toLowerCase().includes(q.toLowerCase())))
    .slice(0, 30)
    .map(a => ({ title: a.text, url: new URL(a.href, base).toString() }));

  return { status, items: results };
}

// API: /api/scrape/animekai?q=title
async function scrapeAnimeKai(q) {
  const base = "https://animekai.to";
  const searchUrl = `${base}/?s=${encodeURIComponent(q)}`;
  const { status, html, error } = await fetchHtml(searchUrl);
  if (status !== 200 || !html) return { status, items: [], error };

  const anchors = extractAnchors(html);
  const results = anchors
    .filter(a => (/\/anime\//i.test(a.href) || /episode|season|watch/i.test(a.text)) && a.text)
    .slice(0, 30)
    .map(a => ({ title: a.text, url: new URL(a.href, base).toString() }));

  return { status, items: results };
}

const allSources = {
  ftpbd: require("./sources/ftpbd"),
};

function getEnabledSources() {
  try {
    const enabled = JSON.parse(process.env.STREAMBDIX_SOURCES || "[]");
    return enabled.map((key) => allSources[key]).filter(Boolean);
  } catch {
    return Object.values(allSources);
  }
}

const CINEMETA_URL = "https://v3-cinemeta.strem.io";

const QUALITY_RANK = {
  "4k": 4,
  "2160p": 4,
  "1080p": 3,
  "720p": 2,
  "480p": 1,
  unknown: 0,
};
const SOURCE_RANK = {
  imax: 20,
  hmax: 19,
  "hbo max": 19,
  bluray: 18,
  "blu-ray": 18,
  brrip: 17,
  bdrip: 17,
  "web-dl": 16,
  webdl: 16,
  webrip: 15,
  hdrip: 14,
  hdtv: 13,
  dvdrip: 12,
  hdr: 10,
  sdr: 9,
  "dolby atmos": 8,
  "ddp5.1": 7,
  ddp5: 7,
  "dd5.1": 7,
  dd5: 7,
  eac3: 7,
  7.1: 6,
  5.1: 5,
  ac3: 5,
  aac: 4,
  amzn: 3,
  amazon: 3,
};

function getStreamScore(title) {
  const t = (title || "").toLowerCase();
  let qScore = 0,
    sScore = 0;

  for (const [k, v] of Object.entries(QUALITY_RANK)) {
    if (t.includes(k)) {
      qScore = v;
      break;
    }
  }
  for (const [k, v] of Object.entries(SOURCE_RANK)) {
    if (t.includes(k)) {
      sScore = v;
      break;
    }
  }

  return qScore * 10 + sScore;
}

function sortStreams(streams) {
  return streams.sort(
    (a, b) => getStreamScore(b.title) - getStreamScore(a.title)
  );
}

async function getMetaFromCinemeta(type, imdbId) {
  try {
    const response = await axios.get(
      `${CINEMETA_URL}/meta/${type}/${imdbId}.json`,
      {
        timeout: 5000,
      }
    );
    return response.data?.meta || null;
  } catch (error) {
    return null;
  }
}

// Default BDIX builder (existing)
builder.defineStreamHandler(async ({ type, id }) => {
  let imdbId, season, episode;

  if (type === "series") {
    const parts = id.split(":");
    imdbId = parts[0];
    season = parseInt(parts[1]) || 1;
    episode = parseInt(parts[2]) || 1;
  } else {
    imdbId = id;
  }

  const meta = await getMetaFromCinemeta(type, imdbId);
  if (!meta) return { streams: [] };

  const sources = getEnabledSources();
  const relevantSources = sources.filter((source) =>
    source.types.includes(type)
  );

  const streamPromises = relevantSources.map((source) =>
    source.getStreams(type, meta, season, episode).catch(() => [])
  );

  const results = await Promise.all(streamPromises);
  const streams = sortStreams(results.flat());
  return { streams };
});

// Stream4U: simple search-based catalog and no-op streams placeholder for now
stream4uBuilder.defineCatalogHandler(async ({ type, id, extra }) => {
  const search = (extra && extra.search) || "";
  if (!search) return { metas: [] };
  const out = await scrapeStreamM4U(search);
  const metas = (out.items || []).map((it, i) => ({
    id: `s4u:${Buffer.from(it.url).toString('base64')}`,
    type: type,
    name: it.title || it.url,
    poster: "",
  }));
  return { metas };
});
stream4uBuilder.defineStreamHandler(async ({ type, id }) => {
  // id encodes the URL base64
  try {
    const b64 = id.split(":")[1] || "";
    const url = Buffer.from(b64, 'base64').toString('utf8');
    return { streams: [{ title: 'Open Link', url }] };
  } catch {
    return { streams: [] };
  }
});

// AnimeKai: search-based catalog and placeholder streams
animekaiBuilder.defineCatalogHandler(async ({ type, id, extra }) => {
  const search = (extra && extra.search) || "";
  if (!search) return { metas: [] };
  const out = await scrapeAnimeKai(search);
  const metas = (out.items || []).map((it, i) => ({
    id: `akai:${Buffer.from(it.url).toString('base64')}`,
    type: 'series',
    name: it.title || it.url,
    poster: "",
  }));
  return { metas };
});
animekaiBuilder.defineStreamHandler(async ({ type, id }) => {
  try {
    const b64 = id.split(":")[1] || "";
    const url = Buffer.from(b64, 'base64').toString('utf8');
    return { streams: [{ title: 'Open Link', url }] };
  } catch {
    return { streams: [] };
  }
});

// Export interfaces for index.js to mount under namespaces
module.exports = Object.assign(builder.getInterface(), {
  scrapeStreamM4U,
  scrapeAnimeKai,
  stream4uInterface: stream4uBuilder.getInterface(),
  animekaiInterface: animekaiBuilder.getInterface(),
});
