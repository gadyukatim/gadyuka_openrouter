import { createHash } from "node:crypto";
import { copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config.js";
import { ensureDir } from "./storage.js";
import type { ImageParams, SavedImage } from "./types.js";

export interface CacheMeta {
  model: string;
  prompt: string;
  params: ImageParams;
  referenceHashes: string[];
  files: string[]; // filenames inside the cache dir
  mediaTypes: string[];
  cost: number; // original cost when first generated
  createdAt: string;
}

/**
 * A cache key is a content hash of everything that affects the output:
 * model + prompt + the params that change pixels + reference image bytes.
 * Seed is included on purpose — same seed should reuse, different seed should not.
 */
export function computeCacheKey(
  model: string,
  prompt: string,
  params: ImageParams,
  referenceHashes: string[],
  /**
   * Distinguishes intentionally-different samples of an otherwise identical
   * request (e.g. item #3 in a batch of 10 with no seed). Without it, those
   * samples would collide on one key and collapse to a single cached image.
   */
  variantSalt?: string,
): string {
  const canonical = JSON.stringify({
    model,
    prompt: prompt.trim(),
    params: sortedParams(params),
    refs: [...referenceHashes].sort(),
    ...(variantSalt ? { variant: variantSalt } : {}),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function sortedParams(params: ImageParams): Record<string, unknown> {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  entries.sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}

function cacheEntryDir(cfg: Config, key: string): string {
  return path.join(cfg.cacheDir, key);
}

/** Look up a cached entry. Returns null on miss. */
export async function lookupCache(cfg: Config, key: string): Promise<CacheMeta | null> {
  try {
    const metaPath = path.join(cacheEntryDir(cfg, key), "meta.json");
    const raw = await readFile(metaPath, "utf8");
    return JSON.parse(raw) as CacheMeta;
  } catch {
    return null;
  }
}

/** Store freshly generated images (already written under the cache dir as canonical copies). */
export async function storeCache(
  cfg: Config,
  key: string,
  meta: CacheMeta,
): Promise<void> {
  const dir = cacheEntryDir(cfg, key);
  await ensureDir(dir);
  await writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
}

/** Directory where canonical cache copies of images live for a key. */
export function cacheDirFor(cfg: Config, key: string): string {
  return cacheEntryDir(cfg, key);
}

/** Copy cached image files into `outputDir`, renaming to the requested stem. */
export async function copyCachedTo(
  cfg: Config,
  meta: CacheMeta,
  key: string,
  outputDir: string,
  stem: string,
): Promise<SavedImage[]> {
  await ensureDir(outputDir);
  const dir = cacheEntryDir(cfg, key);
  const multiple = meta.files.length > 1;
  const out: SavedImage[] = [];

  for (let i = 0; i < meta.files.length; i++) {
    const src = path.join(dir, meta.files[i]!);
    const ext = path.extname(meta.files[i]!);
    const name = multiple ? `${stem}-${String(i + 1).padStart(2, "0")}${ext}` : `${stem}${ext}`;
    const dest = path.join(outputDir, name);
    await copyFile(src, dest);
    const buf = await readFile(dest);
    out.push({ path: dest, bytes: buf.length, mediaType: meta.mediaTypes[i] ?? "image/png" });
  }
  return out;
}

/** Rough stats for diagnostics. */
export async function cacheStats(cfg: Config): Promise<{ entries: number }> {
  try {
    const dirs = await readdir(cfg.cacheDir, { withFileTypes: true });
    return { entries: dirs.filter((d) => d.isDirectory()).length };
  } catch {
    return { entries: 0 };
  }
}
