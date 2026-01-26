/**
 * Drink Questions Handler
 *
 * Mutumbot dispenses ANCIENT WISDOM about beverages,
 * with particular reverence for tiki drinks and rum.
 */

import OpenAI from 'openai';
import {
  MUTUMBOT_SYSTEM_PROMPT,
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
  ContextPack,
} from './services/contextBuilder';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// OpenRouter client for Gemini 2.5 Flash Lite
const openrouter = OPENROUTER_API_KEY
  ? new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: OPENROUTER_API_KEY,
    })
  : null;

const OPENROUTER_MODEL = 'google/gemini-2.5-flash-lite';

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
    model: OPENROUTER_MODEL,
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
async function analyzeImageWithOpenAI(
  base64: string,
  contentType: string,
  prompt: string
): Promise<ImageAnalysis | null> {
  if (!OPENAI_API_KEY) {
    return null;
  }

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  const response = await openai.responses.create({
    model: 'gpt-5-nano-2025-08-07',
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          {
            type: 'input_image',
            image_url: `data:${contentType};base64,${base64}`,
            detail: 'auto',
          },
        ],
      },
    ],
  });

  const responseText = response.output_text?.trim();
  if (!responseText) {
    return null;
  }

  return parseImageAnalysisResponse(responseText);
}

/**
 * Analyze an image and generate a full AI response for the tribute
 * Uses OpenRouter (Gemini 2.5 Flash Lite) as primary, falls back to OpenAI if it fails
 */
export async function analyzeImage(
  imageUrl: string,
  userMessage?: string,
  isFriday?: boolean,
  isDM?: boolean
): Promise<ImageAnalysis | null> {
  // Need at least one AI provider
  if (!OPENROUTER_API_KEY && !OPENAI_API_KEY) {
    console.error('No AI API keys configured for image analysis. OPENROUTER_API_KEY:', !!OPENROUTER_API_KEY, 'OPENAI_API_KEY:', !!OPENAI_API_KEY);
    return null;
  }

  console.log('analyzeImage called. OpenRouter available:', !!OPENROUTER_API_KEY, 'OpenAI available:', !!OPENAI_API_KEY);

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

    // Try OpenRouter first (primary - Gemini 2.5 Flash Lite)
    if (OPENROUTER_API_KEY) {
      try {
        console.log('Attempting OpenRouter (Gemini 2.5 Flash Lite) image analysis...');
        const openrouterResult = await analyzeImageWithOpenRouter(base64, contentType, prompt);
        if (openrouterResult) {
          console.log('Image analyzed with OpenRouter. Category:', openrouterResult.category, 'Score:', openrouterResult.score);
          return openrouterResult;
        }
        console.error('OpenRouter returned null result');
      } catch (error) {
        console.error('OpenRouter analysis failed, trying OpenAI fallback. Error:', (error as Error).message || error);
      }
    }

    // Fallback to OpenAI
    if (OPENAI_API_KEY) {
      try {
        console.log('Attempting OpenAI image analysis (fallback)...');
        const openaiResult = await analyzeImageWithOpenAI(base64, contentType, prompt);
        if (openaiResult) {
          console.log('Image analyzed with OpenAI. Category:', openaiResult.category, 'Score:', openaiResult.score);
          return openaiResult;
        }
        console.error('OpenAI returned null result');
      } catch (error) {
        console.error('OpenAI fallback also failed. Error:', (error as Error).message || error);
      }
    }

    console.error('All AI providers failed for image analysis');
    return null;
  } catch (error) {
    console.error('Image analysis error:', (error as Error).message || error);
    return null;
  }
}

/**
 * Chat with OpenRouter (Gemini 2.5 Flash Lite) with conversation history
 * Supports both in-memory context and database transcript context
 */
async function chatWithOpenRouter(
  question: string,
  channelId?: string,
  aiContext?: string,
  transcript?: string
): Promise<string | null> {
  if (!openrouter) {
    return null;
  }

  // Build system prompt with optional database context (tribute stats) and transcript
  let systemPrompt = MUTUMBOT_SYSTEM_PROMPT;

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

  const response = await openrouter.chat.completions.create({
    model: OPENROUTER_MODEL,
    messages,
  });

  return response.choices[0]?.message?.content || null;
}

/**
 * Chat with OpenAI (with conversation history) - fallback
 * Now supports both in-memory context and database transcript context
 */
async function chatWithOpenAI(
  question: string,
  channelId?: string,
  aiContext?: string,
  transcript?: string
): Promise<string | null> {
  if (!OPENAI_API_KEY) {
    return null;
  }

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  // Build system prompt with optional database context and transcript
  let systemPrompt = MUTUMBOT_SYSTEM_PROMPT;

  // Add database context (tribute statistics, leaderboards)
  if (aiContext) {
    systemPrompt += `\n\n--- CURRENT DATABASE CONTEXT ---\n${aiContext}`;
  }

  // Add channel transcript (recent conversation history from DB)
  if (transcript) {
    systemPrompt += `\n\n--- RECENT CHANNEL CONVERSATION ---\nThis is the recent conversation in this channel. Use this to understand context:\n${transcript}`;
  }

  // Build input array for OpenAI responses API
  const input: Array<{ role: string; content: string }> = [
    { role: 'developer', content: systemPrompt },
    { role: 'assistant', content: MUTUMBOT_AWAKENING },
  ];

  // If we have a transcript, we don't need the in-memory context
  // Otherwise, fall back to in-memory for backward compatibility
  if (!transcript && channelId) {
    const contextHistory = formatContextForAI(channelId);
    for (const entry of contextHistory) {
      const role = entry.role === 'user' ? 'user' : 'assistant';
      const text = entry.parts.map((p: { text: string }) => p.text).join('');
      input.push({ role, content: text });
    }
  }

  // Add the current question
  input.push({ role: 'user', content: question });

  const response = await openai.responses.create({
    model: 'gpt-5-nano-2025-08-07',
    input: input as any,
  });

  return response.output_text || null;
}

/**
 * Handle the /ask command using AI with Mutumbot personality
 * Uses OpenRouter (Gemini 2.5 Flash Lite) as primary, falls back to OpenAI if it fails
 *
 * @param question - The user's question
 * @param channelId - Channel ID for context
 * @param aiContext - Optional tribute/stats context from database
 * @param messageId - Optional trigger message ID for building conversation transcript
 */
export async function handleDrinkQuestion(
  question: string,
  channelId?: string,
  aiContext?: string,
  messageId?: string
): Promise<{ content: string }> {
  if (!OPENROUTER_API_KEY && !OPENAI_API_KEY) {
    return {
      content: `${ISEE_EMOJI} The spirits are SILENT. The ancient connection to the AI realm has not been established. Summon the bot administrator to configure the sacred API key.`,
    };
  }

  // Build conversation transcript from database if we have message ID
  let transcript: string | undefined;
  if (channelId && messageId) {
    try {
      const contextPack = await buildContextPack(channelId, messageId);
      if (contextPack && contextPack.transcript) {
        transcript = contextPack.transcript;
        console.log(`[Context] Built transcript: ${contextPack.messageCount} messages`);
      }
    } catch (error) {
      console.error('[Context] Failed to build transcript:', error);
      // Continue without transcript - will fall back to in-memory context
    }
  }

  let response: string | null = null;

  // Try OpenRouter first (Gemini 2.5 Flash Lite)
  if (OPENROUTER_API_KEY) {
    try {
      response = await chatWithOpenRouter(question, channelId, aiContext, transcript);
      if (response) {
        console.log('Chat handled by OpenRouter (Gemini 2.5 Flash Lite)');
      }
    } catch (error) {
      console.error('OpenRouter chat failed, trying OpenAI fallback:', error);
    }
  }

  // Fallback to OpenAI
  if (!response && OPENAI_API_KEY) {
    try {
      response = await chatWithOpenAI(question, channelId, aiContext, transcript);
      if (response) {
        console.log('Chat handled by OpenAI (fallback)');
      }
    } catch (error) {
      console.error('OpenAI chat fallback also failed:', error);
    }
  }

  if (!response) {
    return {
      content: `${ISEE_EMOJI} The spirits are DISTURBED. Something has disrupted the ancient connection. Try again, mortal.`,
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

  return { content: response };
}

/**
 * Handle a general @mention without a specific question
 * Used by the gateway bot
 *
 * @param message - The raw message content
 * @param channelId - Channel ID for context
 * @param aiContext - Optional tribute/stats context from database
 * @param messageId - Optional trigger message ID for building conversation transcript
 */
export async function handleMention(
  message: string,
  channelId: string,
  aiContext?: string,
  messageId?: string
): Promise<{ content: string }> {
  // If there's actual content beyond the mention, treat it as a question
  const cleanedMessage = message.replace(/<@!?\d+>/g, '').trim();

  if (cleanedMessage.length > 0) {
    return handleDrinkQuestion(cleanedMessage, channelId, aiContext, messageId);
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
    model: OPENROUTER_MODEL,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.choices[0]?.message?.content || null;
}

/**
 * Generate simple text with OpenAI (fallback)
 */
async function generateWithOpenAI(prompt: string): Promise<string | null> {
  if (!OPENAI_API_KEY) {
    return null;
  }

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  const response = await openai.responses.create({
    model: 'gpt-5-nano-2025-08-07',
    input: prompt,
  });

  return response.output_text || null;
}

/**
 * Handle the legacy /drink random command - random tiki/drink fact
 * Uses OpenRouter (Gemini 2.5 Flash Lite) as primary, falls back to OpenAI if it fails
 */
export async function handleRandomDrinkFact(): Promise<{ content: string }> {
  if (!OPENROUTER_API_KEY && !OPENAI_API_KEY) {
    return {
      content: `${ISEE_EMOJI} The spirits are SILENT. The sacred API connection is not configured.`,
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

  // Try OpenRouter first (Gemini 2.5 Flash Lite)
  if (OPENROUTER_API_KEY) {
    try {
      response = await generateWithOpenRouter(prompt);
      if (response) {
        console.log('Random fact generated by OpenRouter (Gemini 2.5 Flash Lite)');
      }
    } catch (error) {
      console.error('OpenRouter generation failed, trying OpenAI fallback:', error);
    }
  }

  // Fallback to OpenAI
  if (!response && OPENAI_API_KEY) {
    try {
      response = await generateWithOpenAI(prompt);
      if (response) {
        console.log('Random fact generated by OpenAI (fallback)');
      }
    } catch (error) {
      console.error('OpenAI generation fallback also failed:', error);
    }
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
