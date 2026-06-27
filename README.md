# gadyuka_openrouter

**English** · [Русский](README.ru.md)

An **MCP server** that lets AI agents create images through the
[OpenRouter Image API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation) —
across **any** image model OpenRouter offers — with built-in **cost tracking**, **caching**,
**batches/chains**, and **reference-image (image-to-image)** support.

Point it at one OpenRouter API key and your agent can generate visuals on demand — social posts,
website heroes, blog headers, product and marketing images — switch models, follow a budget, and
reuse prior results for free.

> Status: **foundation (v0.1)** — local `stdio` server, single key, **still-image generation only**.
> Multi-tenant HTTP transport with per-user key issuance is on the roadmap (see below).

---

## Features

- **Any image model** — the catalog is fetched **live** from OpenRouter and cached, never hardcoded
  (GPT Image 2, Nano Banana 2 / Pro, FLUX.2, Seedream 4.5, Recraft, Riverflow, GPT-5.x Image, …).
- **Save to disk + manifest** — images are written to a folder; the agent gets file paths + metadata
  (model, cost, seed), not heavy base64 in the chat.
- **Cost & budget tracking** — every call's real cost is recorded to a local ledger; set a
  daily/monthly/total cap that warns or blocks.
- **Caching** — an identical request (model + prompt + params + reference bytes) returns the saved
  files for free, no second charge.
- **Batches / chains** — many prompts, or many varied samples of one prompt, with bounded concurrency;
  partial failures reported per item.
- **Reference images** — image-to-image / style transfer from local paths, URLs, or data URLs.
- **Long jobs** — generation can take seconds to ~3 minutes; the client waits with a generous timeout.

## Install

```bash
npm install
npm run build
```

## Configure your MCP client

Add the server to your agent. Example (generic MCP `stdio` config — works with Cursor, VS Code, and any MCP client):

```json
{
  "mcpServers": {
    "gadyuka_openrouter": {
      "command": "node",
      "args": ["/absolute/path/to/gadyuka_openrouter/dist/index.js"],
      "env": {
        "OPENROUTER_API_KEY": "sk-or-..."
      }
    }
  }
}
```

The only required setting is your OpenRouter key. Everything else has sane defaults.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | — | **Required to generate.** Model discovery works without it. |
| `GADYUKA_MODEL` | `openai/gpt-image-2` | Default model when a call omits `model`. |
| `GADYUKA_DATA_DIR` | `~/.gadyuka_openrouter` | Root for cache, ledger, budget. |
| `GADYUKA_OUTPUT_DIR` | `<data dir>/outputs` | Default folder images are written to. |
| `GADYUKA_TIMEOUT_MS` | `300000` | Per-request timeout (slow models can take minutes). |
| `GADYUKA_MAX_RETRIES` | `2` | Retries on 429/5xx with backoff. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | API base. |

## Tools

| Tool | What it does |
|---|---|
| `list_image_models` | List image models (live + cached), optional substring filter. |
| `get_image_model` | Definitive per-provider params + pricing for one model. |
| `generate_image` | Generate 1–N images from a prompt (+ optional reference images). Saves to disk. |
| `generate_batch` | Many prompts, or N varied samples of one prompt, run concurrently. |
| `get_usage` | Spend totals, per-model breakdown, cache savings, budget remaining. |
| `set_budget` | Set/clear a spend cap (`warn` or `block`). |

See the agent-facing usage guide in
[`skills/gadyuka-openrouter/SKILL.md`](skills/gadyuka-openrouter/SKILL.md).

### Quick examples (tool arguments)

Single, high-fidelity image:
```json
{ "name": "generate_image", "arguments": { "prompt": "neon city at dusk, cinematic", "aspect_ratio": "16:9" } }
```

10 samples in one call (model must support `n>1`, e.g. GPT Image 2):
```json
{ "name": "generate_image", "arguments": { "prompt": "minimalist logo, single line", "n": 10 } }
```

"Same style across several posts" via batch (distinct prompts, shared reference):
```json
{ "name": "generate_batch", "arguments": {
  "prompts": ["instagram square hero", "story 9:16", "website banner 16:9"],
  "reference_images": ["/path/to/style-ref.jpg"],
  "model": "google/gemini-3.1-flash-image-preview"
} }
```

Estimate before spending:
```json
{ "name": "generate_image", "arguments": { "prompt": "...", "model": "bytedance-seed/seedream-4.5", "n": 4, "dry_run": true } }
```

## Demo

<!-- DEMO:START -->
Real images, generated **through this MCP server** from a style reference + a character photo, each
branded with the on-image caption **“MADE WITH MCP GADYUKA_OPENROUTER”**. One local run, 4 models,
10 images, **`$0.77` total** — tracked by the built-in cost ledger.

| 9:16 (Gemini 3 Pro) | 1:1 (GPT-5.4 Image) | 16:9 (Gemini Flash) |
|---|---|---|
| <img src="demo/gadyuka-pro-vertical.png" width="150"> | <img src="demo/gadyuka-gpt54-square.png" width="260"> | <img src="demo/gadyuka-flash2-wide.png" width="300"> |

➡️ **Full gallery, inputs, per-model cost breakdown and how it was made: [`demo/README.md`](demo/README.md).**
<!-- DEMO:END -->

## How caching works

The cache key is a content hash of `model + prompt + pixel-affecting params + reference bytes`
(+ a per-sample salt for batch samples that share an identical request). A hit copies the saved
files into your output folder and records `$0.00`. Pass `force: true` to bypass the cache (and any
budget block) and always re-generate. Use a `seed` to make a request reproducible.

## Cost notes

Cost is read from each response's `usage.cost` and appended to a JSONL ledger.
Pre-flight estimates (`dry_run`, budget gating) use the model's per-image price where one is
published; **token/megapixel-billed models (e.g. GPT Image 2, Gemini Image) can't be pre-estimated** —
their real cost is still recorded after the call. Per-image-priced models (Seedream, FLUX, …) estimate cleanly.

## Tests

```bash
npm test           # offline pipeline test (fake client): save → cache hit → force → ledger
npm run test:live  # boots the server, lists models live, dry-run estimate (no spend)
```

## Roadmap

- Streaming partial images (`stream: true`) for progressive previews.
- HTTP/SSE transport + multi-tenant **API-key issuance and access control** (auth layer).
- Per-key budgets and usage reporting.
- More media types (video/audio) once the image foundation is solid.

## License

MIT
