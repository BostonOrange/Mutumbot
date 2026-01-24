/**
 * Mention Handler
 *
 * Handles @Mutumbot mentions in Discord messages.
 * Detects image attachments for tribute offerings (any day!).
 */

import { Message } from 'discord.js';
import { handleMention } from '../drink-questions';
import { handleMentionTribute } from '../tribute-tracker';

/**
 * Handle a message that mentions Mutumbot
 */
export async function handleMentionMessage(message: Message): Promise<void> {
  const guildId = message.guild?.id || 'dm';
  const channelId = message.channel.id;
  const userId = message.author.id;
  const username = message.author.username;

  // Check for image attachments
  const imageAttachment = message.attachments.find(att =>
    att.contentType?.startsWith('image/')
  );

  // If there's an image, treat as a tribute (any day!)
  if (imageAttachment) {
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
