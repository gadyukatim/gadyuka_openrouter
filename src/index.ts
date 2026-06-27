#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { OpenRouterClient } from "./openrouter.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const client = new OpenRouterClient(cfg);

  const server = new McpServer(
    { name: "gadyuka_openrouter", version: "0.1.0" },
    {
      instructions:
        "gadyuka_openrouter: generate images via OpenRouter and save them locally. " +
        "Discover models with list_image_models / get_image_model, generate with generate_image " +
        "(use `n` for multiple samples of one prompt, `reference_images` for image-to-image), " +
        "fan out with generate_batch, and track spend with get_usage / set_budget. " +
        "Images are written to disk and only file paths are returned — never expect base64 in the chat. " +
        "This server creates still images only (for social posts, websites, marketing, etc.).",
    },
  );

  registerTools(server, cfg, client);

  // stderr only: stdout is the MCP transport channel and must stay clean.
  process.stderr.write(
    `gadyuka_openrouter ready (default model: ${cfg.defaultModel}, data dir: ${cfg.dataDir}` +
      `${cfg.apiKey ? "" : ", WARNING: OPENROUTER_API_KEY not set — generation disabled"})\n`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
