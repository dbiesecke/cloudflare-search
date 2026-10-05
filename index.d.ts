type ResultItem = {
  title: string;
  description: string;
  url: string;
};

type TimeRange = "day" | "month" | "year";

export type subSearch = (params: {
  query: string;
  language?: string;
  time_range?: TimeRange;
  pageno?: number;
  signal?: AbortSignal;
  config?: Env;
}) => Promise<Array<ResultItem>>;

export type searchAll = (params: {
  query: string;
  engines?: string[];
}) => Promise<{
  query: string;
  number_of_results: number;
  enabled_engines: string[];
  unresponsive_engines: string[];
  engine_diagnostics: Array<{
    engine: string;
    status: "ok" | "empty" | "disabled" | "timeout" | "error";
    http_status: number | null;
    duration_ms: number;
    error_type: string | null;
    message: string | null;
  }>;
  results: Array<ResultItem & { engine: string }>;
}>;

export interface Env {
  DEFAULT_TIMEOUT?: string;
  SUPPORTED_ENGINES?: string[];
  DEFAULT_ENGINES?: string[];
  GOOGLE_API_KEY?: string;
  GOOGLE_CX?: string;
  TOKEN?: string;
}
