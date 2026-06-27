import path from "node:path";
import type { Config } from "./config.js";
import type { OpenRouterClient } from "./openrouter.js";
import { Catalog, estimateCost, type CostEstimate } from "./catalog.js";
import { resolveReferences } from "./references.js";
import {
  computeCacheKey,
  copyCachedTo,
  lookupCache,
  storeCache,
  type CacheMeta,
} from "./cache.js";
import { saveImages, writeManifest, slugify, ensureDir } from "./storage.js";
import { checkBudget, recordEntry } from "./ledger.js";
import type { GenerateRequest, ImageParams, SavedImage } from "./types.js";

export interface GenerationDeps {
  cfg: Config;
  client: OpenRouterClient;
  catalog: Catalog;
  now: () => Date;
}

export interface GenerationInput {
  model: string;
  prompt: string;
  params: ImageParams;
  references?: string[];
  providerOptions?: Record<string, Record<string, unknown>>;
  /** Directory to write images + manifest into. */
  outputDir: string;
  /** Filename stem / label. */
  label?: string;
  useCache: boolean;
  /** Bypass cache write/read AND budget block. */
  force: boolean;
  /** Estimate only — no API call, no spend. */
  dryRun: boolean;
  /** Distinguishes identical-request samples in a batch so they cache separately. */
  variantSalt?: string;
}

export interface GenerationResult {
  model: string;
  prompt: string;
  files: SavedImage[];
  n: number;
  cost: number;
  cached: boolean;
  cacheKey: string;
  manifestPath?: string;
  seed?: number;
  estimate?: CostEstimate;
  warning?: string;
  dryRun?: boolean;
  wouldHitCache?: boolean;
  /** Set when the budget blocked the call (allowed=false). */
  blocked?: boolean;
  blockReason?: string;
}

/** Run a single generation through cache → budget → API → save → ledger. */
export async function generateOne(
  deps: GenerationDeps,
  input: GenerationInput,
): Promise<GenerationResult> {
  const { cfg, client, catalog, now } = deps;
  const n = input.params.n ?? 1;
  const stem = slugify(input.label ?? input.prompt);

  const refs = await resolveReferences(input.references);
  const refApis = refs.map((r) => r.api);
  const refHashes = refs.map((r) => r.hash);
  const cacheKey = computeCacheKey(input.model, input.prompt, input.params, refHashes, input.variantSalt);

  // --- Dry run: estimate only ---
  if (input.dryRun) {
    const estimate = await estimateCost(catalog, input.model, n);
    const hit = input.useCache ? (await lookupCache(cfg, cacheKey)) !== null : false;
    return {
      model: input.model,
      prompt: input.prompt,
      files: [],
      n,
      cost: 0,
      cached: false,
      cacheKey,
      estimate,
      dryRun: true,
      wouldHitCache: hit,
    };
  }

  // --- Cache hit ---
  if (input.useCache && !input.force) {
    const meta = await lookupCache(cfg, cacheKey);
    if (meta) {
      const files = await copyCachedTo(cfg, meta, cacheKey, input.outputDir, stem);
      const manifestPath = await writeManifest(
        input.outputDir,
        `${stem}.manifest.json`,
        buildManifest(input, files, meta.cost, true, cacheKey, refs),
      );
      await recordEntry(cfg, {
        ts: now().toISOString(),
        model: input.model,
        n: files.length,
        cost: 0,
        cached: true,
        cacheKey,
        promptExcerpt: excerpt(input.prompt),
      });
      return {
        model: input.model,
        prompt: input.prompt,
        files,
        n: files.length,
        cost: 0,
        cached: true,
        cacheKey,
        manifestPath,
        seed: input.params.seed,
      };
    }
  }

  // --- Budget gate ---
  const estimate = await estimateCost(catalog, input.model, n);
  let warning: string | undefined;
  if (!input.force) {
    const check = await checkBudget(cfg, estimate.total ?? 0, now());
    if (!check.allowed) {
      return {
        model: input.model,
        prompt: input.prompt,
        files: [],
        n,
        cost: 0,
        cached: false,
        cacheKey,
        estimate,
        blocked: true,
        blockReason: check.reason,
      };
    }
    warning = check.reason;
  }

  // --- Generate ---
  const req: GenerateRequest = {
    model: input.model,
    prompt: input.prompt,
    ...stripUndefined(input.params),
    ...(refApis.length ? { input_references: refApis } : {}),
    ...(input.providerOptions ? { provider: { options: input.providerOptions } } : {}),
  };
  const res = await client.generateImages(req);
  const cost = res.usage?.cost ?? estimate.total ?? 0;

  // Canonical copies live in the cache dir; the output dir gets renamed copies.
  const cacheImageDir = path.join(cfg.cacheDir, cacheKey);
  const canonical = await saveImages(cacheImageDir, "img", res.data);
  const meta: CacheMeta = {
    model: input.model,
    prompt: input.prompt,
    params: input.params,
    referenceHashes: refHashes,
    files: canonical.map((c) => path.basename(c.path)),
    mediaTypes: canonical.map((c) => c.mediaType),
    cost,
    createdAt: now().toISOString(),
  };
  if (input.useCache) await storeCache(cfg, cacheKey, meta);

  const files = await copyCachedTo(cfg, meta, cacheKey, input.outputDir, stem);
  const manifestPath = await writeManifest(
    input.outputDir,
    `${stem}.manifest.json`,
    buildManifest(input, files, cost, false, cacheKey, refs),
  );

  await recordEntry(cfg, {
    ts: now().toISOString(),
    model: input.model,
    n: files.length,
    cost,
    cached: false,
    cacheKey,
    promptExcerpt: excerpt(input.prompt),
  });

  return {
    model: input.model,
    prompt: input.prompt,
    files,
    n: files.length,
    cost,
    cached: false,
    cacheKey,
    manifestPath,
    seed: input.params.seed,
    estimate,
    warning,
  };
}

function buildManifest(
  input: GenerationInput,
  files: SavedImage[],
  cost: number,
  cached: boolean,
  cacheKey: string,
  refs: { source: string; hash: string }[],
) {
  return {
    model: input.model,
    prompt: input.prompt,
    params: stripUndefined(input.params),
    references: refs.map((r) => ({ source: r.source, hash: r.hash })),
    providerOptions: input.providerOptions ?? null,
    files: files.map((f) => ({ path: f.path, bytes: f.bytes, mediaType: f.mediaType })),
    cost,
    cached,
    cacheKey,
  };
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) out[k] = v;
  return out as Partial<T>;
}

function excerpt(s: string, len = 120): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > len ? t.slice(0, len - 1) + "…" : t;
}

/** Resolve an output directory: explicit override, or a dated subfolder of the default. */
export async function resolveOutputDir(cfg: Config, override: string | undefined, now: Date): Promise<string> {
  if (override) {
    const abs = path.resolve(override);
    await ensureDir(abs);
    return abs;
  }
  const day = now.toISOString().slice(0, 10);
  const dir = path.join(cfg.outputsDir, day);
  await ensureDir(dir);
  return dir;
}
