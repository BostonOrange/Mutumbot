/**
 * AI Tools Service
 *
 * Defines tools that the AI can use during conversations.
 * Tools are only available if the agent has the required capabilities.
 */

import {
  createScheduledEvent,
  getScheduledEvents,
  updateScheduledEvent,
  deleteScheduledEvent,
  ScheduledEvent,
  EventType,
  EVENT_TYPES,
  AVAILABLE_CAPABILITIES,
} from './agents';

// ============ TOOL DEFINITIONS ============

/**
 * OpenAI-compatible tool definition format
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description: string;
        enum?: string[];
      }>;
      required: string[];
    };
  };
}

/**
 * Tool call from the AI
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Result of executing a tool
 */
export interface ToolResult {
  tool_call_id: string;
  role: 'tool';
  content: string;
}

// ============ DISCORD INFO CALLBACK ============

/**
 * Callback for getting Discord channel info
 * Must be provided by the gateway layer
 */
export type GetChannelsCallback = (guildId: string) => Promise<Array<{
  id: string;
  name: string;
  type: 'text' | 'voice' | 'category' | 'thread' | 'other';
}>>;

let getChannelsCallback: GetChannelsCallback | null = null;

/**
 * Register the channel lookup callback
 * Called by the gateway on startup
 */
export function registerChannelLookup(callback: GetChannelsCallback): void {
  getChannelsCallback = callback;
  console.log('[Tools] Channel lookup callback registered');
}

// ============ TOOL DEFINITIONS FOR DISCORD INFO ============

export const DISCORD_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_channels',
      description: 'List all text channels in the current server/guild. Use this to find channel IDs when the user mentions a channel by name (like "#tiki-lounge"). Returns channel names and IDs.',
      parameters: {
        type: 'object',
        properties: {
          guild_id: {
            type: 'string',
            description: 'The guild/server ID to list channels for. If not provided, uses the current guild.',
          },
        },
        required: [],
      },
    },
  },
];

// ============ TOOL DEFINITIONS FOR SCHEDULING ============

export const SCHEDULING_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'create_scheduled_event',
      description: 'Create a new scheduled event (cron job) for a channel. Use this when users ask to set up reminders, scheduled messages, or recurring events. If no target channel specified, uses the current channel.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'A short name for the event (e.g., "Friday Tribute Reminder")',
          },
          cron_expression: {
            type: 'string',
            description: 'Cron expression for when to trigger. Format: "minute hour day month weekday". Examples: "0 17 * * 5" = Friday 5pm, "0 9 * * *" = Daily 9am, "0 12 * * 1-5" = Weekdays noon',
          },
          event_type: {
            type: 'string',
            description: 'Type of event to trigger',
            enum: ['tribute_reminder', 'custom_message', 'ai_prompt', 'status_report'],
          },
          message: {
            type: 'string',
            description: 'For custom_message: the message to send. For ai_prompt: the prompt for AI to generate a response.',
          },
          timezone: {
            type: 'string',
            description: 'Timezone for the schedule (default: Europe/Stockholm). Examples: UTC, America/New_York, Europe/London',
          },
          target_channel_id: {
            type: 'string',
            description: 'Discord channel ID to target (if different from current channel). Use when user specifies a channel like "#tiki-lounge" or provides a channel ID.',
          },
          target_guild_id: {
            type: 'string',
            description: 'Discord guild/server ID for the target channel. Required if target_channel_id is provided and we are in a DM.',
          },
        },
        required: ['name', 'cron_expression', 'event_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_scheduled_events',
      description: 'List all scheduled events for this channel. Use this when users ask what reminders or scheduled events are set up.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_scheduled_event',
      description: 'Delete a scheduled event. Use this when users want to cancel or remove a reminder or scheduled event.',
      parameters: {
        type: 'object',
        properties: {
          event_id: {
            type: 'string',
            description: 'The ID of the event to delete (from list_scheduled_events)',
          },
          event_name: {
            type: 'string',
            description: 'The name of the event to delete (alternative to event_id)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_scheduled_event',
      description: 'Update an existing scheduled event. Use this when users want to change the time or settings of a reminder.',
      parameters: {
        type: 'object',
        properties: {
          event_id: {
            type: 'string',
            description: 'The ID of the event to update',
          },
          event_name: {
            type: 'string',
            description: 'The name of the event to update (alternative to event_id)',
          },
          new_cron_expression: {
            type: 'string',
            description: 'New cron expression for the schedule',
          },
          new_message: {
            type: 'string',
            description: 'New message or prompt',
          },
          is_active: {
            type: 'boolean',
            description: 'Enable or disable the event',
          },
        },
        required: [],
      },
    },
  },
];

// ============ TOOL EXECUTION ============

/**
 * Get tools available to an agent based on its capabilities
 */
export function getToolsForCapabilities(capabilities: string[]): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  // Discord info tools - always available for channel lookups
  tools.push(...DISCORD_TOOLS);

  // Scheduling tools require 'scheduled_messages' capability
  if (capabilities.includes(AVAILABLE_CAPABILITIES.SCHEDULED_MESSAGES)) {
    tools.push(...SCHEDULING_TOOLS);
  }

  return tools;
}

/**
 * Execute a tool call
 */
export async function executeTool(
  toolCall: ToolCall,
  threadId: string,
  capabilities: string[]
): Promise<ToolResult> {
  const { name, arguments: argsJson } = toolCall.function;

  try {
    const args = JSON.parse(argsJson);
    let result: string;

    switch (name) {
      case 'list_channels':
        result = await executeListChannels(args, threadId);
        break;

      case 'create_scheduled_event':
        result = await executeCreateScheduledEvent(args, threadId, capabilities);
        break;

      case 'list_scheduled_events':
        result = await executeListScheduledEvents(threadId);
        break;

      case 'delete_scheduled_event':
        result = await executeDeleteScheduledEvent(args, threadId);
        break;

      case 'update_scheduled_event':
        result = await executeUpdateScheduledEvent(args, threadId);
        break;

      default:
        result = JSON.stringify({ error: `Unknown tool: ${name}` });
    }

    return {
      tool_call_id: toolCall.id,
      role: 'tool',
      content: result,
    };
  } catch (error) {
    return {
      tool_call_id: toolCall.id,
      role: 'tool',
      content: JSON.stringify({
        error: `Tool execution failed: ${(error as Error).message}`,
      }),
    };
  }
}

// ============ TOOL IMPLEMENTATIONS ============

async function executeListChannels(
  args: { guild_id?: string },
  threadId: string
): Promise<string> {
  // Extract guild ID from threadId if not provided
  let guildId = args.guild_id;

  if (!guildId) {
    const parts = threadId.split(':');
    if (parts[0] === 'discord' && parts[1] !== 'dm' && parts[1]) {
      guildId = parts[1];
    } else {
      return JSON.stringify({
        error: 'Cannot list channels: not in a guild context. Please provide guild_id.',
      });
    }
  }

  if (!getChannelsCallback) {
    return JSON.stringify({
      error: 'Channel lookup not available',
    });
  }

  try {
    const channels = await getChannelsCallback(guildId);
    const textChannels = channels.filter(c => c.type === 'text');

    return JSON.stringify({
      message: `Found ${textChannels.length} text channel(s) in this server`,
      channels: textChannels.map(c => ({
        id: c.id,
        name: c.name,
      })),
    });
  } catch (error) {
    return JSON.stringify({
      error: `Failed to list channels: ${(error as Error).message}`,
    });
  }
}

async function executeCreateScheduledEvent(
  args: {
    name: string;
    cron_expression: string;
    event_type: string;
    message?: string;
    timezone?: string;
    target_channel_id?: string;
    target_guild_id?: string;
  },
  threadId: string,
  capabilities: string[]
): Promise<string> {
  // Check capability
  if (!capabilities.includes(AVAILABLE_CAPABILITIES.SCHEDULED_MESSAGES)) {
    return JSON.stringify({
      error: 'This agent does not have permission to create scheduled events',
    });
  }

  // Determine target threadId
  let targetThreadId = threadId;
  if (args.target_channel_id) {
    // User specified a target channel
    if (args.target_guild_id) {
      // Guild channel
      targetThreadId = `discord:${args.target_guild_id}:${args.target_channel_id}`;
    } else {
      // Try to extract guild from current threadId if it's a guild channel
      const parts = threadId.split(':');
      if (parts[0] === 'discord' && parts[1] !== 'dm' && parts[1]) {
        // Current thread is in a guild, use that guild
        targetThreadId = `discord:${parts[1]}:${args.target_channel_id}`;
      } else {
        // We're in a DM and no guild specified - need guild ID
        return JSON.stringify({
          error: 'target_guild_id is required when specifying a channel from a DM. Please provide the server/guild ID.',
        });
      }
    }
  }

  // Validate event type
  const validTypes = Object.values(EVENT_TYPES);
  if (!validTypes.includes(args.event_type as EventType)) {
    return JSON.stringify({
      error: `Invalid event type. Valid types: ${validTypes.join(', ')}`,
    });
  }

  // Build payload based on event type
  const payload: Record<string, unknown> = {};
  if (args.event_type === 'custom_message' && args.message) {
    payload.message = args.message;
  } else if (args.event_type === 'ai_prompt' && args.message) {
    payload.prompt = args.message;
  }

  try {
    console.log('[Tools] Creating scheduled event:', {
      name: args.name,
      threadId: targetThreadId,
      cron: args.cron_expression,
      type: args.event_type,
      timezone: args.timezone || 'Europe/Stockholm',
    });

    const event = await createScheduledEvent(
      args.name,
      targetThreadId,
      args.cron_expression,
      args.event_type as EventType,
      {
        payload,
        timezone: args.timezone || 'Europe/Stockholm',
      }
    );

    console.log('[Tools] Event created successfully:', event.id);

    const targetInfo = args.target_channel_id
      ? ` for channel ${args.target_channel_id}`
      : '';

    return JSON.stringify({
      success: true,
      message: `Created scheduled event "${event.name}"${targetInfo}`,
      event: {
        id: event.id,
        name: event.name,
        cron: event.cronExpression,
        type: event.eventType,
        timezone: event.timezone,
        targetChannel: targetThreadId,
      },
    });
  } catch (error) {
    console.error('[Tools] Failed to create event:', error);
    return JSON.stringify({
      error: `Failed to create event: ${(error as Error).message}`,
    });
  }
}

async function executeListScheduledEvents(threadId: string): Promise<string> {
  try {
    const events = await getScheduledEvents({ threadId });

    if (events.length === 0) {
      return JSON.stringify({
        message: 'No scheduled events for this channel',
        events: [],
      });
    }

    return JSON.stringify({
      message: `Found ${events.length} scheduled event(s)`,
      events: events.map(e => ({
        id: e.id,
        name: e.name,
        cron: e.cronExpression,
        type: e.eventType,
        timezone: e.timezone,
        active: e.isActive,
        lastRun: e.lastRunAt?.toISOString() || null,
        lastStatus: e.lastRunStatus,
      })),
    });
  } catch (error) {
    return JSON.stringify({
      error: `Failed to list events: ${(error as Error).message}`,
    });
  }
}

async function executeDeleteScheduledEvent(
  args: { event_id?: string; event_name?: string },
  threadId: string
): Promise<string> {
  try {
    let eventId = args.event_id;

    // If name provided instead of ID, find the event
    if (!eventId && args.event_name) {
      const events = await getScheduledEvents({ threadId });
      const match = events.find(
        e => e.name.toLowerCase() === args.event_name!.toLowerCase()
      );
      if (match) {
        eventId = match.id;
      } else {
        return JSON.stringify({
          error: `No event found with name "${args.event_name}"`,
        });
      }
    }

    if (!eventId) {
      return JSON.stringify({
        error: 'Please provide either event_id or event_name',
      });
    }

    const deleted = await deleteScheduledEvent(eventId);

    if (deleted) {
      return JSON.stringify({
        success: true,
        message: 'Scheduled event deleted',
      });
    } else {
      return JSON.stringify({
        error: 'Event not found or already deleted',
      });
    }
  } catch (error) {
    return JSON.stringify({
      error: `Failed to delete event: ${(error as Error).message}`,
    });
  }
}

async function executeUpdateScheduledEvent(
  args: {
    event_id?: string;
    event_name?: string;
    new_cron_expression?: string;
    new_message?: string;
    is_active?: boolean;
  },
  threadId: string
): Promise<string> {
  try {
    let eventId = args.event_id;

    // If name provided instead of ID, find the event
    if (!eventId && args.event_name) {
      const events = await getScheduledEvents({ threadId });
      const match = events.find(
        e => e.name.toLowerCase() === args.event_name!.toLowerCase()
      );
      if (match) {
        eventId = match.id;
      } else {
        return JSON.stringify({
          error: `No event found with name "${args.event_name}"`,
        });
      }
    }

    if (!eventId) {
      return JSON.stringify({
        error: 'Please provide either event_id or event_name',
      });
    }

    const updates: Record<string, unknown> = {};
    if (args.new_cron_expression) {
      updates.cronExpression = args.new_cron_expression;
    }
    if (args.is_active !== undefined) {
      updates.isActive = args.is_active;
    }
    if (args.new_message) {
      // Get current event to determine payload type
      const events = await getScheduledEvents({ threadId });
      const current = events.find(e => e.id === eventId);
      if (current) {
        if (current.eventType === 'custom_message') {
          updates.payload = { ...current.payload, message: args.new_message };
        } else if (current.eventType === 'ai_prompt') {
          updates.payload = { ...current.payload, prompt: args.new_message };
        }
      }
    }

    const updated = await updateScheduledEvent(eventId, updates);

    if (updated) {
      return JSON.stringify({
        success: true,
        message: 'Scheduled event updated',
        event: {
          id: updated.id,
          name: updated.name,
          cron: updated.cronExpression,
          active: updated.isActive,
        },
      });
    } else {
      return JSON.stringify({
        error: 'Event not found',
      });
    }
  } catch (error) {
    return JSON.stringify({
      error: `Failed to update event: ${(error as Error).message}`,
    });
  }
}

// ============ CRON EXPRESSION HELPERS ============

/**
 * Common cron patterns for reference
 */
export const CRON_PATTERNS = {
  // Weekly
  'friday_5pm': '0 17 * * 5',
  'monday_9am': '0 9 * * 1',
  'sunday_noon': '0 12 * * 0',

  // Daily
  'daily_9am': '0 9 * * *',
  'daily_noon': '0 12 * * *',
  'daily_6pm': '0 18 * * *',

  // Weekdays
  'weekdays_9am': '0 9 * * 1-5',
  'weekdays_5pm': '0 17 * * 1-5',

  // Monthly
  'first_of_month': '0 9 1 * *',
  'last_friday': '0 17 * * 5#L',
} as const;

/**
 * Describe a cron expression in human terms
 */
export function describeCron(cron: string): string {
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;

  const [minute, hour, day, month, weekday] = parts;

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  let desc = '';

  // Time
  if (hour !== '*' && minute !== '*') {
    desc += `at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  }

  // Day of week
  if (weekday !== '*') {
    if (weekday.includes('-')) {
      const [start, end] = weekday.split('-').map(Number);
      desc += ` ${days[start]} to ${days[end]}`;
    } else if (weekday.includes(',')) {
      const dayNames = weekday.split(',').map(d => days[Number(d)]);
      desc += ` on ${dayNames.join(', ')}`;
    } else {
      desc += ` every ${days[Number(weekday)]}`;
    }
  } else if (day !== '*') {
    desc += ` on day ${day} of the month`;
  } else {
    desc += ' every day';
  }

  return desc.trim();
}
