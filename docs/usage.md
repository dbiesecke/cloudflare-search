# Cloudflare Search — usage (1.1.1)

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
npx wrangler dev
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
Five regression tests exercise the real Worker handler with controlled upstreams:
default partial results, disabled Google, hard deadlines, request configuration
isolation and both MCP aliases. These tests do not prove live provider availability.

Live pre-change Bing returned 10 results on 2026-10-05. The deployed service has
not been changed by this patch. Brave and DuckDuckGo scraping still require
provider-specific investigation; see [todo.md](../todo.md).
