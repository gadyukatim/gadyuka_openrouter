import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedReference } from "./types.js";

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Resolve a reference input into the API wire shape.
 *
 * Accepts:
 *  - http(s) URL              → passed through as-is
 *  - data: URL                → passed through as-is
 *  - local filesystem path    → read, base64-encoded into a data URL
 */
export async function resolveReference(ref: string): Promise<ResolvedReference> {
  const trimmed = ref.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    return {
      api: { type: "image_url", image_url: { url: trimmed } },
      hash: sha256(trimmed),
      source: trimmed.length > 60 ? trimmed.slice(0, 57) + "…" : trimmed,
    };
  }

  if (/^data:/i.test(trimmed)) {
    return {
      api: { type: "image_url", image_url: { url: trimmed } },
      hash: sha256(trimmed),
      source: "data-url",
    };
  }

  // Local file.
  const abs = path.resolve(trimmed);
  const ext = path.extname(abs).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) {
    throw new Error(
      `Unsupported reference image type "${ext || "(none)"}" for ${trimmed}. ` +
        `Supported: ${Object.keys(MIME_BY_EXT).join(", ")}.`,
    );
  }
  let buf: Buffer;
  try {
    buf = await readFile(abs);
  } catch {
    throw new Error(`Reference image not found or unreadable: ${abs}`);
  }
  const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
  return {
    api: { type: "image_url", image_url: { url: dataUrl } },
    hash: sha256(buf),
    source: path.basename(abs),
  };
}

export async function resolveReferences(refs: string[] | undefined): Promise<ResolvedReference[]> {
  if (!refs || refs.length === 0) return [];
  return Promise.all(refs.map(resolveReference));
}
