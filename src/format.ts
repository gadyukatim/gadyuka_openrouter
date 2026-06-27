import path from "node:path";
import type { GenerationResult } from "./service.js";

export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function usd(n: number): string {
  return `$${n.toFixed(4)}`;
}

/** Render a single generation result as concise agent-facing text. */
export function formatGeneration(r: GenerationResult): string {
  if (r.dryRun) {
    const est =
      r.estimate?.total != null
        ? `~${usd(r.estimate.total)} for ${r.n} image(s)`
        : `cost ${r.estimate?.note ?? "unknown"} for ${r.n} image(s)`;
    return [
      `Dry run — no image generated.`,
      `Model: ${r.model}`,
      `Estimate: ${est}`,
      `Cache: ${r.wouldHitCache ? "would HIT (free re-use)" : "would MISS (new generation)"}`,
    ].join("\n");
  }

  if (r.blocked) {
    return `⛔ Budget blocked. ${r.blockReason}`;
  }

  const lines: string[] = [];
  const dir = r.files[0] ? path.dirname(r.files[0].path) : "(none)";
  if (r.cached) {
    lines.push(`♻️ Cache hit — reused ${r.n} image(s) from a prior identical request. No charge.`);
  } else {
    lines.push(`✅ Generated ${r.n} image(s) with ${r.model} — ${usd(r.cost)}`);
  }
  lines.push(`Folder: ${dir}`);
  for (const f of r.files) {
    lines.push(`  • ${path.basename(f.path)} (${humanBytes(f.bytes)})`);
  }
  if (r.seed !== undefined) lines.push(`Seed: ${r.seed}`);
  if (r.manifestPath) lines.push(`Manifest: ${r.manifestPath}`);
  if (r.warning) lines.push(`⚠️ ${r.warning}`);
  return lines.join("\n");
}

export function formatBatch(results: Array<GenerationResult | { error: string; label: string }>): string {
  const ok = results.filter((r): r is GenerationResult => !("error" in r));
  const failed = results.filter((r): r is { error: string; label: string } => "error" in r);

  const totalImages = ok.reduce((s, r) => s + r.n, 0);
  const totalCost = ok.reduce((s, r) => s + r.cost, 0);
  const cacheHits = ok.filter((r) => r.cached).length;
  const dir = ok.find((r) => r.files[0])?.files[0]?.path;

  const lines: string[] = [];
  lines.push(
    `Batch done: ${ok.length}/${results.length} succeeded — ${totalImages} image(s), ${usd(totalCost)} total` +
      (cacheHits ? ` (${cacheHits} from cache)` : ""),
  );
  if (dir) lines.push(`Folder: ${path.dirname(dir)}`);
  for (const r of ok) {
    const tag = r.cached ? "♻️" : "✅";
    const files = r.files.map((f) => path.basename(f.path)).join(", ");
    lines.push(`  ${tag} ${files || "(no files)"} — ${usd(r.cost)}`);
  }
  for (const f of failed) {
    lines.push(`  ❌ ${f.label}: ${f.error}`);
  }
  return lines.join("\n");
}
