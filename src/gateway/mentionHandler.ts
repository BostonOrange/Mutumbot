/**
 * Mention Handler
 *
 * Handles @Mutumbot mentions in Discord messages.
 * Detects image attachments for tribute offerings.
 */

import { Message } from 'discord.js';
import { handleMention } from '../drink-questions';
import { handleMentionTribute, isFriday } from '../tribute-tracker';
import { ISEE_EMOJI, isTikiRelated } from '../personality';

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

  // If there's an image and it's Friday, treat as a tribute
  if (imageAttachment && isFriday()) {
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

  // If there's an image but not Friday, acknowledge it but explain
  if (imageAttachment && !isFriday()) {
    const isTiki = isTikiRelated(message.content);

    if (isTiki) {
      await message.reply(
        `${ISEE_EMOJI} A worthy TIKI OFFERING... but the ritual day has not yet arrived. Return on Friday, mortal, and the spirits will RECEIVE your tribute properly.`
      );
    } else {
      await message.reply(
        `${ISEE_EMOJI} I see your offering, mortal. But the ANCIENT CALENDAR dictates that tributes are only recorded on Friday. Hold your libation until then.`
      );
    }
    return;
  }

  // No image - treat as a question/conversation
  const response = await handleMention(message.content, channelId);
  await message.reply(response.content);
}
