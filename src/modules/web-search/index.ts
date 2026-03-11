/**
 * Web Search module — Brave Search API integration.
 *
 * Mirrors OpenClaw's built-in web_search tool:
 * - Same tool name, parameter schema, and result format
 * - Brave Web Search and LLM Context modes
 * - In-memory result caching (15 min TTL, 100 entries max)
 * - freshness normalization (day→pd, week→pw, month→pm, year→py)
 * - date_after/date_before → Brave freshness range conversion
 */

import type { FreeTurtleModule, ToolDefinition } from "../types.js";

// --- Constants ---
const BRAVE_WEB_URL = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_LLM_URL = "https://api.search.brave.com/res/v1/llm/context";
const DEFAULT_COUNT = 5;
const DEFAULT_TIMEOUT_MS = 30_000;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const CACHE_MAX_SIZE = 100;

// --- Types ---
type BraveMode = "web" | "llm-context";

interface CacheEntry {
  result: string;
  timestamp: number;
}

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
}

interface BraveWebResponse {
  web?: { results?: BraveWebResult[] };
}

interface BraveLlmGenericResult {
  url?: string;
  title?: string;
  snippets?: string[];
}

interface BraveLlmResponse {
  grounding?: { generic?: BraveLlmGenericResult[] };
  sources?: Array<{ url?: string; hostname?: string; date?: string }>;
}

// --- Freshness normalization (matches OpenClaw) ---
const FRESHNESS_MAP: Record<string, string> = {
  day: "pd",
  week: "pw",
  month: "pm",
  year: "py",
};

function normalizeFreshness(
  freshness?: string,
  dateAfter?: string,
  dateBefore?: string,
): string | undefined {
  if (freshness && (dateAfter || dateBefore)) {
    throw new Error("Cannot use both freshness and date_after/date_before");
  }

  if (freshness) {
    return FRESHNESS_MAP[freshness] ?? freshness;
  }

  // Convert date_after/date_before to Brave's range format
  if (dateAfter || dateBefore) {
    const start = dateAfter ?? "1970-01-01";
    const end = dateBefore ?? new Date().toISOString().slice(0, 10);
    return `${start}to${end}`;
  }

  return undefined;
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// --- Tool definition (matches OpenClaw's web_search schema) ---
function buildToolDef(mode: BraveMode): ToolDefinition {
  const desc =
    mode === "llm-context"
      ? "Search the web using Brave Search LLM Context API. Returns pre-extracted page content (text chunks, tables, code blocks) optimized for LLM grounding."
      : "Search the web using Brave Search API. Supports region-specific and localized search via country and language parameters. Returns titles, URLs, and snippets for fast research.";

  return {
    name: "web_search",
    description: desc,
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query string.",
        },
        count: {
          type: "number",
          description: "Number of results to return (1-10).",
        },
        country: {
          type: "string",
          description:
            "2-letter country code (e.g., 'DE', 'US', 'ALL'). Default: 'US'.",
        },
        language: {
          type: "string",
          description: "ISO 639-1 language code (e.g., 'en', 'de', 'fr').",
        },
        freshness: {
          type: "string",
          description:
            "'day' (24h), 'week', 'month', or 'year'.",
        },
        date_after: {
          type: "string",
          description:
            "Only results published after this date (YYYY-MM-DD).",
        },
        date_before: {
          type: "string",
          description:
            "Only results published before this date (YYYY-MM-DD).",
        },
        search_lang: {
          type: "string",
          description:
            "Brave-specific language code (e.g., 'en-gb', 'zh-hans').",
        },
        ui_lang: {
          type: "string",
          description:
            "Locale for UI elements (e.g., 'en-US', 'de-DE').",
        },
      },
      required: ["query"],
    },
  };
}

// --- Module ---
export class WebSearchModule implements FreeTurtleModule {
  name = "web-search";
  description = "Search the web using Brave Search API";

  private apiKey = "";
  private mode: BraveMode = "web";
  private timeoutMs = DEFAULT_TIMEOUT_MS;
  private cache = new Map<string, CacheEntry>();

  async initialize(
    config: Record<string, unknown>,
    env: Record<string, string>,
  ): Promise<void> {
    // API key: config > env (matches OpenClaw's resolution order)
    this.apiKey =
      (config.api_key as string) ||
      env.BRAVE_API_KEY ||
      "";

    if (!this.apiKey) {
      throw new Error(
        "Web search requires BRAVE_API_KEY in .env or api_key in config",
      );
    }

    // Mode: "web" (default) or "llm-context"
    const rawMode = (config.mode as string) ?? "web";
    if (rawMode === "web" || rawMode === "llm-context") {
      this.mode = rawMode;
    }

    // Timeout
    const timeoutSec = config.timeout_seconds as number | undefined;
    if (timeoutSec && timeoutSec > 0) {
      this.timeoutMs = timeoutSec * 1000;
    }
  }

  getTools(): ToolDefinition[] {
    return [buildToolDef(this.mode)];
  }

  async executeTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    if (name !== "web_search") {
      throw new Error(`Unknown tool: ${name}`);
    }
    return this.search(input);
  }

  private async search(input: Record<string, unknown>): Promise<string> {
    const query = input.query as string;
    if (!query) return "Error: query is required";

    const count = Math.min(Math.max((input.count as number) ?? DEFAULT_COUNT, 1), 10);
    const country = (input.country as string) ?? undefined;
    const language = input.language as string | undefined;
    const freshness = input.freshness as string | undefined;
    const dateAfter = input.date_after as string | undefined;
    const dateBefore = input.date_before as string | undefined;
    const searchLang = input.search_lang as string | undefined;
    const uiLang = input.ui_lang as string | undefined;

    let normalizedFreshness: string | undefined;
    try {
      normalizedFreshness = normalizeFreshness(freshness, dateAfter, dateBefore);
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }

    // Check cache
    const cacheKey = JSON.stringify({
      mode: this.mode,
      query,
      count,
      country,
      language,
      freshness: normalizedFreshness,
      searchLang,
      uiLang,
    });

    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.result;
    }

    // Build URL
    const baseUrl = this.mode === "llm-context" ? BRAVE_LLM_URL : BRAVE_WEB_URL;
    const params = new URLSearchParams({ q: query });
    if (this.mode === "web") {
      params.set("count", String(count));
    }
    if (country) params.set("country", country);
    if (searchLang) params.set("search_lang", searchLang);
    if (uiLang) params.set("ui_lang", uiLang);
    if (normalizedFreshness) params.set("freshness", normalizedFreshness);

    const url = `${baseUrl}?${params.toString()}`;

    // Fetch
    const start = Date.now();
    let res: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": this.apiKey,
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg.includes("abort")) {
        return `Error: Brave Search request timed out after ${this.timeoutMs / 1000}s`;
      }
      return `Error: Brave Search request failed: ${msg}`;
    }

    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch { /* ignore */ }
      return `Error: Brave Search API error (${res.status}): ${detail || res.statusText}`;
    }

    const tookMs = Date.now() - start;

    // Parse and format results
    let result: string;
    if (this.mode === "llm-context") {
      result = this.formatLlmContext(await res.json() as BraveLlmResponse, query, tookMs);
    } else {
      result = this.formatWebResults(await res.json() as BraveWebResponse, query, count, tookMs);
    }

    // Update cache (LRU eviction)
    if (this.cache.size >= CACHE_MAX_SIZE) {
      let oldestKey: string | undefined;
      let oldestTime = Infinity;
      for (const [k, v] of this.cache) {
        if (v.timestamp < oldestTime) {
          oldestTime = v.timestamp;
          oldestKey = k;
        }
      }
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(cacheKey, { result, timestamp: Date.now() });

    return result;
  }

  private formatWebResults(
    data: BraveWebResponse,
    query: string,
    count: number,
    tookMs: number,
  ): string {
    const entries = data.web?.results ?? [];

    const results = entries.map((entry) => ({
      title: entry.title ?? "",
      url: entry.url ?? "",
      description: entry.description ?? "",
      published: entry.age ?? undefined,
      siteName: entry.url ? hostnameFromUrl(entry.url) : "",
    }));

    return JSON.stringify({
      query,
      provider: "brave",
      count: results.length,
      tookMs,
      results,
    });
  }

  private formatLlmContext(
    data: BraveLlmResponse,
    query: string,
    tookMs: number,
  ): string {
    const entries = data.grounding?.generic ?? [];

    const results = entries.map((entry) => ({
      url: entry.url ?? "",
      title: entry.title ?? "",
      snippets: entry.snippets ?? [],
      siteName: entry.url ? hostnameFromUrl(entry.url) : "",
    }));

    return JSON.stringify({
      query,
      provider: "brave",
      mode: "llm-context",
      count: results.length,
      tookMs,
      results,
      sources: data.sources ?? [],
    });
  }
}
