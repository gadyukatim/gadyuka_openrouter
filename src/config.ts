import os from "node:os";
import path from "node:path";

/**
 * Runtime configuration. Everything is overridable via environment variables so
 * the same build works for a local single-key setup today and a hosted/multi-key
 * deployment later (where the key is injected per request instead of from env).
 */
export interface Config {
  /** OpenRouter API key. Undefined is allowed: model discovery works without it. */
  apiKey: string | undefined;
  /** API base, e.g. https://openrouter.ai/api/v1 */
  baseUrl: string;
  /** Root dir for cache, ledger and budget state. */
  dataDir: string;
  /** Where generated images and manifests are written by default. */
  outputsDir: string;
  cacheDir: string;
  ledgerPath: string;
  budgetPath: string;
  /** Model used when a tool call omits `model`. */
  defaultModel: string;
  /** Per-request HTTP timeout. Image jobs can take 1–3 min, so this is generous. */
  timeoutMs: number;
  /** Retries on 429 / 5xx with exponential backoff. */
  maxRetries: number;
  /** Sent as HTTP-Referer / X-Title — shows up in OpenRouter dashboards. */
  referer: string;
  title: string;
  /** TTL for the cached live model catalog. */
  modelCacheTtlMs: number;
}

function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(): Config {
  const dataDir =
    process.env.GADYUKA_DATA_DIR || path.join(os.homedir(), ".gadyuka_openrouter");

  const outputsDir = process.env.GADYUKA_OUTPUT_DIR || path.join(dataDir, "outputs");

  return {
    apiKey: process.env.OPENROUTER_API_KEY?.trim() || undefined,
    baseUrl: (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
    dataDir,
    outputsDir,
    cacheDir: path.join(dataDir, "cache"),
    ledgerPath: path.join(dataDir, "ledger.jsonl"),
    budgetPath: path.join(dataDir, "budget.json"),
    defaultModel: process.env.GADYUKA_MODEL || "openai/gpt-image-2",
    timeoutMs: envNum("GADYUKA_TIMEOUT_MS", 300_000),
    maxRetries: envNum("GADYUKA_MAX_RETRIES", 2),
    referer: process.env.GADYUKA_REFERER || "https://github.com/gadyuka_openrouter",
    title: process.env.GADYUKA_TITLE || "gadyuka_openrouter",
    modelCacheTtlMs: envNum("GADYUKA_MODEL_CACHE_TTL_MS", 30 * 60_000),
  };
}
