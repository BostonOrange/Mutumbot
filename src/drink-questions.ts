/**
 * Drink Questions Handler
 *
 * Mutumbot dispenses ANCIENT WISDOM about beverages,
 * with particular reverence for tiki drinks and rum.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
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

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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
  "response": "Your full in-character response as MUTUMBOT (2-3 sentences)"
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

Keep your response mysterious and theatrical but not too long.`;
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
 * Analyze image using Google Gemini
 */
async function analyzeImageWithGemini(
  base64: string,
  contentType: string,
  prompt: string
): Promise<ImageAnalysis | null> {
  if (!GOOGLE_AI_API_KEY) {
    return null;
  }

  const genAI = new GoogleGenerativeAI(GOOGLE_AI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: contentType,
        data: base64,
      },
    },
    { text: prompt },
  ]);

  const responseText = result.response.text().trim();
  return parseImageAnalysisResponse(responseText);
}

/**
 * Analyze image using OpenAI GPT-4o (fallback)
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

  const response = await openai.chat.completions.create({
    model: 'gpt-5-nano-2025-08-07',
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
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
    max_tokens: 500,
  });

  const responseText = response.choices[0]?.message?.content?.trim();
  if (!responseText) {
    return null;
  }

  return parseImageAnalysisResponse(responseText);
}

/**
 * Analyze an image and generate a full AI response for the tribute
 * Uses Gemini as primary, falls back to OpenAI if Gemini fails (e.g., rate limit)
 */
export async function analyzeImage(
  imageUrl: string,
  userMessage?: string,
  isFriday?: boolean,
  isDM?: boolean
): Promise<ImageAnalysis | null> {
  // Need at least one AI provider
  if (!GOOGLE_AI_API_KEY && !OPENAI_API_KEY) {
    console.error('No AI API keys configured for image analysis');
    return null;
  }

  try {
    // Fetch the image from Discord CDN
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.error('Failed to fetch image:', response.status);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const prompt = buildImageAnalysisPrompt(userMessage, isFriday, isDM);

    // Try Gemini first (primary)
    if (GOOGLE_AI_API_KEY) {
      try {
        const geminiResult = await analyzeImageWithGemini(base64, contentType, prompt);
        if (geminiResult) {
          console.log('Image analyzed with Gemini');
          return geminiResult;
        }
      } catch (error) {
        console.error('Gemini analysis failed, trying OpenAI fallback:', error);
      }
    }

    // Fallback to OpenAI
    if (OPENAI_API_KEY) {
      try {
        const openaiResult = await analyzeImageWithOpenAI(base64, contentType, prompt);
        if (openaiResult) {
          console.log('Image analyzed with OpenAI (fallback)');
          return openaiResult;
        }
      } catch (error) {
        console.error('OpenAI fallback also failed:', error);
      }
    }

    console.error('All AI providers failed for image analysis');
    return null;
  } catch (error) {
    console.error('Image analysis error:', error);
    return null;
  }
}

/**
 * Handle the /ask command using Google AI with Mutumbot personality
 */
export async function handleDrinkQuestion(
  question: string,
  channelId?: string
): Promise<{ content: string }> {
  if (!GOOGLE_AI_API_KEY) {
    return {
      content: `${ISEE_EMOJI} The spirits are SILENT. The ancient connection to the AI realm has not been established. Summon the bot administrator to configure the sacred API key.`,
    };
  }

  try {
    const genAI = new GoogleGenerativeAI(GOOGLE_AI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

    // Build chat history with system prompt and conversation context
    const baseHistory = [
      {
        role: 'user' as const,
        parts: [{ text: MUTUMBOT_SYSTEM_PROMPT }],
      },
      {
        role: 'model' as const,
        parts: [{ text: MUTUMBOT_AWAKENING }],
      },
    ];

    // Add conversation context if we have a channel ID
    const contextHistory = channelId ? formatContextForAI(channelId) : [];

    const chat = model.startChat({
      history: [...baseHistory, ...contextHistory],
    });

    const result = await chat.sendMessage(question);
    let response = result.response.text();

    // Process [ISEE] markers in the response
    response = processIseeMarkers(response);

    // Store this exchange in context for future reference
    if (channelId) {
      addToContext(channelId, 'user', question);
      addToContext(channelId, 'model', response);
    }

    // Truncate if too long (Discord limit)
    if (response.length > 2000) {
      response = response.slice(0, 1997) + '...';
    }

    return { content: response };
  } catch (error) {
    console.error('Google AI error:', error);
    return {
      content: `${ISEE_EMOJI} The spirits are DISTURBED. Something has disrupted the ancient connection. Try again, mortal.`,
    };
  }
}

/**
 * Handle a general @mention without a specific question
 * Used by the gateway bot
 */
export async function handleMention(
  message: string,
  channelId: string
): Promise<{ content: string }> {
  // If there's actual content beyond the mention, treat it as a question
  const cleanedMessage = message.replace(/<@!?\d+>/g, '').trim();

  if (cleanedMessage.length > 0) {
    return handleDrinkQuestion(cleanedMessage, channelId);
  }

  // Just a mention with no question - respond mysteriously
  const responses = [
    `${ISEE_EMOJI} You have summoned the ancient one. What knowledge do you seek from the TIKI DEPTHS?`,
    `${ISEE_EMOJI} I AWAKEN... The spirits stir. Speak your query, mortal.`,
    `${ISEE_EMOJI} You dare invoke my name? Very well... ASK, and the ancient wisdom shall flow.`,
    `The spirits sense your presence. What do you seek from MUTUMBOT?`,
    `${ISEE_EMOJI} I SEE you, mortal. Do you require the ancient knowledge of libations?`,
  ];

  return {
    content: responses[Math.floor(Math.random() * responses.length)],
  };
}

/**
 * Handle the legacy /drink random command - random tiki/drink fact
 */
export async function handleRandomDrinkFact(): Promise<{ content: string }> {
  if (!GOOGLE_AI_API_KEY) {
    return {
      content: `${ISEE_EMOJI} The spirits are SILENT. The sacred API connection is not configured.`,
    };
  }

  try {
    const genAI = new GoogleGenerativeAI(GOOGLE_AI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

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

    const result = await model.generateContent(prompt);
    let response = result.response.text();

    // Process [ISEE] markers
    response = processIseeMarkers(response);

    return { content: response };
  } catch (error) {
    console.error('Google AI error:', error);
    return {
      content: `${ISEE_EMOJI} The ancient knowledge eludes me momentarily. The spirits are... DISTRACTED. Try again.`,
    };
  }
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
