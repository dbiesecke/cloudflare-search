import { normalizeResults } from "./index.js";
import { parseHtml, findAll, find, hasClass, text, safeUrl, providerError, checkResponse, uniqueResults } from "./providerHtml.js";

export function extractBraveResults(document) {
  const containers = findAll(document, (node) => hasClass(node, "result-content"));
  return uniqueResults(containers.flatMap((container) => {
    const title = find(container, (node) => hasClass(node, "search-snippet-title") || hasClass(node, "title"));
    let link = title;
    while (link && link !== container && link.name !== "a") link = link.parent;
    if (link?.name !== "a") return [];
    const url = safeUrl(link.attribs?.href, "https://search.brave.com");
    if (!url || new URL(url).hostname === "search.brave.com") return [];
    const snippet = find(container, (node) => hasClass(node, "generic-snippet") || hasClass(node, "snippet-description"));
    return [{ title: text(title), url, description: text(snippet) }];
  }));
}

async function searchBrave({ query, signal, config = {} }) {
  if (config.BRAVE_API_KEY) {
    const params = new URLSearchParams({ q: query, count: "20" });
    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      signal, headers: { Accept: "application/json", "X-Subscription-Token": config.BRAVE_API_KEY },
    });
    if (!response.ok) throw providerError("http_error", response.status);
    let data;
    try { data = await response.json(); } catch { throw providerError("parser_error", response.status); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw providerError("parser_error", response.status);
    // Empty searches may omit web entirely; a present but malformed web object is an error.
    if (data.web != null && !Array.isArray(data.web.results)) throw providerError("parser_error", response.status);
    if (data.web == null && data.type !== "search") throw providerError("parser_error", response.status);
    return uniqueResults(normalizeResults(data.web?.results || []).map((item) => ({
      ...item, url: safeUrl(item.url), description: text(parseHtml(item.description)),
    })));
  }
  const params = new URLSearchParams({ q: query, source: "web" });
  const response = await fetch(`https://search.brave.com/search?${params}`, {
    signal, headers: { Accept: "text/html", "Accept-Language": "en-US,en;q=0.5" },
  });
  const document = parseHtml(await response.text());
  checkResponse(response, document);
  const results = extractBraveResults(document);
  if (results.length) return results;
  if (find(document, (node) => hasClass(node, "no-results") || node.attribs?.id === "no-results")) return [];
  throw providerError("parser_error", response.status);
}

export default searchBrave;
