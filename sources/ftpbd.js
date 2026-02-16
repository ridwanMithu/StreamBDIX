// StreamBDIX - By Corpse
const { extractQuality, titlesMatch, extractYear, axios } = require("./utils");
const SOURCE_NAME = "FTPBD";
const FTPBD_URL = "https://old.ftpbd.net";

// Function to search for content on ftpbd.net
async function searchContent(query, type) {
  try {
    // First, try to get the search page
    const searchParams = new URLSearchParams({
      s: encodeURIComponent(query),
    });

    const response = await axios.get(
      `${FTPBD_URL}/?s=${searchParams.get("s")}`,
      {
        timeout: 10000,
      }
    );

    const html = response.data;

    // Regular expression to find movie/series links
    const linkRegex =
      /<h2 class="entry-title">\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a><\/h2>[\s\S]*?(?:<span class="year">\s*\((\d{4})\s*\)\s*<\/span>|<span class="year">\s*(\d{4})\s*<\/span>)/g;

    const results = [];
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const url = match[1];
      const title = match[2].trim();
      const year = match[3] || match[4] || null;

      // Check if this matches the expected type
      if (type === "movie" && !url.includes("/tv-series/")) {
        results.push({ url, title, year });
      } else if (type === "series" && url.includes("/tv-series/")) {
        results.push({ url, title, year });
      }
    }

    return results;
  } catch (error) {
    console.error("Search error:", error.message);
    return [];
  }
}

// Function to extract direct download links from a movie/series page
async function extractDirectLinks(pageUrl) {
  try {
    const response = await axios.get(pageUrl, {
      timeout: 10000,
    });

    const html = response.data;

    // Look for direct download links
    const directLinkRegex =
      /<a[^>]*href=["']([^"']+)["'][^>]*>/gi;

    const directLinks = [];
    let match;
    while ((match = directLinkRegex.exec(html)) !== null) {
      const link = match[1];
      if (!link || link.includes("javascript:")) continue;
      if (!directLinks.includes(link)) directLinks.push(link);
    }

    // Also look for links in different formats
    const altLinkRegex =
      /(?:download|watch|link)[^>]*href=["']([^"']+)["']/gi;
    while ((match = altLinkRegex.exec(html)) !== null) {
      const link = match[1];
      if (
        link &&
        !link.includes("javascript:") &&
        !directLinks.includes(link)
      ) {
        directLinks.push(link);
      }
    }

    // Extract magnet links as well
    const magnetRegex = /magnet:\?xt=[^"'\s]+/gi;
    while ((match = magnetRegex.exec(html)) !== null) {
      const link = match[0];
      if (link && !directLinks.includes(link)) {
        directLinks.push(link);
      }
    }

    return directLinks;
  } catch (error) {
    console.error("Extract links error:", error.message);
    return [];
  }
}

// Function to extract episode links for series
async function extractEpisodeLinks(pageUrl, season, episode) {
  try {
    const response = await axios.get(pageUrl, {
      timeout: 10000,
    });

    const html = response.data;

    // Look for episode links that match the requested season and episode
    const epRegex = new RegExp(
      `S0?${season}E0?${episode}[\s\S]{0,500}?href=["']([^"']+(?:\.mkv|\.mp4|\.avi|\.mov|\.wmv|magnet:\?xt)[^"']*)["']`,
      "gi"
    );

    const episodeLinks = [];
    let match;
    while ((match = epRegex.exec(html)) !== null) {
      const link = match[1];
      if (link && !link.includes("javascript:")) {
        episodeLinks.push(link);
      }
    }

    // Alternative pattern for episode detection
    const altEpRegex = new RegExp(
      `(?:Season\s*0?${season}[\s\S]{0,200})?(?:Episode\s*0?${episode}|E\s*0?${episode})[\s\S]{0,500}?href=["']([^"']+(?:\.mkv|\.mp4|\.avi|\.mov|\.wmv|magnet:\?xt)[^"']*)["']`,
      "gi"
    );
    while ((match = altEpRegex.exec(html)) !== null) {
      const link = match[1];
      if (
        link &&
        !link.includes("javascript:") &&
        !episodeLinks.includes(link)
      ) {
        episodeLinks.push(link);
      }
    }

    return episodeLinks;
  } catch (error) {
    console.error("Extract episode links error:", error.message);
    return [];
  }
}

async function getMovieStreams(title, year) {
  const searchResults = await searchContent(title, "movie");

  if (searchResults.length === 0) return [];

  // Find the best matching result
  let bestResult = null;
  for (const result of searchResults) {
    if (titlesMatch(result.title, title)) {
      if (year && result.year) {
        if (Math.abs(parseInt(result.year) - year) <= 1) {
          bestResult = result;
          break;
        }
      } else {
        bestResult = result;
        break;
      }
    }
  }

  if (!bestResult) {
    // If no perfect match, try to find the closest match
    bestResult = searchResults[0];
  }

  const directLinks = await extractDirectLinks(bestResult.url);

  const streams = [];
  const seen = new Set();

  for (const link of directLinks) {
    const isPlayable = /\.(mkv|mp4|avi|mov|wmv)(\?|#|$)/i.test(link) || /^magnet:\/\//i.test(link);
    if (!isPlayable) continue;
    if (seen.has(link)) continue;
    seen.add(link);
    streams.push({ name: SOURCE_NAME, title: extractQuality(link), url: link });
  }

  return streams;
}

async function getSeriesStreams(title, season, episode) {
  const searchResults = await searchContent(title, "series");

  if (searchResults.length === 0) return [];

  // Find the best matching series result
  let bestResult = null;
  for (const result of searchResults) {
    if (titlesMatch(result.title, title)) {
      bestResult = result;
      break;
    }
  }

  if (!bestResult) {
    bestResult = searchResults[0];
  }

  const episodeLinks = await extractEpisodeLinks(
    bestResult.url,
    season,
    episode
  );

  const streams = [];
  const seen = new Set();

  for (const link of episodeLinks) {
    const isPlayable = /\.(mkv|mp4|avi|mov|wmv)(\?|#|$)/i.test(link) || /^magnet:\/\//i.test(link);
    if (!isPlayable) continue;
    if (seen.has(link)) continue;
    seen.add(link);
    streams.push({ name: SOURCE_NAME, title: extractQuality(link), url: link });
  }

  return streams;
}
module.exports = {
  name: SOURCE_NAME,
  types: ["movie", "series"],
  async getStreams(type, meta, season, episode) {
    const title = meta.name || meta.title || "";
    const year = meta.year || (meta.releaseInfo ? parseInt(((meta.releaseInfo+"")||"").match(/\b(19\d{2}|20\d{2})\b/)?.[0]||0) : null);
    if (!title) return [];
    if (type === "movie") return await getMovieStreams(title, year);
    else return await getSeriesStreams(title, season, episode);
  },
};
