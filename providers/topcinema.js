/**
 * Nuvio Provider: TopCinema (توب سينما)
 * Compatible with Nuvio Local Scrapers
 */

const TMDB_API_KEY = "YOUR_TMDB_API_KEY"; // Replace with your TMDB v3 API Key
const BASE_URL = "https://topcinema.io";
const AJAX_URL = "https://topcinema.io/wp-content/themes/movies2023/Ajaxat/";

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Referer": "https://topcinema.io/",
    "X-Requested-With": "XMLHttpRequest"
};

/**
 * 1. Fetch title and year from TMDB
 */
function getMetadata(tmdbId, mediaType) {
    const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    return fetch(url)
        .then(res => res.json())
        .then(data => ({
            title: data.title || data.name || data.original_name,
            year: (data.release_date || data.first_air_date || "").split("-")[0]
        }));
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
        // Extract post URLs from search result HTML
        const hrefMatches = html.match(/href=["'](https:\/\/topcinema\.io\/[^"']+)["']/g);
        if (!hrefMatches || hrefMatches.length === 0) return null;
        
        // Clean URL
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

            // Extract the default loaded iframe
            const defaultIframeMatch = html.match(/<div class="player--iframe"[^>]*>[\s\S]*?<iframe[^>]+src=["']([^"']+)["']/i);
            if (defaultIframeMatch && defaultIframeMatch[1]) {
                servers.push({
                    name: "TopCinema - Default",
                    url: defaultIframeMatch[1]
                });
            }

            // Extract all server items from <li data-id="236949" data-server="1" class="server--item"><span>ServerName</span></li>
            const serverRegex = /<li[^>]+data-id=["'](\d+)["'][^>]+data-server=["'](\d+)["'][^>]*>[\s\S]*?<span>([^<]+)<\/span>/gi;
            let match;
            const fetchPromises = [];

            while ((match = serverRegex.exec(html)) !== null) {
                const postId = match[1];
                const serverIndex = match[2];
                const serverName = match[3].trim();

                // Skip the first one if already loaded as default
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

                // Format streams for Nuvio player
                const streams = servers.map(srv => ({
                    name: srv.name,
                    title: srv.name + " (Arabic Sub/Dub)",
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

// Module export for Nuvio environment
if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}