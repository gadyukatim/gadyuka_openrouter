import type { Config } from "./config.js";
import type { OpenRouterClient } from "./openrouter.js";
import type { ImageModel, ModelEndpoints } from "./types.js";

/**
 * In-memory, TTL'd cache of the live model catalog and per-model endpoint records.
 * The catalog changes often (new models ship weekly), so we never hardcode it —
 * we fetch live and cache for cfg.modelCacheTtlMs.
 */
interface Entry<T> {
  value: T;
  expires: number;
}

export class Catalog {
  private models: Entry<ImageModel[]> | null = null;
  private endpoints = new Map<string, Entry<ModelEndpoints>>();

  constructor(
    private readonly cfg: Config,
    private readonly client: OpenRouterClient,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async listModels(force = false): Promise<ImageModel[]> {
    if (!force && this.models && this.models.expires > this.now()) return this.models.value;
    const value = await this.client.listImageModels();
    this.models = { value, expires: this.now() + this.cfg.modelCacheTtlMs };
    return value;
  }

  async getModel(id: string): Promise<ImageModel | undefined> {
    const models = await this.listModels();
    return models.find((m) => m.id === id);
  }

  async getEndpoints(id: string, force = false): Promise<ModelEndpoints> {
    const cached = this.endpoints.get(id);
    if (!force && cached && cached.expires > this.now()) return cached.value;
    const value = await this.client.getModelEndpoints(id);
    this.endpoints.set(id, { value, expires: this.now() + this.cfg.modelCacheTtlMs });
    return value;
  }
}

export interface CostEstimate {
  /** Best-effort total USD for `n` images, or null when pricing is usage-based. */
  total: number | null;
  perImage: number | null;
  note?: string;
}

/**
 * Estimate the cost of generating `n` images. Uses the cheapest endpoint's
 * `output_image`/image pricing line. Returns null + a note for token- or
 * megapixel-billed models where the cost depends on resolution/output size.
 */
export async function estimateCost(
  catalog: Catalog,
  model: string,
  n: number,
): Promise<CostEstimate> {
  let endpoints: ModelEndpoints;
  try {
    endpoints = await catalog.getEndpoints(model);
  } catch {
    return { total: null, perImage: null, note: "pricing unavailable" };
  }

  let bestPerImage: number | null = null;
  let usageBased = false;

  for (const ep of endpoints.endpoints ?? []) {
    for (const line of ep.pricing ?? []) {
      if (line.billable === "output_image" && line.unit === "image") {
        if (bestPerImage === null || line.cost_usd < bestPerImage) bestPerImage = line.cost_usd;
      } else if (line.unit === "megapixel" || line.unit === "token") {
        usageBased = true;
      }
    }
  }

  if (bestPerImage !== null) {
    return { total: bestPerImage * n, perImage: bestPerImage };
  }
  return {
    total: null,
    perImage: null,
    note: usageBased ? "usage-based pricing (per token/megapixel) — cost depends on resolution" : "no per-image price published",
  };
}
