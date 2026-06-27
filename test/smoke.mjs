// Live smoke test: boots the server over stdio as a real MCP client and
// exercises the read-only / dry-run tools. Hits the OpenRouter models API
// (no auth, no spend). Run: npm run test:live
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  cwd: projectRoot,
  env: { ...process.env, GADYUKA_DATA_DIR: "/tmp/gadyuka-smoke" },
});

const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(transport);
const sep = (t) => console.log(`\n===== ${t} =====`);

sep("TOOLS");
const tools = await client.listTools();
console.log(tools.tools.map((t) => `${t.name} — ${t.title}`).join("\n"));

sep("list_image_models query=flux");
console.log((await client.callTool({ name: "list_image_models", arguments: { query: "flux" } })).content[0].text);

sep("generate_image dry_run (Seedream — per-image pricing)");
console.log((await client.callTool({ name: "generate_image", arguments: { prompt: "a red panda astronaut", model: "bytedance-seed/seedream-4.5", n: 4, dry_run: true } })).content[0].text);

await client.close();
console.log("\nOK");
process.exit(0);
