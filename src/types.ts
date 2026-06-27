/** Shared types mirroring the OpenRouter Image API shapes. */

export type CapabilityDescriptor =
  | { type: "enum"; values: string[] }
  | { type: "range"; min: number; max: number }
  | { type: "boolean" };

export interface ImageModel {
  id: string;
  name: string;
  description?: string;
  created?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supported_parameters?: Record<string, CapabilityDescriptor>;
  supports_streaming?: boolean;
  endpoints?: string;
}

export interface PricingLine {
  billable: string; // e.g. "output_image", "input_image", "input_reference"
  unit: string; // "image" | "megapixel" | "token"
  cost_usd: number;
  variant?: string; // e.g. "2k", "4k"
}

export interface ModelEndpoint {
  provider_name: string;
  provider_slug: string;
  provider_tag: string | null;
  supported_parameters?: Record<string, CapabilityDescriptor>;
  allowed_passthrough_parameters?: string[];
  supports_streaming?: boolean;
  pricing?: PricingLine[];
}

export interface ModelEndpoints {
  id: string;
  endpoints: ModelEndpoint[];
}

/** A reference image after resolution to the API wire shape. */
export interface ResolvedReference {
  api: { type: "image_url"; image_url: { url: string } };
  /** Stable hash for cache keying (bytes for local files, the URL string for remote). */
  hash: string;
  /** Human label for logs (filename or truncated url). */
  source: string;
}

/** Tunable image params passed straight through to the API. */
export interface ImageParams {
  n?: number;
  resolution?: string;
  aspect_ratio?: string;
  size?: string;
  quality?: string;
  output_format?: string;
  background?: string;
  output_compression?: number;
  seed?: number;
}

export interface GenerateRequest extends ImageParams {
  model: string;
  prompt: string;
  input_references?: ResolvedReference["api"][];
  provider?: { options?: Record<string, Record<string, unknown>> };
  stream?: boolean;
}

export interface ImageUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
}

export interface ImageDatum {
  b64_json: string;
  media_type?: string;
}

export interface ImageGenResponse {
  created?: number;
  data: ImageDatum[];
  usage?: ImageUsage;
}

/** One image after being written to disk. */
export interface SavedImage {
  path: string;
  bytes: number;
  mediaType: string;
}
