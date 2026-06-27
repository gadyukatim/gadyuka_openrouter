# Prompt Engineering (gadyuka_openrouter)

## Basics

Concrete, sensory prompts win. Build from:

- **Subject + setting + style**: "a red fox curled in a snowy pine forest, golden hour, cinematic"
- **Camera/composition**: lens (35mm, 85mm), angle (low, overhead), framing (close-up, wide), where the subject sits
- **Lighting**: rim light, neon glow, soft window light, moody backlight
- **Medium/style**: photograph, oil painting, watercolor, 3D render, anime, vector, bold graphic poster

Keep it focused — roughly under 200 tokens. Very long prompts tend to dilute.

## On-image text (posters, ads, social)

Image models vary a lot at rendering text. Tips that actually work:

- **Quote the exact words.** Put the literal text in quotes: `headline reading "SUMMER 50% OFF"`.
- **List every text element and forbid the rest.** For clean output add:
  `IMPORTANT: the ONLY text in the image is "<A>" and "<B>". Do not add any other words, numbers or slogans.`
  Without this, models invent extra captions or phone numbers.
- **Best at text:** `openai/gpt-image-2`, `openai/gpt-5.x-image`, and `google/gemini-3-pro-image-preview`.
  Cheaper/faster models (e.g. `gemini-3.1-flash-image-preview`) render text but misspell more —
  prefer them for short words, or generate a few and pick the clean one.
- **Unusual brand words get misspelled.** Repeat the exact spelling and keep the word short; expect
  occasional slips on long/rare strings and regenerate if needed.

## Image-to-image (reference_images)

When you pass a reference, describe **what changes**, not the whole input.

- Bad: "a man with brown hair in a leather jacket holding coffee, made into anime"
- Good: "restyle into anime, vibrant colors, soft cel shading"

The number of references a model accepts varies — check `get_image_model`. GPT Image 2 accepts up to 16;
Gemini Image up to 14.

### Style + character (two references)

A powerful pattern for branded posts: pass **two** references — a *layout/style* image and a *person's
photo* — and prompt: "in the style of the layout reference, featuring the person from the character
reference". The model transfers the look onto your subject.

> ⚠️ **A style reference's own text gets copied.** If the layout reference contains words (a headline,
> a phone number), models tend to reproduce that text verbatim and ignore your requested caption. To
> control the on-image text, either (a) drop the text-bearing reference and describe the style in
> words instead, or (b) keep it but add the strict "the ONLY text is …" instruction above. The cleanest
> branded text comes from describing the style in words + a single character reference.

## Negative phrasing

Most image models don't expose a negative prompt. Phrase positively:

- instead of "no blur" → "tack sharp"
- instead of "no people" → "uninhabited landscape"

## Aspect ratio (formats)

- `16:9` — landscape / website hero / banner
- `9:16` — vertical / story / reel
- `1:1` — square / feed post / avatar
- `4:5`, `2:3` — portrait social
- `21:9` — ultra-wide header

Pass `aspect_ratio: "auto"` to let the provider choose. Note: GPT Image / GPT-5.x Image generate
square only via OpenRouter (no `aspect_ratio`) — use a Gemini/Seedream model for a specific format.

## Reproducibility & variety

- Set `seed` to reproduce a result (models that list `seed`: Seedream, FLUX, …).
- For variety across a batch, omit `seed` (provider randomizes) or use `generate_batch` with
  `seed_start` so each sample is a different, reproducible seed.
- An identical request returns the **cached** files for free — change the prompt/seed or pass
  `force: true` to get genuinely new output.

## Quality / format

- `quality`: `auto` | `low` | `medium` | `high` (GPT Image family). Higher = more tokens = more cost.
- `output_format`: `png` | `jpeg` | `webp`. `background: "transparent"` needs png/webp (GPT Image).

## Safety

Avoid prompts likely to be rejected: real public figures, sexual content, trademarked / branded
characters. Models can return a safety/IP error and no image.
