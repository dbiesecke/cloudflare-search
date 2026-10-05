# Urgent follow-up — cf-search 1.1.3

- [ ] Verify the production Worker source, account, URL and runtime secrets. Cloudflare reads are blocked by missing account selection in the connector schema.
- [x] Replace Brave's eval parser and fixed CAPTCHA cookie with safe HTML parsing; optional official API support is available through BRAVE_API_KEY. The current captured HTML parses 17 results.
- [x] Make DuckDuckGo parsing independent of attribute order and recognize CAPTCHA / anomaly pages as blocked instead of empty success.
- [x] Replace DuckDuckGo HTML search with its key-free Instant Answer JSON API. Valid HTTP 202 JSON is accepted; live captures include a Python summary and topics. Event queries may legitimately return no answers.
- [ ] Deploy the reviewed patch and verify default search plus both MCP aliases with real upstreams. Eleven regression tests and a Wrangler bundle dry-run pass; production recovery is not confirmed.
- [ ] Repeat local HTTP validation on a working Wrangler host: this environment cannot enumerate network interfaces, so dev mode failed before opening the listener.
