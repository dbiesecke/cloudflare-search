import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const bingHtml = '<li class="b_algo"><h2><a href="https://example.org/event">Berlin event</a></h2><div class="b_caption"><p>Lineup and tickets</p></div></li>';
const request = (query = "Berlin techno") => new Request(`https://worker.test/search?q=${encodeURIComponent(query)}`);

test("default search preserves Bing results when other providers fail; skips unconfigured Google", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return String(url).includes("bing.com") ? new Response(bingHtml) : new Response("blocked", { status: 429 });
  };
  const response = await worker.fetch(request(), {});
  const result = await response.json();
  assert.equal(result.number_of_results, 1);
  assert.equal(result.results[0].engine, "bing");
  assert.equal(calls.some((url) => url.includes("googleapis")), false);
  assert.deepEqual(result.enabled_engines, ["bing", "brave", "duckduckgo"]);
  assert.equal(result.engine_diagnostics.find((d) => d.engine === "google").status, "disabled");
  assert.equal(result.engine_diagnostics.find((d) => d.engine === "brave").http_status, 429);
});

test("explicit Google selection explains missing credentials without calling an upstream", async () => {
  globalThis.fetch = () => { throw new Error("Must not call upstream"); };
  const response = await worker.fetch(new Request("https://worker.test/search?q=test&engines=google"), {});
  const result = await response.json();
  assert.deepEqual(result.enabled_engines, []);
  assert.equal(result.engine_diagnostics[0].error_type, "missing_credentials");
});

test("deadline returns even when an upstream ignores the abort signal", async () => {
  globalThis.fetch = () => new Promise(() => {});
  const response = await worker.fetch(request(), { DEFAULT_ENGINES: ["bing"], DEFAULT_TIMEOUT: "10" });
  const result = await response.json();
  assert.equal(result.engine_diagnostics[0].status, "timeout");
  assert.deepEqual(result.unresponsive_engines, ["bing"]);
});

test("concurrent requests retain their own Google credentials and subsequent requests reset configuration", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    await Promise.resolve();
    return new Response(JSON.stringify({ items: [{ title: "test", link: "https://example.org" }] }));
  };
  await Promise.all(["key-one", "key-two"].map((key) => worker.fetch(request(), {
    DEFAULT_ENGINES: ["google"], GOOGLE_API_KEY: key, GOOGLE_CX: "cx",
  })));
  assert.ok(calls.some((url) => url.includes("key=key-one")));
  assert.ok(calls.some((url) => url.includes("key=key-two")));
  const response = await worker.fetch(new Request("https://worker.test/search?q=test&engines=google"), {});
  assert.equal((await response.json()).engine_diagnostics[0].status, "disabled");
  assert.equal(calls.length, 2);
});

test("MCP aliases share default selection and return safe diagnostics", async () => {
  globalThis.fetch = async (url) => String(url).includes("bing.com")
    ? new Response(bingHtml) : Promise.reject(new Error("secret-token=https://upstream.test/?key=private"));
  for (const name of ["search", "web_search"]) {
    const response = await worker.fetch(new Request("https://worker.test/mcp", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { query: "Berlin techno" } } }),
    }), {});
    const body = await response.text();
    assert.ok(!body.includes("secret-token"));
    assert.equal(JSON.parse(body).result.structuredContent.results[0].engine, "bing");
  }
});
