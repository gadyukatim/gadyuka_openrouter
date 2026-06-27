import { readFile, writeFile, appendFile } from "node:fs/promises";
import type { Config } from "./config.js";
import { ensureDir } from "./storage.js";
import path from "node:path";

export interface LedgerEntry {
  ts: string; // ISO timestamp
  model: string;
  n: number;
  cost: number; // actual USD charged (0 for cache hits)
  cached: boolean;
  cacheKey?: string;
  promptExcerpt: string;
}

export type BudgetAction = "warn" | "block";
export type BudgetPeriod = "day" | "month" | "total";

export interface Budget {
  limitUsd: number;
  period: BudgetPeriod;
  action: BudgetAction;
  updatedAt: string;
}

/** Append one generation to the JSONL ledger. */
export async function recordEntry(cfg: Config, entry: LedgerEntry): Promise<void> {
  await ensureDir(path.dirname(cfg.ledgerPath));
  await appendFile(cfg.ledgerPath, JSON.stringify(entry) + "\n", "utf8");
}

export async function readLedger(cfg: Config): Promise<LedgerEntry[]> {
  let raw: string;
  try {
    raw = await readFile(cfg.ledgerPath, "utf8");
  } catch {
    return [];
  }
  const out: LedgerEntry[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as LedgerEntry);
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

function periodStart(period: BudgetPeriod, now: Date): Date {
  if (period === "total") return new Date(0);
  if (period === "day") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return new Date(now.getFullYear(), now.getMonth(), 1); // month
}

export interface UsageSummary {
  totalCost: number;
  totalImages: number;
  totalCalls: number;
  cacheHits: number;
  byModel: Record<string, { cost: number; images: number; calls: number }>;
  periodCost: number;
  period: BudgetPeriod | null;
  since: string | null;
}

export async function summarizeUsage(
  cfg: Config,
  now: Date,
  period: BudgetPeriod | null,
): Promise<UsageSummary> {
  const entries = await readLedger(cfg);
  const start = period ? periodStart(period, now) : null;
  const byModel: UsageSummary["byModel"] = {};
  let totalCost = 0,
    totalImages = 0,
    cacheHits = 0,
    periodCost = 0;

  for (const e of entries) {
    totalCost += e.cost;
    totalImages += e.n;
    if (e.cached) cacheHits++;
    const m = (byModel[e.model] ??= { cost: 0, images: 0, calls: 0 });
    m.cost += e.cost;
    m.images += e.n;
    m.calls++;
    if (start && new Date(e.ts) >= start) periodCost += e.cost;
  }

  return {
    totalCost,
    totalImages,
    totalCalls: entries.length,
    cacheHits,
    byModel,
    periodCost,
    period,
    since: start ? start.toISOString() : null,
  };
}

export async function getBudget(cfg: Config): Promise<Budget | null> {
  try {
    return JSON.parse(await readFile(cfg.budgetPath, "utf8")) as Budget;
  } catch {
    return null;
  }
}

export async function setBudget(
  cfg: Config,
  limitUsd: number,
  period: BudgetPeriod,
  action: BudgetAction,
  now: Date,
): Promise<Budget> {
  await ensureDir(path.dirname(cfg.budgetPath));
  const budget: Budget = { limitUsd, period, action, updatedAt: now.toISOString() };
  await writeFile(cfg.budgetPath, JSON.stringify(budget, null, 2), "utf8");
  return budget;
}

export async function clearBudget(cfg: Config): Promise<void> {
  try {
    await writeFile(cfg.budgetPath, JSON.stringify(null), "utf8");
  } catch {
    /* ignore */
  }
}

export interface BudgetCheck {
  allowed: boolean;
  budget: Budget | null;
  spentThisPeriod: number;
  projected: number;
  reason?: string;
}

/**
 * Decide whether a generation costing ~`estimatedCost` may proceed.
 * `block` budgets refuse when the projected spend would exceed the limit;
 * `warn` budgets always allow but flag the overage.
 */
export async function checkBudget(
  cfg: Config,
  estimatedCost: number,
  now: Date,
): Promise<BudgetCheck> {
  const budget = await getBudget(cfg);
  if (!budget) return { allowed: true, budget: null, spentThisPeriod: 0, projected: estimatedCost };

  const summary = await summarizeUsage(cfg, now, budget.period);
  const spent = summary.periodCost;
  const projected = spent + estimatedCost;
  const over = projected > budget.limitUsd;

  if (over && budget.action === "block") {
    return {
      allowed: false,
      budget,
      spentThisPeriod: spent,
      projected,
      reason:
        `Budget exceeded: $${spent.toFixed(4)} already spent this ${budget.period}, ` +
        `projected $${projected.toFixed(4)} > limit $${budget.limitUsd.toFixed(2)}. ` +
        `Raise the limit with set_budget or pass force=true to override.`,
    };
  }
  return {
    allowed: true,
    budget,
    spentThisPeriod: spent,
    projected,
    reason: over ? `Warning: projected spend $${projected.toFixed(4)} exceeds budget $${budget.limitUsd.toFixed(2)}.` : undefined,
  };
}
