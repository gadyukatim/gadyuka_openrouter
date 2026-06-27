---
version: 0.1.0
name: gadyuka-openrouter
description: |
  Create still images for social posts, websites, blogs, ads and marketing via the
  gadyuka_openrouter MCP server (OpenRouter Image API), across any image model — GPT
  Image 2, Nano Banana 2/Pro, Gemini 3 Pro Image, GPT-5.x Image, FLUX.2, Seedream 4.5,
  Recraft (vector/logo), and more. Use when: "make an image for a post", "instagram /
  story / banner visual", "website hero image", "blog header", "product shot",
  "ad creative", "image-to-image / restyle this photo", "in this style from a reference",
  "create N variations", "logo / icon / vector", "create 10 images in this style".
  Supports reference images (image-to-image / style + character), multiple samples per call
  (n), batches/chains across prompts or models, local caching (identical request = free
  re-use), and spend tracking / budgets. IMAGE GENERATION ONLY — no video or audio.
argument-hint: "[prompt] [--model <id>] [--ref <path-or-url>] [--n <1-10>] [--format 1:1|9:16|16:9]"
---

# gadyuka_openrouter — image creation

Drive the **gadyuka_openrouter** MCP server to create still images through OpenRouter.
The server saves images to a local folder and returns **file paths + cost**, not base64.
It tracks spend, enforces an optional budget, and caches results. Use it for **social
posts, website heroes, blog headers, product/marketing visuals, logos** — anything that's
a single picture.

## Tools (from the MCP server)

- `list_image_models` — discover model ids + which params each accepts (live, cached).
- `get_image_model` — definitive per-provider params **and pricing** for one model.
- `generate_image` — generate 1–N images from a prompt (+ optional reference images).
- `generate_batch` — many prompts, or N varied samples of one prompt, run concurrently.
- `get_usage` — spend totals, per-model breakdown, cache savings, budget remaining.
- `set_budget` — set/clear a spend cap (`warn` or `block`).

## UX rules

1. Be concise. Report the **output folder + filenames + cost** — never dump base64 or raw JSON.
2. Detect the user's language from their message and reply in it. Technical args
   (`aspect_ratio`, `n`, model ids) stay as-is.
3. Pick a sane default model; ask at most one clarifying question, and only if genuinely missing.
4. Don't pre-optimize for the cheapest model unless the user asks — prefer the quality default.
5. The user supplies their OpenRouter key via the server env. If a call fails with
   "OPENROUTER_API_KEY is not set", tell them to set it in the MCP server config.
6. **Cache awareness:** an identical request is free and instant. Before re-running the same
   prompt, expect a cache hit (say so). To deliberately get *new* variations of an identical
   request, change the `seed`, tweak the prompt, or use `generate_batch` (which keeps samples
   distinct). Use `force: true` only when the user truly wants to bypass the cache.

## Formats for posts & sites

Pick `aspect_ratio` to match the destination (models that support it — Gemini Image, Seedream, …):

| Use | aspect_ratio |
|---|---|
| Instagram / square post, avatar, thumbnail | `1:1` |
| Story / Reel / TikTok / vertical post | `9:16` |
| Website hero, banner, YouTube, X/LinkedIn landscape | `16:9` |
| Pinterest / portrait post | `4:5` or `2:3` |
| Ultra-wide site header | `21:9` |

More ratios are available — `3:2`, `4:3`, `5:4`, `9:21`, `1:2`, `2:1`, `1:4`, `4:1`, `1:8`, `8:1`,
plus `auto`. Full list + every other parameter and its allowed values: `references/parameters.md`.

Note: some models (e.g. GPT Image 2 / GPT-5.x Image) generate square only here and don't take
`aspect_ratio` — use a Gemini/Seedream model when a specific format matters, or crop afterward.
The authoritative per-model parameter set is always `get_image_model <id>`.

## Workflow

1. **Pick a model.** Use the default unless the brief needs a specialist:
   - **General post / high fidelity / text-on-image / UI / banners → `openai/gpt-image-2`** (default; `n` up to 10, transparent bg, great at rendering text on the image).
   - **Specific format (story/banner) / fast reference edits → `google/gemini-3.1-flash-image-preview`** (Nano Banana 2; supports `aspect_ratio` + resolution; cheap).
   - **Best quality with format control → `google/gemini-3-pro-image-preview`** (Nano Banana Pro; pricier).
   - **Photoreal / scene edits / strong reference adherence → `bytedance-seed/seedream-4.5`** (per-image price, `seed`, resolution tiers).
   - **Logo / icon / vector / controlled palette → `recraft/recraft-v4.1` or `recraft/recraft-v4.1-vector`**.
   - Unsure which params/values a model accepts? Call `get_image_model <id>` first.

2. **Write a good prompt.** Concrete and sensory: *subject + setting + style + lighting + composition + text overlay if any*. Keep it focused. See `references/prompt-engineering.md`.

3. **References (image-to-image / style / character).** Pass `reference_images` as local paths,
   http(s) URLs, or data URLs. Typical patterns:
   - **Style transfer:** 1 reference = the look you want; prompt says what to draw in that style.
   - **Style + character:** 2 references = a layout/style image + a person's photo; prompt: "in the
     style of the layout reference, featuring the person from the character reference".
   When using a reference, describe **what changes**, don't re-describe the input. Reference count
   varies per model — check `get_image_model` (e.g. GPT Image 2 up to 16, Gemini up to 14).

4. **One prompt, many images.** Prefer `generate_image` with **`n`** (e.g. `n: 10`) — ONE API call,
   one cache entry, cheaper than N separate calls. Only models that advertise `n>1` support it
   (GPT Image / GPT-5.x Image do; Gemini Image and FLUX are 1 per call).

5. **Same style across formats / many posts.** Use `generate_batch`:
   - several **different** prompts sharing a style/reference → `prompts: [...]`;
   - N varied samples of one prompt on a 1-per-call model → `prompt` + `count` (add `seed_start`
     for reproducible variety; each sample caches separately).
   Tune `concurrency` (default 3). Partial failures are reported per item.

6. **Deliver.** Give the folder path, filenames, and cost. Say if a result was a cache hit (free).
   Offer next steps (more variations, a different format, a different model, an edit).

## Cost & budget

- Every generation's real cost (`usage.cost`) is recorded. Call `get_usage` to report spend.
- `set_budget` caps spend per `day`/`month`/`total`. `block` refuses calls that would exceed it
  (override a single call with `force: true`); `warn` lets them through but flags the overage.
- To estimate before spending, call `generate_image` with `dry_run: true`. Per-image-priced models
  (Seedream, FLUX) estimate cleanly; token/megapixel-billed models (GPT Image, Gemini) can't be
  pre-estimated — their real cost is still recorded after the call.

## Common calls

```jsonc
// Square post, high fidelity, with on-image text
{ "prompt": "bold sale poster, big white headline 'SUMMER 50% OFF' on coral background, playful", "model": "openai/gpt-image-2" }

// Instagram story (vertical) in a chosen format
{ "prompt": "minimalist product launch teaser, soft gradient, centered bottle", "model": "google/gemini-3.1-flash-image-preview", "aspect_ratio": "9:16" }

// Website hero banner from a brand style reference
{ "prompt": "wide hero banner for a fintech site, calm, trustworthy, abstract 3D shapes", "model": "google/gemini-3.1-flash-image-preview", "aspect_ratio": "16:9", "reference_images": ["/path/brand-style.png"] }

// Restyle a photo (image-to-image)
{ "prompt": "restyle into soft watercolor, pastel palette", "reference_images": ["/path/photo.jpg"], "model": "google/gemini-3.1-flash-image-preview" }

// Style + character → branded poster (2 references)
{ "prompt": "poster in the style of the layout reference, featuring the person from the character reference, bold typography", "reference_images": ["/path/layout.png", "/path/person.png"], "model": "google/gemini-3-pro-image-preview", "aspect_ratio": "1:1" }

// Many samples in one call (model supports n)
{ "prompt": "minimalist line-art fox logo", "model": "openai/gpt-image-2", "n": 10 }

// Estimate first
{ "prompt": "...", "model": "bytedance-seed/seedream-4.5", "n": 4, "dry_run": true }
```

## Errors

- `OPENROUTER_API_KEY is not set` → ask the user to add their key to the MCP server env.
- `Budget blocked: ...` → tell the user the limit; offer to raise it (`set_budget`) or `force: true`.
- `Unsupported reference image type` → references must be png/jpg/jpeg/webp/gif (path/URL/data URL).
- API param errors (bad enum, unknown param) → call `get_image_model <id>` and pass only supported params.

## Reference docs

- `references/parameters.md` — **every parameter and allowed value (all formats/aspect ratios, resolution, quality, …).**
- `references/prompt-engineering.md` — writing prompts, on-image text, image-to-image phrasing.
- `references/model-picking.md` — choosing a model per task.
