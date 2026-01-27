/**
 * Event Scheduler
 *
 * Manages cron jobs for scheduled events.
 * Each scheduled event gets its own cron job that executes when triggered.
 */

import * as cron from 'node-cron';
import {
  getScheduledEvents,
  ScheduledEvent,
} from '../services/agents';
import {
  executeEvent,
  registerMessageSender,
  SendMessageCallback,
} from '../services/eventExecutor';

// Map of event ID to cron task
const scheduledTasks: Map<string, cron.ScheduledTask> = new Map();

// Refresh interval (check for new/updated events)
const REFRESH_INTERVAL_MINUTES = 5;
let refreshTask: cron.ScheduledTask | null = null;

/**
 * Initialize the event scheduler
 */
export async function initializeEventScheduler(
  messageSender: SendMessageCallback
): Promise<void> {
  console.log('[EventScheduler] Initializing...');

  // Register the message sender with the executor
  registerMessageSender(messageSender);

  // Load and schedule all active events
  await refreshScheduledEvents();

  // Set up periodic refresh to catch new/updated events
  refreshTask = cron.schedule(`*/${REFRESH_INTERVAL_MINUTES} * * * *`, async () => {
    await refreshScheduledEvents();
  });

  console.log('[EventScheduler] Initialized with refresh every', REFRESH_INTERVAL_MINUTES, 'minutes');
}

/**
 * Refresh scheduled events from database
 */
async function refreshScheduledEvents(): Promise<void> {
  try {
    const events = await getScheduledEvents({ activeOnly: true });

    // Track which events we've seen
    const currentEventIds = new Set<string>();

    for (const event of events) {
      currentEventIds.add(event.id);

      // Check if this event already has a task
      const existingTask = scheduledTasks.get(event.id);

      if (existingTask) {
        // Check if cron expression changed (would need to reschedule)
        // For now, we just keep the existing task
        continue;
      }

      // Schedule new event
      scheduleEvent(event);
    }

    // Remove tasks for events that are no longer active
    for (const [eventId, task] of scheduledTasks) {
      if (!currentEventIds.has(eventId)) {
        console.log(`[EventScheduler] Removing inactive event: ${eventId}`);
        task.stop();
        scheduledTasks.delete(eventId);
      }
    }

    console.log(`[EventScheduler] Active events: ${scheduledTasks.size}`);
  } catch (error) {
    console.error('[EventScheduler] Failed to refresh events:', error);
  }
}

/**
 * Schedule a single event
 */
function scheduleEvent(event: ScheduledEvent): void {
  // Validate cron expression
  if (!cron.validate(event.cronExpression)) {
    console.error(`[EventScheduler] Invalid cron expression for event ${event.name}: ${event.cronExpression}`);
    return;
  }

  console.log(`[EventScheduler] Scheduling event: ${event.name} (${event.cronExpression})`);

  const task = cron.schedule(
    event.cronExpression,
    async () => {
      console.log(`[EventScheduler] Triggering event: ${event.name}`);
      try {
        const result = await executeEvent(event);
        if (result.success) {
          console.log(`[EventScheduler] Event ${event.name} completed successfully`);
        } else {
          console.error(`[EventScheduler] Event ${event.name} failed:`, result.error);
        }
      } catch (error) {
        console.error(`[EventScheduler] Event ${event.name} threw error:`, error);
      }
    },
    {
      timezone: event.timezone || 'UTC',
    }
  );

  scheduledTasks.set(event.id, task);
}

/**
 * Manually trigger an event (for testing)
 */
export async function triggerEventNow(eventId: string): Promise<boolean> {
  const events = await getScheduledEvents();
  const event = events.find(e => e.id === eventId);

  if (!event) {
    console.error(`[EventScheduler] Event not found: ${eventId}`);
    return false;
  }

  console.log(`[EventScheduler] Manually triggering event: ${event.name}`);
  const result = await executeEvent(event);
  return result.success;
}

/**
 * Stop all scheduled tasks
 */
export function stopEventScheduler(): void {
  console.log('[EventScheduler] Stopping...');

  // Stop refresh task
  if (refreshTask) {
    refreshTask.stop();
    refreshTask = null;
  }

  // Stop all event tasks
  for (const [eventId, task] of scheduledTasks) {
    task.stop();
  }
  scheduledTasks.clear();

  console.log('[EventScheduler] Stopped');
}

/**
 * Force refresh of scheduled events
 */
export async function forceRefresh(): Promise<void> {
  await refreshScheduledEvents();
}

/**
 * Get status of all scheduled events
 */
export function getSchedulerStatus(): {
  activeEvents: number;
  eventIds: string[];
} {
  return {
    activeEvents: scheduledTasks.size,
    eventIds: Array.from(scheduledTasks.keys()),
  };
}
