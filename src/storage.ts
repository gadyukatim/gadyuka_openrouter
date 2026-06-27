import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImageDatum, SavedImage } from "./types.js";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

/** Pick a file extension. Raster PNG omits media_type, so default to png. */
function extFor(datum: ImageDatum): string {
  if (datum.media_type && EXT_BY_MIME[datum.media_type]) return EXT_BY_MIME[datum.media_type]!;
  return "png";
}

/** Sanitize a user-provided label into a safe filename stem. */
export function slugify(input: string, fallback = "image"): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || fallback;
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/**
 * Write a batch of generated images to `dir` with the given filename stem.
 * Returns absolute paths and byte sizes.
 */
export async function saveImages(
  dir: string,
  stem: string,
  data: ImageDatum[],
): Promise<SavedImage[]> {
  await ensureDir(dir);
  const multiple = data.length > 1;
  const out: SavedImage[] = [];

  for (let i = 0; i < data.length; i++) {
    const datum = data[i]!;
    const ext = extFor(datum);
    const name = multiple ? `${stem}-${String(i + 1).padStart(2, "0")}.${ext}` : `${stem}.${ext}`;
    const filePath = path.join(dir, name);
    const buf = Buffer.from(datum.b64_json, "base64");
    await writeFile(filePath, buf);
    out.push({ path: filePath, bytes: buf.length, mediaType: datum.media_type ?? "image/png" });
  }
  return out;
}

/** Write a JSON manifest next to the images describing the generation. */
export async function writeManifest(dir: string, name: string, manifest: unknown): Promise<string> {
  await ensureDir(dir);
  const p = path.join(dir, name);
  await writeFile(p, JSON.stringify(manifest, null, 2), "utf8");
  return p;
}
