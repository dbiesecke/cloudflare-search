import { parseHtml, text, safeUrl, providerError, uniqueResults } from "./providerHtml.js";

const clean = (value) => typeof value === "string" ? text(parseHtml(value)) : "";

export function extractDuckDuckGoResponse(data, query) {
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      !["AbstractText", "Abstract", "Answer", "Definition", "RelatedTopics", "Results"].some((key) => key in data)) {
    throw providerError("parser_error");
  }
  for (const key of ["AbstractText", "Abstract", "Answer", "Definition", "Heading", "AbstractURL", "DefinitionURL"]) {
    if (key in data && typeof data[key] !== "string") throw providerError("parser_error");
  }
  const results = [];
  const instant_answers = [];
  const title = clean(data.Heading) || query;
  function addAnswer(type, value, href, source) {
    const answerText = clean(value);
    if (!answerText) return;
    const url = safeUrl(href);
    instant_answers.push({ type, title, text: answerText, url, source: clean(source) || null });
    if (url) results.push({ title, description: answerText, url });
  }
  addAnswer("abstract", data.AbstractText || data.Abstract, data.AbstractURL, data.AbstractSource);
  addAnswer("answer", data.Answer, data.AnswerURL, data.AnswerType);
  addAnswer("definition", data.Definition, data.DefinitionURL, data.DefinitionSource);
  function topics(items) {
    if (items === undefined) return;
    if (!Array.isArray(items)) throw providerError("parser_error");
    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw providerError("parser_error");
      if (item.Topics !== undefined) topics(item.Topics);
      const url = safeUrl(item.FirstURL);
      const description = clean(item.Text) || clean(item.Result);
      if (url && description) results.push({ title: description, description, url });
    }
  }
  topics(data.Results);
  topics(data.RelatedTopics);
  return { results: uniqueResults(results), instant_answers };
}

async function searchDuckDuckGo({ query, signal }) {
  const params = new URLSearchParams({ q: query, format: "json", no_html: "1", no_redirect: "1" });
  const response = await fetch(`https://api.duckduckgo.com/?${params}`, {
    signal, headers: { Accept: "application/json" },
  });
  if (!response.ok) throw providerError("http_error", response.status);
  let data;
  try { data = await response.json(); } catch { throw providerError("parser_error", response.status); }
  try { return extractDuckDuckGoResponse(data, query); }
  catch (error) { error.http_status = response.status; throw error; }
}

export default searchDuckDuckGo;
