/**
 * Drink Questions Handler
 *
 * Mutumbot dispenses ANCIENT WISDOM about beverages,
 * with particular reverence for tiki drinks and rum.
 */

import OpenAI from 'openai';
import {
  MUTUMBOT_AWAKENING,
  ISEE_EMOJI,
  processIseeMarkers,
} from './personality';
import {
  addToContext,
  formatContextForAI,
} from './services/conversationContext';
import {
  buildContextPack,
  buildThreadContextPack,
  ContextPack,
} from './services/contextBuilder';
import {
  startRun,
  completeRun,
  failRun,
  hasProcessedTrigger,
  generateThreadId,
} from './services/threads';
import {
  resolveConfigWithDefaults,
  ResolvedConfig,
} from './services/agents';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// OpenRouter client - the ONLY AI provider (no fallbacks)
const openrouter = OPENROUTER_API_KEY
  ? new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: OPENROUTER_API_KEY,
    })
  : null;

const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';

// Tribute scoring system
export const TRIBUTE_SCORES = {
  TIKI: 10,      // Tiki drinks (Mai Tai, Zombie, Painkiller, etc.)
  COCKTAIL: 5,   // Other cocktails
  BEER_WINE: 2,  // Beer, wine, basic drinks
  OTHER: 1,      // Non-drink offerings (still acknowledged)
} as const;

export type DrinkCategory = 'TIKI' | 'COCKTAIL' | 'BEER_WINE' | 'OTHER';

export interface ImageAnalysis {
  description: string;
  category: DrinkCategory;
  score: number;
  drinkName?: string;
  response?: string;  // AI-generated in-character response
}

/**
 * Build the image analysis prompt for AI models
 */
function buildImageAnalysisPrompt(userMessage?: string, isFriday?: boolean, isDM?: boolean): string {
  return `You are MUTUMBOT, an ancient and ominous tiki entity receiving a tribute offering.

Analyze this image and respond in EXACTLY this JSON format (no markdown, just raw JSON):
{
  "description": "What you SEE in the image - be specific about the drink, vessel, garnishes, setting",
  "category": "TIKI" or "COCKTAIL" or "BEER_WINE" or "OTHER",
  "drinkName": "name of the drink if identifiable, or null",
  "response": "Your in-character response as MUTUMBOT (1-2 SHORT sentences, max 200 chars)"
}

CATEGORY RULES (for scoring):
- TIKI (10pts): Tiki drinks (Mai Tai, Zombie, Painkiller, Hurricane, Scorpion, Navy Grog, Jungle Bird, etc.), drinks in tiki mugs, tropical cocktails with rum and exotic garnishes
- COCKTAIL (5pts): Other mixed drinks, cocktails, spirits (margarita, martini, old fashioned, whiskey sour, etc.)
- BEER_WINE (2pts): Beer, wine, cider, hard seltzer, simple drinks
- OTHER (1pt): Non-alcoholic drinks, food, or anything that's not a beverage

RESPONSE GUIDELINES:
- Stay in character as an ancient, ominous tiki entity
- Use dramatic CAPS for emphasis on key words
- Reference "the spirits", "the ancient ones", "the tiki gods"
- React appropriately to what you see:
  - TIKI drinks: Express GREAT pleasure, the sacred arts are honored
  - Cocktails: Acknowledge the craft, but hint you prefer tiki
  - Beer/Wine: Accept humbly, suggest they could do better
  - Other: Be curious or mildly disappointed
${isFriday ? '- This is FRIDAY - the sacred ritual day! Mention this.' : ''}
${isDM ? '- This is a private DM tribute - these remain between you and the mortal, separate from the public competition.' : ''}
${userMessage ? `- The mortal who sent this said: "${userMessage}"` : ''}

Keep response SHORT (under 200 chars). Do NOT ask follow-up questions or prompt about other drinks.`;
}

/**
 * Parse AI response JSON into ImageAnalysis
 */
function parseImageAnalysisResponse(responseText: string): ImageAnalysis | null {
  try {
    const parsed = JSON.parse(responseText.replace(/```json\n?|\n?```/g, ''));
    const category = (['TIKI', 'COCKTAIL', 'BEER_WINE', 'OTHER'].includes(parsed.category)
      ? parsed.category
      : 'OTHER') as DrinkCategory;

    return {
      description: parsed.description || 'A mysterious offering',
      category,
      score: TRIBUTE_SCORES[category],
      drinkName: parsed.drinkName || undefined,
      response: parsed.response || undefined,
    };
  } catch {
    console.error('Failed to parse image analysis JSON:', responseText);
    return null;
  }
}

/**
 * Analyze image using OpenRouter (Gemini 2.5 Flash Lite)
 */
async function analyzeImageWithOpenRouter(
  base64: string,
  contentType: string,
  prompt: string
): Promise<ImageAnalysis | null> {
  if (!openrouter) {
    return null;
  }

  const response = await openrouter.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:${contentType};base64,${base64}`,
            },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });

  const responseText = response.choices[0]?.message?.content?.trim();
  if (!responseText) {
    return null;
  }

  return parseImageAnalysisResponse(responseText);
}

/**
 * Analyze image using OpenAI (fallback)
 */
/**
 * Analyze an image and generate a full AI response for the tribute
 * Uses OpenRouter only (no fallbacks)
 */
export async function analyzeImage(
  imageUrl: string,
  userMessage?: string,
  isFriday?: boolean,
  isDM?: boolean
): Promise<ImageAnalysis | null> {
  if (!OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY not configured for image analysis');
    return null;
  }

  try {
    // Fetch the image from Discord CDN
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.error('Failed to fetch image:', response.status, response.statusText);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const prompt = buildImageAnalysisPrompt(userMessage, isFriday, isDM);

    console.log('Image fetched successfully. Size:', base64.length, 'Content-Type:', contentType);

    // Use OpenRouter for image analysis
    try {
      console.log('Analyzing image with OpenRouter...');
      const result = await analyzeImageWithOpenRouter(base64, contentType, prompt);
      if (result) {
        console.log('Image analyzed. Category:', result.category, 'Score:', result.score);
        return result;
      }
      console.error('OpenRouter returned null result');
    } catch (error) {
      console.error('OpenRouter analysis failed:', (error as Error).message || error);
    }

    console.error('Image analysis failed');
    return null;
  } catch (error) {
    console.error('Image analysis error:', (error as Error).message || error);
    return null;
  }
}

/**
 * Chat with OpenRouter with conversation history
 * Uses agent config for model selection and system prompt
 * All prompts come from database (except hardcoded safety guardrails)
 */
async function chatWithOpenRouter(
  question: string,
  channelId?: string,
  aiContext?: string,
  transcript?: string,
  config?: ResolvedConfig
): Promise<string | null> {
  if (!openrouter || !config) {
    return null;
  }

  // System prompt comes entirely from config (safety + agent persona)
  let systemPrompt = config.systemPrompt;

  // Add database context (tribute statistics, leaderboards)
  if (aiContext) {
    systemPrompt += `\n\n--- CURRENT DATABASE CONTEXT ---\n${aiContext}`;
  }

  // Add channel transcript (recent conversation history from DB)
  if (transcript) {
    systemPrompt += `\n\n--- RECENT CHANNEL CONVERSATION ---\nThis is the recent conversation in this channel. Use this to understand context:\n${transcript}`;
  }

  // Build messages array
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'assistant', content: MUTUMBOT_AWAKENING },
  ];

  // If we have a transcript, we don't need the in-memory context
  // Otherwise, fall back to in-memory for backward compatibility
  if (!transcript && channelId) {
    const contextHistory = formatContextForAI(channelId);
    for (const entry of contextHistory) {
      const role = entry.role === 'user' ? 'user' : 'assistant';
      const text = entry.parts.map((p: { text: string }) => p.text).join('');
      messages.push({ role, content: text });
    }
  }

  // Add the current question
  messages.push({ role: 'user', content: question });

  // Use agent's model or fall back to default
  const model = config?.agent.model || DEFAULT_MODEL;
  const params = config?.agent.params || {};

  const response = await openrouter.chat.completions.create({
    model,
    messages,
    temperature: params.temperature,
    top_p: params.topP,
    max_tokens: params.maxTokens,
  });

  return response.choices[0]?.message?.content || null;
}

/**
 * Handle the /ask command using AI with Mutumbot personality
 * Uses OpenRouter (Gemini 2.5 Flash Lite) as primary, falls back to OpenAI if it fails
 *
 * Now includes ChatKit-style run logging for:
 * - Idempotency (duplicate message protection)
 * - Debugging (replay context selection)
 * - Reliability (track failures)
 *
 * @param question - The user's question
 * @param channelId - Channel ID for context
 * @param aiContext - Optional tribute/stats context from database
 * @param messageId - Optional trigger message ID for building conversation transcript
 * @param guildId - Optional guild ID for thread identification
 */
export async function handleDrinkQuestion(
  question: string,
  channelId?: string,
  aiContext?: string,
  messageId?: string,
  guildId?: string | null
): Promise<{ content: string; runId?: string }> {
  if (!OPENROUTER_API_KEY) {
    return {
      content: `${ISEE_EMOJI} The spirits are SILENT. The ancient connection to the AI realm has not been established. Summon the bot administrator to configure the OPENROUTER_API_KEY.`,
    };
  }

  // Idempotency check: don't process the same trigger twice
  if (messageId) {
    try {
      const alreadyProcessed = await hasProcessedTrigger(messageId);
      if (alreadyProcessed) {
        console.log(`[RunLog] Skipping duplicate trigger: ${messageId}`);
        return {
          content: '', // Return empty - the response was already sent
        };
      }
    } catch (error) {
      // Log but continue - idempotency check is non-critical
      console.error('[RunLog] Idempotency check failed:', error);
    }
  }

  // Build conversation transcript from database if we have message ID
  let transcript: string | undefined;
  let contextPack: ContextPack | null = null;

  if (channelId && messageId) {
    try {
      // Try ChatKit-style context first (includes summary)
      contextPack = await buildThreadContextPack(channelId, guildId ?? null, messageId);

      if (!contextPack) {
        // Fall back to legacy context building
        contextPack = await buildContextPack(channelId, messageId);
      }

      if (contextPack?.transcript) {
        transcript = contextPack.transcript;
        console.log(`[Context] Built transcript: ${contextPack.messageCount} messages${contextPack.summary ? ' (with summary)' : ''}`);
      }
    } catch (error) {
      console.error('[Context] Failed to build transcript:', error);
      // Continue without transcript - will fall back to in-memory context
    }
  }

  // Resolve agent/workflow config for this thread (persona comes from DB)
  const threadId = channelId ? generateThreadId(channelId, guildId ?? null) : null;
  let config: ResolvedConfig | undefined;
  try {
    config = await resolveConfigWithDefaults(threadId);
    if (config.agent.name !== 'Fallback Agent') {
      console.log(`[Agent] Using agent: ${config.agent.name}, model: ${config.agent.model}`);
    }
  } catch (error) {
    console.error('[Agent] Failed to resolve config:', error);
    return {
      content: `${ISEE_EMOJI} The spirits are CONFUSED. Failed to resolve agent configuration.`,
    };
  }

  // Start run logging
  let runId: string | undefined;
  if (channelId && threadId && config) {
    try {
      runId = await startRun(threadId, {
        provider: 'openrouter',
        model: config.agent.model || DEFAULT_MODEL,
        selectedItemIds: contextPack?.selectedItemIds,
        tokenEstimate: contextPack?.tokenEstimate,
      });
    } catch (error) {
      console.error('[RunLog] Failed to start run:', error);
      // Continue without run logging
    }
  }

  let response: string | null = null;

  // Use OpenRouter (the only AI provider)
  try {
    response = await chatWithOpenRouter(question, channelId, aiContext, transcript, config);
    if (response) {
      console.log(`Chat handled by OpenRouter (${config.agent.model || DEFAULT_MODEL})`);
    }
  } catch (error) {
    console.error('OpenRouter chat failed:', error);
  }

  if (!response) {
    // Mark run as failed
    if (runId) {
      try {
        await failRun(runId, 'All AI providers failed');
      } catch (error) {
        console.error('[RunLog] Failed to mark run as failed:', error);
      }
    }

    return {
      content: `${ISEE_EMOJI} The spirits are DISTURBED. Something has disrupted the ancient connection. Try again, mortal.`,
      runId,
    };
  }

  // Process [ISEE] markers in the response
  response = processIseeMarkers(response);

  // Store this exchange in in-memory context as fallback
  // (Database context is stored via message ingestor)
  if (channelId) {
    addToContext(channelId, 'user', question);
    addToContext(channelId, 'model', response);
  }

  // Truncate if too long (Discord limit)
  if (response.length > 2000) {
    response = response.slice(0, 1997) + '...';
  }

  // Mark run as completed
  if (runId) {
    try {
      await completeRun(runId, {
        provider: 'openrouter',
        responseLength: response.length,
      });
    } catch (error) {
      console.error('[RunLog] Failed to complete run:', error);
    }
  }

  return { content: response, runId };
}

/**
 * Handle a general @mention without a specific question
 * Used by the gateway bot
 *
 * @param message - The raw message content
 * @param channelId - Channel ID for context
 * @param aiContext - Optional tribute/stats context from database
 * @param messageId - Optional trigger message ID for building conversation transcript
 * @param guildId - Optional guild ID for thread identification
 */
export async function handleMention(
  message: string,
  channelId: string,
  aiContext?: string,
  messageId?: string,
  guildId?: string | null
): Promise<{ content: string; runId?: string }> {
  // If there's actual content beyond the mention, treat it as a question
  const cleanedMessage = message.replace(/<@!?\d+>/g, '').trim();

  if (cleanedMessage.length > 0) {
    return handleDrinkQuestion(cleanedMessage, channelId, aiContext, messageId, guildId);
  }

  // Just a mention with no question - respond mysteriously but briefly
  const responses = [
    `${ISEE_EMOJI} You have summoned the ancient one. Speak.`,
    `${ISEE_EMOJI} I AWAKEN... What is it, mortal?`,
    `${ISEE_EMOJI} You dare invoke my name? Speak your purpose.`,
    `The spirits sense your presence. What do you seek?`,
    `${ISEE_EMOJI} I SEE you, mortal. What brings you here?`,
  ];

  return {
    content: responses[Math.floor(Math.random() * responses.length)],
  };
}

/**
 * Generate simple text with OpenRouter (Gemini 2.5 Flash Lite)
 */
async function generateWithOpenRouter(prompt: string): Promise<string | null> {
  if (!openrouter) {
    return null;
  }

  const response = await openrouter.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.choices[0]?.message?.content || null;
}

/**
 * Handle the legacy /drink random command - random tiki/drink fact
 * Uses OpenRouter only (no fallbacks)
 */
export async function handleRandomDrinkFact(): Promise<{ content: string }> {
  if (!OPENROUTER_API_KEY) {
    return {
      content: `${ISEE_EMOJI} The spirits are SILENT. OPENROUTER_API_KEY is not configured.`,
    };
  }

  const topics = [
    'tiki cocktails',
    'rum history',
    'Don the Beachcomber',
    'Trader Vic',
    'tropical drinks',
    'tiki culture',
    'Mai Tai',
    'exotic cocktail ingredients',
  ];
  const randomTopic = topics[Math.floor(Math.random() * topics.length)];

  const prompt = `You are MUTUMBOT, an ancient and ominous tiki entity. Tell me one interesting and surprising fact about ${randomTopic}. Keep it under 500 characters. Be dramatic and mysterious but informative. Use CAPS for emphasis on key dramatic words. You may start with [ISEE] if this fact is particularly revelatory.`;

  let response: string | null = null;

  try {
    response = await generateWithOpenRouter(prompt);
    if (response) {
      console.log('Random fact generated by OpenRouter');
    }
  } catch (error) {
    console.error('OpenRouter generation failed:', error);
  }

  if (!response) {
    return {
      content: `${ISEE_EMOJI} The ancient knowledge eludes me momentarily. The spirits are... DISTRACTED. Try again.`,
    };
  }

  // Process [ISEE] markers
  response = processIseeMarkers(response);

  return { content: response };
}

/**
 * Handle the /drink list command - show what Mutumbot knows
 */
export function handleDrinkList(): { content: string } {
  return {
    content: `${ISEE_EMOJI} **THE ANCIENT KNOWLEDGE AWAITS...**

I possess wisdom of the ages regarding:

**TIKI & TROPICAL** - My sacred specialty. Mai Tai, Zombie, Painkiller, and the forgotten recipes of the ancients.

**RUM** - The LIFEBLOOD of tiki. From the Caribbean depths to the distilleries of the world.

**BEER** - The mortal's common offering. Ales, lagers, stouts, and more.

**WINE** - The fruit of the vine. Regions, varieties, pairings.

**WHISKEY** - Bourbon, scotch, rye. The amber spirits.

**COFFEE & TEA** - The awakening elixirs.

Use \`/ask <your question>\` to seek the ancient wisdom.`,
  };
}
