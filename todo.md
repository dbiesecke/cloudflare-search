# Urgent follow-up — cf-search

- [ ] Verify the production Worker source, account, URL and runtime secrets. Cloudflare reads are blocked by missing account selection in the connector schema.
- [ ] Investigate Brave scraping: the current parser evaluates an upstream script with `eval` and includes a fixed CAPTCHA cookie. Replace with safe parsing or an authenticated provider API; do not reuse CAPTCHA tokens.
- [ ] Inspect DuckDuckGo live responses: the HTML parser assumes fixed classes, redirect links and attribute order. Distinguish challenge pages and parser changes from genuine empty results.
- [ ] Deploy the reviewed patch and verify default search plus both MCP aliases with real upstreams. Controlled regression tests pass; production provider recovery is not confirmed.
