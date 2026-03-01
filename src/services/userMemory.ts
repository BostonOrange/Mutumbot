/**
 * User Memory Service
 *
 * Maintains per-user memories at the channel level.
 * Uses AI to summarize the last 30 messages from each user in a channel,
 * giving the bot a personal memory of each person it talks to.
 */

import OpenAI from 'openai';
import { sql } from '../db';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const openrouter = OPENROUTER_API_KEY
  ? new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: OPENROUTER_API_KEY,
    })
  : null;

const SUMMARIZATION_MODEL = 'google/gemini-2.5-flash-lite';

// How many user messages to look back when building a user memory summary
const USER_MEMORY_MESSAGE_LIMIT = 30;
// Update user memory after every N new messages from that user
const UPDATE_EVERY_N_MESSAGES = 5;
// Max length for user memory summary
const MAX_MEMORY_CHARS = 1500;

// Track in-progress updates to prevent concurrent duplicate updates
const updatesInProgress = new Set<string>();

// ============ DATABASE INITIALIZATION ============

export async function initializeUserMemoryTable(): Promise<void> {
  if (!sql) return;

  await sql`
    CREATE TABLE IF NOT EXISTS user_memories (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      channel_id VARCHAR(255) NOT NULL,
      guild_id VARCHAR(255),
      summary TEXT NOT NULL,
      message_count INTEGER DEFAULT 0,
      last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, channel_id)
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_user_memories_user_channel ON user_memories(user_id, channel_id)`;

  console.log('[UserMemory] Table initialized');
}

// ============ MEMORY RETRIEVAL ============

export interface UserMemory {
  userId: string;
  channelId: string;
  guildId: string | null;
  summary: string;
  messageCount: number;
  lastUpdatedAt: Date;
}

/**
 * Get the stored memory summary for a user in a channel
 */
export async function getUserMemory(
  userId: string,
  channelId: string
): Promise<UserMemory | null> {
  if (!sql) return null;

  try {
    const result = await sql`
      SELECT user_id, channel_id, guild_id, summary, message_count, last_updated_at
      FROM user_memories
      WHERE user_id = ${userId} AND channel_id = ${channelId}
    `;

    if (result.length === 0) return null;

    const row = result[0];
    return {
      userId: row.user_id as string,
      channelId: row.channel_id as string,
      guildId: row.guild_id as string | null,
      summary: row.summary as string,
      messageCount: row.message_count as number,
      lastUpdatedAt: new Date(row.last_updated_at as string),
    };
  } catch (error) {
    console.error('[UserMemory] Failed to get user memory:', error);
    return null;
  }
}

/**
 * Format user memory for inclusion in AI context
 */
export function formatUserMemoryForContext(memory: UserMemory, username: string): string {
  return `[MEMORY OF ${username.toUpperCase()}]
${memory.summary}
[END MEMORY]`;
}

// ============ MEMORY UPDATES ============

/**
 * Fetch the last N messages from a specific user in a channel
 */
async function fetchUserMessages(
  userId: string,
  channelId: string,
  limit: number = USER_MEMORY_MESSAGE_LIMIT
): Promise<Array<{ content: string; createdAt: Date; isBot: boolean }>> {
  if (!sql) return [];

  const result = await sql`
    SELECT content, created_at, is_bot
    FROM discord_messages_recent
    WHERE author_id = ${userId}
      AND channel_id = ${channelId}
      AND is_deleted = FALSE
      AND content IS NOT NULL
      AND content != ''
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return result.map(row => ({
    content: row.content as string,
    createdAt: new Date(row.created_at as string),
    isBot: row.is_bot as boolean,
  })).reverse(); // Return in chronological order
}

/**
 * Count how many messages a user has sent in a channel
 */
async function countUserMessages(userId: string, channelId: string): Promise<number> {
  if (!sql) return 0;

  const result = await sql`
    SELECT COUNT(*) as count
    FROM discord_messages_recent
    WHERE author_id = ${userId}
      AND channel_id = ${channelId}
      AND is_deleted = FALSE
  `;

  return Number(result[0]?.count || 0);
}

/**
 * Generate a user memory summary using AI
 */
async function generateUserMemorySummary(
  username: string,
  existingSummary: string | null,
  messages: Array<{ content: string; createdAt: Date }>
): Promise<string | null> {
  if (!openrouter || messages.length === 0) return null;

  let prompt = `You are building a personal memory profile for a Discord user to help the bot remember them better.
Create a concise summary that captures:
- Their personality, communication style, and tone
- Topics they frequently discuss or show interest in
- Any preferences, opinions, or facts they've shared about themselves
- The kinds of questions or requests they typically make
- Any ongoing topics or interests

IMPORTANT PRIVACY GUIDELINES:
- Do NOT store passwords, access tokens, or security credentials
- Do NOT store sensitive personal identifiers (SSN, passport numbers, etc.)
- Do NOT store medical/health conditions or personal financial details
- Keep the summary general and conversational, not data-collection focused

Keep it factual, warm, and focused on things that would help personalize future responses.

Username: ${username}
`;

  if (existingSummary) {
    prompt += `\nEXISTING MEMORY (update and refine this):\n${existingSummary}\n`;
  }

  prompt += `\nRECENT MESSAGES FROM ${username}:\n`;
  for (const msg of messages) {
    const time = msg.createdAt.toISOString().slice(0, 16).replace('T', ' ');
    prompt += `[${time}] ${msg.content.slice(0, 300)}\n`;
  }

  prompt += `\nWrite an updated personal memory profile (max ${MAX_MEMORY_CHARS} characters). Be concise but capture what makes this person unique in this community.`;

  try {
    const response = await openrouter.chat.completions.create({
      model: SUMMARIZATION_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
    });

    return response.choices[0]?.message?.content || null;
  } catch (error) {
    console.error('[UserMemory] Failed to generate summary:', error);
    return null;
  }
}

/**
 * Update the user memory summary for a user in a channel
 */
export async function updateUserMemory(
  userId: string,
  username: string,
  channelId: string,
  guildId: string | null
): Promise<void> {
  if (!sql || !openrouter) return;

  const lockKey = `${userId}:${channelId}`;
  if (updatesInProgress.has(lockKey)) {
    console.log(`[UserMemory] Update already in progress for ${lockKey}, skipping`);
    return;
  }

  updatesInProgress.add(lockKey);
  try {
    const [messages, existing] = await Promise.all([
      fetchUserMessages(userId, channelId),
      getUserMemory(userId, channelId),
    ]);

    if (messages.length === 0) return;

    const summary = await generateUserMemorySummary(username, existing?.summary || null, messages);
    if (!summary) return;

    const truncated = summary.length > MAX_MEMORY_CHARS
      ? summary.slice(0, MAX_MEMORY_CHARS) + '...'
      : summary;

    const messageCount = await countUserMessages(userId, channelId);

    await sql`
      INSERT INTO user_memories (user_id, channel_id, guild_id, summary, message_count, last_updated_at)
      VALUES (${userId}, ${channelId}, ${guildId}, ${truncated}, ${messageCount}, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, channel_id)
      DO UPDATE SET
        summary = ${truncated},
        message_count = ${messageCount},
        last_updated_at = CURRENT_TIMESTAMP,
        guild_id = COALESCE(EXCLUDED.guild_id, user_memories.guild_id)
    `;

    console.log(`[UserMemory] Updated memory for user ${userId} in channel ${channelId}`);
  } catch (error) {
    console.error('[UserMemory] Failed to update user memory:', error);
  } finally {
    updatesInProgress.delete(lockKey);
  }
}

/**
 * Check if a user's memory should be updated and do so if needed.
 * Call this after a user sends a message.
 * Non-blocking — failures are silent.
 */
export async function maybeUpdateUserMemory(
  userId: string,
  username: string,
  channelId: string,
  guildId: string | null
): Promise<void> {
  if (!sql) return;

  const lockKey = `${userId}:${channelId}`;
  if (updatesInProgress.has(lockKey)) {
    return; // Already updating, skip
  }

  try {
    const existing = await getUserMemory(userId, channelId);
    const currentCount = await countUserMessages(userId, channelId);

    // Update if no memory yet, or if enough new messages have come in
    const shouldUpdate = !existing ||
      (currentCount - existing.messageCount) >= UPDATE_EVERY_N_MESSAGES;

    if (shouldUpdate) {
      // Run in background — don't await
      updateUserMemory(userId, username, channelId, guildId).catch(error => {
        console.error('[UserMemory] Background update failed:', error);
      });
    }
  } catch (error) {
    // Non-critical — silently ignore
    console.error('[UserMemory] maybeUpdateUserMemory failed:', error);
  }
}
