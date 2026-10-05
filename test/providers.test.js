import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import brave from "../utils/searchBrave.js";
import duckduckgo from "../utils/searchDuckDuckGo.js";
import worker from "../worker.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
// Current Brave result-content / search-snippet-title structure, reduced from
// the 2026-10-05 Berlin techno response. No upstream scripts or cookies retained.
const braveHtml = `<div class="result-content svelte-1rq4ngz">
  <a target="_self" href="https://ra.co/events/de/berlin/techno">
    <div class="site-name-wrapper">RA</div>
    <div class="title search-snippet-title line-clamp-1">Upcoming Techno Events in Berlin &amp; Tickets</div>
  </a><div class="generic-snippet"><div class="content">Lineup &#183; Berlin</div></div>
</div>`;

test("Brave reads current HTML, decodes entities, deduplicates and never executes upstream scripts", async () => {
  globalThis.__braveExecuted = false;
  let headers;
  globalThis.fetch = async (_, options) => {
    headers = options.headers;
    return new Response(braveHtml + braveHtml + '<script>globalThis.__braveExecuted=true</script>');
  };
  const results = await brave({ query: "Berlin techno" });
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Upcoming Techno Events in Berlin & Tickets");
  assert.equal(results[0].description, "Lineup · Berlin");
  assert.equal(globalThis.__braveExecuted, false);
  assert.equal(new Headers(headers).has("cookie"), false);
  delete globalThis.__braveExecuted;
});

test("DuckDuckGo uses the JSON API and flattens nested topics with valid source URLs", async () => {
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.hostname, "api.duckduckgo.com");
    assert.equal(parsed.searchParams.get("format"), "json");
    assert.equal(parsed.searchParams.get("no_html"), "1");
    assert.equal(parsed.searchParams.get("q"), "Python & music");
    assert.equal(options.headers.Accept, "application/json");
    return new Response(JSON.stringify({ Heading: "Python", AbstractText: "Language", AbstractURL: "https://example.org/python",
      Results: [{ FirstURL: "https://example.org/python", Text: "Duplicate" }],
      RelatedTopics: [{ Name: "Topics", Topics: [{ FirstURL: "https://example.net/topic", Text: "Nested &amp; topic" },
        { FirstURL: "javascript:alert(1)", Text: "Invalid" }] }] }), { status: 202 });
  };
  const result = await duckduckgo({ query: "Python & music" });
  assert.equal(result.results.length, 2);
  assert.equal(result.results[1].description, "Nested & topic");
  assert.equal(result.instant_answers[0].type, "abstract");
});

test("DuckDuckGo direct answers without sources remain usable and empty API responses are successful", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ Heading: "Calculation", Answer: "4", RelatedTopics: [], Results: [] }), { status: 202 });
  const response = await worker.fetch(new Request("https://worker.test/mcp", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: { query: "2+2", engines: ["duckduckgo"] } } }) }), {});
  const result = (await response.json()).result;
  assert.equal(result.structuredContent.results.length, 0);
  assert.equal(result.structuredContent.instant_answers[0].url, null);
  assert.equal(result.structuredContent.engine_diagnostics[0].status, "ok");
  assert.ok(result.content[0].text.includes("Calculation: 4"));
  globalThis.fetch = async () => new Response(JSON.stringify({ AbstractText: "", Answer: "", Definition: "", Results: [], RelatedTopics: [] }));
  assert.deepEqual(await duckduckgo({ query: "Berlin techno events" }), { results: [], instant_answers: [] });
  for (const body of ["<html>Challenge</html>", JSON.stringify({ error: "Unexpected" }), JSON.stringify({ RelatedTopics: {} })]) {
    globalThis.fetch = async () => new Response(body);
    await assert.rejects(duckduckgo({ query: "test" }), (error) => error.error_type === "parser_error");
  }
});

test("challenge pages are blocked at HTTP 200 and 202; layout changes are parser errors, not empty success", async () => {
  for (const search of [brave]) {
    for (const status of [200, 202]) {
      globalThis.fetch = async () => new Response('<form id="challenge-form" action="//duckduckgo.com/anomaly.js"></form>', { status });
      await assert.rejects(search({ query: "test" }), (error) => error.error_type === "blocked" && error.http_status === status);
    }
    globalThis.fetch = async () => new Response('<main>Unexpected new layout</main>');
    await assert.rejects(search({ query: "test" }), (error) => error.error_type === "parser_error");
    globalThis.fetch = async () => new Response('<div class="no-results">No results</div>');
    assert.deepEqual(await search({ query: "test" }), []);
  }
});

test("Brave API key stays in the header; bad credentials do not silently fall back to scraping", async () => {
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(new URL(url).hostname, "api.search.brave.com");
    assert.ok(!String(url).includes("private-test-key"));
    assert.equal(options.headers["X-Subscription-Token"], "private-test-key");
    return new Response(JSON.stringify({ type: "search", web: { results: [{ title: "Event", url: "https://example.org", description: "Live <b>music</b>" }] } }));
  };
  assert.equal((await brave({ query: "Berlin techno", config: { BRAVE_API_KEY: "private-test-key" } }))[0].description, "Live music");
  globalThis.fetch = async () => { calls++; return new Response("private-test-key", { status: 401 }); };
  await assert.rejects(brave({ query: "test", config: { BRAVE_API_KEY: "private-test-key" } }), (error) => error.http_status === 401);
  assert.equal(calls, 2);
});

test("Worker preserves Brave results when DuckDuckGo API returns HTTP errors", async () => {
  globalThis.fetch = async (url) => String(url).includes("brave.com")
    ? new Response(braveHtml)
    : new Response("private upstream token", { status: 429 });
  const response = await worker.fetch(new Request("https://worker.test/search?q=Berlin&engines=brave,duckduckgo"), {});
  const result = await response.json();
  assert.equal(result.number_of_results, 1);
  assert.equal(result.engine_diagnostics[1].error_type, "http_error");
  assert.equal(result.engine_diagnostics[1].http_status, 429);
  assert.ok(!JSON.stringify(result).includes("private upstream token"));
});
