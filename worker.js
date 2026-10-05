import { env } from "./envs.js";
import { getSearchHtml } from "./utils/getHTML.js";
import searchGoogle from "./utils/searchGoogle.js";
import searchBrave from "./utils/searchBrave.js";
import searchDuckDuckGo from "./utils/searchDuckDuckGo.js";
import searchBing from "./utils/searchBing.js";

const SEARCH_ENGINES = {
  google: searchGoogle,
  brave: searchBrave,
  duckduckgo: searchDuckDuckGo,
  bing: searchBing,
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  ...CORS_HEADERS,
};

const MCP_PROTOCOL_VERSION = "2025-06-18";

const SEARCH_INPUT_SCHEMA = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Search query.",
    },
    engines: {
      type: "array",
      items: {
        type: "string",
        enum: ["google", "brave", "duckduckgo", "bing"],
      },
      description:
        "Optional list of search engines. Supported: google, brave, duckduckgo, bing.",
    },
  },
  required: ["query"],
  additionalProperties: false,
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...(init.headers || {}),
    },
  });
}

function parseEngines(enginesParam, config) {
  const requested = enginesParam == null || enginesParam === ""
    ? config.DEFAULT_ENGINES
    : enginesParam;
  const names = Array.isArray(requested) ? requested : String(requested).split(",");
  return [...new Set(names.map((name) => String(name).trim().toLowerCase()))]
    .filter((name) => config.SUPPORTED_ENGINES.includes(name) && SEARCH_ENGINES[name]);
}

async function searchSingle(engineName, query, config) {
  const started = Date.now();
  const diagnostic = {
    engine: engineName, status: "error", http_status: null,
    duration_ms: 0, error_type: null, message: null,
  };
  if (engineName === "google" && !(config.GOOGLE_API_KEY && config.GOOGLE_CX)) {
    return { results: [], diagnostic: {
      ...diagnostic, status: "disabled", error_type: "missing_credentials",
      message: "Configure GOOGLE_API_KEY and GOOGLE_CX.",
    } };
  }
  const controller = new AbortController();
  const parsed = Number(config.DEFAULT_TIMEOUT);
  const timeout = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 30000) : 8000;
  let timeoutId;
  try {
    const deadline = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(Object.assign(new Error("Provider timed out."), { error_type: "timeout" }));
      }, timeout);
    });
    const results = await Promise.race([
      SEARCH_ENGINES[engineName]({ query, signal: controller.signal, config }), deadline,
    ]);
    diagnostic.status = results.length ? "ok" : "empty";
    return { results, diagnostic };
  } catch (error) {
    diagnostic.status = error.error_type === "timeout" || controller.signal.aborted ? "timeout" : "error";
    diagnostic.error_type = diagnostic.status === "timeout" ? "timeout" : (error.error_type || "provider_error");
    diagnostic.http_status = error.http_status || null;
    // Never return upstream bodies, URLs or exception messages that may contain credentials.
    diagnostic.message = diagnostic.status === "timeout" ? "Provider timed out."
      : diagnostic.http_status ? `Provider returned HTTP ${diagnostic.http_status}.`
      : "Provider request or response parsing failed.";
    return { results: [], diagnostic };
  } finally {
    clearTimeout(timeoutId);
    diagnostic.duration_ms = Date.now() - started;
  }
}

async function searchAll({ query, engines }, config) {
  const selected = parseEngines(engines, config);
  const outcomes = await Promise.all(selected.map((engine) => searchSingle(engine, query, config)));
  const results = outcomes.flatMap((outcome, index) => outcome.results.map((item) => ({
    ...item, engine: selected[index],
  })));
  const diagnostics = outcomes.map((outcome) => outcome.diagnostic);
  return {
    query, number_of_results: results.length,
    enabled_engines: diagnostics.filter((d) => d.status !== "disabled").map((d) => d.engine),
    unresponsive_engines: diagnostics.filter((d) => ["error", "timeout"].includes(d.status)).map((d) => d.engine),
    engine_diagnostics: diagnostics, results,
  };
}

function verifyToken(request, paramToken, config) {
  if (!config.TOKEN) return true;

  const authToken =
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ||
    paramToken;

  return authToken === config.TOKEN;
}

function rpcResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function rpcError(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
      ...(data ? { data } : {}),
    },
  };
}

function mcpTools() {
  return [
    {
      name: "web_search",
      title: "Web Search",
      description:
        "Search the web for current information using the configured Cloudflare Search engines. Returns titles, descriptions, URLs, source engine names, and unresponsive engines.",
      inputSchema: SEARCH_INPUT_SCHEMA,
    },
    {
      name: "search",
      title: "Search",
      description:
        "Aggregated search across Google, Brave, DuckDuckGo, and Bing depending on your Worker configuration.",
      inputSchema: SEARCH_INPUT_SCHEMA,
    },
  ];
}

function formatSearchResultForMcp(result) {
  if (!result.results || result.results.length === 0) {
    return [
      `Search query: ${result.query}`,
      `Total results: 0`,
      `Engines used: ${result.enabled_engines.join(", ") || "none"}`,
      result.unresponsive_engines.length
        ? `Unresponsive engines: ${result.unresponsive_engines.join(", ")}`
        : null,
      "",
      "No results returned.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const lines = [
    `Search query: ${result.query}`,
    `Total results: ${result.number_of_results}`,
    `Engines used: ${result.enabled_engines.join(", ")}`,
    result.unresponsive_engines.length
      ? `Unresponsive engines: ${result.unresponsive_engines.join(", ")}`
      : null,
    "",
    "Results:",
  ].filter(Boolean);

  result.results.slice(0, 20).forEach((item, index) => {
    lines.push(
      [
        `${index + 1}. [${String(item.engine || "unknown").toUpperCase()}] ${item.title || "Untitled"}`,
        item.description ? `   ${item.description}` : null,
        item.url ? `   ${item.url}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  });

  return lines.join("\n");
}

async function handleMcpRpc(payload, config) {
  const { id, method, params } = payload;

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: params?.protocolVersion || MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "cloudflare-search",
        title: "Cloudflare Search",
        version: "1.1.1",
      },
      instructions:
        "Use the search tools when the user asks for current web information, URLs, sources, or recent facts. Prefer concise queries and include URLs from the results.",
    });
  }

  if (method === "tools/list") {
    return rpcResult(id, {
      tools: mcpTools(),
    });
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments || {};

    if (toolName !== "web_search" && toolName !== "search") {
      return rpcError(id, -32601, `Unknown tool: ${toolName}`);
    }

    if (!args.query || typeof args.query !== "string") {
      return rpcError(id, -32602, "Missing required argument: query");
    }

    const engines = Array.isArray(args.engines) ? args.engines : undefined;
    const result = await searchAll({
      query: args.query,
      engines,
    }, config);

    return rpcResult(id, {
      content: [
        {
          type: "text",
          text: formatSearchResultForMcp(result),
        },
      ],
      structuredContent: result,
    });
  }

  if (method?.startsWith("notifications/")) {
    return null;
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}

async function handleMcpRequest(request, config) {
  const url = new URL(request.url);

  if (!verifyToken(request, url.searchParams.get("token"), config)) {
    return json(
      {
        error: "Unauthorized",
        message: "Invalid or missing authentication token",
      },
      { status: 401 },
    );
  }

  if (request.method === "GET") {
    return json({
      name: "cloudflare-search",
      transport: "streamable-http",
      endpoint: "/mcp",
      tools: mcpTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
    });
  }

  if (request.method !== "POST") {
    return json(
      {
        error: "Method Not Allowed",
        message: "MCP endpoint accepts POST requests.",
      },
      { status: 405 },
    );
  }

  let payload;

  try {
    payload = await request.json();
  } catch {
    return json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }

  try {
    if (Array.isArray(payload)) {
      const responses = [];

      for (const item of payload) {
        const response = await handleMcpRpc(item, config);
        if (response) responses.push(response);
      }

      if (responses.length === 0) {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      return json(responses);
    }

    const response = await handleMcpRpc(payload, config);

    if (!response) {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    return json(response);
  } catch (error) {
    return json(rpcError(payload?.id, -32603, "Internal error", error.message), {
      status: 500,
    });
  }
}

async function handleSearchRequest(request, config) {
  const url = new URL(request.url);

  let params = {};

  if (request.method === "POST") {
    const formData = await request.formData();
    params = Object.fromEntries(formData.entries());
  } else {
    params = Object.fromEntries(url.searchParams.entries());
  }

  if (!verifyToken(request, params.token, config)) {
    return json(
      {
        error: "Unauthorized",
        message: "Invalid or missing authentication token",
      },
      { status: 401 },
    );
  }

  const query = params.q || params.query;

  if (!query) {
    return json(
      {
        error: "Missing query parameter",
        message: "Please provide 'q' or 'query' parameter",
      },
      { status: 400 },
    );
  }

  const engines = params.engines?.split(",").filter(Boolean) || undefined;
  const response = await searchAll({ query, engines }, config);

  return json(response);
}

async function handleRequest(request, config) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (url.pathname === "/mcp") {
    return handleMcpRequest(request, config);
  }

  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  if (url.pathname === "/") {
    return new Response(getSearchHtml(config), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...CORS_HEADERS,
      },
    });
  }

  if (url.pathname === "/search") {
    return handleSearchRequest(request, config);
  }

  return new Response("Not Found", {
    status: 404,
    headers: CORS_HEADERS,
  });
}

export default {
  async fetch(request, envParam) {
    const config = { ...env, ...envParam };
    return handleRequest(request, config);
  },
};
