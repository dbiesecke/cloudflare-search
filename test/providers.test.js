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

test("DuckDuckGo accepts attribute order, extra classes, nested titles, direct and redirected URLs", async () => {
  globalThis.fetch = async () => new Response(`
    <div class='result extra'><h2><a href='//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2F%3Fa%3D1%26b%3D2&amp;rut=x' class='extra result__a'><b>Berlin</b> &amp; &#x1F3B5;</a></h2>
    <div class='result__snippet'>Dates &amp; Tickets</div></div>
    <div class='result'><a href='https://example.net/show' class='result__a'>Show</a><span class='result__snippet'>Live</span></div>
    <div class='result result--ad'><a class='result__a' href='https://ads.example.org'>Advert</a></div>
    <div class='result'><a class='result__a' href='javascript:alert(1)'>Invalid</a></div>
    <div class='result'><a class='result__a'>Missing link</a></div>
    <div class='result'><a class='result__a' href='//duckduckgo.com/l/?uddg=relative-path'>Invalid redirect</a></div>`);
  const results = await duckduckgo({ query: "Berlin techno" });
  assert.equal(results.length, 2);
  assert.equal(results[0].url, "https://example.org/?a=1&b=2");
  assert.equal(results[0].title, "Berlin & 🎵");
  assert.equal(results[0].description, "Dates & Tickets");
  assert.equal(results[1].url, "https://example.net/show");
});

test("challenge pages are blocked at HTTP 200 and 202; layout changes are parser errors, not empty success", async () => {
  for (const search of [brave, duckduckgo]) {
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

test("Worker returns a distinct, credential-safe blocked diagnostic while preserving Brave results", async () => {
  globalThis.fetch = async (url) => String(url).includes("brave.com")
    ? new Response(braveHtml)
    : new Response('<form id="challenge-form">private upstream token</form>', { status: 202 });
  const response = await worker.fetch(new Request("https://worker.test/search?q=Berlin&engines=brave,duckduckgo"), {});
  const result = await response.json();
  assert.equal(result.number_of_results, 1);
  assert.equal(result.engine_diagnostics[1].error_type, "blocked");
  assert.equal(result.engine_diagnostics[1].http_status, 202);
  assert.ok(!JSON.stringify(result).includes("private upstream token"));
});
