/**
 * Rolling Summarization Service
 *
 * ChatKit-style rolling summarization to maintain conversation continuity
 * beyond the TTL window. Compresses older messages into a summary while
 * keeping recent turns verbatim.
 *
 * Policy:
 * - Keep last N items verbatim (e.g., last 20-40)
 * - Anything older: compress into thread.summary
 * - Update summary when token/char budget exceeded or every X messages
 */

import OpenAI from 'openai';
import {
  getThread,
  getThreadItems,
  getThreadItemCount,
  updateThreadSummary,
  ThreadItem,
} from './threads';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// OpenRouter client for summarization
const openrouter = OPENROUTER_API_KEY
  ? new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: OPENROUTER_API_KEY,
    })
  : null;

const SUMMARIZATION_MODEL = 'google/gemini-2.5-flash-lite';

// ============ CONFIGURATION ============

const CONFIG = {
  // Number of recent items to keep verbatim
  VERBATIM_ITEM_COUNT: 30,
  // Maximum characters before triggering summarization
  MAX_CONTEXT_CHARS: 6000,
  // Minimum items before considering summarization
  MIN_ITEMS_FOR_SUMMARY: 40,
  // How often to check for summarization (every N new items)
  SUMMARIZATION_CHECK_INTERVAL: 10,
  // Maximum summary length
  MAX_SUMMARY_CHARS: 2000,
};

// ============ SUMMARIZATION ============

/**
 * Build the summarization prompt
 */
function buildSummarizationPrompt(
  existingSummary: string | null,
  itemsToSummarize: ThreadItem[]
): string {
  let prompt = `You are summarizing a conversation for continuity. Create a concise summary that captures:
- Key topics discussed
- Important decisions or conclusions
- User preferences or context revealed
- Any ongoing threads or unresolved questions

Keep the summary factual and neutral. Focus on information that would be useful for continuing the conversation later.

`;

  if (existingSummary) {
    prompt += `EXISTING SUMMARY (incorporate and update this):
${existingSummary}

`;
  }

  prompt += `NEW MESSAGES TO INCORPORATE:
`;

  for (const item of itemsToSummarize) {
    const role = item.role || item.type.replace('_message', '');
    const author = item.authorName || role;
    const time = item.createdAt.toISOString().slice(0, 16).replace('T', ' ');
    prompt += `[${time}] ${author}: ${item.content.slice(0, 500)}\n`;
  }

  prompt += `
Create an updated summary (max 2000 characters) that merges the existing summary with these new messages. Be concise but preserve important context.`;

  return prompt;
}

/**
 * Generate summary using AI
 */
async function generateSummary(prompt: string): Promise<string | null> {
  // Try OpenRouter first
  if (openrouter) {
    try {
      const response = await openrouter.chat.completions.create({
        model: SUMMARIZATION_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
      });
      return response.choices[0]?.message?.content || null;
    } catch (error) {
      console.error('[Summarizer] OpenRouter failed:', error);
    }
  }

  // Fallback to OpenAI
  if (OPENAI_API_KEY) {
    try {
      const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
      const response = await openai.responses.create({
        model: 'gpt-5-nano-2025-08-07',
        input: prompt,
      });
      return response.output_text || null;
    } catch (error) {
      console.error('[Summarizer] OpenAI fallback failed:', error);
    }
  }

  return null;
}

/**
 * Check if a thread needs summarization
 */
export async function needsSummarization(threadId: string): Promise<boolean> {
  const itemCount = await getThreadItemCount(threadId);

  // Not enough items yet
  if (itemCount < CONFIG.MIN_ITEMS_FOR_SUMMARY) {
    return false;
  }

  // Check if we have significantly more items than verbatim threshold
  return itemCount > CONFIG.VERBATIM_ITEM_COUNT + CONFIG.SUMMARIZATION_CHECK_INTERVAL;
}

/**
 * Perform rolling summarization for a thread
 *
 * This compresses older messages into the thread summary while keeping
 * recent messages verbatim for context.
 */
export async function summarizeThread(threadId: string): Promise<boolean> {
  const thread = await getThread(threadId);
  if (!thread) {
    console.error('[Summarizer] Thread not found:', threadId);
    return false;
  }

  // Get all items (we'll select which ones to summarize)
  const allItems = await getThreadItems(threadId, {
    limit: CONFIG.VERBATIM_ITEM_COUNT + 50, // Get extra for summarization
  });

  if (allItems.length <= CONFIG.VERBATIM_ITEM_COUNT) {
    console.log('[Summarizer] Not enough items to summarize');
    return false;
  }

  // Items are returned DESC, so reverse for chronological order
  const chronological = allItems.reverse();

  // Split: keep recent verbatim, summarize older
  const verbatimItems = chronological.slice(-CONFIG.VERBATIM_ITEM_COUNT);
  const itemsToSummarize = chronological.slice(0, -CONFIG.VERBATIM_ITEM_COUNT);

  if (itemsToSummarize.length === 0) {
    return false;
  }

  console.log(`[Summarizer] Summarizing ${itemsToSummarize.length} items for thread ${threadId}`);

  // Build and generate summary
  const prompt = buildSummarizationPrompt(thread.summary, itemsToSummarize);
  const newSummary = await generateSummary(prompt);

  if (!newSummary) {
    console.error('[Summarizer] Failed to generate summary');
    return false;
  }

  // Truncate if needed
  const truncatedSummary = newSummary.length > CONFIG.MAX_SUMMARY_CHARS
    ? newSummary.slice(0, CONFIG.MAX_SUMMARY_CHARS) + '...'
    : newSummary;

  // Update thread summary
  await updateThreadSummary(threadId, truncatedSummary);

  console.log(`[Summarizer] Updated summary for thread ${threadId} (${truncatedSummary.length} chars)`);
  return true;
}

/**
 * Maybe summarize a thread if conditions are met
 * Call this after adding new items to check if summarization is needed
 */
export async function maybeSummarize(threadId: string): Promise<void> {
  try {
    if (await needsSummarization(threadId)) {
      await summarizeThread(threadId);
    }
  } catch (error) {
    console.error('[Summarizer] Error during summarization check:', error);
    // Don't throw - summarization is non-critical
  }
}

// ============ CONTEXT FORMATTING ============

/**
 * Format thread summary for inclusion in AI context
 */
export function formatSummaryForContext(summary: string | null): string {
  if (!summary) return '';

  return `[CONVERSATION HISTORY SUMMARY]
${summary}
[END SUMMARY - Recent messages follow]

`;
}

/**
 * Estimate character count for context items
 */
export function estimateContextSize(items: ThreadItem[], summary: string | null): number {
  let size = summary?.length || 0;

  for (const item of items) {
    // Estimate: author + timestamp + content + formatting
    size += (item.authorName?.length || 10) + 25 + item.content.length + 10;
  }

  return size;
}
