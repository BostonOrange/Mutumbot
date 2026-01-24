/**
 * Mention Handler
 *
 * Handles @Mutumbot mentions in Discord messages.
 * Detects image attachments for tribute offerings (any day!).
 * DM tributes are acknowledged but don't count toward competitive tallies.
 * Now with VISION - Mutumbot actually SEES the images!
 */

import { Message } from 'discord.js';
import { handleMention, analyzeImage } from '../drink-questions';
import {
  handleMentionTribute,
  getAllTimeTribute,
  getDailyTribute,
  getFridayTribute,
} from '../tribute-tracker';
import { ISEE_EMOJI } from '../personality';
import { addToContext } from '../services/conversationContext';

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

  // If there's an image, treat as a tribute (any day!)
  if (imageAttachment) {
    // Analyze the image so Mutumbot actually SEES it
    const imageDescription = await analyzeImage(imageAttachment.url, message.content);

    // Store the user's message and image description in context for follow-up questions
    const userContextMessage = message.content
      ? `[Sent an image with message: "${message.content.replace(/<@!?\d+>/g, '').trim()}"]`
      : '[Sent an image as tribute]';
    addToContext(channelId, 'user', userContextMessage);

    if (imageDescription) {
      // Store what Mutumbot saw in context
      addToContext(channelId, 'model', `[I observed this image: ${imageDescription}]`);
    }

    // DM tributes get a different response (don't count toward tally)
    if (isDM) {
      // Get their public tribute counts (from channel tributes, not DMs)
      const publicAllTime = getAllTimeTribute(userId);
      const publicFriday = getFridayTribute(userId);

      let dmResponse = `${ISEE_EMOJI} I SEE your private offering, **${username}**...`;

      if (imageDescription) {
        dmResponse += ` ${imageDescription}`;
      }

      dmResponse += `\n\nThe spirits acknowledge your devotion.\n\n*Note: DM tributes are between you and the gods alone - they do not count toward the public leaderboard. Tribute in the sacred channels to compete with other mortals!*`;

      // Add their public tribute count info to context so AI can answer follow-up questions
      const tributeInfo = publicAllTime > 0
        ? `[This user has ${publicAllTime} public channel tribute(s) recorded (${publicFriday} on Fridays). DM tributes do not count toward the tally.]`
        : `[This user has no public channel tributes recorded yet. DM tributes do not count toward the tally - they must tribute in a server channel to be counted.]`;
      addToContext(channelId, 'model', tributeInfo);

      await message.reply(dmResponse);
      return;
    }

    const result = handleMentionTribute(
      userId,
      username,
      guildId,
      imageAttachment.url,
      message.content,
      imageDescription || undefined
    );

    // Add tribute count info to context so AI can answer follow-up questions
    const allTime = getAllTimeTribute(userId);
    const daily = getDailyTribute(userId);
    const fridayCount = getFridayTribute(userId);
    addToContext(channelId, 'model', `[${username} now has ${allTime} total tribute(s), ${daily} today, ${fridayCount} on Fridays.]`);

    await message.reply(result.content);
    return;
  }

  // No image - treat as a question/conversation
  const response = await handleMention(message.content, channelId);
  await message.reply(response.content);
}
