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
} from '../tribute-tracker';
import { ISEE_EMOJI } from '../personality';
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
  const imageAttachment = message.attachments.find(att =>
    att.contentType?.startsWith('image/')
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

  // No image - treat as a question/conversation
  const response = await handleMention(message.content, channelId);
  await message.reply(response.content);
}
