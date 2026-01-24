/**
 * Mention Handler
 *
 * Handles @Mutumbot mentions in Discord messages.
 * Detects image attachments for tribute offerings (any day!).
 * DM tributes are acknowledged but don't count toward competitive tallies.
 */

import { Message } from 'discord.js';
import { handleMention } from '../drink-questions';
import { handleMentionTribute } from '../tribute-tracker';
import { ISEE_EMOJI } from '../personality';

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
    // DM tributes get a different response (don't count toward tally)
    if (isDM) {
      await message.reply(
        `${ISEE_EMOJI} I SEE your private offering, **${username}**... The spirits acknowledge your devotion.\n\n*Note: DM tributes are between you and the gods alone - they do not count toward the public leaderboard. Tribute in the sacred channels to compete with other mortals!*`
      );
      return;
    }

    const result = handleMentionTribute(
      userId,
      username,
      guildId,
      imageAttachment.url,
      message.content
    );

    await message.reply(result.content);
    return;
  }

  // No image - treat as a question/conversation
  const response = await handleMention(message.content, channelId);
  await message.reply(response.content);
}
