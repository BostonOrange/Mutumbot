/**
 * Conversation Context Service
 *
 * Stores recent messages per channel to give Mutumbot short-term memory
 * for more contextual AI responses.
 */

export interface ContextMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

// In-memory storage for conversation context
// Key: channelId, Value: array of recent messages
const contextCache = new Map<string, ContextMessage[]>();

// Maximum number of messages to remember per channel
const MAX_CONTEXT_MESSAGES = 20;

// Context expiry time in milliseconds (30 minutes)
const CONTEXT_EXPIRY_MS = 30 * 60 * 1000;

/**
 * Add a message to the conversation context for a channel
 */
export function addToContext(
  channelId: string,
  role: 'user' | 'model',
  text: string
): void {
  const history = contextCache.get(channelId) || [];

  history.push({
    role,
    text,
    timestamp: Date.now(),
  });

  // Keep only the most recent messages
  if (history.length > MAX_CONTEXT_MESSAGES) {
    history.shift();
  }

  contextCache.set(channelId, history);
}

/**
 * Get the conversation context for a channel
 * Returns only non-expired messages
 */
export function getContext(channelId: string): ContextMessage[] {
  const history = contextCache.get(channelId) || [];
  const now = Date.now();

  // Filter out expired messages
  const validHistory = history.filter(
    msg => now - msg.timestamp < CONTEXT_EXPIRY_MS
  );

  // Update cache if we filtered anything out
  if (validHistory.length !== history.length) {
    if (validHistory.length === 0) {
      contextCache.delete(channelId);
    } else {
      contextCache.set(channelId, validHistory);
    }
  }

  return validHistory;
}

/**
 * Clear the conversation context for a channel
 */
export function clearContext(channelId: string): void {
  contextCache.delete(channelId);
}

/**
 * Get the number of channels with active context
 * (useful for debugging/monitoring)
 */
export function getActiveContextCount(): number {
  return contextCache.size;
}

/**
 * Format context for Gemini AI chat history
 * Merges consecutive messages with the same role since Gemini requires
 * alternating user/model turns
 */
export function formatContextForAI(
  channelId: string
): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  const context = getContext(channelId);

  // Merge consecutive messages with the same role
  const merged: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  for (const msg of context) {
    const lastMsg = merged[merged.length - 1];
    if (lastMsg && lastMsg.role === msg.role) {
      // Append to existing message with same role
      lastMsg.parts[0].text += '\n' + msg.text;
    } else {
      // Add new message
      merged.push({
        role: msg.role,
        parts: [{ text: msg.text }],
      });
    }
  }

  return merged;
}
