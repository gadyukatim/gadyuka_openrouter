import type { Config } from "./config.js";
import type {
  GenerateRequest,
  ImageGenResponse,
  ImageModel,
  ModelEndpoints,
} from "./types.js";

export class OpenRouterError extends Error {
  status?: number;
  code?: string;
  body?: unknown;
  constructor(message: string, opts: { status?: number; code?: string; body?: unknown } = {}) {
    super(message);
    this.name = "OpenRouterError";
    this.status = opts.status;
    this.code = opts.code;
    this.body = opts.body;
  }
}

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class OpenRouterClient {
  constructor(private readonly cfg: Config) {}

  private headers(withAuth: boolean): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "HTTP-Referer": this.cfg.referer,
      "X-Title": this.cfg.title,
    };
    if (withAuth && this.cfg.apiKey) h.Authorization = `Bearer ${this.cfg.apiKey}`;
    return h;
  }

  /** Core fetch with timeout + retry on transient failures. */
  private async request(
    method: "GET" | "POST",
    pathname: string,
    body?: unknown,
    opts: { withAuth?: boolean; timeoutMs?: number } = {},
  ): Promise<Response> {
    const url = `${this.cfg.baseUrl}${pathname}`;
    const timeoutMs = opts.timeoutMs ?? this.cfg.timeoutMs;
    let lastErr: unknown;

    for (let attempt = 0; attempt <= this.cfg.maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          method,
          headers: this.headers(opts.withAuth ?? true),
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (res.ok) return res;

        // Retry transient statuses; otherwise surface a structured error.
        if (RETRYABLE_STATUS.has(res.status) && attempt < this.cfg.maxRetries) {
          await sleep(backoffMs(attempt, res));
          continue;
        }
        throw await toError(res);
      } catch (err) {
        lastErr = err;
        // Already-structured API errors are non-retryable.
        if (err instanceof OpenRouterError) throw err;
        // Network / abort errors: retry a couple of times.
        if (attempt < this.cfg.maxRetries) {
          await sleep(backoffMs(attempt));
          continue;
        }
        const reason = err instanceof Error ? err.message : String(err);
        throw new OpenRouterError(`Request to ${pathname} failed: ${reason}`, { code: "network" });
      }
    }
    throw lastErr instanceof Error ? lastErr : new OpenRouterError("Request failed");
  }

  /** GET /images/models — live catalog of image-output models. No auth required. */
  async listImageModels(): Promise<ImageModel[]> {
    const res = await this.request("GET", "/images/models", undefined, {
      withAuth: false,
      timeoutMs: 30_000,
    });
    const json = (await res.json()) as { data?: ImageModel[] };
    return json.data ?? [];
  }

  /** GET /images/models/{id}/endpoints — definitive per-provider caps + pricing. */
  async getModelEndpoints(modelId: string): Promise<ModelEndpoints> {
    const res = await this.request(
      "GET",
      `/images/models/${modelId}/endpoints`,
      undefined,
      { withAuth: false, timeoutMs: 30_000 },
    );
    return (await res.json()) as ModelEndpoints;
  }

  /** POST /images — generate. Blocks until the job is done (can be minutes). */
  async generateImages(req: GenerateRequest): Promise<ImageGenResponse> {
    if (!this.cfg.apiKey) {
      throw new OpenRouterError(
        "OPENROUTER_API_KEY is not set. Add your OpenRouter key to the MCP server env to generate images.",
        { code: "no_api_key" },
      );
    }
    const res = await this.request("POST", "/images", req);
    const json = (await res.json()) as ImageGenResponse;
    if (!json.data || json.data.length === 0) {
      throw new OpenRouterError("OpenRouter returned no image data.", { body: json });
    }
    return json;
  }
}

function backoffMs(attempt: number, res?: Response): number {
  const retryAfter = res?.headers.get("retry-after");
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs)) return Math.min(secs * 1000, 30_000);
  }
  return Math.min(500 * 2 ** attempt, 8_000);
}

async function toError(res: Response): Promise<OpenRouterError> {
  let body: unknown;
  let message = `${res.status} ${res.statusText}`;
  try {
    body = await res.json();
    const apiMsg = (body as any)?.error?.message ?? (body as any)?.message;
    if (apiMsg) message = `${res.status}: ${apiMsg}`;
  } catch {
    try {
      const text = await res.text();
      if (text) message = `${res.status}: ${text.slice(0, 500)}`;
    } catch {
      /* ignore */
    }
  }
  const code = (body as any)?.error?.code;
  return new OpenRouterError(message, { status: res.status, code, body });
}
