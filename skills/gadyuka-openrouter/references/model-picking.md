# Picking a Model

The catalog is fetched live — run `list_image_models` for the current set and
`get_image_model <id>` for exact params + pricing. This is a routing guide, not a
fixed list; trust the live catalog over this file when they disagree.

## By task

| Task | Start with | Notes |
|---|---|---|
| General / high fidelity / text on image / UI / banners | `openai/gpt-image-2` | Default. `n` up to 10, transparent bg, quality tiers. Excellent at on-image text. Square only here. Token-billed. |
| Specific format (story/banner) / fast reference edits | `google/gemini-3.1-flash-image-preview` (Nano Banana 2) | Supports `aspect_ratio` + `resolution`. Cheap. `n`=1 per call. Misspells long words more. |
| Best quality with format control | `google/gemini-3-pro-image-preview` (Nano Banana Pro) | Supports `aspect_ratio`. Strong at text. Pricier. `n`=1 per call. |
| Photoreal / scene edits / strong reference adherence | `bytedance-seed/seedream-4.5` | Per-image price (estimates cleanly), has `seed`, resolution tiers. |
| Logo / icon / vector / controlled palette | `recraft/recraft-v4.1-vector` or `recraft/recraft-v4.1` | Vector variants output SVG. |
| Top-tier photoreal / fine detail | `black-forest-labs/flux.2-pro` | Has `seed`. `n` is 1 per call → use `generate_batch` for many. |
| Cheap / fast iteration | a `*-fast` / `*-mini` / `klein` variant | Check `list_image_models` for current cheap options. |

## Format control

- Need `1:1` / `9:16` / `16:9` / `4:5` etc.? Use a model that lists `aspect_ratio`
  (Gemini Image, Seedream). GPT Image / GPT-5.x Image are **square only** via OpenRouter.
- On-image text quality is best on GPT Image, GPT-5.x Image, and Gemini 3 Pro Image. See
  `prompt-engineering.md` → "On-image text".

## n vs batch

- Need several samples of **one** prompt and the model supports `n>1`?
  → `generate_image` with `n` (one call, cheaper, one cache entry). GPT Image / GPT-5.x do.
- Model is **1-per-call** (Gemini Image, FLUX), or you want **different** prompts?
  → `generate_batch` (`prompt`+`count`, or `prompts: [...]`).

## Pricing awareness

- Per-image-priced models (Seedream, FLUX, Recraft) → `dry_run` gives a real estimate.
- Token/megapixel-billed models (GPT Image, Gemini) → can't pre-estimate; the real cost is
  recorded after the call and visible via `get_usage`.
- Always available: `get_image_model <id>` shows the published pricing lines per provider.

### Observed cost (real run, 1K / medium quality, ~1 image)

Rough, real numbers from a demo run (your prices may differ):

| Model | ~Cost / image |
|---|---|
| `google/gemini-3.1-flash-image-preview` | ~$0.068 |
| `openai/gpt-image-2` (medium) | ~$0.079 |
| `openai/gpt-5.4-image-2` (medium) | ~$0.071 |
| `google/gemini-3-pro-image-preview` (1K) | ~$0.136 |

Use cheaper models for volume/iteration and the pricier Pro/GPT-5.x for hero shots — and watch
`get_usage` or set a `set_budget` cap.
