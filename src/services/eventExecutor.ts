/**
 * Event Executor Service
 *
 * Executes scheduled events based on their type and configuration.
 * Called by the cron scheduler when an event's time comes.
 */

import {
  ScheduledEvent,
  EventType,
  EVENT_TYPES,
  resolveConfigWithDefaults,
  recordEventRun,
} from './agents';
import { handleDrinkQuestion } from '../drink-questions';
import {
  ISEE_EMOJI,
  TRIBUTE_DEMAND_PHRASES,
  getRandomPhrase,
  processIseeMarkers,
} from '../personality';

/**
 * Result of executing an event
 */
export interface EventExecutionResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Callback for sending messages to Discord
 * Must be provided by the gateway layer
 */
export type SendMessageCallback = (
  threadId: string,
  content: string,
  options?: { mentionRole?: string }
) => Promise<boolean>;

// Message sender callback (set by gateway)
let sendMessage: SendMessageCallback | null = null;

/**
 * Register the message sending callback
 * Called by the gateway on startup
 */
export function registerMessageSender(callback: SendMessageCallback): void {
  sendMessage = callback;
  console.log('[EventExecutor] Message sender registered');
}

/**
 * Execute a scheduled event
 */
export async function executeEvent(event: ScheduledEvent): Promise<EventExecutionResult> {
  console.log(`[EventExecutor] Executing event: ${event.name} (${event.eventType})`);

  if (!sendMessage) {
    const error = 'Message sender not registered';
    console.error(`[EventExecutor] ${error}`);
    await recordEventRun(event.id, 'failed', error);
    return { success: false, error };
  }

  try {
    let result: EventExecutionResult;

    switch (event.eventType) {
      case EVENT_TYPES.TRIBUTE_REMINDER:
        result = await executeTributeReminder(event);
        break;

      case EVENT_TYPES.CUSTOM_MESSAGE:
        result = await executeCustomMessage(event);
        break;

      case EVENT_TYPES.STATUS_REPORT:
        result = await executeStatusReport(event);
        break;

      case EVENT_TYPES.AI_PROMPT:
        result = await executeAiPrompt(event);
        break;

      case EVENT_TYPES.CHANNEL_SUMMARY:
        result = await executeChannelSummary(event);
        break;

      default:
        result = {
          success: false,
          error: `Unknown event type: ${event.eventType}`,
        };
    }

    // Record the run result
    await recordEventRun(
      event.id,
      result.success ? 'success' : 'failed',
      result.error
    );

    return result;
  } catch (error) {
    const errorMessage = (error as Error).message || String(error);
    console.error(`[EventExecutor] Event failed:`, error);
    await recordEventRun(event.id, 'failed', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Execute a tribute reminder event
 */
async function executeTributeReminder(event: ScheduledEvent): Promise<EventExecutionResult> {
  const message = getRandomPhrase(TRIBUTE_DEMAND_PHRASES);

  const sent = await sendMessage!(event.threadId, message, {
    mentionRole: event.payload.mentionRole,
  });

  if (sent) {
    return { success: true, message: 'Tribute reminder sent' };
  } else {
    return { success: false, error: 'Failed to send message' };
  }
}

/**
 * Execute a custom message event
 */
async function executeCustomMessage(event: ScheduledEvent): Promise<EventExecutionResult> {
  const template = event.payload.message;
  if (!template) {
    return { success: false, error: 'No message template in payload' };
  }

  // Process any [ISEE] markers in the template
  const message = processIseeMarkers(template);

  const sent = await sendMessage!(event.threadId, message, {
    mentionRole: event.payload.mentionRole,
  });

  if (sent) {
    return { success: true, message: 'Custom message sent' };
  } else {
    return { success: false, error: 'Failed to send message' };
  }
}

/**
 * Execute a status report event
 */
async function executeStatusReport(event: ScheduledEvent): Promise<EventExecutionResult> {
  // Build status report message
  let message = `${ISEE_EMOJI} **STATUS REPORT**\n\n`;

  // TODO: Integrate with tribute tracking to get real stats
  if (event.payload.includeTributeCount) {
    message += `The spirits have received tributes this week.\n`;
  }

  if (event.payload.includeLeaderboard) {
    message += `The faithful devotees are honored.\n`;
  }

  const sent = await sendMessage!(event.threadId, message, {
    mentionRole: event.payload.mentionRole,
  });

  if (sent) {
    return { success: true, message: 'Status report sent' };
  } else {
    return { success: false, error: 'Failed to send message' };
  }
}

/**
 * Execute an AI prompt event - generates content using the agent's persona
 */
async function executeAiPrompt(event: ScheduledEvent): Promise<EventExecutionResult> {
  const prompt = event.payload.prompt;
  if (!prompt) {
    return { success: false, error: 'No prompt in payload' };
  }

  // Parse threadId to get channelId and guildId
  const parts = event.threadId.split(':');
  let guildId: string | null = null;
  let channelId: string;

  if (parts[0] === 'discord') {
    if (parts[1] === 'dm') {
      channelId = parts[2];
    } else {
      guildId = parts[1];
      channelId = parts[2];
    }
  } else {
    return { success: false, error: 'Invalid threadId format' };
  }

  // Use the drink question handler to generate a response
  const response = await handleDrinkQuestion(
    prompt,
    channelId,
    undefined, // aiContext
    undefined, // messageId
    guildId
  );

  if (!response.content) {
    return { success: false, error: 'AI generated empty response' };
  }

  const sent = await sendMessage!(event.threadId, response.content, {
    mentionRole: event.payload.mentionRole,
  });

  if (sent) {
    return { success: true, message: 'AI-generated message sent' };
  } else {
    return { success: false, error: 'Failed to send message' };
  }
}

/**
 * Execute a channel summary event
 */
async function executeChannelSummary(event: ScheduledEvent): Promise<EventExecutionResult> {
  // Use AI to summarize recent activity
  const prompt = `Summarize the recent activity in this channel. Be brief and dramatic, as befitting an ancient tiki entity. Keep it under 500 characters.`;

  const response = await executeAiPrompt({
    ...event,
    payload: { ...event.payload, prompt },
  });

  return response;
}

/**
 * Parse thread ID to extract Discord IDs
 */
export function parseThreadId(threadId: string): {
  guildId: string | null;
  channelId: string;
} | null {
  const parts = threadId.split(':');

  if (parts[0] !== 'discord') {
    return null;
  }

  if (parts[1] === 'dm') {
    return { guildId: null, channelId: parts[2] };
  }

  return { guildId: parts[1], channelId: parts[2] };
}
