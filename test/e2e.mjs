// Offline end-to-end test of the generation pipeline with a FAKE OpenRouter
// client. No API key, no spend, no network. Run: npm test
import { mkdtempSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Catalog } from "../dist/catalog.js";
import { generateOne, resolveOutputDir } from "../dist/service.js";
import { summarizeUsage } from "../dist/ledger.js";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAACQF4VFAAAAAElFTkSuQmCC";

const dataDir = mkdtempSync(path.join(tmpdir(), "orimg-e2e-"));
const cfg = {
  apiKey: "fake", baseUrl: "http://x", dataDir,
  outputsDir: path.join(dataDir, "outputs"),
  cacheDir: path.join(dataDir, "cache"),
  ledgerPath: path.join(dataDir, "ledger.jsonl"),
  budgetPath: path.join(dataDir, "budget.json"),
  defaultModel: "fake/model", timeoutMs: 1000, maxRetries: 0,
  referer: "x", title: "x", modelCacheTtlMs: 60000,
};

let generateCalls = 0;
const fakeClient = {
  async listImageModels() {
    return [{ id: "fake/model", name: "Fake", supported_parameters: { n: { type: "range", min: 1, max: 10 } } }];
  },
  async getModelEndpoints() {
    return { id: "fake/model", endpoints: [{ provider_name: "Fake", provider_slug: "fake", pricing: [{ billable: "output_image", unit: "image", cost_usd: 0.02 }] }] };
  },
  async generateImages(req) {
    generateCalls++;
    const n = req.n ?? 1;
    return { created: 1, data: Array.from({ length: n }, () => ({ b64_json: PNG })), usage: { cost: 0.02 * n } };
  },
};

const catalog = new Catalog(cfg, fakeClient);
const deps = { cfg, client: fakeClient, catalog, now: () => new Date("2026-06-27T12:00:00Z") };

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error("❌ FAIL:", msg); failures++; } else console.log("✓", msg);
}

const outDir = await resolveOutputDir(cfg, undefined, deps.now());

const r1 = await generateOne(deps, { model: "fake/model", prompt: "a calm lake", params: { n: 2 }, outputDir: outDir, label: "lake", useCache: true, force: false, dryRun: false });
assert(!r1.cached, "first call is a cache miss");
assert(r1.files.length === 2, "wrote 2 files");
assert(r1.files.every((f) => existsSync(f.path) && statSync(f.path).size > 0), "both files exist and non-empty");
assert(Math.abs(r1.cost - 0.04) < 1e-9, "cost = $0.04 (2 × $0.02)");
assert(generateCalls === 1, "API called once");
assert(existsSync(r1.manifestPath), "manifest written");
const manifest = JSON.parse(readFileSync(r1.manifestPath, "utf8"));
assert(manifest.files.length === 2 && manifest.cost === 0.04, "manifest has files + cost");

const r2 = await generateOne(deps, { model: "fake/model", prompt: "a calm lake", params: { n: 2 }, outputDir: outDir, label: "lake-again", useCache: true, force: false, dryRun: false });
assert(r2.cached, "second identical call is a cache HIT");
assert(r2.cost === 0, "cache hit costs $0");
assert(generateCalls === 1, "API NOT called again on cache hit");
assert(r2.files.length === 2 && r2.files.every((f) => existsSync(f.path)), "cache hit copied 2 files to output");

const r3 = await generateOne(deps, { model: "fake/model", prompt: "a stormy sea", params: { n: 1 }, outputDir: outDir, label: "sea", useCache: true, force: false, dryRun: false });
assert(!r3.cached && generateCalls === 2, "different prompt triggers a new generation");

const r4 = await generateOne(deps, { model: "fake/model", prompt: "a calm lake", params: { n: 2 }, outputDir: outDir, label: "lake-forced", useCache: true, force: true, dryRun: false });
assert(!r4.cached && generateCalls === 3, "force=true bypasses cache and re-generates");

const usage = await summarizeUsage(cfg, deps.now(), "month");
assert(Math.abs(usage.totalCost - 0.10) < 1e-9, `total spend == $0.10 (got $${usage.totalCost.toFixed(2)})`);
assert(usage.cacheHits === 1, "one cache hit recorded");
assert(usage.totalImages === 7, "7 images total across calls");

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log("\nALL E2E CHECKS PASSED.");
process.exit(0);
