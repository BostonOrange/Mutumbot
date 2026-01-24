/**
 * Mention Handler
 *
 * Handles @Mutumbot mentions in Discord messages.
 * Detects image attachments for tribute offerings (any day!).
 * DM tributes are acknowledged but don't count toward competitive tallies.
 * Now with VISION - Mutumbot actually SEES the images!
 */

import { Message } from 'discord.js';
import { handleMention, analyzeImage, TRIBUTE_SCORES, type ImageAnalysis } from '../drink-questions';
import {
  handleMentionTribute,
  getFullUserStats,
  getPrivateDevotionStats,
  recordTributePost,
  getLeaderboardContext,
  getFridayStatus,
  getAllTimeLeaderboard,
  getDailyLeaderboard,
  getFridayLeaderboard,
  isFriday,
} from '../tribute-tracker';
import { ISEE_EMOJI, getRandomPhrase, NO_TRIBUTES_PHRASES, TRIBUTES_RECEIVED_STATUS } from '../personality';
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
 */
export async function handleMentionMessage(message: Message): Promise<void> {
  const guildId = message.guild?.id || 'dm';
  const channelId = message.channel.id;
  const userId = message.author.id;
  const username = message.author.username;
  const isDM = !message.guild;

  // Check for image attachments
  // Note: contentType can be null/undefined for some Discord attachments,
  // so we also check the URL for common image extensions as fallback
  const imageAttachment = message.attachments.find(att =>
    att.contentType?.startsWith('image/') ||
    /\.(png|jpg|jpeg|gif|webp)($|\?)/i.test(att.url)
  );

  // Check if today is Friday
  const isSpecialDay = new Date().getDay() === 5;

  // If there's an image, treat as a tribute (any day!)
  if (imageAttachment) {
    // Analyze the image so Mutumbot actually SEES and JUDGES it
    // Pass context so AI can generate appropriate response
    const imageAnalysis = await analyzeImage(imageAttachment.url, message.content, isSpecialDay, isDM);

    // Store the user's message and image analysis in context for follow-up questions
    const userContextMessage = message.content
      ? `[Sent an image with message: "${message.content.replace(/<@!?\d+>/g, '').trim()}"]`
      : '[Sent an image as tribute]';
    addToContext(channelId, 'user', userContextMessage);

    if (imageAnalysis) {
      // Store what Mutumbot saw + the scoring in context
      const categoryLabel = CATEGORY_LABELS[imageAnalysis.category] || imageAnalysis.category;
      addToContext(channelId, 'model', `[I observed this image: ${imageAnalysis.description}. Category: ${categoryLabel}${imageAnalysis.drinkName ? `, identified as: ${imageAnalysis.drinkName}` : ''}. Worth ${imageAnalysis.score} points.]`);
    }

    // DM tributes go to private devotion tally (separate from competitive leaderboard)
    if (isDM) {
      const score = imageAnalysis?.score || TRIBUTE_SCORES.OTHER;

      // Record the DM tribute to private devotion
      recordTributePost({
        userId,
        username,
        timestamp: new Date().toISOString(),
        imageUrl: imageAttachment.url,
        guildId: 'dm',
      }, score);

      // Get all their stats (for AI context, not display)
      const privateStats = getPrivateDevotionStats(userId);
      const publicStats = getFullUserStats(userId);

      // Use AI-generated response if available, otherwise fallback
      let dmResponse: string;
      if (imageAnalysis?.response) {
        dmResponse = `${ISEE_EMOJI} ${imageAnalysis.response}`;
      } else {
        dmResponse = `${ISEE_EMOJI} I SEE your private offering, **${username}**... The spirits acknowledge your devotion.`;
      }

      // Add comprehensive stats to context for AI (user can ask for stats)
      addToContext(channelId, 'model', `[${username}'s stats - Private devotion: ${privateStats.score}pts from ${privateStats.count} DM tributes. Public channel: ${publicStats.allTime.score}pts from ${publicStats.allTime.count} tributes (${publicStats.friday.score}pts on Fridays). Scoring: Tiki=10pts, Cocktail=5pts, Beer/Wine=2pts, Other=1pt. DM tributes don't count toward public leaderboard. User can ask "what's my score" or "how many tributes" to get their stats.]`);

      await message.reply(dmResponse);
      return;
    }

    // Public channel tribute
    const result = handleMentionTribute(
      userId,
      username,
      guildId,
      imageAttachment.url,
      message.content,
      imageAnalysis || undefined
    );

    // Add comprehensive stats + leaderboard info to context
    const stats = getFullUserStats(userId);
    const leaderboard = getLeaderboardContext();
    addToContext(channelId, 'model', `[${username}'s updated stats - Today: ${stats.daily.score}pts (${stats.daily.count} tributes), Fridays: ${stats.friday.score}pts, All-time: ${stats.allTime.score}pts (${stats.allTime.count} tributes). Scoring: Tiki=10pts, Cocktail=5pts, Beer/Wine=2pts, Other=1pt.]\n${leaderboard}`);

    await message.reply(result.content);
    return;
  }

  // No image - check for status/tally keywords first
  const cleanedContent = message.content.replace(/<@!?\d+>/g, '').trim().toLowerCase();

  // Check for status/tally related keywords
  if (isStatusQuery(cleanedContent)) {
    const statusResponse = handleStatusQuery(userId, username, guildId, isDM);
    await message.reply(statusResponse);
    return;
  }

  // Check for personal stats queries
  if (isPersonalStatsQuery(cleanedContent)) {
    const statsResponse = handlePersonalStatsQuery(userId, username);
    await message.reply(statsResponse);
    return;
  }

  // Check for leaderboard queries
  if (isLeaderboardQuery(cleanedContent)) {
    const leaderboardResponse = handleLeaderboardQuery();
    await message.reply(leaderboardResponse);
    return;
  }

  // General question/conversation - add user stats context so AI can answer stats questions
  const stats = getFullUserStats(userId);
  const privateStats = getPrivateDevotionStats(userId);
  const leaderboard = getLeaderboardContext();
  addToContext(channelId, 'model', `[${username}'s current stats - All-time: ${stats.allTime.score}pts (${stats.allTime.count} tributes), Fridays: ${stats.friday.score}pts, Today: ${stats.daily.score}pts. Private devotion: ${privateStats.score}pts from ${privateStats.count} DM tributes. Scoring: Tiki=10pts, Cocktail=5pts, Beer/Wine=2pts, Other=1pt.]\n${leaderboard}`);

  const response = await handleMention(message.content, channelId);
  await message.reply(response.content);
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
 * Handle tribute status query
 */
function handleStatusQuery(userId: string, username: string, guildId: string, isDM: boolean): string {
  const status = getFridayStatus(guildId);
  const fridayLabel = isFriday() ? 'this sacred Friday' : `Friday (${status.date})`;

  if (!status.hasTributePost) {
    return `${getRandomPhrase(NO_TRIBUTES_PHRASES)}\n\n**${fridayLabel}**: The offering hall stands EMPTY.${isFriday() ? '\n\nMention me with an image to make your offering!' : ''}`;
  }

  const devotees = status.posts.map(p => {
    const stats = getFullUserStats(p.userId);
    const fridayS = getFridayLeaderboard().find(e => e.userId === p.userId);
    return `  - ${p.username} (${stats.allTime.score}pts from ${stats.allTime.count} tributes | Fridays: ${fridayS?.score || 0}pts)`;
  }).join('\n');

  let response = `${getRandomPhrase(TRIBUTES_RECEIVED_STATUS)}\n\n**${fridayLabel}**: ${status.posts.length} offering${status.posts.length !== 1 ? 's' : ''} recorded.\n\n**Devoted mortals:**\n${devotees}`;

  // Add leaderboard teaser
  const leaderboard = getAllTimeLeaderboard();
  if (leaderboard.length > 0) {
    const top = leaderboard[0];
    response += `\n\n${ISEE_EMOJI} **Most devoted:** <@${top.userId}> with ${top.score}pts from ${top.count} tributes`;
  }

  return response;
}

/**
 * Handle personal stats query
 */
function handlePersonalStatsQuery(userId: string, username: string): string {
  const stats = getFullUserStats(userId);
  const allTimeBoard = getAllTimeLeaderboard();
  const rank = allTimeBoard.findIndex(e => e.userId === userId) + 1;
  const rankText = rank > 0 ? `#${rank} of ${allTimeBoard.length}` : 'Unranked';

  return `${ISEE_EMOJI} **${username}**, the spirits reveal your devotion...\n\n` +
    `**All-Time:** ${stats.allTime.score} pts (${stats.allTime.count} tributes) - ${rankText}\n` +
    `**Fridays:** ${stats.friday.score} pts (${stats.friday.count} tributes)\n` +
    `**Today:** ${stats.daily.score} pts (${stats.daily.count} tributes)\n` +
    `**Private Devotion:** ${stats.private.score} pts (${stats.private.count} DM tributes)\n\n` +
    `*Scoring: Tiki=10pts, Cocktail=5pts, Beer/Wine=2pts, Other=1pt*`;
}

/**
 * Handle leaderboard query
 */
function handleLeaderboardQuery(): string {
  const allTime = getAllTimeLeaderboard().slice(0, 10);
  const daily = getDailyLeaderboard().slice(0, 5);
  const friday = getFridayLeaderboard().slice(0, 5);

  let content = `${ISEE_EMOJI} **THE SPIRITS REVEAL THE DEVOTED...**\n\n`;

  if (allTime.length > 0) {
    content += `**🏆 All-Time Rankings:**\n`;
    allTime.forEach((entry, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      content += `${medal} <@${entry.userId}> - ${entry.score}pts (${entry.count} tributes)\n`;
    });
  } else {
    content += `*No tributes yet... The spirits HUNGER.*\n`;
  }

  if (daily.length > 0) {
    content += `\n**📅 Today's Devoted:**\n`;
    daily.forEach((entry, i) => {
      content += `${i + 1}. <@${entry.userId}> - ${entry.score}pts\n`;
    });
  }

  if (friday.length > 0) {
    content += `\n**🗿 Friday Champions:**\n`;
    friday.forEach((entry, i) => {
      content += `${i + 1}. <@${entry.userId}> - ${entry.score}pts\n`;
    });
  }

  return content;
}
