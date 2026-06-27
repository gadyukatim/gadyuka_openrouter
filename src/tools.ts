import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";
import type { OpenRouterClient } from "./openrouter.js";
import { Catalog, estimateCost } from "./catalog.js";
import {
  generateOne,
  resolveOutputDir,
  type GenerationDeps,
  type GenerationInput,
  type GenerationResult,
} from "./service.js";
import { formatBatch, formatGeneration, usd } from "./format.js";
import {
  clearBudget,
  getBudget,
  setBudget,
  summarizeUsage,
  type BudgetAction,
  type BudgetPeriod,
} from "./ledger.js";
import { cacheStats } from "./cache.js";
import type { ImageParams } from "./types.js";

/** Build a deterministic-ish env. `now` is injectable for tests. */
function makeDeps(cfg: Config, client: OpenRouterClient, catalog: Catalog): GenerationDeps {
  return { cfg, client, catalog, now: () => new Date() };
}

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function errorText(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
}

/** Shared param shape (pixels/quality/etc.) reused by single + batch tools. */
const paramShape = {
  resolution: z
    .string()
    .optional()
    .describe("Resolution tier: 512, 1K, 2K, or 4K. Model-dependent (Gemini/Seedream support it; GPT Image does not)."),
  aspect_ratio: z
    .string()
    .optional()
    .describe(
      "Aspect ratio / format. Allowed: 1:1, 9:16, 16:9, 4:5, 2:3, 3:4, 3:2, 4:3, 5:4, 21:9, 9:21, " +
        "1:2, 2:1, 1:4, 4:1, 1:8, 8:1, or 'auto'. Providers clamp to their own subset (check get_image_model). " +
        "GPT Image / GPT-5.x Image ignore this (square only) — use a Gemini/Seedream model for a specific format.",
    ),
  size: z.string().optional().describe("Shorthand for resolution+aspect, e.g. '2K' or '2048x2048'."),
  quality: z.enum(["auto", "low", "medium", "high"]).optional().describe("Quality tier (GPT Image etc.)."),
  output_format: z.enum(["png", "jpeg", "webp"]).optional().describe("Output file format."),
  background: z.enum(["auto", "transparent", "opaque"]).optional().describe("transparent requires png/webp."),
  output_compression: z.number().int().min(0).max(100).optional().describe("0–100 for webp/jpeg."),
  seed: z.number().int().optional().describe("Seed for reproducible output (where the model supports it)."),
};

function collectParams(a: Record<string, unknown>): ImageParams {
  return {
    n: a.n as number | undefined,
    resolution: a.resolution as string | undefined,
    aspect_ratio: a.aspect_ratio as string | undefined,
    size: a.size as string | undefined,
    quality: a.quality as string | undefined,
    output_format: a.output_format as string | undefined,
    background: a.background as string | undefined,
    output_compression: a.output_compression as number | undefined,
    seed: a.seed as number | undefined,
  };
}

export function registerTools(server: McpServer, cfg: Config, client: OpenRouterClient): void {
  const catalog = new Catalog(cfg, client);
  const deps = makeDeps(cfg, client, catalog);

  // ───────────────────────── list_image_models ─────────────────────────
  server.registerTool(
    "list_image_models",
    {
      title: "List image models",
      description:
        "List image-generation models available on OpenRouter (fetched live and cached). " +
        "Use this to discover model IDs and which parameters each one accepts before generating. " +
        "Optionally filter by a substring of the id/name.",
      inputSchema: {
        query: z.string().optional().describe("Case-insensitive filter over model id and name, e.g. 'flux' or 'gpt'."),
        refresh: z.boolean().optional().describe("Bypass the in-memory cache and refetch."),
      },
    },
    async (a) => {
      try {
        const models = await catalog.listModels(a.refresh ?? false);
        const q = a.query?.toLowerCase();
        const filtered = q
          ? models.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
          : models;
        if (filtered.length === 0) return text(`No image models match "${a.query}".`);
        const lines = filtered.map((m) => {
          const params = Object.keys(m.supported_parameters ?? {});
          const refs = params.includes("input_references") ? " · refs✓" : "";
          const nMax = (m.supported_parameters?.n as any)?.max;
          const nInfo = nMax ? ` · n≤${nMax}` : "";
          return `• ${m.id}\n    ${m.name}${nInfo}${refs}\n    params: ${params.join(", ") || "(none)"}`;
        });
        return text(
          `${filtered.length} image model(s) (default: ${cfg.defaultModel}):\n\n${lines.join("\n")}\n\n` +
            `Use get_image_model <id> for exact per-provider params + pricing.`,
        );
      } catch (e) {
        return errorText(e);
      }
    },
  );

  // ───────────────────────── get_image_model ─────────────────────────
  server.registerTool(
    "get_image_model",
    {
      title: "Get image model details",
      description:
        "Get the definitive per-provider capabilities and pricing for one image model. " +
        "Call this when you need to know exactly which params/values a model accepts and what it costs.",
      inputSchema: {
        model: z.string().describe("Model id, e.g. 'openai/gpt-image-2' or 'black-forest-labs/flux.2-pro'."),
      },
    },
    async (a) => {
      try {
        const [model, endpoints, est] = await Promise.all([
          catalog.getModel(a.model),
          catalog.getEndpoints(a.model),
          estimateCost(catalog, a.model, 1),
        ]);
        const lines: string[] = [];
        lines.push(`Model: ${a.model}${model ? ` — ${model.name}` : ""}`);
        if (model?.description) lines.push(model.description);
        if (model?.architecture) {
          lines.push(
            `Modalities: in [${(model.architecture.input_modalities ?? []).join(", ")}] → out [${(model.architecture.output_modalities ?? []).join(", ")}]`,
          );
        }
        lines.push(
          `Est. per-image cost: ${est.total != null ? usd(est.total) : est.note ?? "unknown"}`,
        );
        lines.push("");
        for (const ep of endpoints.endpoints ?? []) {
          const params = Object.entries(ep.supported_parameters ?? {})
            .map(([k, v]) => `${k}=${descShort(v)}`)
            .join(", ");
          const price = (ep.pricing ?? [])
            .map((p) => `${p.billable}:${usd(p.cost_usd)}/${p.unit}${p.variant ? `(${p.variant})` : ""}`)
            .join(", ");
          lines.push(`Provider ${ep.provider_name} [${ep.provider_slug}]`);
          lines.push(`  params: ${params || "(none)"}`);
          lines.push(`  pricing: ${price || "(none)"}`);
          if (ep.allowed_passthrough_parameters?.length) {
            lines.push(`  passthrough: ${ep.allowed_passthrough_parameters.join(", ")}`);
          }
        }
        return text(lines.join("\n"));
      } catch (e) {
        return errorText(e);
      }
    },
  );

  // ───────────────────────── generate_image ─────────────────────────
  server.registerTool(
    "generate_image",
    {
      title: "Generate image(s)",
      description:
        "Generate one or more images from a text prompt via OpenRouter, saving them to a local folder " +
        "(no base64 is returned to the chat). Supports reference images for image-to-image / style transfer, " +
        "and `n` to get several samples of the SAME prompt in a single call (preferred over batch when the " +
        "model supports n>1, e.g. GPT Image 2 allows n≤10). Results are cached: an identical request returns " +
        "the saved files for free. Generation can take from a few seconds up to ~3 minutes. " +
        "Set dry_run=true to estimate cost without spending.",
      inputSchema: {
        prompt: z.string().min(1).describe("What to generate. Be concrete: subject + setting + style + lighting."),
        model: z.string().optional().describe(`Model id. Defaults to ${cfg.defaultModel}. Use list_image_models to discover.`),
        n: z.number().int().min(1).max(10).optional().describe("Number of images in ONE call (model must support it)."),
        reference_images: z
          .array(z.string())
          .optional()
          .describe("Reference images for image-to-image / style. Each is a local file path, http(s) URL, or data URL."),
        ...paramShape,
        provider_options: z
          .record(z.string(), z.record(z.string(), z.any()))
          .optional()
          .describe("Provider-specific params keyed by provider slug, e.g. {\"black-forest-labs\":{\"steps\":40}}."),
        output_dir: z.string().optional().describe("Where to save. Defaults to a dated folder under the data dir."),
        label: z.string().optional().describe("Filename stem / label for the output files and manifest."),
        use_cache: z.boolean().optional().describe("Reuse a prior identical result for free. Default true."),
        force: z.boolean().optional().describe("Bypass cache AND budget block; always re-generate. Default false."),
        dry_run: z.boolean().optional().describe("Estimate cost only; do not generate or spend. Default false."),
      },
    },
    async (a) => {
      try {
        const now = deps.now();
        const outputDir = await resolveOutputDir(cfg, a.output_dir, now);
        const input: GenerationInput = {
          model: a.model ?? cfg.defaultModel,
          prompt: a.prompt,
          params: collectParams(a),
          references: a.reference_images,
          providerOptions: a.provider_options as Record<string, Record<string, unknown>> | undefined,
          outputDir,
          label: a.label,
          useCache: a.use_cache ?? true,
          force: a.force ?? false,
          dryRun: a.dry_run ?? false,
        };
        const result = await generateOne(deps, input);
        return text(formatGeneration(result));
      } catch (e) {
        return errorText(e);
      }
    },
  );

  // ───────────────────────── generate_batch ─────────────────────────
  server.registerTool(
    "generate_batch",
    {
      title: "Generate a batch / chain of images",
      description:
        "Generate many images in one go, each as a SEPARATE API call, run with limited concurrency. " +
        "Use this for: (a) several DIFFERENT prompts that share a style/reference, via `prompts`; or " +
        "(b) N varied samples of the SAME prompt, via `count` (each sample caches independently). " +
        "Note: for N samples of one prompt on a model that supports n>1, prefer generate_image with n=N " +
        "(one call, cheaper). Shared model/params/reference_images apply to every item. Partial failures are reported per item.",
      inputSchema: {
        prompts: z.array(z.string().min(1)).optional().describe("Distinct prompts. Mutually exclusive with prompt+count."),
        prompt: z.string().optional().describe("Base prompt used with `count` to make N varied samples."),
        count: z.number().int().min(1).max(50).optional().describe("How many samples of `prompt` to generate."),
        seed_start: z
          .number()
          .int()
          .optional()
          .describe("With `count`: starting seed; each sample uses seed_start+i for reproducible variety."),
        model: z.string().optional().describe(`Model id for all items. Defaults to ${cfg.defaultModel}.`),
        reference_images: z.array(z.string()).optional().describe("Shared reference images for every item."),
        ...paramShape,
        concurrency: z.number().int().min(1).max(8).optional().describe("Parallel in-flight requests. Default 3."),
        output_dir: z.string().optional().describe("Shared output folder. Defaults to a dated folder."),
        label: z.string().optional().describe("Base label; each item gets a numbered suffix."),
        use_cache: z.boolean().optional().describe("Reuse identical prior results. Default true."),
        force: z.boolean().optional().describe("Bypass cache + budget. Default false."),
        dry_run: z.boolean().optional().describe("Estimate total cost only. Default false."),
      },
    },
    async (a) => {
      try {
        if (!a.prompts && !(a.prompt && a.count)) {
          return errorText(new Error("Provide either `prompts` (a list) or `prompt` + `count`."));
        }
        const now = deps.now();
        const outputDir = await resolveOutputDir(cfg, a.output_dir, now);
        const model = a.model ?? cfg.defaultModel;
        const baseParams = collectParams(a);
        const baseLabel = a.label ?? a.prompt ?? "batch";

        // Build the work items.
        type Item = { prompt: string; label: string; params: ImageParams; variantSalt?: string };
        const items: Item[] = [];
        if (a.prompts) {
          a.prompts.forEach((p, i) =>
            items.push({ prompt: p, label: `${baseLabel}-${i + 1}`, params: { ...baseParams } }),
          );
        } else {
          const count = a.count!;
          for (let i = 0; i < count; i++) {
            const params = { ...baseParams };
            if (a.seed_start !== undefined) params.seed = a.seed_start + i;
            items.push({
              prompt: a.prompt!,
              label: `${baseLabel}-${i + 1}`,
              params,
              // No seed → identical request; salt keeps samples distinct in cache.
              variantSalt: params.seed === undefined ? String(i) : undefined,
            });
          }
        }

        const concurrency = a.concurrency ?? 3;
        const results = await mapPool<Item, GenerationResult | { error: string; label: string }>(
          items,
          concurrency,
          async (item) => {
            try {
              return await generateOne(deps, {
                model,
                prompt: item.prompt,
                params: item.params,
                references: a.reference_images,
                outputDir,
                label: item.label,
                useCache: a.use_cache ?? true,
                force: a.force ?? false,
                dryRun: a.dry_run ?? false,
                variantSalt: item.variantSalt,
              });
            } catch (e) {
              return { error: e instanceof Error ? e.message : String(e), label: item.label };
            }
          },
        );
        return text(formatBatch(results));
      } catch (e) {
        return errorText(e);
      }
    },
  );

  // ───────────────────────── get_usage ─────────────────────────
  server.registerTool(
    "get_usage",
    {
      title: "Get spend / usage",
      description:
        "Report image-generation spend tracked locally from each call's reported cost: totals, per-model breakdown, " +
        "cache savings, and how much of any active budget remains.",
      inputSchema: {
        period: z.enum(["day", "month", "total"]).optional().describe("Window for the budget figure. Default month."),
      },
    },
    async (a) => {
      try {
        const now = deps.now();
        const period = (a.period ?? "month") as BudgetPeriod;
        const [summary, budget, cache] = await Promise.all([
          summarizeUsage(cfg, now, period),
          getBudget(cfg),
          cacheStats(cfg),
        ]);
        const lines: string[] = [];
        lines.push(`Total spend (all time): ${usd(summary.totalCost)} over ${summary.totalCalls} call(s), ${summary.totalImages} image(s).`);
        lines.push(`Cache hits: ${summary.cacheHits} (${cache.entries} entries cached).`);
        lines.push(`This ${period}: ${usd(summary.periodCost)}.`);
        if (budget) {
          const remaining = budget.limitUsd - summary.periodCost;
          lines.push(
            `Budget: ${usd(budget.limitUsd)}/${budget.period} (${budget.action}) — ${usd(Math.max(0, remaining))} remaining.`,
          );
        } else {
          lines.push(`Budget: none set. Use set_budget to cap spend.`);
        }
        const models = Object.entries(summary.byModel).sort((x, y) => y[1].cost - x[1].cost);
        if (models.length) {
          lines.push("", "By model:");
          for (const [m, s] of models) lines.push(`  • ${m}: ${usd(s.cost)} (${s.images} img, ${s.calls} call)`);
        }
        return text(lines.join("\n"));
      } catch (e) {
        return errorText(e);
      }
    },
  );

  // ───────────────────────── set_budget ─────────────────────────
  server.registerTool(
    "set_budget",
    {
      title: "Set or clear spend budget",
      description:
        "Set a spending cap. With action='block', generations that would exceed the cap are refused (override per-call with force=true). " +
        "With action='warn', they proceed but are flagged. Pass limit_usd=0 to clear the budget.",
      inputSchema: {
        limit_usd: z.number().min(0).describe("USD cap for the period. 0 clears the budget."),
        period: z.enum(["day", "month", "total"]).optional().describe("Window the cap applies to. Default month."),
        action: z.enum(["warn", "block"]).optional().describe("warn = allow+flag, block = refuse. Default block."),
      },
    },
    async (a) => {
      try {
        const now = deps.now();
        if (a.limit_usd === 0) {
          await clearBudget(cfg);
          return text("Budget cleared.");
        }
        const b = await setBudget(cfg, a.limit_usd, (a.period ?? "month") as BudgetPeriod, (a.action ?? "block") as BudgetAction, now);
        return text(`Budget set: ${usd(b.limitUsd)}/${b.period} (${b.action}).`);
      } catch (e) {
        return errorText(e);
      }
    },
  );
}

function descShort(v: { type: string; values?: string[]; min?: number; max?: number }): string {
  if (v.type === "enum") return `[${(v.values ?? []).join("|")}]`;
  if (v.type === "range") return `${v.min}–${v.max}`;
  return "bool";
}

/** Run `fn` over `items` with at most `limit` concurrent executions. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}
