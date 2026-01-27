/**
 * Retention Job
 *
 * Periodic cleanup job that:
 * - Purges messages older than TTL (default 4 hours)
 * - Purges thread items older than TTL (ChatKit-style cleanup)
 * - Purges old runs after 24 hours (keep for debugging)
 * - Caps messages per channel to prevent spam dominance
 *
 * This keeps the Neon DB lean and fast while maintaining
 * rolling summaries for conversation continuity.
 */

import * as cron from 'node-cron';
import { purgeOldMessages } from '../services/messageIngestor';
import { purgeOldThreadItems, purgeOldRuns } from '../services/threads';

// Configuration
const MESSAGE_TTL_HOURS = 4;
const THREAD_ITEMS_TTL_HOURS = 4; // Same as messages for consistency
const RUNS_TTL_HOURS = 24; // Keep runs longer for debugging
const CLEANUP_CRON = '0 * * * *'; // Every hour at minute 0

let scheduledTask: cron.ScheduledTask | null = null;

/**
 * Run the retention cleanup
 */
async function runRetentionCleanup(): Promise<void> {
  console.log('[Retention] Starting cleanup...');
  const startTime = Date.now();

  try {
    // Cleanup legacy messages
    const purgedMessages = await purgeOldMessages(MESSAGE_TTL_HOURS);

    // Cleanup ChatKit-style thread items (summaries are preserved in threads table)
    const purgedItems = await purgeOldThreadItems(THREAD_ITEMS_TTL_HOURS);

    // Cleanup old runs (keep longer for debugging)
    const purgedRuns = await purgeOldRuns(RUNS_TTL_HOURS);

    const duration = Date.now() - startTime;
    console.log(`[Retention] Cleanup complete in ${duration}ms: ${purgedMessages} messages, ${purgedItems} thread items, ${purgedRuns} runs`);
  } catch (error) {
    console.error('[Retention] Cleanup failed:', error);
  }
}

/**
 * Start the retention cleanup job
 */
export function startRetentionJob(): void {
  if (scheduledTask) {
    console.log('[Retention] Job already running');
    return;
  }

  // Schedule hourly cleanup
  scheduledTask = cron.schedule(CLEANUP_CRON, () => {
    runRetentionCleanup();
  }, {
    timezone: 'UTC',
  });

  console.log(`[Retention] Scheduled cleanup every hour (TTL: ${MESSAGE_TTL_HOURS}h)`);

  // Run initial cleanup after a short delay (let DB initialize first)
  setTimeout(() => {
    runRetentionCleanup();
  }, 10000);
}

/**
 * Stop the retention job
 */
export function stopRetentionJob(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[Retention] Job stopped');
  }
}

/**
 * Run cleanup immediately (for manual triggers)
 */
export async function runCleanupNow(): Promise<number> {
  console.log('[Retention] Manual cleanup triggered');
  return await purgeOldMessages(MESSAGE_TTL_HOURS);
}
