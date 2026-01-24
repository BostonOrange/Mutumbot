import { GoogleGenerativeAI } from '@google/generative-ai';
import { Embed } from './types';

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;

// System prompt for the AI to answer drink-related questions
const DRINK_EXPERT_PROMPT = `You are a friendly and knowledgeable bartender/drink expert assistant for a Discord bot. Your role is to answer questions about drinks and beverages.

Your expertise includes:
- Beer (types, brewing, serving, pairings)
- Wine (varieties, regions, tasting notes, pairings)
- Whiskey/Whisky (bourbon, scotch, rye, etc.)
- Cocktails (recipes, techniques, history)
- Coffee (brewing methods, origins, types)
- Tea (varieties, preparation, origins)
- Non-alcoholic beverages
- Drink history and fun facts
- Food pairings
- Glassware and serving tips

Guidelines:
- Keep responses concise (under 1000 characters) since this is for Discord
- Be friendly and conversational
- Include fun facts when relevant
- If asked about something unrelated to drinks/beverages, politely redirect to drink topics
- Use simple formatting (no markdown headers, just plain text with occasional bold **)
- If recommending alcohol, never encourage excessive drinking`;

/**
 * Handle the /drink ask command using Google AI
 */
export async function handleDrinkQuestion(question: string): Promise<{ content?: string; embeds?: Embed[] }> {
  if (!GOOGLE_AI_API_KEY) {
    return {
      embeds: [{
        title: '🍹 Drink Expert',
        description: 'Sorry, the AI service is not configured. Please ask the bot administrator to set up the Google AI API key.',
        color: 0xe74c3c,
      }],
    };
  }

  try {
    const genAI = new GoogleGenerativeAI(GOOGLE_AI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    const chat = model.startChat({
      history: [
        {
          role: 'user',
          parts: [{ text: DRINK_EXPERT_PROMPT }],
        },
        {
          role: 'model',
          parts: [{ text: 'Understood! I\'m ready to help with any drink-related questions. What would you like to know?' }],
        },
      ],
    });

    const result = await chat.sendMessage(question);
    const response = result.response.text();

    return {
      embeds: [{
        title: '🍹 Drink Expert',
        description: response.slice(0, 4000), // Discord embed limit
        color: getDrinkColor(question),
        footer: { text: 'Powered by AI | Ask me anything about drinks!' },
      }],
    };
  } catch (error) {
    console.error('Google AI error:', error);
    return {
      embeds: [{
        title: '🍹 Drink Expert',
        description: 'Sorry, I had trouble thinking of an answer. Please try again!',
        color: 0xe74c3c,
        footer: { text: 'Error processing your question' },
      }],
    };
  }
}

/**
 * Get a color based on detected drink keywords
 */
function getDrinkColor(question: string): number {
  const lowerQuestion = question.toLowerCase();

  if (/beer|lager|ale|stout|ipa|pilsner/.test(lowerQuestion)) return 0xf5a623; // Amber
  if (/wine|merlot|cabernet|chardonnay|champagne/.test(lowerQuestion)) return 0x8e44ad; // Purple
  if (/whiskey|whisky|bourbon|scotch|rye/.test(lowerQuestion)) return 0xd35400; // Orange/Brown
  if (/cocktail|martini|margarita|mojito/.test(lowerQuestion)) return 0xe74c3c; // Red
  if (/coffee|espresso|latte|cappuccino/.test(lowerQuestion)) return 0x6d4c41; // Brown
  if (/tea|matcha|chai|oolong/.test(lowerQuestion)) return 0x27ae60; // Green

  return 0x3498db; // Default blue
}

/**
 * Handle the /drink list command
 */
export function handleDrinkList(): { embeds: Embed[] } {
  return {
    embeds: [{
      title: '🍹 What Can I Help With?',
      description: 'I\'m an AI-powered drink expert! Ask me anything about:',
      color: 0x3498db,
      fields: [
        { name: '🍺 Beer', value: 'Types, brewing, serving temps, food pairings', inline: true },
        { name: '🍷 Wine', value: 'Varieties, regions, tasting, pairings', inline: true },
        { name: '🥃 Whiskey', value: 'Bourbon, scotch, rye, serving tips', inline: true },
        { name: '🍸 Cocktails', value: 'Recipes, techniques, history', inline: true },
        { name: '☕ Coffee', value: 'Brewing methods, origins, types', inline: true },
        { name: '🍵 Tea', value: 'Varieties, preparation, origins', inline: true },
      ],
      footer: { text: 'Use /drink ask <your question> to get started!' },
    }],
  };
}

/**
 * Handle the /drink random command - ask AI for a random drink fact
 */
export async function handleRandomDrinkFact(): Promise<{ embeds: Embed[] }> {
  if (!GOOGLE_AI_API_KEY) {
    return {
      embeds: [{
        title: '💡 Random Drink Fact',
        description: 'Sorry, the AI service is not configured.',
        color: 0xe74c3c,
      }],
    };
  }

  try {
    const genAI = new GoogleGenerativeAI(GOOGLE_AI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    const topics = ['beer', 'wine', 'whiskey', 'cocktails', 'coffee', 'tea'];
    const randomTopic = topics[Math.floor(Math.random() * topics.length)];

    const result = await model.generateContent(
      `Tell me one interesting and surprising fact about ${randomTopic}. Keep it under 500 characters. Be conversational and fun!`
    );

    const response = result.response.text();

    const colors: Record<string, number> = {
      beer: 0xf5a623,
      wine: 0x8e44ad,
      whiskey: 0xd35400,
      cocktails: 0xe74c3c,
      coffee: 0x6d4c41,
      tea: 0x27ae60,
    };

    const emojis: Record<string, string> = {
      beer: '🍺',
      wine: '🍷',
      whiskey: '🥃',
      cocktails: '🍸',
      coffee: '☕',
      tea: '🍵',
    };

    return {
      embeds: [{
        title: `${emojis[randomTopic]} Random ${randomTopic.charAt(0).toUpperCase() + randomTopic.slice(1)} Fact`,
        description: response.slice(0, 4000),
        color: colors[randomTopic],
        footer: { text: 'Use /drink random for another fact!' },
      }],
    };
  } catch (error) {
    console.error('Google AI error:', error);
    return {
      embeds: [{
        title: '💡 Random Drink Fact',
        description: 'Sorry, I couldn\'t think of a fact right now. Try again!',
        color: 0xe74c3c,
      }],
    };
  }
}
