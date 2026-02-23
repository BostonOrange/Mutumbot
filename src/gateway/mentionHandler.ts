/**
 * Mention Handler
 *
 * Handles @Mutumbot mentions in Discord messages.
 * Detects image attachments for tribute offerings (any day!).
 * Uses database for all persistent storage.
 * Provides rich AI context for answering questions.
 */

import { Message } from 'discord.js';
import { handleMention, analyzeImage, TRIBUTE_SCORES } from '../drink-questions';
import {
  handleMentionTribute,
  recordTributePost,
  getFullUserStats,
  getAllTimeLeaderboard,
  getDailyLeaderboard,
  getFridayLeaderboard,
  getFridayStatus,
  getFridayStats,
  getLeaderboardContext,
  getAIContext,
  isFriday,
} from '../tribute-tracker';
import { ISEE_EMOJI, getRandomPhrase, NO_TRIBUTES_PHRASES, TRIBUTES_RECEIVED_STATUS } from '../personality';
import { formatPersonalStats, formatLeaderboard } from '../formatters';
import { addToContext } from '../services/conversationContext';

// Category labels for context
const CATEGORY_LABELS: Record<string, string> = {
  TIKI: 'Tiki (10pts)',
  COCKTAIL: 'Cocktail (5pts)',
  BEER_WINE: 'Beer/Wine (2pts)',
  OTHER: 'Other (1pt)',
};

/**
 * Handle a message that mentions Mutumbot
 * Returns the reply message for context ingestion
 */
export async function handleMentionMessage(message: Message): Promise<Message | null> {
  const guildId = message.guild?.id || 'dm';
  const channelId = message.channel.id;
  const userId = message.author.id;
  const username = message.member?.displayName || message.author.displayName || message.author.username;
  const isDM = !message.guild;

  // Check for image attachments
  const imageAttachment = message.attachments.find(att =>
    att.contentType?.startsWith('image/') ||
    /\.(png|jpg|jpeg|gif|webp)($|\?)/i.test(att.url)
  );

  const isSpecialDay = isFriday();

  // If there's an image, treat as a tribute
  if (imageAttachment) {
    const imageAnalysis = await analyzeImage(imageAttachment.url, message.content, isSpecialDay, isDM);

    // Store user's message in context
    const userContextMessage = message.content
      ? `[Sent an image with message: "${message.content.replace(/<@!?\d+>/g, '').trim()}"]`
      : '[Sent an image as tribute]';
    addToContext(channelId, 'user', userContextMessage);

    if (imageAnalysis) {
      const categoryLabel = CATEGORY_LABELS[imageAnalysis.category] || imageAnalysis.category;
      addToContext(channelId, 'model', `[I observed this image: ${imageAnalysis.description}. Category: ${categoryLabel}${imageAnalysis.drinkName ? `, identified as: ${imageAnalysis.drinkName}` : ''}. Worth ${imageAnalysis.score} points.]`);
    }

    // DM tributes
    if (isDM) {
      const score = imageAnalysis?.score || TRIBUTE_SCORES.OTHER;
      const category = (imageAnalysis?.category as 'TIKI' | 'COCKTAIL' | 'BEER_WINE' | 'OTHER') || 'OTHER';

      let recordFailed = false;
      try {
        await recordTributePost(
          { userId, username, guildId: 'dm', channelId, imageUrl: imageAttachment.url, timestamp: new Date().toISOString() },
          score,
          category,
          imageAnalysis?.drinkName,
          imageAnalysis?.description,
          imageAnalysis?.response
        );
      } catch (error) {
        console.error('Failed to record DM tribute to database:', error);
        recordFailed = true;
      }

      let dmResponse: string;
      if (imageAnalysis?.response) {
        dmResponse = `${ISEE_EMOJI} ${imageAnalysis.response}`;
      } else {
        dmResponse = `${ISEE_EMOJI} I SEE your private offering, **${username}**... The spirits acknowledge your devotion.`;
      }

      if (recordFailed) {
        dmResponse += `\n\n⚠️ **The ancient scrolls failed to record this tribute!** The database spirits are unresponsive. Please try again later — your offering was witnessed but NOT saved.`;
      }

      const reply = await message.reply(dmResponse);
      return reply;
    }

    // Public channel tribute
    const result = await handleMentionTribute(
      userId,
      username,
      guildId,
      channelId,
      imageAttachment.url,
      message.content,
      imageAnalysis || undefined
    );

    const reply = await message.reply(result.content);
    return reply;
  }

  // No image - check for status/tally keywords first
  const cleanedContent = message.content.replace(/<@!?\d+>/g, '').trim().toLowerCase();

  // Check for status query
  if (isStatusQuery(cleanedContent)) {
    const statusResponse = await handleStatusQuery(userId, username, guildId);
    const reply = await message.reply(statusResponse);
    return reply;
  }

  // Check for personal stats query
  if (isPersonalStatsQuery(cleanedContent)) {
    const statsResponse = await handlePersonalStatsQuery(userId, username);
    const reply = await message.reply(statsResponse);
    return reply;
  }

  // Check for leaderboard query
  if (isLeaderboardQuery(cleanedContent)) {
    const leaderboardResponse = await handleLeaderboardQuery();
    const reply = await message.reply(leaderboardResponse);
    return reply;
  }

  // General question/conversation - only include database context if question relates to tributes/data
  const aiContext = needsTributeContext(cleanedContent)
    ? await getAIContext(userId, channelId)
    : undefined;

  // Pass message ID and guild ID for ChatKit-style context building
  const response = await handleMention(message.content, channelId, aiContext, message.id, guildId);

  // Skip if empty response (idempotency - already processed)
  if (!response.content) {
    return null;
  }

  const reply = await message.reply(response.content);
  return reply;
}

/**
 * Check if the message is asking about tribute status
 */
function isStatusQuery(content: string): boolean {
  const statusKeywords = [
    'tribute status', 'status', 'who has offered', 'who has tributed',
    'offerings today', 'friday offerings', 'friday tributes',
    'who offered', 'who tributed', 'any tributes', 'any offerings'
  ];
  return statusKeywords.some(keyword => content.includes(keyword));
}

/**
 * Check if the message is asking about personal stats
 */
function isPersonalStatsQuery(content: string): boolean {
  const personalKeywords = [
    'my stats', 'my score', 'my tributes', 'my tally', 'my devotion',
    'how much have i', 'how many have i', 'how many tributes',
    'how much devotion', 'what is my', 'what\'s my'
  ];
  return personalKeywords.some(keyword => content.includes(keyword));
}

/**
 * Check if the message is asking about the leaderboard
 */
function isLeaderboardQuery(content: string): boolean {
  const leaderboardKeywords = [
    'leaderboard', 'top tributes', 'rankings', 'who is winning',
    'who\'s winning', 'who is leading', 'who\'s leading', 'best devoted',
    'most devoted', 'top devoted', 'tally'
  ];
  return leaderboardKeywords.some(keyword => content.includes(keyword));
}

/**
 * Check if the message relates to tributes/scores/data and needs database context
 * This avoids injecting tribute data into unrelated conversations
 */
function needsTributeContext(content: string): boolean {
  const tributeKeywords = [
    'tribute', 'score', 'tally', 'points', 'pts',
    'devotion', 'offering', 'rank', 'ranking',
    'how many', 'how much', 'total',
    'history', 'record', 'past',
    'friday', 'fridays',
    'who', 'anyone', 'everybody', 'everyone',
    'remember', 'last time', 'before',
  ];
  return tributeKeywords.some(keyword => content.includes(keyword));
}

/**
 * Handle tribute status query
 */
async function handleStatusQuery(userId: string, username: string, guildId: string): Promise<string> {
  const status = await getFridayStatus(guildId);
  const fridayLabel = isFriday() ? 'this sacred Friday' : `Friday (${status.date})`;

  if (!status.hasTributePost) {
    return `${getRandomPhrase(NO_TRIBUTES_PHRASES)}\n\n**${fridayLabel}**: The offering hall stands EMPTY.${isFriday() ? '\n\nMention me with an image to make your offering!' : ''}`;
  }

  const devoteePromises = status.posts.map(async p => {
    const [stats, fridayS] = await Promise.all([
      getFullUserStats(p.userId),
      getFridayStats(p.userId),
    ]);
    return `  - ${p.username} (${stats.allTime.score}pts from ${stats.allTime.count} tributes | Fridays: ${fridayS.score}pts)`;
  });
  const devotees = (await Promise.all(devoteePromises)).join('\n');

  let response = `${getRandomPhrase(TRIBUTES_RECEIVED_STATUS)}\n\n**${fridayLabel}**: ${status.posts.length} offering${status.posts.length !== 1 ? 's' : ''} recorded.\n\n**Devoted mortals:**\n${devotees}`;

  const leaderboard = await getAllTimeLeaderboard(5);
  if (leaderboard.length > 0) {
    const top = leaderboard[0];
    response += `\n\n${ISEE_EMOJI} **Most devoted:** <@${top.userId}> with ${top.score}pts from ${top.count} tributes`;
  }

  return response;
}

/**
 * Handle personal stats query
 */
async function handlePersonalStatsQuery(userId: string, username: string): Promise<string> {
  const [stats, allTimeBoard] = await Promise.all([
    getFullUserStats(userId),
    getAllTimeLeaderboard(50),
  ]);
  const rank = allTimeBoard.findIndex(e => e.userId === userId) + 1;
  const rankText = rank > 0 ? `#${rank} of ${allTimeBoard.length}` : 'Unranked';

  return formatPersonalStats(username, stats, rankText);
}

/**
 * Handle leaderboard query
 */
async function handleLeaderboardQuery(): Promise<string> {
  const [allTimeRaw, dailyRaw, fridayRaw] = await Promise.all([
    getAllTimeLeaderboard(50),
    getDailyLeaderboard(20),
    getFridayLeaderboard(20),
  ]);
  return formatLeaderboard(allTimeRaw.slice(0, 10), dailyRaw.slice(0, 5), fridayRaw.slice(0, 5));
}
