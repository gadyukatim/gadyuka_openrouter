# Parameters & Formats reference

Every parameter the gadyuka_openrouter tools accept, with allowed values. **Support is
model-dependent** — this is the full superset; the authoritative per-model list comes from
`get_image_model <id>` (its `supported_parameters`). Passing a param a model doesn't support
returns a clear API error, so check first when unsure.

## `generate_image` parameters

| Param | Type | Allowed values | Notes |
|---|---|---|---|
| `prompt` | string | — | **Required.** The description (and any on-image text in quotes). |
| `model` | string | any image model id | Default `openai/gpt-image-2`. Discover with `list_image_models`. |
| `n` | integer | `1`–`10` | Images per call. Only models that list `n>1` (GPT Image / GPT-5.x). Gemini/FLUX = 1. |
| `reference_images` | string[] | local path / http(s) URL / data URL | Image-to-image, style, character. Count cap is model-specific (GPT Image ≤16, Gemini ≤14). |
| `resolution` | string | `512`, `1K`, `2K`, `4K` | Tier; concrete pixels derived per provider. Gemini/Seedream support it; GPT Image doesn't. |
| `aspect_ratio` | string | see **Formats** below | `auto` lets the provider choose. GPT Image / GPT-5.x ignore it (square only). |
| `size` | string | a tier (`"2K"`) or pixels (`"2048x2048"`) | Shorthand for resolution+aspect. Don't combine with conflicting `resolution`/`aspect_ratio`. |
| `quality` | string | `auto`, `low`, `medium`, `high` | GPT Image family. Higher = more tokens = more cost. |
| `output_format` | string | `png`, `jpeg`, `webp` | File format. |
| `background` | string | `auto`, `transparent`, `opaque` | `transparent` needs png/webp (GPT Image). |
| `output_compression` | integer | `0`–`100` | webp/jpeg only; ignored for png. |
| `seed` | integer | any | Reproducible output where supported (Seedream, FLUX, …). |
| `provider_options` | object | `{ "<provider_slug>": { … } }` | Provider-specific passthrough. See `get_image_model` → `allowed_passthrough_parameters`. |

### gadyuka_openrouter-specific (always available)

| Param | Type | Default | Notes |
|---|---|---|---|
| `output_dir` | string | dated folder under the data dir | Where files are written. |
| `label` | string | derived from prompt | Filename stem + manifest name. |
| `use_cache` | boolean | `true` | Reuse an identical prior result for free. |
| `force` | boolean | `false` | Bypass cache **and** budget block; always re-generate. |
| `dry_run` | boolean | `false` | Estimate cost only; no API call, no spend. |

## `generate_batch` extra parameters

| Param | Type | Allowed | Notes |
|---|---|---|---|
| `prompts` | string[] | — | Distinct prompts. Mutually exclusive with `prompt`+`count`. |
| `prompt` + `count` | string + integer | count `1`–`50` | N varied samples of one prompt. |
| `seed_start` | integer | any | With `count`: sample *i* uses `seed_start+i` (reproducible variety). |
| `concurrency` | integer | `1`–`8` | Parallel in-flight requests. Default 3. |

Plus all `generate_image` params above (shared across every item).

## Formats (`aspect_ratio`)

Full superset accepted by the API. Providers clamp to their own subset — verify with
`get_image_model`.

| Value | Typical use |
|---|---|
| `1:1` | Feed post, avatar, thumbnail, square ad |
| `9:16` | Story / reel / TikTok / vertical post |
| `16:9` | Website hero, banner, YouTube, landscape social |
| `4:5` | Portrait Instagram post |
| `2:3`, `3:4` | Portrait / Pinterest |
| `3:2`, `4:3` | Classic photo landscape |
| `5:4` | Near-square print |
| `21:9`, `9:21` | Ultra-wide header / tall banner |
| `1:2`, `2:1`, `1:4`, `4:1`, `1:8`, `8:1` | Extreme strips / skyscraper ads (model-dependent) |
| `auto` | Let the provider pick |

**Resolution tiers:** `512`, `1K`, `2K`, `4K` (higher = more cost; not all models expose it).

### Per-model quick facts (verify live with `get_image_model`)

- `openai/gpt-image-2`, `openai/gpt-5.4-image-2`: `quality`, `background`, `n`≤10, `input_references`≤16,
  `output_compression`. **No `aspect_ratio`/`resolution` — square only.** Best at on-image text.
- `google/gemini-3.1-flash-image-preview`: `aspect_ratio` (wide list incl. extreme ratios),
  `resolution` 512–4K, `input_references`≤14, `n`=1. Cheap.
- `google/gemini-3-pro-image-preview`: `aspect_ratio`, `resolution` 1K–4K, `input_references`≤14, `n`=1. Pricier, sharp text.
- `bytedance-seed/seedream-4.5`: `resolution`, `aspect_ratio`, `seed`, `input_references`, `n`. Per-image price.
- `black-forest-labs/flux.2-*`: `output_format`, `seed`, `input_references`, `n`=1.
