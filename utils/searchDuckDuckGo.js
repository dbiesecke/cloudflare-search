import { parseHtml, findAll, find, hasClass, text, safeUrl, providerError, checkResponse, uniqueResults } from "./providerHtml.js";

function destination(href) {
  const url = safeUrl(href, "https://duckduckgo.com");
  if (!url) return null;
  const parsed = new URL(url);
  if (["duckduckgo.com", "html.duckduckgo.com"].includes(parsed.hostname)) {
    const target = parsed.searchParams.get("uddg");
    return target ? safeUrl(target) : null;
  }
  return url;
}

export function extractDuckDuckGoResults(document) {
  return uniqueResults(findAll(document, (node) => node.name === "a" && hasClass(node, "result__a")).flatMap((link) => {
    let container = link.parent;
    while (container && !hasClass(container, "result")) container = container.parent;
    if (!container || hasClass(container, "result--ad")) return [];
    const url = destination(link.attribs?.href);
    const snippet = find(container, (node) => hasClass(node, "result__snippet"));
    return url ? [{ title: text(link), url, description: text(snippet) }] : [];
  }));
}

async function searchDuckDuckGo({ query, language, time_range, pageno, signal }) {
  const params = new URLSearchParams({ q: query, kl: language === "zh" ? "cn-zh" : "wt-wt", s: String((pageno || 0) * 30) });
  if (time_range) params.set("df", time_range);
  const response = await fetch(`https://html.duckduckgo.com/html/?${params}`, {
    signal, headers: { Accept: "text/html", "Accept-Language": "en-US,en;q=0.5" },
  });
  const document = parseHtml(await response.text());
  checkResponse(response, document);
  const results = extractDuckDuckGoResults(document);
  if (results.length) return results;
  if (find(document, (node) => hasClass(node, "no-results") || hasClass(node, "result--no-result"))) return [];
  throw providerError("parser_error", response.status);
}

export default searchDuckDuckGo;
