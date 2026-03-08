/**
 * Supported AI Models Registry
 *
 * Curated list of models available via OpenRouter.
 * Used in the admin dashboard for agent configuration and diagnostics.
 *
 * Pricing is approximate and may change — check OpenRouter for current rates.
 */

export type InputModality = 'text' | 'image' | 'audio' | 'video' | 'pdf';
export type NativeTool = 'web_search' | 'thinking' | 'computer_use' | 'code_execution';
export type SpeedTier = 'fast' | 'medium' | 'slow';

export interface ModelInfo {
  /** OpenRouter model ID (e.g. 'google/gemini-3-flash-preview') */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Provider name */
  provider: 'Google' | 'OpenAI' | 'Anthropic' | 'DeepSeek' | 'Perplexity';
  /** Short description of the model */
  description: string;
  /** Supported input modalities */
  inputModalities: InputModality[];
  /** Max input context window in tokens */
  maxInputTokens: number;
  /** Max output tokens per response */
  maxOutputTokens: number;
  /** Approximate input cost per million tokens (USD) */
  inputPricePerM: number;
  /** Approximate output cost per million tokens (USD) */
  outputPricePerM: number;
  /** Relative cost tier for quick comparison */
  tier: 'free' | 'low' | 'medium' | 'high';
  /** Relative speed/latency */
  speed: SpeedTier;
  /** Native tools built into the model (not our custom tools) */
  nativeTools: NativeTool[];
  /** Notable features or caveats */
  notes?: string;
}

// Convenience checks
export function supportsVision(model: ModelInfo): boolean {
  return model.inputModalities.includes('image');
}

/**
 * All supported models, ordered by provider then cost.
 */
export const SUPPORTED_MODELS: ModelInfo[] = [
  // ── Google ──────────────────────────────────────────────────────────────
  {
    id: 'google/gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash Lite',
    provider: 'Google',
    description: 'Cheapest Google model. Ultra-low latency, great for high-volume.',
    inputModalities: ['text', 'image', 'audio', 'video', 'pdf'],
    maxInputTokens: 1_048_576,
    maxOutputTokens: 65_536,
    inputPricePerM: 0.10,
    outputPricePerM: 0.40,
    tier: 'free',
    speed: 'fast',
    nativeTools: ['thinking'],
    notes: 'Current Mutumbot default',
  },
  {
    id: 'google/gemini-3.1-flash-lite-preview',
    name: 'Gemini 3.1 Flash Lite Preview',
    provider: 'Google',
    description: 'Next-gen efficiency. Outperforms 2.5 Flash Lite across the board.',
    inputModalities: ['text', 'image', 'audio', 'video', 'pdf'],
    maxInputTokens: 1_048_576,
    maxOutputTokens: 65_536,
    inputPricePerM: 0.15,
    outputPricePerM: 0.60,
    tier: 'free',
    speed: 'fast',
    nativeTools: ['thinking'],
    notes: 'Thinking levels: minimal/low/medium/high',
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'Google',
    description: 'Strong workhorse model with built-in reasoning.',
    inputModalities: ['text', 'image', 'audio', 'video', 'pdf'],
    maxInputTokens: 1_048_576,
    maxOutputTokens: 65_536,
    inputPricePerM: 0.15,
    outputPricePerM: 0.60,
    tier: 'low',
    speed: 'fast',
    nativeTools: ['thinking'],
  },
  {
    id: 'google/gemini-3-flash-preview',
    name: 'Gemini 3 Flash Preview',
    provider: 'Google',
    description: 'Near-Pro reasoning at Flash speed. Great for agentic workflows.',
    inputModalities: ['text', 'image', 'audio', 'video', 'pdf'],
    maxInputTokens: 1_048_576,
    maxOutputTokens: 65_536,
    inputPricePerM: 0.50,
    outputPricePerM: 3.50,
    tier: 'low',
    speed: 'fast',
    nativeTools: ['thinking'],
    notes: 'Structured output, automatic context caching',
  },
  {
    id: 'google/gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    provider: 'Google',
    description: 'Frontier reasoning. Best Google quality across all modalities.',
    inputModalities: ['text', 'image', 'audio', 'video', 'pdf'],
    maxInputTokens: 1_048_576,
    maxOutputTokens: 65_536,
    inputPricePerM: 2.00,
    outputPricePerM: 12.00,
    tier: 'medium',
    speed: 'medium',
    nativeTools: ['thinking'],
    notes: 'High-precision reasoning, 1M context',
  },

  // ── OpenAI ──────────────────────────────────────────────────────────────
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'OpenAI',
    description: 'Fast and cheap OpenAI model. Solid generalist.',
    inputModalities: ['text', 'image'],
    maxInputTokens: 128_000,
    maxOutputTokens: 16_384,
    inputPricePerM: 0.15,
    outputPricePerM: 0.60,
    tier: 'free',
    speed: 'fast',
    nativeTools: [],
  },
  {
    id: 'openai/gpt-5.3-chat',
    name: 'GPT-5.3 Chat',
    provider: 'OpenAI',
    description: 'Latest conversational model. Smoother, more helpful, fewer refusals.',
    inputModalities: ['text', 'image'],
    maxInputTokens: 128_000,
    maxOutputTokens: 16_384,
    inputPricePerM: 1.75,
    outputPricePerM: 14.00,
    tier: 'medium',
    speed: 'medium',
    nativeTools: [],
    notes: 'Released March 2026',
  },

  // ── Anthropic ───────────────────────────────────────────────────────────
  {
    id: 'anthropic/claude-haiku-4.5',
    name: 'Claude Haiku 4.5',
    provider: 'Anthropic',
    description: 'Fast, efficient. Near-frontier intelligence at low cost.',
    inputModalities: ['text', 'image'],
    maxInputTokens: 200_000,
    maxOutputTokens: 200_000,
    inputPricePerM: 1.00,
    outputPricePerM: 5.00,
    tier: 'low',
    speed: 'fast',
    nativeTools: ['thinking', 'web_search', 'computer_use'],
    notes: 'Extended thinking, web search, computer use',
  },
  {
    id: 'anthropic/claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    description: 'Best at instructions. Frontier coding and reasoning.',
    inputModalities: ['text', 'image'],
    maxInputTokens: 200_000,
    maxOutputTokens: 200_000,
    inputPricePerM: 3.00,
    outputPricePerM: 15.00,
    tier: 'medium',
    speed: 'medium',
    nativeTools: ['thinking', 'web_search', 'computer_use'],
    notes: 'Frontier performance across coding, agents, professional work',
  },

  // ── DeepSeek ────────────────────────────────────────────────────────────
  {
    id: 'deepseek/deepseek-chat-v3',
    name: 'DeepSeek Chat V3',
    provider: 'DeepSeek',
    description: 'Very cheap 685B MoE model. Strong reasoning, text only.',
    inputModalities: ['text'],
    maxInputTokens: 256_000,
    maxOutputTokens: 16_384,
    inputPricePerM: 0.25,
    outputPricePerM: 0.38,
    tier: 'free',
    speed: 'fast',
    nativeTools: [],
    notes: 'No image analysis — text only. 685B parameters.',
  },

  // ── Perplexity ──────────────────────────────────────────────────────────
  {
    id: 'perplexity/sonar',
    name: 'Perplexity Sonar',
    provider: 'Perplexity',
    description: 'Built-in web search with citations. Great for research questions.',
    inputModalities: ['text'],
    maxInputTokens: 127_000,
    maxOutputTokens: 16_384,
    inputPricePerM: 1.00,
    outputPricePerM: 1.00,
    tier: 'low',
    speed: 'medium',
    nativeTools: ['web_search'],
    notes: 'Answers include source citations. Web search is native.',
  },
];

/** Quick lookup by model ID */
export const MODEL_MAP = new Map(SUPPORTED_MODELS.map((m) => [m.id, m]));

/** Get model info by ID, returns undefined for unknown models */
export function getModelInfo(modelId: string): ModelInfo | undefined {
  return MODEL_MAP.get(modelId);
}

/** Format price for display (e.g. "$0.15") */
export function formatPrice(pricePerM: number): string {
  if (pricePerM === 0) return 'Free';
  if (pricePerM < 0.01) return `$${pricePerM.toFixed(3)}`;
  return `$${pricePerM.toFixed(2)}`;
}

/** Format token count for display (e.g. "1M" or "128K") */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  return `${Math.round(tokens / 1_000)}K`;
}

/** Tier display labels */
export const TIER_LABELS: Record<ModelInfo['tier'], string> = {
  free: 'Free / Very Low',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

/** Speed display labels */
export const SPEED_LABELS: Record<SpeedTier, string> = {
  fast: 'Fast',
  medium: 'Medium',
  slow: 'Slow',
};

/** Input modality display labels */
export const MODALITY_LABELS: Record<InputModality, string> = {
  text: 'Text',
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
  pdf: 'PDF',
};

/** Native tool display labels */
export const NATIVE_TOOL_LABELS: Record<NativeTool, string> = {
  web_search: 'Web Search',
  thinking: 'Thinking/Reasoning',
  computer_use: 'Computer Use',
  code_execution: 'Code Execution',
};
