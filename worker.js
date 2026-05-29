import { env, setEnv } from "./envs.js";
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

function parseEngines(enginesParam) {
  if (!enginesParam) return env.DEFAULT_ENGINES || env.SUPPORTED_ENGINES;

  return enginesParam
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => {
      if (e === "google" && !(env.GOOGLE_API_KEY && env.GOOGLE_CX)) {
        return false;
      }

      return env.SUPPORTED_ENGINES.includes(e);
    });
}

async function searchSingle(engineName, query) {
  const searchFn = SEARCH_ENGINES[engineName];

  if (!searchFn) {
    console.warn(`Unknown engine: ${engineName}`);
    return [];
  }

  const controller = new AbortController();
  const timeout = Number.parseInt(env.DEFAULT_TIMEOUT ?? "3000", 10);
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    return await searchFn({ query, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      console.error(`[${engineName}] Timeout after ${timeout}ms`);
    } else {
      console.error(`[${engineName}] Error:`, error.message);
    }

    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

async function searchAll({ query, engines }) {
  const enabledEngines = Array.isArray(engines)
    ? parseEngines(engines.join(","))
    : parseEngines(engines);

  const resultsArr = await Promise.allSettled(
    enabledEngines.map((engine) => searchSingle(engine, query)),
  );

  const results = [];
  const unresponsive = [];

  resultsArr.forEach((result, index) => {
    const engineName = enabledEngines[index];

    if (result.status === "fulfilled" && result.value.length > 0) {
      results.push(
        ...result.value.map((item) => ({
          ...item,
          engine: engineName,
        })),
      );
    } else {
      unresponsive.push(engineName);

      if (result.status === "rejected") {
        console.error(`[${engineName}] Rejected:`, result.reason);
      }
    }
  });

  return {
    query,
    number_of_results: results.length,
    enabled_engines: enabledEngines,
    unresponsive_engines: unresponsive,
    results,
  };
}

function verifyToken(request, paramToken) {
  if (!env.TOKEN) return true;

  const authToken =
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ||
    paramToken;

  return authToken === env.TOKEN;
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

async function handleMcpRpc(payload) {
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
        version: "1.0.0",
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
    });

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

async function handleMcpRequest(request) {
  const url = new URL(request.url);

  if (!verifyToken(request, url.searchParams.get("token"))) {
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
        const response = await handleMcpRpc(item);
        if (response) responses.push(response);
      }

      if (responses.length === 0) {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      return json(responses);
    }

    const response = await handleMcpRpc(payload);

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

async function handleSearchRequest(request) {
  const url = new URL(request.url);

  let params = {};

  if (request.method === "POST") {
    const formData = await request.formData();
    params = Object.fromEntries(formData.entries());
  } else {
    params = Object.fromEntries(url.searchParams.entries());
  }

  if (!verifyToken(request, params.token)) {
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
  const response = await searchAll({ query, engines });

  return json(response);
}

async function handleRequest(request) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (url.pathname === "/mcp") {
    return handleMcpRequest(request);
  }

  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  if (url.pathname === "/") {
    return new Response(getSearchHtml(), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...CORS_HEADERS,
      },
    });
  }

  if (url.pathname === "/search") {
    return handleSearchRequest(request);
  }

  return new Response("Not Found", {
    status: 404,
    headers: CORS_HEADERS,
  });
}

export default {
  async fetch(request, envParam) {
    setEnv(envParam);
    return handleRequest(request);
  },
};
