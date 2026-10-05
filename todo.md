# Urgent follow-up — cf-search 1.1.2

- [ ] Verify the production Worker source, account, URL and runtime secrets. Cloudflare reads are blocked by missing account selection in the connector schema.
- [x] Replace Brave's eval parser and fixed CAPTCHA cookie with safe HTML parsing; optional official API support is available through BRAVE_API_KEY. The current captured HTML parses 17 results.
- [x] Make DuckDuckGo parsing independent of attribute order and recognize CAPTCHA / anomaly pages as blocked instead of empty success.
- [ ] Resolve production DuckDuckGo availability: direct access from this environment returned an HTTP 202 challenge. Retain Bing/Brave partial results while blocked; do not report the provider as recovered.
- [ ] Deploy the reviewed patch and verify default search plus both MCP aliases with real upstreams. Ten regression tests and a Wrangler bundle dry-run pass; production recovery is not confirmed.
- [ ] Repeat local HTTP validation on a working Wrangler host: this environment cannot enumerate network interfaces, so dev mode failed before opening the listener.
