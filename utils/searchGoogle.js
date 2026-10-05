import { normalizeResults } from "./index.js";

// type subSearch under index.d.ts
// TODO: support language, time_range, pageno
async function searchGoogle({ query, language, time_range, pageno, signal, config }) {
  const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${config.GOOGLE_API_KEY}&cx=${config.GOOGLE_CX}&q=${encodeURIComponent(
    query
  )}`;

  const response = await fetch(searchUrl, { signal });

  if (!response.ok) {
    throw Object.assign(new Error("Upstream HTTP error."), {
      error_type: "http_error", http_status: response.status,
    });
  }

  const data = await response.json();
  const results = [];

  if (data.items && Array.isArray(data.items)) {
    for (const item of data.items) {
      results.push({
        title: item.title,
        url: item.link,
        content: item.snippet || "",
      });
    }
  }

  return normalizeResults(results);
}

export default searchGoogle;
