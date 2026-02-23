/**
 * Message Ingestor Service
 *
 * Captures Discord events (message create/update/delete) and stores them
 * in PostgreSQL for building LLM context. Implements idempotent writes
 * with proper handling of edits, deletes, replies, and attachments.
 *
 * Now also writes to the ChatKit-style thread_items table for first-class
 * transcript storage with full run logging support.
 */

import { sql } from '../db';
import { Message, PartialMessage } from 'discord.js';
import {
  getOrCreateThread,
  addThreadItem,
  generateThreadId,
  ThreadItemMetadata,
} from './threads';
import { maybeSummarize } from './summarizer';

// ============ TYPES ============

export interface DiscordMessageRecord {
  messageId: string;
  channelId: string;
  guildId: string | null;
  authorId: string;
  authorName: string;
  isBot: boolean;
  createdAt: Date;
  ingestedAt?: Date;
  content: string;
  mentionsBot: boolean;
  replyToMessageId: string | null;
  hasImage: boolean;
  hasAttachments: boolean;
  attachments: AttachmentInfo[];
  isDeleted: boolean;
  editedAt: Date | null;
}

export interface AttachmentInfo {
  id: string;
  name: string;
  contentType: string | null;
  url: string;
  isImage: boolean;
}

// ============ INGESTION FUNCTIONS ============

/**
 * Ingest a MESSAGE_CREATE event
 * Upserts the message (idempotent - safe to call multiple times)
 * Now also writes to ChatKit-style thread_items table
 */
export async function ingestMessageCreate(
  message: Message,
  botUserId: string
): Promise<void> {
  if (!sql) {
    console.log('[Ingestor] Database not available, skipping message ingestion');
    return;
  }

  // Skip messages we don't want in context
  if (shouldSkipMessage(message)) {
    return;
  }

  const record = messageToRecord(message, botUserId);

  try {
    // Legacy: Write to discord_messages_recent for backward compatibility
    await sql`
      INSERT INTO discord_messages_recent (
        message_id, channel_id, guild_id, author_id, author_name,
        is_bot, created_at, content, mentions_bot, reply_to_message_id,
        has_image, has_attachments, attachments, is_deleted, edited_at
      )
      VALUES (
        ${record.messageId}, ${record.channelId}, ${record.guildId},
        ${record.authorId}, ${record.authorName}, ${record.isBot},
        ${record.createdAt.toISOString()}, ${record.content}, ${record.mentionsBot},
        ${record.replyToMessageId}, ${record.hasImage}, ${record.hasAttachments},
        ${JSON.stringify(record.attachments)}, ${record.isDeleted}, ${record.editedAt?.toISOString() || null}
      )
      ON CONFLICT (message_id) DO UPDATE SET
        content = EXCLUDED.content,
        edited_at = EXCLUDED.edited_at
    `;

    // ChatKit: Write to thread_items for first-class transcript storage
    await ingestToThreadItems(record);
  } catch (error) {
    console.error('[Ingestor] Failed to ingest message:', error);
  }
}

/**
 * Ingest a message record to the ChatKit-style thread_items table
 */
async function ingestToThreadItems(record: DiscordMessageRecord): Promise<void> {
  try {
    // Ensure thread exists
    await getOrCreateThread(record.channelId, record.guildId, {
      primaryUserId: record.authorId,
      primaryUsername: record.authorName,
    });

    const threadId = generateThreadId(record.channelId, record.guildId);

    // Build metadata
    const metadata: ThreadItemMetadata = {
      discordMessageId: record.messageId,
      discordChannelId: record.channelId,
      discordGuildId: record.guildId || undefined,
      attachments: record.attachments,
      replyToMessageId: record.replyToMessageId || undefined,
      mentionsBot: record.mentionsBot,
      hasImage: record.hasImage,
    };

    // Add thread item (idempotent via sourceMessageId)
    await addThreadItem(threadId, {
      type: record.isBot ? 'assistant_message' : 'user_message',
      role: record.isBot ? 'assistant' : 'user',
      authorId: record.authorId,
      authorName: record.authorName,
      content: record.content,
      metadata,
      sourceMessageId: record.messageId,
    });

    // Check if we need to summarize (non-blocking)
    maybeSummarize(threadId).catch(err =>
      console.error('[Ingestor] Summarization check failed:', err)
    );
  } catch (error) {
    // Log but don't fail - thread_items is supplementary
    console.error('[Ingestor] Failed to write to thread_items:', error);
  }
}

/**
 * Ingest a MESSAGE_UPDATE event
 * Updates the content and marks as edited
 */
export async function ingestMessageUpdate(
  message: Message | PartialMessage
): Promise<void> {
  if (!sql) return;

  // Partial messages may not have content - fetch if needed
  const content = message.content ?? '';
  const editedAt = message.editedAt || new Date();

  try {
    await sql`
      UPDATE discord_messages_recent
      SET content = ${content}, edited_at = ${editedAt.toISOString()}
      WHERE message_id = ${message.id}
    `;
  } catch (error) {
    console.error('[Ingestor] Failed to update message:', error);
  }
}

/**
 * Ingest a MESSAGE_DELETE event
 * Marks as deleted and blanks content (keeps tombstone for context)
 */
export async function ingestMessageDelete(
  messageId: string
): Promise<void> {
  if (!sql) return;

  try {
    await sql`
      UPDATE discord_messages_recent
      SET is_deleted = TRUE, content = ''
      WHERE message_id = ${messageId}
    `;
  } catch (error) {
    console.error('[Ingestor] Failed to mark message deleted:', error);
  }
}

/**
 * Ingest the bot's own outgoing message
 * Important for including bot replies in the transcript
 * Now also writes to ChatKit-style thread_items table
 *
 * @param runId - Optional run ID to associate with this response
 */
export async function ingestBotMessage(
  message: Message,
  botUserId: string,
  runId?: string
): Promise<void> {
  if (!sql) return;

  const record: DiscordMessageRecord = {
    messageId: message.id,
    channelId: message.channel.id,
    guildId: message.guild?.id || null,
    authorId: message.author.id,
    authorName: message.member?.displayName || message.author.displayName || message.author.username,
    isBot: true,
    createdAt: message.createdAt,
    content: truncateContent(message.content),
    mentionsBot: false, // Bot's own message
    replyToMessageId: message.reference?.messageId || null,
    hasImage: false,
    hasAttachments: false,
    attachments: [],
    isDeleted: false,
    editedAt: null,
  };

  try {
    // Legacy: Write to discord_messages_recent
    await sql`
      INSERT INTO discord_messages_recent (
        message_id, channel_id, guild_id, author_id, author_name,
        is_bot, created_at, content, mentions_bot, reply_to_message_id,
        has_image, has_attachments, attachments, is_deleted, edited_at
      )
      VALUES (
        ${record.messageId}, ${record.channelId}, ${record.guildId},
        ${record.authorId}, ${record.authorName}, ${record.isBot},
        ${record.createdAt.toISOString()}, ${record.content}, ${record.mentionsBot},
        ${record.replyToMessageId}, ${record.hasImage}, ${record.hasAttachments},
        ${JSON.stringify(record.attachments)}, ${record.isDeleted}, ${null}
      )
      ON CONFLICT (message_id) DO NOTHING
    `;

    // ChatKit: Write to thread_items with optional run association
    await ingestBotResponseToThreadItems(record, runId);
  } catch (error) {
    console.error('[Ingestor] Failed to ingest bot message:', error);
  }
}

/**
 * Ingest a bot response to the ChatKit-style thread_items table
 */
async function ingestBotResponseToThreadItems(
  record: DiscordMessageRecord,
  runId?: string
): Promise<void> {
  try {
    const threadId = generateThreadId(record.channelId, record.guildId);

    // Build metadata
    const metadata: ThreadItemMetadata = {
      discordMessageId: record.messageId,
      discordChannelId: record.channelId,
      discordGuildId: record.guildId || undefined,
      replyToMessageId: record.replyToMessageId || undefined,
      runId,
    };

    // Add thread item
    await addThreadItem(threadId, {
      type: 'assistant_message',
      role: 'assistant',
      authorId: record.authorId,
      authorName: record.authorName,
      content: record.content,
      metadata,
      sourceMessageId: record.messageId,
    });
  } catch (error) {
    console.error('[Ingestor] Failed to write bot response to thread_items:', error);
  }
}

// ============ HELPER FUNCTIONS ============

/**
 * Decide if a message should be skipped from ingestion
 */
function shouldSkipMessage(message: Message): boolean {
  // Skip system messages (joins, pins, etc.)
  if (message.type !== 0 && message.type !== 19) { // 0=DEFAULT, 19=REPLY
    return true;
  }

  // Skip empty messages with no content and no attachments
  if (!message.content && message.attachments.size === 0) {
    return true;
  }

  // Skip very long pastes (likely code dumps)
  if (message.content.length > 4000) {
    return true;
  }

  return false;
}

/**
 * Convert a Discord.js Message to our record format
 */
function messageToRecord(message: Message, botUserId: string): DiscordMessageRecord {
  const mentionsBot = message.mentions.users.has(botUserId);

  // Process attachments
  const attachments: AttachmentInfo[] = [];
  let hasImage = false;

  message.attachments.forEach(att => {
    const isImage = att.contentType?.startsWith('image/') ||
      /\.(png|jpg|jpeg|gif|webp)($|\?)/i.test(att.url);

    if (isImage) hasImage = true;

    attachments.push({
      id: att.id,
      name: att.name || 'unknown',
      contentType: att.contentType,
      url: att.url,
      isImage,
    });
  });

  return {
    messageId: message.id,
    channelId: message.channel.id,
    guildId: message.guild?.id || null,
    authorId: message.author.id,
    authorName: message.member?.displayName || message.author.displayName || message.author.username,
    isBot: message.author.bot,
    createdAt: message.createdAt,
    content: truncateContent(message.content),
    mentionsBot,
    replyToMessageId: message.reference?.messageId || null,
    hasImage,
    hasAttachments: attachments.length > 0,
    attachments,
    isDeleted: false,
    editedAt: message.editedAt,
  };
}

/**
 * Truncate content to prevent huge messages from bloating context
 */
function truncateContent(content: string, maxLength: number = 500): string {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + '...';
}

// ============ CLEANUP / RETENTION ============

/**
 * Purge messages older than the TTL (default 4 hours)
 */
export async function purgeOldMessages(ttlHours: number = 4): Promise<number> {
  if (!sql) return 0;

  try {
    const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000);
    const result = await sql`
      DELETE FROM discord_messages_recent
      WHERE ingested_at < ${cutoff.toISOString()}
      RETURNING message_id
    `;
    console.log(`[Ingestor] Purged ${result.length} messages older than ${ttlHours}h`);
    return result.length;
  } catch (error) {
    console.error('[Ingestor] Failed to purge old messages:', error);
    return 0;
  }
}

/**
 * Cap messages per channel to prevent spam channels from dominating
 */
export async function capChannelMessages(
  channelId: string,
  maxMessages: number = 100
): Promise<number> {
  if (!sql) return 0;

  try {
    const result = await sql`
      DELETE FROM discord_messages_recent
      WHERE message_id IN (
        SELECT message_id FROM discord_messages_recent
        WHERE channel_id = ${channelId}
        ORDER BY created_at DESC
        OFFSET ${maxMessages}
      )
      RETURNING message_id
    `;
    return result.length;
  } catch (error) {
    console.error('[Ingestor] Failed to cap channel messages:', error);
    return 0;
  }
}
