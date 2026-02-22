/**
 * Context Builder Service
 *
 * Builds optimal LLM context from stored messages.
 * Implements the "best 15" selection algorithm that:
 * - Always includes the trigger message
 * - Includes reply targets if present
 * - Includes the last bot exchange
 * - Fills remaining slots by recency
 * - Normalizes mentions, links, and attachments
 * - Enforces token/length budgets
 *
 * Now also supports ChatKit-style context building with:
 * - Thread summary at the top for continuity
 * - thread_items as first-class transcript source
 * - Deterministic, inspectable context packs with item IDs
 */

import { sql } from '../db';
import {
  getThread,
  getThreadItems,
  generateThreadId,
  ThreadItem,
  Thread,
} from './threads';
import { formatSummaryForContext, estimateContextSize } from './summarizer';
import {
  getThreadWorkflow,
  ContextPolicy,
  DEFAULT_CONTEXT_POLICY,
} from './agents';

// ============ TYPES ============

export interface ContextMessage {
  messageId: string;
  authorId: string;
  authorName: string;
  isBot: boolean;
  createdAt: Date;
  content: string;
  mentionsBot: boolean;
  replyToMessageId: string | null;
  hasImage: boolean;
  hasAttachments: boolean;
  isDeleted: boolean;
}

export interface ContextPack {
  transcript: string;
  messages: ContextMessage[];
  replyTarget: ContextMessage | null;
  lastBotExchange: { userMessage: ContextMessage; botReply: ContextMessage } | null;
  triggerMessage: ContextMessage | null;
  channelId: string;
  messageCount: number;
  // ChatKit enhancements
  threadId?: string;
  summary?: string;
  selectedItemIds?: string[];
  tokenEstimate?: number;
}

// ============ CONFIGURATION ============

const CONFIG = {
  // How many messages to fetch as candidates
  CANDIDATE_WINDOW: 50,
  // How many messages to select for transcript
  TARGET_MESSAGES: 15,
  // Max characters per message content
  MAX_CONTENT_LENGTH: 300,
  // Max total transcript characters
  MAX_TRANSCRIPT_CHARS: 8000,
  // Max age of messages to consider (in hours)
  MAX_MESSAGE_AGE_HOURS: 4,
};

// ============ MAIN CONTEXT BUILDER ============

/**
 * Build a context pack for a given trigger message
 */
export async function buildContextPack(
  channelId: string,
  triggerMessageId: string
): Promise<ContextPack | null> {
  if (!sql) {
    console.log('[ContextBuilder] Database not available');
    return null;
  }

  try {
    // Step A: Fetch candidate window
    const candidates = await fetchCandidateMessages(channelId);

    if (candidates.length === 0) {
      return {
        transcript: '',
        messages: [],
        replyTarget: null,
        lastBotExchange: null,
        triggerMessage: null,
        channelId,
        messageCount: 0,
      };
    }

    // Find trigger message in candidates
    const triggerMessage = candidates.find(m => m.messageId === triggerMessageId) || null;

    // Step B: Normalize all messages
    const normalizedCandidates = candidates.map(normalizeMessage);

    // Step C: Select best messages
    const selectedMessages = selectBestMessages(
      normalizedCandidates,
      triggerMessageId
    );

    // Find special messages for metadata
    const replyTarget = findReplyTarget(normalizedCandidates, triggerMessage);
    const lastBotExchange = findLastBotExchange(normalizedCandidates, triggerMessage);

    // Step D: Order and format
    const orderedMessages = orderByTime(selectedMessages);
    const transcript = formatTranscript(orderedMessages);

    // Step E: Apply length budget
    const finalTranscript = applyLengthBudget(transcript);

    return {
      transcript: finalTranscript,
      messages: orderedMessages,
      replyTarget,
      lastBotExchange,
      triggerMessage: triggerMessage ? normalizeMessage(triggerMessage) : null,
      channelId,
      messageCount: orderedMessages.length,
    };
  } catch (error) {
    console.error('[ContextBuilder] Failed to build context:', error);
    return null;
  }
}

/**
 * Build context for a DM conversation (simpler - no guild complexity)
 */
export async function buildDMContextPack(
  channelId: string,
  triggerMessageId: string
): Promise<ContextPack | null> {
  // DMs use the same logic but may have different defaults
  return buildContextPack(channelId, triggerMessageId);
}

// ============ STEP A: FETCH CANDIDATES ============

async function fetchCandidateMessages(channelId: string): Promise<ContextMessage[]> {
  const cutoff = new Date(Date.now() - CONFIG.MAX_MESSAGE_AGE_HOURS * 60 * 60 * 1000);

  const result = await sql!`
    SELECT
      message_id, author_id, author_name, is_bot, created_at,
      content, mentions_bot, reply_to_message_id, has_image,
      has_attachments, is_deleted
    FROM discord_messages_recent
    WHERE channel_id = ${channelId}
      AND is_deleted = FALSE
      AND created_at > ${cutoff.toISOString()}
    ORDER BY created_at DESC
    LIMIT ${CONFIG.CANDIDATE_WINDOW}
  `;

  return result.map(row => ({
    messageId: row.message_id as string,
    authorId: row.author_id as string,
    authorName: row.author_name as string,
    isBot: row.is_bot as boolean,
    createdAt: new Date(row.created_at as string),
    content: row.content as string,
    mentionsBot: row.mentions_bot as boolean,
    replyToMessageId: row.reply_to_message_id as string | null,
    hasImage: row.has_image as boolean,
    hasAttachments: row.has_attachments as boolean,
    isDeleted: row.is_deleted as boolean,
  }));
}

// ============ STEP B: NORMALIZE MESSAGES ============

function normalizeMessage(message: ContextMessage): ContextMessage {
  let content = message.content;

  // Replace <@id> mentions with @Name (we don't have lookup, keep raw for now)
  // In production, you'd resolve these from a cache
  content = content.replace(/<@!?(\d+)>/g, '@user');

  // Replace <#id> channel mentions
  content = content.replace(/<#(\d+)>/g, '#channel');

  // Collapse URLs to (link: domain.tld)
  content = content.replace(
    /https?:\/\/([^\/\s]+)[^\s]*/g,
    (_, domain) => `(link: ${domain})`
  );

  // Mark empty-but-image messages
  if (!content.trim() && message.hasImage) {
    content = '(image only)';
  } else if (!content.trim() && message.hasAttachments) {
    content = '(attachment)';
  }

  // Trim to max length
  if (content.length > CONFIG.MAX_CONTENT_LENGTH) {
    content = content.slice(0, CONFIG.MAX_CONTENT_LENGTH) + '...';
  }

  return {
    ...message,
    content: content.trim(),
  };
}

// ============ STEP C: SELECT BEST MESSAGES ============

function selectBestMessages(
  candidates: ContextMessage[],
  triggerMessageId: string,
  targetCount: number = CONFIG.TARGET_MESSAGES
): ContextMessage[] {
  const selected: Map<string, ContextMessage> = new Map();

  // 1. Always include trigger message
  const trigger = candidates.find(m => m.messageId === triggerMessageId);
  if (trigger) {
    selected.set(trigger.messageId, trigger);
  }

  // 2. If trigger is a reply, include the reply target
  if (trigger?.replyToMessageId) {
    const replyTarget = candidates.find(m => m.messageId === trigger.replyToMessageId);
    if (replyTarget) {
      selected.set(replyTarget.messageId, replyTarget);
    }
  }

  // 3. Include the most recent bot mention + bot reply pair
  const botMentionIndex = candidates.findIndex(
    m => m.mentionsBot && !m.isBot && m.messageId !== triggerMessageId
  );
  if (botMentionIndex >= 0) {
    const botMention = candidates[botMentionIndex];
    selected.set(botMention.messageId, botMention);

    // Find the bot's reply (should be right after or shortly after)
    const botReply = candidates.slice(0, botMentionIndex).find(m => m.isBot);
    if (botReply) {
      selected.set(botReply.messageId, botReply);
    }
  }

  // 4. Fill remaining slots by recency (most recent first in candidates)
  for (const msg of candidates) {
    if (selected.size >= targetCount) break;
    if (!selected.has(msg.messageId)) {
      selected.set(msg.messageId, msg);
    }
  }

  return Array.from(selected.values());
}

// ============ STEP D: ORDER AND FORMAT ============

function orderByTime(messages: ContextMessage[]): ContextMessage[] {
  return [...messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

function formatTranscript(messages: ContextMessage[]): string {
  return messages.map(msg => {
    const time = formatTime(msg.createdAt);
    const indicators: string[] = [];

    if (msg.mentionsBot) indicators.push('(mentions bot)');
    if (msg.replyToMessageId) indicators.push('(reply)');
    if (msg.hasImage) indicators.push('(image)');
    if (msg.hasAttachments && !msg.hasImage) indicators.push('(attachment)');
    if (msg.isBot) indicators.push('(bot)');

    const indicatorStr = indicators.length > 0 ? ` ${indicators.join(' ')}` : '';
    return `[${time}] ${msg.authorName}${indicatorStr}: ${msg.content}`;
  }).join('\n');
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// ============ STEP E: LENGTH BUDGET ============

function applyLengthBudget(transcript: string, maxChars: number = CONFIG.MAX_TRANSCRIPT_CHARS): string {
  if (transcript.length <= maxChars) {
    return transcript;
  }

  // If over budget, truncate from the beginning (keep most recent)
  const lines = transcript.split('\n');
  let result = '';
  let totalLength = 0;

  // Work backwards from most recent
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (totalLength + line.length + 1 > maxChars) {
      break;
    }
    result = line + (result ? '\n' + result : '');
    totalLength += line.length + 1;
  }

  return result;
}

// ============ HELPER FINDERS ============

function findReplyTarget(
  candidates: ContextMessage[],
  trigger: ContextMessage | null
): ContextMessage | null {
  if (!trigger?.replyToMessageId) return null;
  return candidates.find(m => m.messageId === trigger.replyToMessageId) || null;
}

function findLastBotExchange(
  candidates: ContextMessage[],
  trigger: ContextMessage | null
): { userMessage: ContextMessage; botReply: ContextMessage } | null {
  // Find most recent bot mention that's not the trigger
  const userMention = candidates.find(
    m => m.mentionsBot && !m.isBot && m.messageId !== trigger?.messageId
  );

  if (!userMention) return null;

  // Find the bot's response (most recent bot message before/after the mention)
  const mentionIndex = candidates.indexOf(userMention);
  const botReply = candidates.slice(0, mentionIndex).find(m => m.isBot);

  if (!botReply) return null;

  return { userMessage: userMention, botReply };
}

// ============ UTILITY EXPORTS ============

/**
 * Get raw messages for a channel (for debugging/observability)
 */
export async function getRecentMessages(
  channelId: string,
  limit: number = 20
): Promise<ContextMessage[]> {
  if (!sql) return [];

  const result = await sql`
    SELECT
      message_id, author_id, author_name, is_bot, created_at,
      content, mentions_bot, reply_to_message_id, has_image,
      has_attachments, is_deleted
    FROM discord_messages_recent
    WHERE channel_id = ${channelId}
      AND is_deleted = FALSE
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return result.map(row => ({
    messageId: row.message_id as string,
    authorId: row.author_id as string,
    authorName: row.author_name as string,
    isBot: row.is_bot as boolean,
    createdAt: new Date(row.created_at as string),
    content: row.content as string,
    mentionsBot: row.mentions_bot as boolean,
    replyToMessageId: row.reply_to_message_id as string | null,
    hasImage: row.has_image as boolean,
    hasAttachments: row.has_attachments as boolean,
    isDeleted: row.is_deleted as boolean,
  }));
}

/**
 * Check if context is available for a channel
 */
export async function hasContext(channelId: string): Promise<boolean> {
  if (!sql) return false;

  const result = await sql`
    SELECT 1 FROM discord_messages_recent
    WHERE channel_id = ${channelId}
    LIMIT 1
  `;

  return result.length > 0;
}

// ============ CHATKIT-STYLE CONTEXT BUILDING ============

/**
 * Build a ChatKit-style context pack using threads and thread_items
 *
 * This provides:
 * - Thread summary at the top for historical context
 * - Recent items verbatim
 * - Deterministic item selection with IDs for debugging
 * - Token estimation
 * - Workflow-based context policy (per-channel customization)
 */
export async function buildThreadContextPack(
  channelId: string,
  guildId: string | null,
  triggerMessageId?: string
): Promise<ContextPack | null> {
  const threadId = generateThreadId(channelId, guildId);

  try {
    // Get workflow for this thread (or default)
    const workflow = await getThreadWorkflow(threadId);
    const policy: ContextPolicy = workflow?.contextPolicy || DEFAULT_CONTEXT_POLICY;

    // Get thread with summary
    const thread = await getThread(threadId);

    // Get recent thread items using workflow's policy
    const items = await getThreadItems(threadId, {
      limit: policy.recentMessages * 2, // Fetch extra for selection
      types: ['user_message', 'assistant_message'],
    });

    if (items.length === 0 && !thread?.summary) {
      // Fall back to legacy context building
      return triggerMessageId
        ? buildContextPack(channelId, triggerMessageId)
        : null;
    }

    // Convert thread items to ContextMessages for compatibility
    const contextMessages = threadItemsToContextMessages(items);

    // Find trigger message
    const triggerMessage = triggerMessageId
      ? contextMessages.find(m => m.messageId === triggerMessageId) || null
      : null;

    // Select best messages using workflow's policy
    const selectedMessages = selectBestMessages(
      contextMessages,
      triggerMessageId || '',
      policy.recentMessages
    );

    // Find special messages
    const replyTarget = triggerMessage
      ? findReplyTarget(contextMessages, triggerMessage)
      : null;
    const lastBotExchange = findLastBotExchange(contextMessages, triggerMessage);

    // Order and format
    const orderedMessages = orderByTime(selectedMessages);

    // Build transcript with summary at the top (if policy allows)
    let transcript = '';

    // Add summary if available and policy allows (ChatKit-style continuity)
    if (thread?.summary && policy.useSummary) {
      transcript += formatSummaryForContext(thread.summary);
    }

    // Add recent messages
    transcript += formatTranscript(orderedMessages);

    // Apply length budget from policy
    const finalTranscript = applyLengthBudget(transcript, policy.maxTranscriptChars);

    // Collect selected item IDs for debugging/replay
    const selectedItemIds = items
      .filter(item =>
        selectedMessages.some(m =>
          m.messageId === item.metadata.discordMessageId
        )
      )
      .map(item => item.id);

    // Estimate tokens (rough: ~4 chars per token)
    const tokenEstimate = Math.ceil(finalTranscript.length / 4);

    return {
      transcript: finalTranscript,
      messages: orderedMessages,
      replyTarget,
      lastBotExchange,
      triggerMessage,
      channelId,
      messageCount: orderedMessages.length,
      // ChatKit enhancements
      threadId,
      summary: thread?.summary || undefined,
      selectedItemIds,
      tokenEstimate,
    };
  } catch (error) {
    console.error('[ContextBuilder] Failed to build thread context:', error);
    // Fall back to legacy
    return triggerMessageId
      ? buildContextPack(channelId, triggerMessageId)
      : null;
  }
}

/**
 * Convert ThreadItems to ContextMessages for compatibility
 */
function threadItemsToContextMessages(items: ThreadItem[]): ContextMessage[] {
  return items.map(item => ({
    messageId: item.metadata.discordMessageId || item.id,
    authorId: item.authorId || 'unknown',
    authorName: item.authorName || (item.role === 'assistant' ? 'Mutumbot' : 'User'),
    isBot: item.role === 'assistant',
    createdAt: item.createdAt,
    content: item.content,
    mentionsBot: item.metadata.mentionsBot || false,
    replyToMessageId: item.metadata.replyToMessageId || null,
    hasImage: item.metadata.hasImage || false,
    hasAttachments: (item.metadata.attachments?.length || 0) > 0,
    isDeleted: false,
  }));
}

/**
 * Get thread state for AI context
 */
export async function getThreadState(
  channelId: string,
  guildId: string | null
): Promise<{ state: Record<string, unknown>; summary: string | null } | null> {
  const threadId = generateThreadId(channelId, guildId);
  const thread = await getThread(threadId);

  if (!thread) return null;

  return {
    state: thread.state,
    summary: thread.summary,
  };
}

/**
 * Format thread context for inclusion in system prompt
 *
 * Returns a formatted string with:
 * - Thread state variables
 * - Rolling summary
 * - Ready to prepend to recent transcript
 */
export function formatThreadContextForPrompt(
  state: Record<string, unknown> | null,
  summary: string | null
): string {
  let context = '';

  // Add relevant state variables
  if (state) {
    const relevantState: string[] = [];

    if (state.primaryUsername) {
      relevantState.push(`Primary user: ${state.primaryUsername}`);
    }
    if (state.isDm) {
      relevantState.push('Context: Private DM conversation');
    }
    if (state.department) {
      relevantState.push(`Department: ${state.department}`);
    }
    if (state.locale) {
      relevantState.push(`Locale: ${state.locale}`);
    }

    if (relevantState.length > 0) {
      context += `[THREAD STATE]\n${relevantState.join('\n')}\n\n`;
    }
  }

  // Add summary
  if (summary) {
    context += formatSummaryForContext(summary);
  }

  return context;
}
