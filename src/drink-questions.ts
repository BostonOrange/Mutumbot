/**
 * Drink Questions Handler
 *
 * Mutumbot dispenses ANCIENT WISDOM about beverages,
 * with particular reverence for tiki drinks and rum.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
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
