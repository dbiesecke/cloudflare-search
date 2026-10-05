# Cloudflare Search — usage (1.1.3)

Source: https://github.com/dbiesecke/cloudflare-search

## Search

`GET /search?q=Berlin%20techno` selects Bing, Google, Brave and DuckDuckGo.
Google needs both `GOOGLE_API_KEY` and `GOOGLE_CX`; otherwise its diagnostic is
`disabled` and it is omitted from `enabled_engines`.

`GET /search?q=Berlin%20techno&engines=bing` restricts the request to Bing.
Explicit engine selection is respected, normalized and deduplicated; it does
not silently call engines outside the selection.
`POST /search` accepts form fields `q` (or `query`), `engines` and optional `token`.
Use a Bearer header for authentication to avoid tokens in URL logs.

```sh
curl "$CF_SEARCH_URL/search?q=Berlin%20techno" \
  -H "Authorization: Bearer $CF_SEARCH_TOKEN"
```

## Diagnostics and partial results

`engine_diagnostics` describes every selected supported provider. Statuses are
`ok`, `empty`, `disabled`, `timeout` and `error`. `http_status` is populated for
HTTP failures and is otherwise null. `duration_ms` measures the provider attempt.
`error_type` and `message` describe failures without returning upstream bodies,
credentials or exception URLs. An empty result is distinct from a failed request.

`unresponsive_engines` contains failed or timed-out engines. Successful results
remain available even when every other engine fails. There is no guarantee that
Bing or another provider will always return results.

## MCP

`POST /mcp` supports the existing `search` and `web_search` aliases with identical
selection and aggregation behavior. Results include `structuredContent` with
provider diagnostics. `GET /mcp` describes the tools.

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"web_search","arguments":{"query":"Berlin techno","engines":["bing"]}}}
```

## Configuration and deployment

`DEFAULT_TIMEOUT` defaults to 8000 milliseconds. Invalid values use that default;
positive values are capped at 30000 milliseconds. A deadline also bounds providers
that fail to honor abort signals. Configuration is isolated per request.

```sh
npm ci
npm run dev
npm test
npx wrangler secret put GOOGLE_API_KEY
npx wrangler secret put GOOGLE_CX
npx wrangler deploy
```

Google credentials are optional. Set `TOKEN` as a secret if authentication is
required. Choose the correct Cloudflare account before deploying.
The existing wrangler configuration names the Worker `cloudflare-search`.
The active deployment URL and configuration have not been verified: the current
Cloudflare connector requires an account ID that its exposed read tools cannot pass.

## API contract and validation

[openapi.yaml](../openapi.yaml) uses OpenAPI 3.1.1 and documents HTTP search,
MCP discovery and JSON-RPC calls, including partial-success examples.
Eleven regression tests exercise the real Worker handler with controlled upstreams:
default partial results, disabled Google, hard deadlines, request configuration
isolation, both MCP aliases and provider-specific parsing, safe script handling,
DuckDuckGo JSON normalization, source-free answers, empty API responses,
Brave CAPTCHA detection and optional Brave API authentication.
These tests do not prove live provider availability.

Live pre-change Bing returned 10 results on 2026-10-05. The deployed service has
not been changed by this patch. On 2026-10-05 a direct Brave HTML capture yielded
17 results with the new parser; the old parser found none of its expected data
lines. The DuckDuckGo JSON API returned valid HTTP 202 JSON: 23 normalized links
and one summary for Python programming language, and zero for Berlin techno events.
See [todo.md](../todo.md) for remaining deployment checks.

## Brave and DuckDuckGo providers

Brave HTML is parsed with `htmlparser2`; scripts are never evaluated and the fixed
CAPTCHA cookie is removed. The parser reads organic result containers, validates
HTTP(S) URLs, decodes text entities and removes duplicate URLs.

Optional: set `BRAVE_API_KEY` with `npx wrangler secret put BRAVE_API_KEY`.
When configured, Brave uses `https://api.search.brave.com/res/v1/web/search` and
sends the key only in `X-Subscription-Token`. API errors do not silently fall back
to scraping. Without a key, public HTML parsing remains the default.
API requests use your configured Brave plan. No API key was available for a live
API test; authentication and response handling were tested with controlled data.
Official reference: https://api-dashboard.search.brave.com/app/documentation/web-search/codes

DuckDuckGo now calls only `https://api.duckduckgo.com/` with `q`, `format=json`,
`no_html=1` and `no_redirect=1`. No credentials are required. No HTML-search
fallback, language filter, time filter or pagination is used for this API.

`AbstractText`/`Abstract`, `Answer` and `Definition` become structured
`instant_answers` with `type`, `title`, `text`, `url` and `source`. The aggregator
adds `engine: duckduckgo`. A missing source URL stays null; no source is invented.
Answers with valid source URLs also become normal link results. `Results` and
nested `RelatedTopics[].Topics` are flattened and duplicate URLs removed.
`number_of_results` counts links; it does not count source-free answers.
Both Worker MCP aliases include answers in text and `structuredContent`.

Example answer-only shape:

```json
{"number_of_results":0,"results":[],"instant_answers":[{"engine":"duckduckgo","type":"answer","title":"Calculation","text":"4","url":null,"source":null}]}
```

The Instant Answer service provides topic answers rather than a full ranked
web-search list. Empty answer fields and empty topic arrays are normal and yield
`empty`, not an upstream failure. HTTP 202 with valid API JSON is accepted;
non-JSON or malformed payloads return `parser_error`, HTTP failures `http_error`.
The original HTML CAPTCHA endpoint is no longer used. Bing/Brave remain the
providers for general web and Event Radar queries.

References:
- https://api.duckduckgo.com/?q=Python%20programming%20language&format=json&no_html=1
- https://duckduckgo.com/duckduckgo-help-pages/results/sources
- https://freeapihub.com/apis/duckduckgo-instant-answer-api

## Local runtime validation

Node 22+ is recommended for the installed Wrangler development dependency.
`npm run dev` was attempted but failed in this execution environment while reading
network interfaces (`uv_interface_addresses`). Wrangler deployment dry-run
successfully bundled the Worker and HTML parser without publishing.
No successful local HTTP server test or production deployment is claimed.
