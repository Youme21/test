/**
 * Nuvio Provider: TopCinema (توب سينما)
 * No API Key required!
 */

const BASE_URL = "https://topcinema.io";
const AJAX_URL = "https://topcinema.io/wp-content/themes/movies2023/Ajaxat/";

// Public metadata endpoints (completely free, zero API keys needed)
const TMDB_ADDON_URL = "https://94c8cb9f702d-tmdb-addon.baby-beamup.club";
const CINEMETA_URL = "https://v3-cinemeta.strem.io";

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Referer": "https://topcinema.io/",
    "X-Requested-With": "XMLHttpRequest"
};

/**
 * 1. Fetch title and year without any private API key
 * Automatically handles:
 *  - "tmdb:12345"
 *  - Plain integer TMDB ID (e.g. 12345)
 *  - IMDb ID (e.g. "tt0137523")
 */
function getMetadata(id, mediaType) {
    const type = (mediaType === "movie") ? "movie" : "series";
    const rawId = String(id).trim();

    // If ID is from Cinemeta / IMDb (starts with 'tt')
    if (rawId.startsWith("tt")) {
        return fetch(`${CINEMETA_URL}/meta/${type}/${rawId}.json`)
            .then(res => res.json())
            .then(data => ({
                title: data.meta ? (data.meta.name || data.meta.name_original) : "",
                year: data.meta && data.meta.year ? data.meta.year : ""
            }))
            .catch(() => ({ title: "", year: "" }));
    }

    // If ID is from TMDB (starts with 'tmdb:' or is a numeric string)
    const tmdbId = rawId.startsWith("tmdb:") ? rawId : `tmdb:${rawId}`;

    return fetch(`${TMDB_ADDON_URL}/meta/${type}/${tmdbId}.json`)
        .then(res => res.json())
        .then(data => ({
            title: data.meta ? (data.meta.name || data.meta.name_original) : "",
            year: data.meta && data.meta.year ? data.meta.year : ""
        }))
        .catch(() => {
            // Fallback to Cinemeta if TMDB addon is unreachable
            return fetch(`${CINEMETA_URL}/meta/${type}/${rawId}.json`)
                .then(r => r.json())
                .then(d => ({
                    title: d.meta ? d.meta.name : "",
                    year: d.meta && d.meta.year ? d.meta.year : ""
                }))
                .catch(() => ({ title: "", year: "" }));
        });
}

/**
 * 2. Search TopCinema for the post URL
 */
function searchTopCinema(title, mediaType) {
    const formData = new URLSearchParams();
    formData.append("search", title);
    formData.append("type", mediaType === "movie" ? "movies" : "series");

    return fetch(AJAX_URL + "Searching.php", {
        method: "POST",
        headers: Object.assign({}, HEADERS, { "Content-Type": "application/x-www-form-urlencoded" }),
        body: formData.toString()
    })
    .then(res => res.text())
    .then(html => {
        const hrefMatches = html.match(/href=["'](https:\/\/topcinema\.io\/[^"']+)["']/g);
        if (!hrefMatches || hrefMatches.length === 0) return null;
        
        const matchedUrl = hrefMatches[0].replace(/href=["']/g, "").replace(/["']$/, "");
        return matchedUrl;
    });
}

/**
 * 3. Retrieve server links from the watch page
 */
function getWatchServers(pageUrl) {
    const watchUrl = pageUrl.endsWith("/") ? pageUrl + "watch/" : pageUrl + "/watch/";

    return fetch(watchUrl, { headers: HEADERS })
        .then(res => res.text())
        .then(html => {
            const servers = [];

            // Extract default loaded iframe
            const defaultIframeMatch = html.match(/<div class="player--iframe"[^>]*>[\s\S]*?<iframe[^>]+src=["']([^"']+)["']/i);
            if (defaultIframeMatch && defaultIframeMatch[1]) {
                servers.push({
                    name: "TopCinema - Default",
                    url: defaultIframeMatch[1]
                });
            }

            // Extract server items
            const serverRegex = /<li[^>]+data-id=["'](\d+)["'][^>]+data-server=["'](\d+)["'][^>]*>[\s\S]*?<span>([^<]+)<\/span>/gi;
            let match;
            const fetchPromises = [];

            while ((match = serverRegex.exec(html)) !== null) {
                const postId = match[1];
                const serverIndex = match[2];
                const serverName = match[3].trim();

                if (serverIndex === "0") continue;

                const postData = new URLSearchParams();
                postData.append("id", postId);
                postData.append("i", serverIndex);

                const p = fetch(AJAX_URL + "Single/Server.php", {
                    method: "POST",
                    headers: Object.assign({}, HEADERS, { "Content-Type": "application/x-www-form-urlencoded" }),
                    body: postData.toString()
                })
                .then(r => r.text())
                .then(serverHtml => {
                    const iframe = serverHtml.match(/src=["']([^"']+)["']/i);
                    if (iframe && iframe[1]) {
                        return {
                            name: "TopCinema - " + serverName,
                            url: iframe[1].startsWith("//") ? "https:" + iframe[1] : iframe[1]
                        };
                    }
                    return null;
                })
                .catch(() => null);

                fetchPromises.push(p);
            }

            return Promise.all(fetchPromises).then(extraServers => {
                extraServers.forEach(s => {
                    if (s) servers.push(s);
                });
                return servers;
            });
        });
}

/**
 * Main Nuvio getStreams entry point
 */
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    return new Promise((resolve) => {
        getMetadata(tmdbId, mediaType)
            .then(meta => {
                if (!meta.title) return resolve([]);
                return searchTopCinema(meta.title, mediaType);
            })
            .then(pageUrl => {
                if (!pageUrl) return resolve([]);
                return getWatchServers(pageUrl);
            })
            .then(servers => {
                if (!servers || servers.length === 0) return resolve([]);

                const streams = servers.map(srv => ({
                    name: srv.name,
                    title: srv.name + " (Arabic)",
                    url: srv.url,
                    quality: "1080p",
                    headers: {
                        "Referer": "https://topcinema.io/",
                        "User-Agent": HEADERS["User-Agent"]
                    },
                    provider: "topcinema"
                }));

                resolve(streams);
            })
            .catch(() => {
                resolve([]);
            });
    });
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
